/**
 * Pipeline types for the execution engine.
 * These types were previously defined in db/schema but are now standalone
 * since pipelines are embedded in proxy rules rather than stored in their own table.
 */

/**
 * HTTP methods that a pipeline can respond to
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Validator types for pre-pipeline validation
 */
export type ValidatorType = 'auth_required' | 'rate_limit';

/**
 * Configuration for auth_required validator
 */
export interface AuthRequiredConfig {
  roles?: string[];
  allowApiKey?: boolean;
}

/**
 * Configuration for rate_limit validator
 */
export interface RateLimitConfig {
  limit: number;
  windowSeconds: number;
  keyBy?: 'ip' | 'user' | 'ip+user';
}

/**
 * Condition operator for validator conditions
 */
export type ValidatorConditionOperator = 'exists' | 'not_exists' | 'equals' | 'not_equals';

/**
 * Condition that determines whether a validator should run.
 * Uses the same expression fields available in pipeline steps (user.id, request.ip, etc.)
 */
export interface ValidatorCondition {
  field: string;
  operator: ValidatorConditionOperator;
  value?: string;
}

/**
 * Configuration for a pipeline validator (discriminated union)
 */
export type ValidatorConfig =
  | { type: 'auth_required'; config: AuthRequiredConfig; condition?: ValidatorCondition }
  | { type: 'rate_limit'; config: RateLimitConfig; condition?: ValidatorCondition };

/**
 * Handler types for pipeline steps
 */
export type HandlerType =
  | 'form_handler'
  | 'data_create'
  | 'data_query'
  | 'data_update'
  | 'data_delete'
  | 'email_handler'
  | 'response_handler'
  | 'function_handler'
  | 'db_aggregate'
  | 'ai_handler'
  | 'file_upload_handler'
  | 'file_serve_handler'
  | 'image_convert_handler'
  | 'replicate'
  | 'embed_store'
  | 'vector_search';

/**
 * Pipeline step definition for execution.
 * handlerType uses string at runtime but should be a HandlerType value.
 */
export interface PipelineStep {
  id: string;
  pipelineId: string;
  name: string;
  handlerType: string; // HandlerType at runtime
  config: unknown; // Handler-specific config, cast as needed
  order: number;
  isEnabled: boolean;
}

/**
 * Pipeline definition for execution.
 * This interface is used for runtime data from proxy rules.
 */
export interface Pipeline {
  id: string;
  projectId: string;
  name: string;
  validators: ValidatorConfig[];
  steps: PipelineStep[];
  postSteps?: PipelineStep[];
}
