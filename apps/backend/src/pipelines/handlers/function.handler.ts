import { Injectable, Logger } from '@nestjs/common';
import { StepHandler, FunctionHandlerConfig } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../../db/schema';
import { ConfigurationError } from '../errors';
import { FunctionRunnerService } from '../function-runner.service';

/**
 * Function Handler
 *
 * Executes custom JavaScript code in a sandboxed environment for data transformations.
 * The code has access to pipeline context data (input, user, request, previous step outputs).
 *
 * Security:
 * - Code runs in a restricted vm context
 * - No access to Node.js APIs (require, process, etc.)
 * - Timeout enforcement
 * - Static code validation for prohibited patterns
 */
@Injectable()
export class FunctionHandler implements StepHandler<FunctionHandlerConfig> {
  readonly type = 'function_handler' as const;
  private readonly logger = new Logger(FunctionHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly functionRunner: FunctionRunnerService,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: FunctionHandlerConfig): void {
    if (!config.code || typeof config.code !== 'string') {
      throw new ConfigurationError('code is required and must be a string', 'function_handler');
    }

    if (config.code.trim().length === 0) {
      throw new ConfigurationError('code cannot be empty', 'function_handler');
    }

    // Validate timeout if provided
    if (config.timeout !== undefined) {
      if (typeof config.timeout !== 'number') {
        throw new ConfigurationError('timeout must be a number', 'function_handler');
      }
      if (config.timeout < 1000 || config.timeout > 30000) {
        throw new ConfigurationError('timeout must be between 1000 and 30000 milliseconds', 'function_handler');
      }
    }

    // Validate the code syntax and patterns
    const validation = this.functionRunner.validateCode(config.code);
    if (!validation.valid) {
      throw new ConfigurationError(
        `Invalid code: ${validation.errors?.join('; ')}`,
        'function_handler',
      );
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as FunctionHandlerConfig;
    const stepName = step.name || 'function_handler';

    this.logger.debug(`Executing function handler for step '${stepName}'`);

    // Prepare data available to user code
    const data: Record<string, unknown> = {
      input: context.input,
      user: context.user
        ? {
            id: context.user.id,
            email: context.user.email,
            role: context.user.role,
          }
        : undefined,
      request: {
        method: context.request?.method,
        path: context.request?.path,
        query: context.request?.query,
      },
      steps: context.stepOutputs,
    };

    // Execute the code
    const result = await this.functionRunner.run(config.code, data, {
      timeout: config.timeout,
    });

    if (!result.success) {
      this.logger.warn(
        `Function execution failed for step '${stepName}': ${result.error?.message}`,
      );

      return {
        success: false,
        error: {
          code: result.error?.code || 'FUNCTION_ERROR',
          message: result.error?.message || 'Function execution failed',
          details: {
            stack: result.error?.stack,
            executionTime: result.executionTime,
            logs: result.logs,
          },
        },
      };
    }

    this.logger.debug(
      `Function execution successful for step '${stepName}' (${result.executionTime}ms)`,
    );

    // Include execution metadata in output if it's an object
    const output =
      result.output && typeof result.output === 'object'
        ? {
            ...(result.output as Record<string, unknown>),
            __functionMeta: {
              executionTime: result.executionTime,
              logs: result.logs,
            },
          }
        : result.output;

    return {
      success: true,
      output,
    };
  }
}
