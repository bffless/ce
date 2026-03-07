import { Request } from 'express';

/**
 * User information available in pipeline context
 */
export interface PipelineUser {
  id: string;
  email?: string;
  role?: string;
}

/**
 * Context passed through pipeline execution
 */
export interface PipelineContext {
  /**
   * The original HTTP request
   */
  request: Request;

  /**
   * Authenticated user (if any)
   */
  user?: PipelineUser;

  /**
   * Parsed input from request body/query
   */
  input: Record<string, unknown>;

  /**
   * Outputs from previous steps, keyed by step name
   */
  stepOutputs: Record<string, unknown>;

  /**
   * The project this pipeline belongs to
   */
  projectId: string;

  /**
   * Request metadata
   */
  metadata: {
    path: string;
    method: string;
    headers: Record<string, string | string[] | undefined>;
    query: Record<string, unknown>;
    ip?: string;
    userAgent?: string;
  };
}

/**
 * Result of executing a single step
 */
export interface StepResult {
  /**
   * Whether the step succeeded
   */
  success: boolean;

  /**
   * Output data from the step (available to subsequent steps)
   */
  output?: unknown;

  /**
   * Error details if step failed
   */
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Result of executing an entire pipeline
 */
export interface PipelineResult {
  /**
   * Whether the pipeline succeeded
   */
  success: boolean;

  /**
   * Final response to send to client (from response_handler or default)
   */
  response?: {
    status: number;
    body: unknown;
    headers?: Record<string, string>;
  };

  /**
   * Error details if pipeline failed
   */
  error?: {
    code: string;
    message: string;
    step?: string;
    details?: unknown;
  };

  /**
   * Outputs from all steps (for debugging/testing)
   */
  stepOutputs?: Record<string, unknown>;
}
