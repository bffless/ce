import { Injectable, Logger } from '@nestjs/common';
import { eq, and, sql, SQL } from 'drizzle-orm';
import { StepHandler, DataUpdateHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { pipelineData } from '../../db/schema';
import { PipelineSchemasService } from '../pipeline-schemas.service';
import { db } from '../../db/client';
import { ConfigurationError, SchemaNotFoundError } from '../errors';
import { buildFilterConditions, validateFilterOps } from './filter-where.util';
import { coerceFieldsToSchema } from './field-coercion.util';

/**
 * Data Update Handler
 *
 * Updates existing records in a pipeline schema, either by recordId or by
 * filter predicate (update-by-query). Filters support the same operator set as
 * data_query: eq, ne, gt, lt, gte, lte, like, in (see filter-where.util).
 */
@Injectable()
export class DataUpdateHandler implements StepHandler<DataUpdateHandlerConfig> {
  readonly type = 'data_update' as const;
  private readonly logger = new Logger(DataUpdateHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    private readonly schemasService: PipelineSchemasService,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: DataUpdateHandlerConfig): void {
    if (!config.schemaId) {
      throw new ConfigurationError('schemaId is required', 'data_update');
    }

    // Either recordId or filters must be provided
    const hasRecordId = config.recordId && config.recordId.trim();
    const hasFilters = config.filters && Object.keys(config.filters).length > 0;

    if (!hasRecordId && !hasFilters) {
      throw new ConfigurationError('Either recordId or at least one filter is required', 'data_update');
    }

    if (!config.fields || Object.keys(config.fields).length === 0) {
      throw new ConfigurationError('At least one field to update is required', 'data_update');
    }

    // Validate filter operators if filters are provided
    if (hasFilters) {
      validateFilterOps(config.filters, 'data_update');
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as DataUpdateHandlerConfig;
    const stepName = step.name || 'data_update';

    this.logger.debug(`Executing data update handler for step '${stepName}'`);

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

    // If recordId is provided, use it directly (ignoring filters)
    if (config.recordId && config.recordId.trim()) {
      const evaluatedRecordId = this.expressionEvaluator.evaluateExpression(
        config.recordId,
        context,
        stepName,
      );
      conditions.push(eq(pipelineData.id, String(evaluatedRecordId)));
    } else if (config.filters) {
      const combinedFilters = buildFilterConditions(config.filters, config.filterLogic, (value) =>
        this.expressionEvaluator.evaluateExpression(value, context, stepName),
      );
      if (combinedFilters) {
        conditions.push(combinedFilters);
      }
    }

    // Find matching records first
    // In single mode, only get the first record
    const query = db
      .select()
      .from(pipelineData)
      .where(and(...conditions));

    const existingRecords = config.single
      ? await query.limit(1)
      : await query;

    if (existingRecords.length === 0) {
      this.logger.debug(`No records found matching filters`);
      // In single mode, return null; otherwise return empty result
      return {
        success: true,
        output: config.single ? null : { count: 0, updated: [] },
      };
    }

    // Evaluate field expressions for updates
    const rawUpdates: Record<string, unknown> = {};
    for (const [fieldName, expression] of Object.entries(config.fields)) {
      rawUpdates[fieldName] = this.expressionEvaluator.evaluateExpression(
        expression,
        context,
        stepName,
      );
    }

    // Coerce values to the schema's declared field types
    const { data: updates, errors } = coerceFieldsToSchema(rawUpdates, schema.fields);
    if (Object.keys(errors).length > 0) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Data validation failed',
          details: { errors },
        },
      };
    }

    // Update each matching record. The merge happens in SQL (`jsonb ||`) rather
    // than as a JS spread over the row we read above, so two concurrent updates
    // touching different fields of the same record compose instead of the later
    // writer clobbering the earlier one with a stale whole-blob write (ce#432).
    const mergeExpression = buildDataMergeExpression(updates);
    const updatedRecords: Array<Record<string, unknown>> = [];
    for (const record of existingRecords) {
      const [updated] = await db
        .update(pipelineData)
        .set({
          data: mergeExpression,
          updatedAt: new Date(),
        })
        .where(eq(pipelineData.id, record.id))
        .returning();

      if (updated) {
        updatedRecords.push({
          id: updated.id,
          alias: updated.alias,
          version: updated.version,
          ...(updated.data as Record<string, unknown>),
          updatedAt: updated.updatedAt,
        });
      }
    }

    this.logger.debug(`Updated ${updatedRecords.length} records`);

    // In single mode, return just the updated object (or null)
    if (config.single) {
      return {
        success: true,
        output: updatedRecords[0] || null,
      };
    }

    return {
      success: true,
      output: {
        count: updatedRecords.length,
        updated: updatedRecords,
      },
    };
  }
}

/**
 * Build the SQL expression that merges `updates` into the stored `data` blob.
 *
 * `jsonb || jsonb` is a shallow merge — the same semantics as the JS spread it
 * replaces — but evaluated against the row's *current* value at write time, so
 * it never depends on an earlier read. Fields whose evaluated value is
 * `undefined` are removed from the record (a JS spread followed by JSON
 * serialisation dropped them too), which `jsonb - key` reproduces.
 */
export function buildDataMergeExpression(updates: Record<string, unknown>): SQL {
  const toSet: Record<string, unknown> = {};
  const toRemove: string[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) {
      toRemove.push(key);
    } else {
      toSet[key] = value;
    }
  }

  let expression: SQL = sql`${pipelineData.data}`;
  for (const key of toRemove) {
    expression = sql`(${expression} - ${key}::text)`;
  }
  if (Object.keys(toSet).length > 0) {
    expression = sql`${expression} || ${JSON.stringify(toSet)}::jsonb`;
  }
  return expression;
}
