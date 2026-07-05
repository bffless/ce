import { api } from './api';

export interface PipelineSchedule {
  id: string;
  projectId: string;
  name: string;
  targetProxyRuleId: string;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  executionStartedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineRuleOption {
  id: string;
  name: string;
  ruleSetId: string;
  ruleSetName: string;
  pathPattern: string;
  method: string | null;
}

export interface CreatePipelineScheduleDto {
  name: string;
  targetProxyRuleId: string;
  cronExpression: string;
  timezone?: string;
  enabled?: boolean;
}

export interface UpdatePipelineScheduleDto {
  name?: string;
  cronExpression?: string;
  timezone?: string;
  enabled?: boolean;
}

interface SchedulesListResponse {
  data: PipelineSchedule[];
}
interface RuleOptionsListResponse {
  data: PipelineRuleOption[];
}

export const pipelineSchedulesApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getSchedules: builder.query<PipelineSchedule[], string>({
      query: (projectId) => `/api/pipeline-schedules/projects/${projectId}/schedules`,
      transformResponse: (response: SchedulesListResponse) => response.data,
      providesTags: (_result, _error, projectId) => [
        { type: 'PipelineSchedule' as const, id: `project-${projectId}` },
        'PipelineSchedule',
      ],
    }),

    getPipelineRuleOptions: builder.query<PipelineRuleOption[], string>({
      query: (projectId) => `/api/pipeline-schedules/projects/${projectId}/pipeline-rules`,
      transformResponse: (response: RuleOptionsListResponse) => response.data,
    }),

    createSchedule: builder.mutation<
      PipelineSchedule,
      { projectId: string; data: CreatePipelineScheduleDto }
    >({
      query: ({ projectId, data }) => ({
        url: `/api/pipeline-schedules/projects/${projectId}/schedules`,
        method: 'POST',
        body: data,
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'PipelineSchedule' as const, id: `project-${projectId}` },
      ],
    }),

    updateSchedule: builder.mutation<
      PipelineSchedule,
      { id: string; projectId: string; data: UpdatePipelineScheduleDto }
    >({
      query: ({ id, data }) => ({
        url: `/api/pipeline-schedules/schedules/${id}`,
        method: 'PUT',
        body: data,
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'PipelineSchedule' as const, id: `project-${projectId}` },
      ],
    }),

    deleteSchedule: builder.mutation<void, { id: string; projectId: string }>({
      query: ({ id }) => ({
        url: `/api/pipeline-schedules/schedules/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'PipelineSchedule' as const, id: `project-${projectId}` },
      ],
    }),
  }),
});

export const {
  useGetSchedulesQuery,
  useGetPipelineRuleOptionsQuery,
  useCreateScheduleMutation,
  useUpdateScheduleMutation,
  useDeleteScheduleMutation,
} = pipelineSchedulesApi;
