import { Injectable, Logger } from '@nestjs/common';
import { StepHandler, AggregateHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../../db/schema';
import { ConfigurationError, StepExecutionError } from '../errors';

/**
 * Aggregate Handler
 *
 * Performs aggregation operations on array input from previous steps.
 * Supports count, sum, avg, min, max operations.
 */
@Injectable()
export class AggregateHandler implements StepHandler<AggregateHandlerConfig> {
  readonly type = 'aggregate_handler' as const;
  private readonly logger = new Logger(AggregateHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: AggregateHandlerConfig): void {
    const validOps = ['sum', 'count', 'avg', 'min', 'max'];
    if (!config.operation || !validOps.includes(config.operation)) {
      throw new ConfigurationError(
        `operation is required and must be one of: ${validOps.join(', ')}`,
        'aggregate_handler',
      );
    }

    // Field is required for all operations except count
    if (config.operation !== 'count' && !config.field) {
      throw new ConfigurationError(
        `field is required for '${config.operation}' operation`,
        'aggregate_handler',
      );
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as AggregateHandlerConfig;
    const stepName = step.name || 'aggregate_handler';

    this.logger.debug(`Executing aggregate handler for step '${stepName}'`);

    // Get input from context - should be an array from a previous step
    const input = context.input;

    // Check if input is an array
    if (!Array.isArray(input)) {
      // Check if we can get input from the last step output
      const stepNames = Object.keys(context.stepOutputs);
      if (stepNames.length > 0) {
        const lastStepName = stepNames[stepNames.length - 1];
        const lastOutput = context.stepOutputs[lastStepName];

        if (Array.isArray(lastOutput)) {
          return this.performAggregation(lastOutput, config, stepName);
        }
      }

      return {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Input must be an array. Use this handler after a data_query step.',
          details: { inputType: typeof input },
        },
      };
    }

    return this.performAggregation(input, config, stepName);
  }

  private performAggregation(
    items: unknown[],
    config: AggregateHandlerConfig,
    stepName: string,
  ): StepResult {
    const { operation, field } = config;

    this.logger.debug(`Performing ${operation} on ${items.length} items`);

    switch (operation) {
      case 'count':
        return {
          success: true,
          output: {
            operation: 'count',
            result: items.length,
          },
        };

      case 'sum': {
        const values = this.extractNumericValues(items, field!, stepName);
        const sum = values.reduce((acc, val) => acc + val, 0);
        return {
          success: true,
          output: {
            operation: 'sum',
            field,
            result: sum,
            count: values.length,
          },
        };
      }

      case 'avg': {
        const values = this.extractNumericValues(items, field!, stepName);
        if (values.length === 0) {
          return {
            success: true,
            output: {
              operation: 'avg',
              field,
              result: null,
              count: 0,
            },
          };
        }
        const sum = values.reduce((acc, val) => acc + val, 0);
        const avg = sum / values.length;
        return {
          success: true,
          output: {
            operation: 'avg',
            field,
            result: avg,
            count: values.length,
          },
        };
      }

      case 'min': {
        const values = this.extractNumericValues(items, field!, stepName);
        if (values.length === 0) {
          return {
            success: true,
            output: {
              operation: 'min',
              field,
              result: null,
              count: 0,
            },
          };
        }
        const min = Math.min(...values);
        return {
          success: true,
          output: {
            operation: 'min',
            field,
            result: min,
            count: values.length,
          },
        };
      }

      case 'max': {
        const values = this.extractNumericValues(items, field!, stepName);
        if (values.length === 0) {
          return {
            success: true,
            output: {
              operation: 'max',
              field,
              result: null,
              count: 0,
            },
          };
        }
        const max = Math.max(...values);
        return {
          success: true,
          output: {
            operation: 'max',
            field,
            result: max,
            count: values.length,
          },
        };
      }

      default:
        return {
          success: false,
          error: {
            code: 'INVALID_OPERATION',
            message: `Unknown operation: ${operation}`,
            details: { operation },
          },
        };
    }
  }

  private extractNumericValues(items: unknown[], field: string, stepName: string): number[] {
    const values: number[] = [];

    for (const item of items) {
      if (item === null || item === undefined) continue;

      let value: unknown;

      if (typeof item === 'object') {
        // Get nested field value using dot notation
        const parts = field.split('.');
        let current: unknown = item;

        for (const part of parts) {
          if (current === null || current === undefined) break;
          if (typeof current !== 'object') break;
          current = (current as Record<string, unknown>)[part];
        }

        value = current;
      } else {
        value = item;
      }

      // Convert to number
      if (value !== null && value !== undefined) {
        const numValue = typeof value === 'number' ? value : parseFloat(String(value));
        if (!isNaN(numValue)) {
          values.push(numValue);
        }
      }
    }

    return values;
  }
}
