import { Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { eq, and, asc } from 'drizzle-orm';
import { db } from '../../db/client';
import { pipelines, pipelineSteps, Pipeline, PipelineStep } from '../../db/schema';
import { PipelineContext, PipelineResult, StepResult } from './pipeline-context.interface';
import { StepHandlerRegistry } from './step-handler.registry';
import { ValidatorRegistry } from './validator.registry';
import { ExpressionEvaluator } from './expression-evaluator';
import { PipelineError, StepExecutionError, ConfigurationError } from '../errors';
import { BaseHandlerConfig } from './step-handler.interface';

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
   * Find a matching pipeline for the given request
   * @param projectId Project ID to search in
   * @param path Request path (relative to pipeline endpoint)
   * @param method HTTP method
   * @returns Matching pipeline or null
   */
  async findMatchingPipeline(
    projectId: string,
    path: string,
    method: string,
  ): Promise<Pipeline | null> {
    // Get all enabled pipelines for this project, ordered by priority
    const projectPipelines = await db
      .select()
      .from(pipelines)
      .where(and(eq(pipelines.projectId, projectId), eq(pipelines.isEnabled, true)))
      .orderBy(asc(pipelines.order));

    // Find first matching pipeline
    for (const pipeline of projectPipelines) {
      if (this.matchesPath(path, pipeline.pathPattern) && this.matchesMethod(method, pipeline.httpMethods)) {
        return pipeline;
      }
    }

    return null;
  }

  /**
   * Execute a pipeline with the given request
   * @param pipeline The pipeline to execute
   * @param req Express request object
   * @param userId Optional authenticated user ID
   * @returns Pipeline execution result
   */
  async executePipeline(
    pipeline: Pipeline,
    req: Request,
    user?: { id: string; email?: string; role?: string },
  ): Promise<PipelineResult> {
    const startTime = Date.now();
    this.logger.log(`Executing pipeline '${pipeline.name}' (${pipeline.id})`);

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

    try {
      // Run validators
      await this.runValidators(pipeline, context);

      // Get pipeline steps
      const steps = await db
        .select()
        .from(pipelineSteps)
        .where(and(eq(pipelineSteps.pipelineId, pipeline.id), eq(pipelineSteps.isEnabled, true)))
        .orderBy(asc(pipelineSteps.order));

      if (steps.length === 0) {
        throw new ConfigurationError(`Pipeline '${pipeline.name}' has no enabled steps`);
      }

      // Execute steps sequentially
      let lastStepResult: StepResult | null = null;
      for (const step of steps) {
        lastStepResult = await this.executeStep(step, context);

        if (!lastStepResult.success) {
          // Step failed - return error
          const duration = Date.now() - startTime;
          this.logger.error(`Pipeline '${pipeline.name}' failed at step '${step.name || step.id}' after ${duration}ms`);

          return {
            success: false,
            error: lastStepResult.error || {
              code: 'STEP_FAILED',
              message: `Step '${step.name || step.id}' failed`,
              step: step.name || step.id,
            },
            stepOutputs: context.stepOutputs,
          };
        }

        // Store step output for use in subsequent steps
        if (step.name && lastStepResult.output !== undefined) {
          context.stepOutputs[step.name] = lastStepResult.output;
        }
      }

      const duration = Date.now() - startTime;
      this.logger.log(`Pipeline '${pipeline.name}' completed successfully in ${duration}ms`);

      // Build response
      // If last step was a response_handler, use its output
      // Otherwise, return a default success response
      const response = this.buildResponse(lastStepResult, context);

      return {
        success: true,
        response,
        stepOutputs: context.stepOutputs,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof PipelineError) {
        this.logger.error(
          `Pipeline '${pipeline.name}' failed after ${duration}ms: ${error.message}`,
          error.stack,
        );
        return {
          success: false,
          error: error.toResponse(),
          stepOutputs: context.stepOutputs,
        };
      }

      this.logger.error(
        `Pipeline '${pipeline.name}' failed with unexpected error after ${duration}ms`,
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
      };
    }
  }

  /**
   * Run pipeline validators
   */
  private async runValidators(pipeline: Pipeline, context: PipelineContext): Promise<void> {
    for (const validatorConfig of pipeline.validators) {
      const validator = this.validatorRegistry.get(validatorConfig.type);
      await validator.validateConfig(validatorConfig.config);
      await validator.validate(context, validatorConfig);
    }
  }

  /**
   * Execute a single step
   */
  private async executeStep(step: PipelineStep, context: PipelineContext): Promise<StepResult> {
    const stepName = step.name || step.id;
    const config = step.config as BaseHandlerConfig;

    // Check condition if present
    if (config.condition) {
      const shouldRun = this.expressionEvaluator.evaluateCondition(config.condition, context, stepName);
      if (!shouldRun) {
        this.logger.debug(`Skipping step '${stepName}' - condition not met`);
        return { success: true, output: null };
      }
    }

    // Get handler
    const handler = this.handlerRegistry.get(step.handlerType, stepName);

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
      const result = await Promise.race([handler.execute(context, step), timeoutPromise]);
      return result;
    } catch (error) {
      if (error instanceof PipelineError) {
        throw error;
      }
      throw new StepExecutionError(
        error instanceof Error ? error.message : 'Unknown error',
        stepName,
        error,
      );
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
   * Check if a path matches a pattern
   * Supports :param style path parameters
   */
  private matchesPath(path: string, pattern: string): boolean {
    // Normalize paths
    const normalizedPath = path.replace(/\/+$/, '') || '/';
    const normalizedPattern = pattern.replace(/\/+$/, '') || '/';

    // Convert pattern to regex
    // :param becomes [^/]+
    const regexPattern = normalizedPattern
      .replace(/:[^/]+/g, '[^/]+')
      .replace(/\//g, '\\/');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(normalizedPath);
  }

  /**
   * Check if a method matches allowed methods
   */
  private matchesMethod(method: string, allowedMethods: string[]): boolean {
    return allowedMethods.includes(method.toUpperCase());
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
