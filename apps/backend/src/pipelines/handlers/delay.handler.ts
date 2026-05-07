import { Injectable, Logger } from '@nestjs/common';
import { StepHandler } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import { PipelineStep } from '../types';
import { ConfigurationError } from '../errors';

const MIN_DELAY_MS = 0;
const MAX_DELAY_MS = 60_000;

export interface DelayHandlerConfig {
  /**
   * Delay duration in milliseconds. Supports expressions (e.g. "request.body.waitMs").
   * Capped at 60000ms (60s).
   */
  ms?: number | string;

  /**
   * Delay duration in seconds. Convenience field — converted to ms internally.
   * Supports expressions. Ignored if `ms` is set.
   */
  seconds?: number | string;
}

/**
 * Delay Handler
 *
 * Pauses pipeline execution for a configurable duration before continuing.
 * Useful for polling backoff, simulating latency, or pacing webhook chains.
 */
@Injectable()
export class DelayHandler implements StepHandler<DelayHandlerConfig> {
  readonly type = 'delay' as const;
  private readonly logger = new Logger(DelayHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: DelayHandlerConfig): void {
    if (config.ms === undefined && config.seconds === undefined) {
      throw new ConfigurationError('ms or seconds is required', 'delay');
    }
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as DelayHandlerConfig;
    const stepName = step.name || 'delay';

    let durationMs: number;

    if (config.ms !== undefined) {
      durationMs = this.resolveNumber(config.ms, context, stepName, 'ms');
    } else {
      const seconds = this.resolveNumber(config.seconds!, context, stepName, 'seconds');
      durationMs = seconds * 1000;
    }

    if (!Number.isFinite(durationMs) || durationMs < MIN_DELAY_MS) {
      return {
        success: false,
        error: {
          code: 'INVALID_DELAY',
          message: `delay must be a finite number >= ${MIN_DELAY_MS}, got ${durationMs}`,
        },
      };
    }

    const clamped = Math.min(durationMs, MAX_DELAY_MS);
    if (clamped !== durationMs) {
      this.logger.warn(
        `Step '${stepName}' requested ${durationMs}ms delay, clamped to ${MAX_DELAY_MS}ms`,
      );
    }

    this.logger.debug(`Step '${stepName}' sleeping for ${clamped}ms`);
    await new Promise<void>((resolve) => setTimeout(resolve, clamped));

    return {
      success: true,
      output: { delayedMs: clamped },
    };
  }

  private resolveNumber(
    value: number | string,
    context: PipelineContext,
    stepName: string,
    field: string,
  ): number {
    if (typeof value === 'number') {
      return value;
    }
    const resolved = this.expressionEvaluator.evaluateExpression(value, context, stepName);
    const num = typeof resolved === 'number' ? resolved : Number(resolved);
    if (!Number.isFinite(num)) {
      throw new ConfigurationError(
        `${field} expression "${value}" resolved to non-numeric value: ${resolved}`,
        'delay',
      );
    }
    return num;
  }
}
