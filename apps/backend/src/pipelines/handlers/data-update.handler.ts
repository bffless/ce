import { Injectable, Logger } from '@nestjs/common';
import { eq, and, ne as drizzleNe, sql } from 'drizzle-orm';
import { StepHandler, DataUpdateHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep, pipelineData } from '../../db/schema';
import { PipelineSchemasService } from '../pipeline-schemas.service';
import { db } from '../../db/client';
import { ConfigurationError, SchemaNotFoundError } from '../errors';

/**
 * Data Update Handler
 *
 * Updates existing records in a pipeline schema.
 * Supports eq and ne filter operators for finding records.
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

    if (!config.filters || Object.keys(config.filters).length === 0) {
      throw new ConfigurationError('At least one filter is required', 'data_update');
    }

    if (!config.fields || Object.keys(config.fields).length === 0) {
      throw new ConfigurationError('At least one field to update is required', 'data_update');
    }

    // Validate filter operators
    const validOps = ['eq', 'ne'];
    for (const [field, filter] of Object.entries(config.filters)) {
      if (!validOps.includes(filter.op)) {
        throw new ConfigurationError(
          `Invalid operator '${filter.op}' for field '${field}'. Valid operators for update: ${validOps.join(', ')}`,
          'data_update',
        );
      }
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

    // Add filter conditions
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
      }
    }

    // Find matching records first
    const existingRecords = await db
      .select()
      .from(pipelineData)
      .where(and(...conditions));

    if (existingRecords.length === 0) {
      this.logger.debug(`No records found matching filters`);
      return {
        success: true,
        output: {
          count: 0,
          updated: [],
        },
      };
    }

    // Evaluate field expressions for updates
    const updates: Record<string, unknown> = {};
    for (const [fieldName, expression] of Object.entries(config.fields)) {
      updates[fieldName] = this.expressionEvaluator.evaluateExpression(
        expression,
        context,
        stepName,
      );
    }

    // Update each matching record
    const updatedRecords: Array<Record<string, unknown>> = [];
    for (const record of existingRecords) {
      const existingData = record.data as Record<string, unknown>;
      const newData = { ...existingData, ...updates };

      const [updated] = await db
        .update(pipelineData)
        .set({
          data: newData,
          updatedAt: new Date(),
        })
        .where(eq(pipelineData.id, record.id))
        .returning();

      if (updated) {
        updatedRecords.push({
          id: updated.id,
          ...(updated.data as Record<string, unknown>),
          updatedAt: updated.updatedAt,
        });
      }
    }

    this.logger.debug(`Updated ${updatedRecords.length} records`);

    return {
      success: true,
      output: {
        count: updatedRecords.length,
        updated: updatedRecords,
      },
    };
  }
}
