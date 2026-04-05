import { Injectable, Logger } from '@nestjs/common';
import { eq, and, or, sql } from 'drizzle-orm';
import { StepHandler, DbAggregateHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { pipelineData } from '../../db/schema';
import { PipelineSchemasService } from '../pipeline-schemas.service';
import { db } from '../../db/client';
import { ConfigurationError, SchemaNotFoundError } from '../errors';

/**
 * DB Aggregate Handler
 *
 * Performs aggregation directly at the database level using PostgreSQL.
 * Efficient for large datasets — pushes computation to PostgreSQL.
 * Supports count, sum, avg, min, max, array_length with optional filtering on JSONB fields.
 */
@Injectable()
export class DbAggregateHandler implements StepHandler<DbAggregateHandlerConfig> {
  readonly type = 'db_aggregate' as const;
  private readonly logger = new Logger(DbAggregateHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    private readonly schemasService: PipelineSchemasService,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: DbAggregateHandlerConfig): void {
    if (!config.schemaId) {
      throw new ConfigurationError('schemaId is required', 'db_aggregate');
    }

    const validOps = ['sum', 'count', 'avg', 'min', 'max', 'array_length'];
    if (!config.operation || !validOps.includes(config.operation)) {
      throw new ConfigurationError(
        `operation is required and must be one of: ${validOps.join(', ')}`,
        'db_aggregate',
      );
    }

    if (config.operation !== 'count' && !config.field) {
      throw new ConfigurationError(
        `field is required for '${config.operation}' operation`,
        'db_aggregate',
      );
    }

    // Validate filter operators
    if (config.filters) {
      const validFilterOps = ['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'like'];
      for (const [field, filter] of Object.entries(config.filters)) {
        if (!validFilterOps.includes(filter.op)) {
          throw new ConfigurationError(
            `Invalid operator '${filter.op}' for field '${field}'. Valid operators: ${validFilterOps.join(', ')}`,
            'db_aggregate',
          );
        }
      }
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as DbAggregateHandlerConfig;
    const stepName = step.name || 'db_aggregate';

    this.logger.debug(`Executing db aggregate handler for step '${stepName}'`);

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

    // Build filter conditions on JSONB data fields
    if (config.filters) {
      const filterConditions: ReturnType<typeof sql>[] = [];

      for (const [fieldName, filter] of Object.entries(config.filters)) {
        const value = this.expressionEvaluator.evaluateExpression(
          filter.value,
          context,
          stepName,
        );

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

      if (filterConditions.length > 0) {
        const combinedFilters = config.filterLogic === 'or'
          ? or(...filterConditions)
          : and(...filterConditions);
        if (combinedFilters) {
          baseConditions.push(combinedFilters);
        }
      }
    }

    const whereClause = and(...baseConditions);
    const { operation, field, groupBy } = config;

    this.logger.debug(`Running ${operation} aggregation${field ? ` on field '${field}'` : ''}${groupBy ? ` grouped by '${groupBy}'` : ''}`);

    // When groupBy is set, we SELECT the group key + aggregate, with GROUP BY
    if (groupBy) {
      const groupKeyExpr = sql`${pipelineData.data}->>${sql.raw(`'${groupBy}'`)}`;

      let aggExpr: ReturnType<typeof sql>;
      switch (operation) {
        case 'count':
          aggExpr = sql<string>`COUNT(*)`;
          break;
        case 'sum':
          aggExpr = sql<string>`COALESCE(SUM((${pipelineData.data}->>${sql.raw(`'${field!}'`)})::numeric), 0)`;
          break;
        case 'avg':
          aggExpr = sql<string>`AVG((${pipelineData.data}->>${sql.raw(`'${field!}'`)})::numeric)`;
          break;
        case 'min':
          aggExpr = sql<string>`MIN((${pipelineData.data}->>${sql.raw(`'${field!}'`)})::numeric)`;
          break;
        case 'max':
          aggExpr = sql<string>`MAX((${pipelineData.data}->>${sql.raw(`'${field!}'`)})::numeric)`;
          break;
        case 'array_length':
          aggExpr = sql<string>`COALESCE(SUM(jsonb_array_length(${pipelineData.data}->${sql.raw(`'${field!}'`)})), 0)`;
          break;
        default:
          aggExpr = sql<string>`COUNT(*)`;
      }

      const rows = await db
        .select({
          key: sql<string>`${groupKeyExpr}`,
          value: aggExpr,
        })
        .from(pipelineData)
        .where(whereClause)
        .groupBy(groupKeyExpr);

      const results = rows.map((row) => ({
        key: row.key,
        value: row.value != null ? Number(row.value) : null,
      }));

      this.logger.debug(`Grouped aggregation returned ${results.length} groups`);

      return {
        success: true,
        output: {
          operation,
          ...(operation !== 'count' && field ? { field } : {}),
          groupBy,
          results,
        },
      };
    }

    // Non-grouped aggregation (original behavior)
    let result: number | null;

    switch (operation) {
      case 'count': {
        const rows = await db
          .select({ result: sql<string>`COUNT(*)` })
          .from(pipelineData)
          .where(whereClause);
        result = Number(rows[0]?.result ?? 0);
        break;
      }

      case 'sum': {
        const rows = await db
          .select({
            result: sql<string>`COALESCE(SUM((${pipelineData.data}->>${sql.raw(`'${field!}'`)})::numeric), 0)`,
          })
          .from(pipelineData)
          .where(whereClause);
        result = Number(rows[0]?.result ?? 0);
        break;
      }

      case 'avg': {
        const rows = await db
          .select({
            result: sql<string | null>`AVG((${pipelineData.data}->>${sql.raw(`'${field!}'`)})::numeric)`,
          })
          .from(pipelineData)
          .where(whereClause);
        result = rows[0]?.result != null ? Number(rows[0].result) : null;
        break;
      }

      case 'min': {
        const rows = await db
          .select({
            result: sql<string | null>`MIN((${pipelineData.data}->>${sql.raw(`'${field!}'`)})::numeric)`,
          })
          .from(pipelineData)
          .where(whereClause);
        result = rows[0]?.result != null ? Number(rows[0].result) : null;
        break;
      }

      case 'max': {
        const rows = await db
          .select({
            result: sql<string | null>`MAX((${pipelineData.data}->>${sql.raw(`'${field!}'`)})::numeric)`,
          })
          .from(pipelineData)
          .where(whereClause);
        result = rows[0]?.result != null ? Number(rows[0].result) : null;
        break;
      }

      case 'array_length': {
        // Sum the lengths of a JSON array field across all matching rows
        // Uses jsonb_array_length() which reads array size from JSONB metadata
        const rows = await db
          .select({
            result: sql<string>`COALESCE(SUM(jsonb_array_length(${pipelineData.data}->${sql.raw(`'${field!}'`)})), 0)`,
          })
          .from(pipelineData)
          .where(whereClause);
        result = Number(rows[0]?.result ?? 0);
        break;
      }
    }

    this.logger.debug(`Aggregation result: ${result}`);

    return {
      success: true,
      output: {
        operation,
        ...(operation !== 'count' && field ? { field } : {}),
        result,
      },
    };
  }
}
