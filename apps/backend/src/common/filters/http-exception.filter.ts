import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ThrottlerException } from '@nestjs/throttler';

interface ErrorResponse {
  statusCode: number;
  error: string;
  message: string | string[];
  timestamp: string;
  path: string;
  // Only included in non-production environments
  stack?: string;
}

/**
 * Global exception filter that:
 * 1. Catches all HTTP exceptions
 * 2. Strips stack traces in production
 * 3. Returns consistent error responses
 * 4. Logs errors for debugging
 * 5. Handles rate limiting with Retry-After header
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);
  private readonly isProduction = process.env.NODE_ENV === 'production';

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // If headers have already been sent (e.g., by a guard that did a redirect),
    // we cannot send another response. Just log and return.
    if (response.headersSent) {
      // Still log the exception for debugging, but don't try to send response
      const status = exception instanceof HttpException ? exception.getStatus() : 500;
      this.logError(request, status, exception);
      return;
    }

    // Determine status code and message
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const responseObj = exceptionResponse as Record<string, unknown>;
        message = (responseObj.message as string | string[]) || exception.message;
        error = (responseObj.error as string) || this.getErrorName(status);
      }

      // Handle rate limiting - add Retry-After header
      if (exception instanceof ThrottlerException) {
        // Default to 60 seconds retry window
        response.setHeader('Retry-After', '60');
        error = 'Too Many Requests';
        message = 'Rate limit exceeded. Please try again later.';
      }
    } else if (exception instanceof Error) {
      // Handle non-HTTP exceptions (e.g., database errors)
      message = this.isProduction ? 'Internal server error' : exception.message;
      error = 'Internal Server Error';

      // Check for specific database errors
      if (this.isDatabaseConnectionError(exception)) {
        status = HttpStatus.SERVICE_UNAVAILABLE;
        error = 'Service Unavailable';
        message = 'Service temporarily unavailable. Please try again later.';
        response.setHeader('Retry-After', '30');
      }
    }

    // Build error response
    const errorResponse: ErrorResponse = {
      statusCode: status,
      error,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    // Only include stack trace in non-production environments
    if (!this.isProduction && exception instanceof Error) {
      errorResponse.stack = exception.stack;
    }

    // Log the error
    this.logError(request, status, exception);

    // Send response
    response.status(status).json(errorResponse);
  }

  /**
   * Get standard error name from HTTP status code
   */
  private getErrorName(status: number): string {
    const errorNames: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: 'Bad Request',
      [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
      [HttpStatus.FORBIDDEN]: 'Forbidden',
      [HttpStatus.NOT_FOUND]: 'Not Found',
      [HttpStatus.CONFLICT]: 'Conflict',
      [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
      [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
      [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
      [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
    };
    return errorNames[status] || 'Error';
  }

  /**
   * Check if exception is a database connection error
   */
  private isDatabaseConnectionError(exception: Error): boolean {
    const errorMessage = exception.message?.toLowerCase() || '';
    const errorName = exception.name?.toLowerCase() || '';

    return (
      errorMessage.includes('connection refused') ||
      errorMessage.includes('connection terminated') ||
      errorMessage.includes('econnrefused') ||
      errorMessage.includes('database') && errorMessage.includes('unavailable') ||
      errorName.includes('connection') ||
      // PostgreSQL specific errors
      errorMessage.includes('pgconnectionerror') ||
      errorMessage.includes('too many connections')
    );
  }

  /**
   * Log the error with appropriate level based on status code
   */
  private logError(request: Request, status: number, exception: unknown): void {
    const { method, url, ip } = request;
    const userId = (request as any).user?.userId || 'anonymous';

    const logContext = {
      method,
      url,
      ip,
      userId,
      status,
    };

    if (status >= 500) {
      // Server errors - log with full details
      this.logger.error(
        `[${method}] ${url} - ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
        JSON.stringify(logContext),
      );
    } else if (status === 401 || status === 403) {
      // Auth errors - log as warnings
      this.logger.warn(
        `[${method}] ${url} - ${status} - User: ${userId}`,
        JSON.stringify(logContext),
      );
    } else if (status === 429) {
      // Rate limiting - log as info
      this.logger.log(
        `Rate limit exceeded: [${method}] ${url} - IP: ${ip}`,
        JSON.stringify(logContext),
      );
    } else {
      // Client errors (400, 404, etc.) - debug level
      this.logger.debug(
        `[${method}] ${url} - ${status}`,
        JSON.stringify(logContext),
      );
    }
  }
}
