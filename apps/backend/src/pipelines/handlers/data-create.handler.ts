import { Injectable, Logger } from '@nestjs/common';
import { StepHandler, DataCreateHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../../db/schema';
import { PipelineDataService } from '../pipeline-data.service';
import { PipelineSchemasService } from '../pipeline-schemas.service';
import { ConfigurationError, SchemaNotFoundError } from '../errors';

/**
 * Data Create Handler
 *
 * Creates a new record in a pipeline schema.
 * Evaluates field expressions and validates data against schema definition.
 */
@Injectable()
export class DataCreateHandler implements StepHandler<DataCreateHandlerConfig> {
  readonly type = 'data_create' as const;
  private readonly logger = new Logger(DataCreateHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    private readonly dataService: PipelineDataService,
    private readonly schemasService: PipelineSchemasService,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: DataCreateHandlerConfig): void {
    if (!config.schemaId) {
      throw new ConfigurationError('schemaId is required', 'data_create');
    }

    if (!config.fields || Object.keys(config.fields).length === 0) {
      throw new ConfigurationError('At least one field mapping is required', 'data_create');
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as DataCreateHandlerConfig;
    const stepName = step.name || 'data_create';

    this.logger.debug(`Executing data create handler for step '${stepName}'`);

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

    // Evaluate field expressions to build data object
    const data: Record<string, unknown> = {};
    for (const [fieldName, expression] of Object.entries(config.fields)) {
      data[fieldName] = this.expressionEvaluator.evaluateExpression(
        expression,
        context,
        stepName,
      );
    }

    // Validate required fields against schema
    const errors: Record<string, string> = {};
    for (const field of schema.fields) {
      if (field.required && (data[field.name] === undefined || data[field.name] === null)) {
        errors[field.name] = `${field.name} is required`;
      }
    }

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

    // Create the record
    const record = await this.dataService.create(
      config.schemaId,
      context.projectId,
      data,
      context.user?.id,
    );

    this.logger.debug(`Created data record ${record.id} in schema ${config.schemaId}`);

    return {
      success: true,
      output: {
        id: record.id,
        ...record.data as Record<string, unknown>,
        createdAt: record.createdAt,
      },
    };
  }
}
