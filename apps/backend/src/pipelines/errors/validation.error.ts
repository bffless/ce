import { HttpStatus } from '@nestjs/common';
import { PipelineError } from './pipeline.error';

/**
 * Error thrown when pipeline input validation fails
 */
export class ValidationError extends PipelineError {
  constructor(
    message: string,
    details?: Record<string, unknown>,
    step?: string,
  ) {
    super('VALIDATION_ERROR', message, step, details, HttpStatus.BAD_REQUEST);
  }
}

/**
 * Error thrown when authentication is required but not provided
 */
export class AuthenticationRequiredError extends PipelineError {
  constructor(message = 'Authentication required') {
    super('AUTH_REQUIRED', message, undefined, undefined, HttpStatus.UNAUTHORIZED);
  }
}

/**
 * Error thrown when the user doesn't have permission
 */
export class AuthorizationError extends PipelineError {
  constructor(message = 'Access denied') {
    super('AUTHORIZATION_ERROR', message, undefined, undefined, HttpStatus.FORBIDDEN);
  }
}

/**
 * Error thrown when rate limit is exceeded
 */
export class RateLimitError extends PipelineError {
  constructor(
    message = 'Rate limit exceeded',
    retryAfter?: number,
  ) {
    super('RATE_LIMIT_EXCEEDED', message, undefined, { retryAfter }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
