import { api } from './api';

// ==================== Types ====================

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type ValidatorType = 'auth_required' | 'rate_limit';

export interface ValidatorConfig {
  type: ValidatorType;
  config: Record<string, unknown>;
}

export type HandlerType =
  | 'form_handler'
  | 'data_create'
  | 'data_query'
  | 'data_update'
  | 'data_delete'
  | 'email_handler'
  | 'response_handler'
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

export interface CreatePipelineDto {
  projectId: string;
  name: string;
  description?: string;
  pathPattern: string;
  httpMethods?: HttpMethod[];
  validators?: ValidatorConfig[];
  isEnabled?: boolean;
  order?: number;
}

export interface UpdatePipelineDto {
  name?: string;
  description?: string;
  pathPattern?: string;
  httpMethods?: HttpMethod[];
  validators?: ValidatorConfig[];
  isEnabled?: boolean;
  order?: number;
}

export interface CreatePipelineStepDto {
  name?: string;
  handlerType: HandlerType;
  config: Record<string, unknown>;
  order?: number;
  isEnabled?: boolean;
}

export interface UpdatePipelineStepDto {
  name?: string;
  handlerType?: HandlerType;
  config?: Record<string, unknown>;
  order?: number;
  isEnabled?: boolean;
}

export interface ReorderStepsDto {
  stepIds: string[];
}

export interface TestPipelineDto {
  method?: string;
  path?: string;
  input: Record<string, unknown>;
  headers?: Record<string, string>;
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
}

// ==================== List Responses ====================

export interface PipelinesListResponse {
  pipelines: Pipeline[];
}

// ==================== API Definition ====================

export const pipelinesApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // ==================== Pipelines ====================

    getProjectPipelines: builder.query<PipelinesListResponse, string>({
      query: (projectId) => `/api/pipelines/project/${projectId}`,
      providesTags: (_result, _error, projectId) => [
        { type: 'Pipeline' as const, id: `project-${projectId}` },
        'Pipeline',
      ],
    }),

    getPipeline: builder.query<PipelineWithSteps, string>({
      query: (id) => `/api/pipelines/${id}`,
      providesTags: (_result, _error, id) => [
        { type: 'Pipeline' as const, id },
        { type: 'PipelineStep' as const, id: `pipeline-${id}` },
      ],
    }),

    createPipeline: builder.mutation<Pipeline, CreatePipelineDto>({
      query: (data) => ({
        url: '/api/pipelines',
        method: 'POST',
        body: data,
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'Pipeline' as const, id: `project-${projectId}` },
        'Pipeline',
      ],
    }),

    updatePipeline: builder.mutation<Pipeline, { id: string; data: UpdatePipelineDto }>({
      query: ({ id, data }) => ({
        url: `/api/pipelines/${id}`,
        method: 'PUT',
        body: data,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Pipeline' as const, id },
        'Pipeline',
      ],
    }),

    deletePipeline: builder.mutation<{ success: boolean }, string>({
      query: (id) => ({
        url: `/api/pipelines/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Pipeline', 'PipelineStep'],
    }),

    testPipeline: builder.mutation<TestPipelineResult, { id: string; data: TestPipelineDto }>({
      query: ({ id, data }) => ({
        url: `/api/pipelines/${id}/test`,
        method: 'POST',
        body: data,
      }),
    }),

    // ==================== Pipeline Steps ====================

    getPipelineSteps: builder.query<PipelineStep[], string>({
      query: (pipelineId) => `/api/pipelines/${pipelineId}/steps`,
      providesTags: (_result, _error, pipelineId) => [
        { type: 'PipelineStep' as const, id: `pipeline-${pipelineId}` },
      ],
    }),

    addStep: builder.mutation<PipelineStep, { pipelineId: string; data: CreatePipelineStepDto }>({
      query: ({ pipelineId, data }) => ({
        url: `/api/pipelines/${pipelineId}/steps`,
        method: 'POST',
        body: data,
      }),
      invalidatesTags: (_result, _error, { pipelineId }) => [
        { type: 'PipelineStep' as const, id: `pipeline-${pipelineId}` },
        { type: 'Pipeline' as const, id: pipelineId },
      ],
    }),

    updateStep: builder.mutation<
      PipelineStep,
      { pipelineId: string; stepId: string; data: UpdatePipelineStepDto }
    >({
      query: ({ pipelineId, stepId, data }) => ({
        url: `/api/pipelines/${pipelineId}/steps/${stepId}`,
        method: 'PUT',
        body: data,
      }),
      invalidatesTags: (_result, _error, { pipelineId }) => [
        { type: 'PipelineStep' as const, id: `pipeline-${pipelineId}` },
      ],
    }),

    deleteStep: builder.mutation<{ success: boolean }, { pipelineId: string; stepId: string }>({
      query: ({ pipelineId, stepId }) => ({
        url: `/api/pipelines/${pipelineId}/steps/${stepId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { pipelineId }) => [
        { type: 'PipelineStep' as const, id: `pipeline-${pipelineId}` },
        { type: 'Pipeline' as const, id: pipelineId },
      ],
    }),

    reorderSteps: builder.mutation<
      PipelineStep[],
      { pipelineId: string; data: ReorderStepsDto }
    >({
      query: ({ pipelineId, data }) => ({
        url: `/api/pipelines/${pipelineId}/steps/reorder`,
        method: 'PUT',
        body: data,
      }),
      invalidatesTags: (_result, _error, { pipelineId }) => [
        { type: 'PipelineStep' as const, id: `pipeline-${pipelineId}` },
      ],
    }),
  }),
});

export const {
  // Pipelines
  useGetProjectPipelinesQuery,
  useGetPipelineQuery,
  useCreatePipelineMutation,
  useUpdatePipelineMutation,
  useDeletePipelineMutation,
  useTestPipelineMutation,
  // Steps
  useGetPipelineStepsQuery,
  useAddStepMutation,
  useUpdateStepMutation,
  useDeleteStepMutation,
  useReorderStepsMutation,
} = pipelinesApi;
