import { api } from './api';

// ==================== Types ====================

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type ValidatorType = 'auth_required' | 'rate_limit';

export interface AuthRequiredConfig {
  roles?: string[];
  allowApiKey?: boolean;
}

export interface RateLimitConfig {
  limit: number;
  windowSeconds: number;
  keyBy?: 'ip' | 'user' | 'ip+user';
}

export type ValidatorConditionOperator = 'exists' | 'not_exists' | 'equals' | 'not_equals';

export interface ValidatorCondition {
  field: string;
  operator: ValidatorConditionOperator;
  value?: string;
}

// Discriminated union for validator configs
export type ValidatorConfig =
  | { type: 'auth_required'; config: AuthRequiredConfig; condition?: ValidatorCondition }
  | { type: 'rate_limit'; config: RateLimitConfig; condition?: ValidatorCondition };

export type HandlerType =
  | 'form_handler'
  | 'data_create'
  | 'data_query'
  | 'data_update'
  | 'data_delete'
  | 'email_handler'
  | 'response_handler'
  | 'proxy_forward'
  | 'function_handler'
  | 'db_aggregate'
  | 'ai_handler'
  | 'file_upload_handler'
  | 'file_serve_handler'
  | 'replicate'
  | 'embed_store'
  | 'vector_search';

export interface Pipeline {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  pathPattern: string;
  httpMethods: HttpMethod[];
  validators: ValidatorConfig[];
  isEnabled: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineStep {
  id: string;
  pipelineId: string;
  name: string; // Required - used to reference step output in subsequent steps
  handlerType: HandlerType;
  config: Record<string, unknown>;
  order: number;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineWithSteps extends Pipeline {
  steps: PipelineStep[];
}

// ==================== DTOs ====================

export interface MockUser {
  id: string;
  email?: string;
  role?: string;
}

export interface TestPipelineDto {
  method?: string;
  path?: string;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  mockUser?: MockUser;
  simulateAuth?: boolean;
  dryRun?: boolean;
  deploymentAlias?: string;
}

export interface ValidatorDebugInfo {
  type: string;
  passed: boolean;
  durationMs: number;
  skipped?: boolean;
  condition?: {
    field: string;
    operator: string;
    value?: string;
  };
  conditionResult?: boolean;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface StepDebugInfo {
  stepId: string;
  stepName?: string;
  handlerType: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  status: 'success' | 'failed' | 'skipped';
  input: {
    requestBody: Record<string, unknown>;
    previousStepOutputs: Record<string, unknown>;
  };
  output?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  condition?: string;
  conditionResult?: boolean;
}

export interface PipelineDebugInfo {
  validators: ValidatorDebugInfo[];
  steps: StepDebugInfo[];
  totalDurationMs: number;
  startTime: string;
  endTime: string;
}

export interface TestPipelineResult {
  success: boolean;
  response?: {
    status: number;
    body: unknown;
    headers?: Record<string, string>;
  };
  error?: {
    code: string;
    message: string;
    step?: string;
    details?: unknown;
  };
  stepOutputs?: Record<string, unknown>;
  durationMs: number;
  debug?: PipelineDebugInfo;
}

// ==================== API Definition ====================
// Note: Standalone pipeline CRUD endpoints have been removed.
// Pipeline configuration is now embedded in proxy rules.
// The pipelinesApi is kept for type exports used by the pipeline config UI.

export const pipelinesApi = api.injectEndpoints({
  endpoints: () => ({}),
});
