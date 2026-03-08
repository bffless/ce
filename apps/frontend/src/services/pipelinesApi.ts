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

// Discriminated union for validator configs
export type ValidatorConfig =
  | { type: 'auth_required'; config: AuthRequiredConfig }
  | { type: 'rate_limit'; config: RateLimitConfig };

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
  | 'aggregate_handler';

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
  name: string | null;
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
  input: Record<string, unknown>;
  headers?: Record<string, string>;
  mockUser?: MockUser;
  simulateAuth?: boolean;
  dryRun?: boolean;
}

export interface ValidatorDebugInfo {
  type: string;
  passed: boolean;
  durationMs: number;
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
    requestInput: Record<string, unknown>;
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
