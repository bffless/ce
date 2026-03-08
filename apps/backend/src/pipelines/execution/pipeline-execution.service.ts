import { Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import {
  PipelineContext,
  PipelineDebugResult,
  StepResult,
  StepDebugInfo,
  ValidatorDebugInfo,
} from './pipeline-context.interface';
import { StepHandlerRegistry } from './step-handler.registry';
import { ValidatorRegistry } from './validator.registry';
import { ExpressionEvaluator } from './expression-evaluator';
import { PipelineError, StepExecutionError, ConfigurationError } from '../errors';
import { BaseHandlerConfig } from './step-handler.interface';
import { Pipeline, PipelineStep, ValidatorType, ValidatorConfig, HandlerType } from '../types';

/**
 * Service that orchestrates pipeline execution
 */
@Injectable()
export class PipelineExecutionService {
  private readonly logger = new Logger(PipelineExecutionService.name);

  constructor(
    private readonly handlerRegistry: StepHandlerRegistry,
    private readonly validatorRegistry: ValidatorRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
  ) {}

  /**
   * Execute a pipeline with debug information
   * Captures per-step timing, I/O snapshots, and validator results
   * @param pipeline The pipeline to execute with inline steps
   * @param req Express request object
   * @param user Optional authenticated user
   * @param options Execution options (dryRun not yet implemented)
   * @returns Pipeline execution result with debug info
   */
  async executePipelineWithDebug(
    pipeline: Pipeline & { steps: PipelineStep[] },
    req: Request,
    user?: { id: string; email?: string; role?: string },
    _options?: { dryRun?: boolean },
  ): Promise<PipelineDebugResult> {
    const executionStartTime = Date.now();
    const executionStartIso = new Date(executionStartTime).toISOString();

    this.logger.log(`Executing pipeline '${pipeline.name}' (${pipeline.id}) with debug mode`);

    // Build context
    const context: PipelineContext = {
      request: req,
      user,
      input: this.extractInput(req),
      stepOutputs: {},
      projectId: pipeline.projectId,
      metadata: {
        path: req.path,
        method: req.method,
        headers: req.headers as Record<string, string | string[] | undefined>,
        query: req.query as Record<string, unknown>,
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.get('user-agent'),
      },
    };

    // Debug info collections
    const validatorDebugInfo: ValidatorDebugInfo[] = [];
    const stepDebugInfo: StepDebugInfo[] = [];

    try {
      // Run validators with debug capture
      await this.runValidatorsWithDebug(pipeline, context, validatorDebugInfo);

      // Get pipeline steps from inline config (required for proxy rule pipelines)
      if (!pipeline.steps || pipeline.steps.length === 0) {
        throw new ConfigurationError(`Pipeline '${pipeline.name}' has no steps defined`);
      }

      const steps = pipeline.steps.filter((s) => s.isEnabled);
      if (steps.length === 0) {
        throw new ConfigurationError(`Pipeline '${pipeline.name}' has no enabled steps`);
      }

      // Execute steps sequentially with debug capture
      let lastStepResult: StepResult | null = null;
      for (const step of steps) {
        const stepDebug = await this.executeStepWithDebug(step, context);
        stepDebugInfo.push(stepDebug);
        lastStepResult = stepDebug.result;

        if (!lastStepResult.success) {
          // Step failed - return error with debug info
          const executionEndTime = Date.now();
          this.logger.error(`Pipeline '${pipeline.name}' failed at step '${step.name || step.id}'`);

          return {
            success: false,
            error: lastStepResult.error || {
              code: 'STEP_FAILED',
              message: `Step '${step.name || step.id}' failed`,
              step: step.name || step.id,
            },
            stepOutputs: context.stepOutputs,
            debug: {
              validators: validatorDebugInfo,
              steps: stepDebugInfo,
              totalDurationMs: executionEndTime - executionStartTime,
              startTime: executionStartIso,
              endTime: new Date(executionEndTime).toISOString(),
            },
          };
        }

        // Store step output for use in subsequent steps
        if (step.name && lastStepResult.output !== undefined) {
          context.stepOutputs[step.name] = lastStepResult.output;
        }
      }

      const executionEndTime = Date.now();
      this.logger.log(`Pipeline '${pipeline.name}' completed successfully with debug mode`);

      // Build response
      const response = this.buildResponse(lastStepResult, context);

      return {
        success: true,
        response,
        stepOutputs: context.stepOutputs,
        debug: {
          validators: validatorDebugInfo,
          steps: stepDebugInfo,
          totalDurationMs: executionEndTime - executionStartTime,
          startTime: executionStartIso,
          endTime: new Date(executionEndTime).toISOString(),
        },
      };
    } catch (error) {
      const executionEndTime = Date.now();

      if (error instanceof PipelineError) {
        this.logger.error(`Pipeline '${pipeline.name}' failed: ${error.message}`, error.stack);
        return {
          success: false,
          error: error.toResponse(),
          stepOutputs: context.stepOutputs,
          debug: {
            validators: validatorDebugInfo,
            steps: stepDebugInfo,
            totalDurationMs: executionEndTime - executionStartTime,
            startTime: executionStartIso,
            endTime: new Date(executionEndTime).toISOString(),
          },
        };
      }

      this.logger.error(
        `Pipeline '${pipeline.name}' failed with unexpected error`,
        error instanceof Error ? error.stack : String(error),
      );

      return {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
          details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
        },
        stepOutputs: context.stepOutputs,
        debug: {
          validators: validatorDebugInfo,
          steps: stepDebugInfo,
          totalDurationMs: executionEndTime - executionStartTime,
          startTime: executionStartIso,
          endTime: new Date(executionEndTime).toISOString(),
        },
      };
    }
  }

  /**
   * Run pipeline validators with debug information capture
   */
  private async runValidatorsWithDebug(
    pipeline: Pipeline,
    context: PipelineContext,
    debugInfo: ValidatorDebugInfo[],
  ): Promise<void> {
    for (const validatorConfig of pipeline.validators) {
      const startTime = Date.now();
      const validator = this.validatorRegistry.get(validatorConfig.type as ValidatorType);

      try {
        await validator.validateConfig(validatorConfig.config);
        await validator.validate(context, validatorConfig as ValidatorConfig);

        debugInfo.push({
          type: validatorConfig.type,
          passed: true,
          durationMs: Date.now() - startTime,
        });
      } catch (error) {
        const errorInfo =
          error instanceof PipelineError
            ? error.toResponse()
            : {
                code: 'VALIDATOR_ERROR',
                message: error instanceof Error ? error.message : 'Unknown error',
              };

        debugInfo.push({
          type: validatorConfig.type,
          passed: false,
          durationMs: Date.now() - startTime,
          error: errorInfo,
        });

        // Re-throw to stop execution
        throw error;
      }
    }
  }

  /**
   * Execute a single step with debug information capture
   */
  private async executeStepWithDebug(
    step: PipelineStep,
    context: PipelineContext,
  ): Promise<StepDebugInfo & { result: StepResult }> {
    const stepName = step.name || step.id;
    const config = step.config as BaseHandlerConfig;
    const startTime = Date.now();
    const startTimeIso = new Date(startTime).toISOString();

    // Capture input snapshot
    const inputSnapshot = {
      requestInput: { ...context.input },
      previousStepOutputs: { ...context.stepOutputs },
    };

    // Check condition if present
    let conditionResult: boolean | undefined;
    if (config.condition) {
      conditionResult = this.expressionEvaluator.evaluateCondition(config.condition, context, stepName);
      if (!conditionResult) {
        const endTime = Date.now();
        this.logger.debug(`Skipping step '${stepName}' - condition not met`);
        return {
          stepId: step.id,
          stepName: step.name || undefined,
          handlerType: step.handlerType,
          startTime: startTimeIso,
          endTime: new Date(endTime).toISOString(),
          durationMs: endTime - startTime,
          status: 'skipped',
          input: inputSnapshot,
          output: null,
          condition: config.condition,
          conditionResult: false,
          result: { success: true, output: null },
        };
      }
    }

    // Get handler
    const handler = this.handlerRegistry.get(step.handlerType as HandlerType, stepName);

    // Validate config
    await handler.validateConfig(step.config);

    // Execute with timeout
    const timeout = config.timeout || 30000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new StepExecutionError(`Step timed out after ${timeout}ms`, stepName));
      }, timeout);
    });

    try {
      const result = await Promise.race([handler.execute(context, step as PipelineStep), timeoutPromise]);
      const endTime = Date.now();

      return {
        stepId: step.id,
        stepName: step.name || undefined,
        handlerType: step.handlerType,
        startTime: startTimeIso,
        endTime: new Date(endTime).toISOString(),
        durationMs: endTime - startTime,
        status: result.success ? 'success' : 'failed',
        input: inputSnapshot,
        output: result.output,
        error: result.error,
        condition: config.condition,
        conditionResult: conditionResult,
        result,
      };
    } catch (error) {
      const endTime = Date.now();
      const errorInfo =
        error instanceof PipelineError
          ? error.toResponse()
          : {
              code: 'STEP_EXECUTION_ERROR',
              message: error instanceof Error ? error.message : 'Unknown error',
            };

      return {
        stepId: step.id,
        stepName: step.name || undefined,
        handlerType: step.handlerType,
        startTime: startTimeIso,
        endTime: new Date(endTime).toISOString(),
        durationMs: endTime - startTime,
        status: 'failed',
        input: inputSnapshot,
        error: errorInfo,
        condition: config.condition,
        conditionResult: conditionResult,
        result: {
          success: false,
          error: errorInfo,
        },
      };
    }
  }

  /**
   * Build the final response from step results
   */
  private buildResponse(
    lastStepResult: StepResult | null,
    _context: PipelineContext,
  ): { status: number; body: unknown; headers?: Record<string, string> } {
    // Check if last step output looks like a response
    if (lastStepResult?.output && typeof lastStepResult.output === 'object') {
      const output = lastStepResult.output as Record<string, unknown>;
      if ('status' in output && 'body' in output) {
        return {
          status: Number(output.status) || 200,
          body: output.body,
          headers: output.headers as Record<string, string> | undefined,
        };
      }
    }

    // Default success response
    return {
      status: 200,
      body: {
        success: true,
        data: lastStepResult?.output,
      },
    };
  }

  /**
   * Extract input from request body and query
   */
  private extractInput(req: Request): Record<string, unknown> {
    return {
      ...(req.query as Record<string, unknown>),
      ...(req.body as Record<string, unknown>),
    };
  }
}
