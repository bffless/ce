import { Injectable, Logger } from '@nestjs/common';
import { eq, and, desc, sql } from 'drizzle-orm';
import { StepHandler, DataQueryHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep, pipelineData, PipelineData } from '../../db/schema';
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

    // Build where conditions - always filter by projectId for security
    const conditions = [
      eq(pipelineData.schemaId, config.schemaId),
      eq(pipelineData.projectId, context.projectId),
    ];

    // Add filter conditions
    if (config.filters) {
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
            conditions.push(sql`${fieldPath} = ${String(value)}`);
            break;
          case 'ne':
            conditions.push(sql`${fieldPath} != ${String(value)}`);
            break;
          case 'gt':
            conditions.push(sql`(${fieldPath})::numeric > ${Number(value)}`);
            break;
          case 'lt':
            conditions.push(sql`(${fieldPath})::numeric < ${Number(value)}`);
            break;
          case 'gte':
            conditions.push(sql`(${fieldPath})::numeric >= ${Number(value)}`);
            break;
          case 'lte':
            conditions.push(sql`(${fieldPath})::numeric <= ${Number(value)}`);
            break;
          case 'like':
            conditions.push(sql`${fieldPath} ILIKE ${String(value)}`);
            break;
        }
      }
    }

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
      .limit(config.limit ?? 100)
      .offset(config.offset ?? 0);

    // Format results - include id and data fields
    const results = records.map((record) => {
      const data = record.data as Record<string, unknown>;

      // If select is specified, only return those fields
      if (config.select && config.select.length > 0) {
        const selected: Record<string, unknown> = { id: record.id };
        for (const field of config.select) {
          if (field === 'id') continue;
          if (field === 'createdAt') {
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
        ...data,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
    });

    this.logger.debug(`Query returned ${results.length} records`);

    // Return single record if limit is 1, otherwise return array
    const output = config.limit === 1 ? (results[0] || null) : results;

    return {
      success: true,
      output,
    };
  }
}
