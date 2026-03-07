import { HttpStatus } from '@nestjs/common';
import { PipelineError } from './pipeline.error';

/**
 * Error thrown when pipeline or step configuration is invalid
 */
export class ConfigurationError extends PipelineError {
  constructor(
    message: string,
    step?: string,
    details?: unknown,
  ) {
    super('CONFIGURATION_ERROR', message, step, details, HttpStatus.BAD_REQUEST);
  }
}

/**
 * Error thrown when a referenced schema doesn't exist
 */
export class SchemaNotFoundError extends PipelineError {
  constructor(schemaId: string, step?: string) {
    super(
      'SCHEMA_NOT_FOUND',
      `Schema '${schemaId}' not found`,
      step,
      { schemaId },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * Error thrown when an expression fails to evaluate
 */
export class ExpressionError extends PipelineError {
  constructor(
    expression: string,
    reason: string,
    step?: string,
  ) {
    super(
      'EXPRESSION_ERROR',
      `Failed to evaluate expression '${expression}': ${reason}`,
      step,
      { expression, reason },
      HttpStatus.BAD_REQUEST,
    );
  }
}
