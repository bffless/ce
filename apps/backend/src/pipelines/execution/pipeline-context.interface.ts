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
   * Outputs from previous steps, keyed by step name
   */
  stepOutputs: Record<string, unknown>;

  /**
   * The project this pipeline belongs to
   */
  projectId: string;

  /**
   * The pipeline being executed
   */
  pipelineId: string;

  /**
   * Request metadata
   */
  metadata: {
    path: string;
    method: string;
    headers: Record<string, string | string[] | undefined>;
    query: Record<string, unknown>;
    body: Record<string, unknown>;
    ip?: string;
    userAgent?: string;
  };

  /**
   * Deployment context for accessing deployment-specific resources like skills.
   * Populated when pipeline is executed in the context of a deployment.
   */
  deployment?: {
    owner: string;
    repo: string;
    commitSha: string;
    alias?: string;
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

  /**
   * If true and success is true, stop pipeline execution and use output as final response.
   * Useful for honeypot detection where we want to return fake success without processing.
   */
  terminates?: boolean;

  /**
   * Optional warning message when step succeeded but with a non-ideal outcome.
   * Surfaced in debug UI to help users diagnose template/config issues.
   */
  warning?: string;
}

/**
 * Debug information for a single step execution
 */
export interface StepDebugInfo {
  /**
   * Step identifier
   */
  stepId: string;

  /**
   * Step name (if defined)
   */
  stepName?: string;

  /**
   * Handler type that executed this step
   */
  handlerType: string;

  /**
   * When the step started executing
   */
  startTime: string;

  /**
   * When the step finished executing
   */
  endTime: string;

  /**
   * Duration in milliseconds
   */
  durationMs: number;

  /**
   * Execution status
   */
  status: 'success' | 'failed' | 'skipped';

  /**
   * Input snapshot before execution (context state)
   */
  input: {
    requestBody: Record<string, unknown>;
    previousStepOutputs: Record<string, unknown>;
  };

  /**
   * Output from the step (if successful)
   */
  output?: unknown;

  /**
   * Error information (if failed)
   */
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };

  /**
   * Warning message if step succeeded but with a non-ideal outcome
   */
  warning?: string;

  /**
   * Condition that was evaluated (if any)
   */
  condition?: string;

  /**
   * Result of condition evaluation
   */
  conditionResult?: boolean;
}

/**
 * Debug information for a validator execution
 */
export interface ValidatorDebugInfo {
  /**
   * Validator type
   */
  type: string;

  /**
   * Whether validation passed
   */
  passed: boolean;

  /**
   * Duration in milliseconds
   */
  durationMs: number;

  /**
   * Whether the validator was skipped due to a condition not being met
   */
  skipped?: boolean;

  /**
   * The condition that was evaluated (if any)
   */
  condition?: {
    field: string;
    operator: string;
    value?: string;
  };

  /**
   * Result of condition evaluation
   */
  conditionResult?: boolean;

  /**
   * Error information (if failed)
   */
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Debug information for the entire pipeline execution
 */
export interface PipelineDebugInfo {
  /**
   * Validator execution results
   */
  validators: ValidatorDebugInfo[];

  /**
   * Step execution results
   */
  steps: StepDebugInfo[];

  /**
   * Total execution time in milliseconds
   */
  totalDurationMs: number;

  /**
   * When execution started
   */
  startTime: string;

  /**
   * When execution ended
   */
  endTime: string;
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

/**
 * Result of executing a pipeline with debug information
 */
export interface PipelineDebugResult extends PipelineResult {
  /**
   * Debug information (present when debug mode is enabled)
   */
  debug?: PipelineDebugInfo;
}
