import { Injectable, Logger } from '@nestjs/common';
import { eq, and, or, desc, sql } from 'drizzle-orm';
import { StepHandler, DataQueryHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { pipelineData, PipelineData } from '../../db/schema';
import { PipelineSchemasService } from '../pipeline-schemas.service';
import { db } from '../../db/client';
import { ConfigurationError, SchemaNotFoundError } from '../errors';

/**
 * Data Query Handler
 *
 * Queries data from a pipeline schema with filtering, sorting, and pagination.
 * Supports operators: eq, ne, gt, lt, gte, lte, like
 */
@Injectable()
export class DataQueryHandler implements StepHandler<DataQueryHandlerConfig> {
  readonly type = 'data_query' as const;
  private readonly logger = new Logger(DataQueryHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    private readonly schemasService: PipelineSchemasService,
  ) {
    this.registry.register(this);
  }

  /**
   * Resolve a config value that may be a number or an expression string.
   * Returns the resolved number, or the default if the value is not set.
   */
  private resolveNumericExpression(
    value: number | string | undefined,
    defaultValue: number,
    context: PipelineContext,
    stepName: string,
  ): number {
    if (value === undefined || value === null) {
      return defaultValue;
    }
    if (typeof value === 'number') {
      return value;
    }
    const resolved = this.expressionEvaluator.evaluateExpression(value, context, stepName);
    const num = Number(resolved);
    return isNaN(num) ? defaultValue : num;
  }

  validateConfig(config: DataQueryHandlerConfig): void {
    if (!config.schemaId) {
      throw new ConfigurationError('schemaId is required', 'data_query');
    }

    // Validate filter operators
    if (config.filters) {
      const validOps = ['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'like'];
      for (const [field, filter] of Object.entries(config.filters)) {
        if (!validOps.includes(filter.op)) {
          throw new ConfigurationError(
            `Invalid operator '${filter.op}' for field '${field}'. Valid operators: ${validOps.join(', ')}`,
            'data_query',
          );
        }
      }
    }

    // Validate orderBy direction
    if (config.orderBy && config.orderBy.direction) {
      const validDirections = ['asc', 'desc'];
      if (!validDirections.includes(config.orderBy.direction)) {
        throw new ConfigurationError(
          `Invalid order direction '${config.orderBy.direction}'. Valid values: ${validDirections.join(', ')}`,
          'data_query',
        );
      }
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as DataQueryHandlerConfig;
    const stepName = step.name || 'data_query';

    this.logger.debug(`Executing data query handler for step '${stepName}'`);

    // Verify schema exists and belongs to project
    const schema = await this.schemasService.getById(config.schemaId);
    if (!schema) {
      throw new SchemaNotFoundError(config.schemaId, stepName);
    }

    if (schema.projectId !== context.projectId) {
      throw new ConfigurationError(
        `Schema '${config.schemaId}' does not belong to this project`,
        stepName,
      );
    }

    // Build where conditions - always filter by projectId and schemaId for security
    const baseConditions = [
      eq(pipelineData.schemaId, config.schemaId),
      eq(pipelineData.projectId, context.projectId),
    ];

    // If recordId is specified, find by table ID directly (ignores other filters)
    if (config.recordId) {
      const recordIdValue = this.expressionEvaluator.evaluateExpression(
        config.recordId,
        context,
        stepName,
      );
      baseConditions.push(eq(pipelineData.id, String(recordIdValue)));
    } else if (config.filters) {
      // Collect filter conditions on JSON data fields
      const filterConditions: ReturnType<typeof sql>[] = [];

      for (const [fieldName, filter] of Object.entries(config.filters)) {
        // Evaluate the filter value as an expression
        const value = this.expressionEvaluator.evaluateExpression(
          filter.value,
          context,
          stepName,
        );

        // Build JSONB field accessor for the data column
        const fieldPath = sql`${pipelineData.data}->>${sql.raw(`'${fieldName}'`)}`;

        switch (filter.op) {
          case 'eq':
            filterConditions.push(sql`${fieldPath} = ${String(value)}`);
            break;
          case 'ne':
            filterConditions.push(sql`${fieldPath} != ${String(value)}`);
            break;
          case 'gt':
            filterConditions.push(sql`(${fieldPath})::numeric > ${Number(value)}`);
            break;
          case 'lt':
            filterConditions.push(sql`(${fieldPath})::numeric < ${Number(value)}`);
            break;
          case 'gte':
            filterConditions.push(sql`(${fieldPath})::numeric >= ${Number(value)}`);
            break;
          case 'lte':
            filterConditions.push(sql`(${fieldPath})::numeric <= ${Number(value)}`);
            break;
          case 'like':
            filterConditions.push(sql`${fieldPath} ILIKE ${String(value)}`);
            break;
        }
      }

      // Combine filter conditions with AND or OR based on filterLogic
      if (filterConditions.length > 0) {
        const combinedFilters = config.filterLogic === 'or'
          ? or(...filterConditions)
          : and(...filterConditions);
        if (combinedFilters) {
          baseConditions.push(combinedFilters);
        }
      }
    }

    // All conditions are combined with AND (base + filters)
    const conditions = baseConditions;

    // Build order by clause
    let orderByClause;
    if (config.orderBy) {
      const fieldPath = sql`${pipelineData.data}->>${sql.raw(`'${config.orderBy.field}'`)}`;
      if (config.orderBy.direction === 'desc') {
        orderByClause = sql`${fieldPath} DESC`;
      } else {
        orderByClause = sql`${fieldPath} ASC`;
      }
    } else {
      orderByClause = desc(pipelineData.createdAt);
    }

    // Execute query with all options
    const records: PipelineData[] = await db
      .select()
      .from(pipelineData)
      .where(and(...conditions))
      .orderBy(orderByClause)
      .limit(this.resolveNumericExpression(config.limit, 100, context, stepName))
      .offset(this.resolveNumericExpression(config.offset, 0, context, stepName));

    // Format results - include id and data fields
    const results = records.map((record) => {
      const data = record.data as Record<string, unknown>;

      // If select is specified, only return those fields
      if (config.select && config.select.length > 0) {
        const selected: Record<string, unknown> = { id: record.id };
        for (const field of config.select) {
          if (field === 'id') continue;
          if (field === 'alias') {
            selected.alias = record.alias;
          } else if (field === 'version') {
            selected.version = record.version;
          } else if (field === 'createdAt') {
            selected.createdAt = record.createdAt;
          } else if (field === 'updatedAt') {
            selected.updatedAt = record.updatedAt;
          } else {
            selected[field] = data[field];
          }
        }
        return selected;
      }

      // Return all fields
      return {
        id: record.id,
        alias: record.alias,
        version: record.version,
        ...data,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
    });

    this.logger.debug(`Query returned ${results.length} records`);

    // Return single object when:
    // - recordId is specified (find by ID)
    // - single is true (find one)
    // - limit is 1 (legacy behavior)
    const resolvedLimit = this.resolveNumericExpression(config.limit, 100, context, stepName);
    const returnSingle = config.recordId || config.single || resolvedLimit === 1;
    const output = returnSingle ? (results[0] || null) : results;

    return {
      success: true,
      output,
    };
  }
}
