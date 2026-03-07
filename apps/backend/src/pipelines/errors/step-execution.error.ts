import { HttpStatus } from '@nestjs/common';
import { PipelineError } from './pipeline.error';

/**
 * Error thrown when a pipeline step fails during execution
 */
export class StepExecutionError extends PipelineError {
  constructor(
    message: string,
    step: string,
    details?: unknown,
  ) {
    super('STEP_EXECUTION_ERROR', message, step, details, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

/**
 * Error thrown when a step handler is not found
 */
export class HandlerNotFoundError extends PipelineError {
  constructor(handlerType: string, step?: string) {
    super(
      'HANDLER_NOT_FOUND',
      `Handler type '${handlerType}' is not registered`,
      step,
      { handlerType },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

/**
 * Error thrown when a step times out
 */
export class StepTimeoutError extends PipelineError {
  constructor(step: string, timeoutMs: number) {
    super(
      'STEP_TIMEOUT',
      `Step '${step}' timed out after ${timeoutMs}ms`,
      step,
      { timeoutMs },
      HttpStatus.GATEWAY_TIMEOUT,
    );
  }
}
