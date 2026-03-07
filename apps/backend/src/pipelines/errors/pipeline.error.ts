import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base error class for pipeline-related errors
 */
export class PipelineError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    public readonly step?: string,
    public readonly details?: unknown,
    status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
  ) {
    super(
      {
        error: code,
        message,
        step,
        details,
      },
      status,
    );
  }

  /**
   * Get a structured response suitable for API responses
   */
  toResponse() {
    return {
      code: this.code,
      message: this.message,
      step: this.step,
      details: this.details,
    };
  }
}
