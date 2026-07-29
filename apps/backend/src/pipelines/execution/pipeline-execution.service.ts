import { Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import {
  PipelineContext,
  PipelineDebugResult,
  PipelineUser,
  StepResult,
  StepDebugInfo,
  ValidatorDebugInfo,
} from './pipeline-context.interface';
import { StepHandlerRegistry } from './step-handler.registry';
import { ValidatorRegistry } from './validator.registry';
import { ExpressionEvaluator } from './expression-evaluator';
import { ProjectSecretsService } from '../../projects/project-secrets.service';
import { redactSecrets } from './redact-secrets';
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
    private readonly projectSecretsService: ProjectSecretsService,
  ) {}

  /**
   * Execute a pipeline with debug information, with project secrets loaded into
   * context and redacted from all output.
   *
   * This is a thin wrapper around {@link executePipelineWithDebugInner}. It loads
   * the project's decrypted secrets, runs the pipeline, then scrubs every secret
   * value from the result (debug step I/O, response body/headers, stepOutputs,
   * and the async post-steps debug) before returning. This single chokepoint is
   * what guarantees secrets can be USED but never read back — including via the
   * persisted execution logs and the MCP log tools that read them.
   */
  async executePipelineWithDebug(
    pipeline: Pipeline & { steps: PipelineStep[] },
    req: Request,
    user?: PipelineUser,
    options?: {
      dryRun?: boolean;
      deployment?: { owner: string; repo: string; commitSha: string; alias?: string };
      /**
       * Whether to retain per-step input/output debug snapshots in memory.
       * Defaults to true. Set to false (e.g. when the rule does not have debug
       * logging enabled) to avoid holding a copy of every step's I/O — including
       * a per-step snapshot of all accumulated step outputs — for the lifetime of
       * the request, which on memory-constrained instances can exhaust the heap.
       */
      captureDebug?: boolean;
    },
  ): Promise<PipelineDebugResult> {
    let secrets: Record<string, string> = {};
    try {
      secrets = await this.projectSecretsService.getDecryptedSecrets(pipeline.projectId);
    } catch (error) {
      // Never let secret loading break a pipeline run; expressions referencing a
      // secret will resolve to null if the map is empty.
      this.logger.error(
        `Failed to load secrets for project ${pipeline.projectId}; continuing without them`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    const secretValues = Object.values(secrets);
    const result = await this.executePipelineWithDebugInner(pipeline, req, user, options, secrets);

    if (secretValues.length === 0) {
      return result;
    }

    // Redact synchronous result surfaces in place.
    if (result.debug) result.debug = redactSecrets(result.debug, secretValues);
    if (result.response) result.response = redactSecrets(result.response, secretValues);
    if (result.stepOutputs) result.stepOutputs = redactSecrets(result.stepOutputs, secretValues);
    if (result.error) result.error = redactSecrets(result.error, secretValues);

    // Redact the async post-steps debug once it resolves.
    if (result.postStepsPromise) {
      result.postStepsPromise = result.postStepsPromise.then((steps) =>
        redactSecrets(steps, secretValues),
      );
    }

    return result;
  }

  /**
   * Execute a pipeline with debug information
   * Captures per-step timing, I/O snapshots, and validator results
   * @param pipeline The pipeline to execute with inline steps
   * @param req Express request object
   * @param user Optional authenticated user
   * @param options Execution options (deployment context for skills, dryRun not yet implemented)
   * @returns Pipeline execution result with debug info
   */
  private async executePipelineWithDebugInner(
    pipeline: Pipeline & { steps: PipelineStep[] },
    req: Request,
    user?: PipelineUser,
    options?: {
      dryRun?: boolean;
      deployment?: { owner: string; repo: string; commitSha: string; alias?: string };
      captureDebug?: boolean;
    },
    secrets?: Record<string, string>,
  ): Promise<PipelineDebugResult> {
    const executionStartTime = Date.now();
    const executionStartIso = new Date(executionStartTime).toISOString();
    const captureDebug = options?.captureDebug ?? true;

    this.logger.log(
      `Executing pipeline '${pipeline.name}' (${pipeline.id})${captureDebug ? ' with debug mode' : ''}`,
    );

    // Build context
    // Extract real client IP (prefer X-Forwarded-For for proxied requests)
    const clientIp = this.extractClientIp(req);

    const context: PipelineContext = {
      request: req,
      user,
      stepOutputs: {},
      projectId: pipeline.projectId,
      pipelineId: pipeline.id,
      metadata: {
        path: req.path,
        method: req.method,
        headers: req.headers as Record<string, string | string[] | undefined>,
        query: req.query as Record<string, unknown>,
        body: (req.body as Record<string, unknown>) || {},
        ip: clientIp,
        userAgent: req.get('user-agent'),
      },
      deployment: options?.deployment,
      secrets: secrets ?? {},
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
        const stepDebug = await this.executeStepWithDebug(step, context, captureDebug);
        stepDebugInfo.push(stepDebug);

        // When a step is skipped (condition not met), preserve the previous step's output
        // so the response comes from the last step that actually ran
        if (stepDebug.status === 'skipped') {
          continue;
        }

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

        // Check for early termination (e.g., honeypot detection, stripe_webhook ignoring
        // an event type, ai_handler streaming response already sent, file-serve completing).
        // Step succeeded but wants to stop pipeline and return its output as final response.
        // Post-steps are SKIPPED on early termination: the main pipeline didn't fully run,
        // so any side effects (notifications, follow-ups) would be operating on partial state.
        if (lastStepResult.terminates) {
          const executionEndTime = Date.now();
          this.logger.debug(
            `Pipeline '${pipeline.name}' terminated early at step '${step.name || step.id}' — skipping post-steps`,
          );

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
        }
      }

      const executionEndTime = Date.now();
      this.logger.log(`Pipeline '${pipeline.name}' completed successfully with debug mode`);

      // Build response
      const response = this.buildResponse(lastStepResult, context);

      // Fire-and-forget post-processing steps
      const postStepsPromise = this.firePostSteps(pipeline, context, captureDebug);

      return {
        success: true,
        response,
        stepOutputs: context.stepOutputs,
        postStepsPromise,
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

      // Evaluate condition if present - skip validator if condition is not met
      if (validatorConfig.condition) {
        const conditionMet = this.evaluateValidatorCondition(validatorConfig.condition, context);
        if (!conditionMet) {
          this.logger.debug(
            `Skipping validator '${validatorConfig.type}' - condition not met (${validatorConfig.condition.field} ${validatorConfig.condition.operator}${validatorConfig.condition.value !== undefined ? ' ' + validatorConfig.condition.value : ''})`,
          );
          debugInfo.push({
            type: validatorConfig.type,
            passed: true,
            skipped: true,
            durationMs: Date.now() - startTime,
            condition: validatorConfig.condition,
            conditionResult: false,
          });
          continue;
        }
      }

      const validator = this.validatorRegistry.get(validatorConfig.type as ValidatorType);

      try {
        await validator.validateConfig(validatorConfig.config);
        await validator.validate(context, validatorConfig as ValidatorConfig);

        debugInfo.push({
          type: validatorConfig.type,
          passed: true,
          durationMs: Date.now() - startTime,
          condition: validatorConfig.condition,
          conditionResult: validatorConfig.condition ? true : undefined,
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
          condition: validatorConfig.condition,
          conditionResult: validatorConfig.condition ? true : undefined,
          error: errorInfo,
        });

        // Re-throw to stop execution
        throw error;
      }
    }
  }

  /**
   * Evaluate a validator condition against the pipeline context.
   * Returns true if the validator should run, false if it should be skipped.
   */
  private evaluateValidatorCondition(
    condition: { field: string; operator: string; value?: string },
    context: PipelineContext,
  ): boolean {
    const fieldValue = this.expressionEvaluator.evaluateExpression(
      condition.field,
      context,
      'validator-condition',
    );

    switch (condition.operator) {
      case 'exists':
        return fieldValue !== null && fieldValue !== undefined;
      case 'not_exists':
        return fieldValue === null || fieldValue === undefined;
      case 'equals':
        return String(fieldValue ?? '') === String(condition.value ?? '');
      case 'not_equals':
        return String(fieldValue ?? '') !== String(condition.value ?? '');
      default:
        this.logger.warn(`Unknown validator condition operator: ${condition.operator}`);
        return true; // Run validator by default if operator is unknown
    }
  }

  /**
   * Execute a single step with debug information capture
   */
  private async executeStepWithDebug(
    step: PipelineStep,
    context: PipelineContext,
    captureDebug = true,
  ): Promise<StepDebugInfo & { result: StepResult }> {
    const stepName = step.name || step.id;
    const config = step.config as BaseHandlerConfig;
    const startTime = Date.now();
    const startTimeIso = new Date(startTime).toISOString();

    // Capture input snapshot only when debug capture is enabled. The snapshot
    // copies all accumulated step outputs, so retaining one per step is what
    // exhausts the heap on memory-constrained instances when debug is off.
    const inputSnapshot = captureDebug
      ? {
          requestBody: { ...context.metadata.body },
          previousStepOutputs: { ...context.stepOutputs },
        }
      : undefined;

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
        output: captureDebug ? result.output : undefined,
        error: result.error,
        warning: result.warning,
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
   * Fire post-processing steps as fire-and-forget if the pipeline has any.
   * Returns a promise that resolves with debug info for all post-steps.
   */
  private firePostSteps(
    pipeline: Pipeline,
    context: PipelineContext,
    captureDebug = true,
  ): Promise<StepDebugInfo[]> | undefined {
    if (pipeline.postSteps && pipeline.postSteps.length > 0) {
      const enabledPostSteps = pipeline.postSteps.filter((s) => s.isEnabled);
      if (enabledPostSteps.length > 0) {
        this.logger.log(
          `Running ${enabledPostSteps.length} post-processing step(s) for pipeline '${pipeline.name}'`,
        );
        const promise = this.runPostSteps(enabledPostSteps, context, captureDebug);
        // Still catch to prevent unhandled rejection
        promise.catch((err) =>
          this.logger.error(
            `Post-processing steps failed for pipeline '${pipeline.name}': ${err.message}`,
            err.stack,
          ),
        );
        return promise;
      }
    }
    return undefined;
  }

  /**
   * Run post-processing steps sequentially with debug capture.
   * Errors are logged per-step but don't stop subsequent steps from running.
   */
  private async runPostSteps(
    postSteps: PipelineStep[],
    context: PipelineContext,
    captureDebug = true,
  ): Promise<StepDebugInfo[]> {
    const debugInfo: StepDebugInfo[] = [];

    for (const step of postSteps) {
      const stepName = step.name || step.id;
      const startTime = Date.now();
      const startTimeIso = new Date(startTime).toISOString();

      // Capture input snapshot only when debug capture is enabled (see executeStepWithDebug).
      const inputSnapshot = captureDebug
        ? {
            requestBody: { ...(context.metadata.body || {}) },
            previousStepOutputs: { ...context.stepOutputs },
          }
        : undefined;

      try {
        const handler = this.handlerRegistry.get(step.handlerType as HandlerType, stepName);
        await handler.validateConfig(step.config);

        const config = step.config as BaseHandlerConfig;

        // Evaluate condition if present
        if (config.condition) {
          const conditionMet = this.expressionEvaluator.evaluateCondition(
            config.condition,
            context,
            stepName,
          );
          if (!conditionMet) {
            const endTime = Date.now();
            this.logger.debug(`Skipping post-processing step '${stepName}' - condition not met`);
            debugInfo.push({
              stepId: step.id,
              stepName: step.name || undefined,
              handlerType: step.handlerType,
              startTime: startTimeIso,
              endTime: new Date(endTime).toISOString(),
              durationMs: endTime - startTime,
              status: 'skipped',
              input: inputSnapshot,
              condition: config.condition,
              conditionResult: false,
            });
            continue;
          }
        }

        const result = await handler.execute(context, step);
        const endTime = Date.now();

        if (result.success && step.name && result.output !== undefined) {
          context.stepOutputs[step.name] = result.output;
        }

        debugInfo.push({
          stepId: step.id,
          stepName: step.name || undefined,
          handlerType: step.handlerType,
          startTime: startTimeIso,
          endTime: new Date(endTime).toISOString(),
          durationMs: endTime - startTime,
          status: result.success ? 'success' : 'failed',
          input: inputSnapshot,
          output: captureDebug ? result.output : undefined,
          error: result.error,
          warning: result.warning,
        });

        if (!result.success) {
          this.logger.warn(
            `Post-processing step '${stepName}' failed: ${result.error?.message || 'unknown error'}`,
          );
        } else {
          this.logger.debug(`Post-processing step '${stepName}' completed successfully`);
        }
      } catch (error) {
        const endTime = Date.now();
        const errorInfo = error instanceof PipelineError
          ? error.toResponse()
          : {
              code: 'STEP_EXECUTION_ERROR',
              message: error instanceof Error ? error.message : 'Unknown error',
            };

        debugInfo.push({
          stepId: step.id,
          stepName: step.name || undefined,
          handlerType: step.handlerType,
          startTime: startTimeIso,
          endTime: new Date(endTime).toISOString(),
          durationMs: endTime - startTime,
          status: 'failed',
          input: inputSnapshot,
          error: errorInfo,
        });

        this.logger.error(
          `Post-processing step '${stepName}' threw an error: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    return debugInfo;
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
   * Extract the real client IP address from request.
   * Prefers X-Forwarded-For header (for proxied requests) over socket IP.
   * Strips IPv6-mapped IPv4 prefix (::ffff:) for cleaner output.
   */
  private extractClientIp(req: Request): string | undefined {
    // Check X-Forwarded-For first (set by reverse proxies like nginx, Traefik, Umbrel)
    const forwardedFor = req.headers['x-forwarded-for'];
    let ip: string | undefined;

    if (forwardedFor) {
      // X-Forwarded-For can be a comma-separated list; first IP is the original client
      const forwardedIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor.split(',')[0];
      ip = forwardedIp?.trim();
    }

    // Fall back to Express req.ip or socket address
    if (!ip) {
      ip = req.ip || req.socket?.remoteAddress;
    }

    // Strip IPv6-mapped IPv4 prefix (::ffff:192.168.1.1 -> 192.168.1.1)
    if (ip?.startsWith('::ffff:')) {
      ip = ip.slice(7);
    }

    return ip;
  }

}
