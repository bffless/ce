import { Injectable, Logger } from '@nestjs/common';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { StepHandler, DataDeleteHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep, pipelineData } from '../../db/schema';
import { PipelineSchemasService } from '../pipeline-schemas.service';
import { db } from '../../db/client';
import { ConfigurationError, SchemaNotFoundError } from '../errors';

/**
 * Data Delete Handler
 *
 * Deletes records from a pipeline schema.
 * Supports eq and ne filter operators for finding records to delete.
 */
@Injectable()
export class DataDeleteHandler implements StepHandler<DataDeleteHandlerConfig> {
  readonly type = 'data_delete' as const;
  private readonly logger = new Logger(DataDeleteHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    private readonly schemasService: PipelineSchemasService,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: DataDeleteHandlerConfig): void {
    if (!config.schemaId) {
      throw new ConfigurationError('schemaId is required', 'data_delete');
    }

    if (!config.filters || Object.keys(config.filters).length === 0) {
      throw new ConfigurationError('At least one filter is required', 'data_delete');
    }

    // Validate filter operators
    const validOps = ['eq', 'ne'];
    for (const [field, filter] of Object.entries(config.filters)) {
      if (!validOps.includes(filter.op)) {
        throw new ConfigurationError(
          `Invalid operator '${filter.op}' for field '${field}'. Valid operators for delete: ${validOps.join(', ')}`,
          'data_delete',
        );
      }
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as DataDeleteHandlerConfig;
    const stepName = step.name || 'data_delete';

    this.logger.debug(`Executing data delete handler for step '${stepName}'`);

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

    // Find matching records first (to get IDs for deletion)
    const recordsToDelete = await db
      .select({ id: pipelineData.id })
      .from(pipelineData)
      .where(and(...conditions));

    if (recordsToDelete.length === 0) {
      this.logger.debug(`No records found matching filters`);
      return {
        success: true,
        output: {
          count: 0,
          deletedIds: [],
        },
      };
    }

    const idsToDelete = recordsToDelete.map((r) => r.id);

    // Delete matching records
    const deleted = await db
      .delete(pipelineData)
      .where(
        and(
          eq(pipelineData.projectId, context.projectId),
          inArray(pipelineData.id, idsToDelete),
        ),
      )
      .returning({ id: pipelineData.id });

    this.logger.debug(`Deleted ${deleted.length} records`);

    return {
      success: true,
      output: {
        count: deleted.length,
        deletedIds: deleted.map((r) => r.id),
      },
    };
  }
}
