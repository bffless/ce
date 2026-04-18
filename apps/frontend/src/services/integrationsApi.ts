import { api } from './api';

export interface IntegrationInfo {
  id: string;
  enabled: boolean;
  activeEnvironment: 'sandbox' | 'production';
  hasSandboxConfig: boolean;
  hasProductionConfig: boolean;
  publicConfig?: Record<string, unknown>;
}

export const integrationsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getProjectIntegrations: builder.query<IntegrationInfo[], string>({
      query: (projectId) => `/api/projects/${projectId}/integrations`,
      providesTags: (_result, _error, projectId) => [
        { type: 'Integration' as const, id: projectId },
      ],
    }),

    getProjectIntegration: builder.query<
      IntegrationInfo,
      { projectId: string; integrationId: string }
    >({
      query: ({ projectId, integrationId }) =>
        `/api/projects/${projectId}/integrations/${integrationId}`,
      providesTags: (_result, _error, { projectId }) => [
        { type: 'Integration' as const, id: projectId },
      ],
    }),

    setIntegrationConfig: builder.mutation<
      IntegrationInfo,
      {
        projectId: string;
        integrationId: string;
        environment: 'sandbox' | 'production';
        config: Record<string, unknown>;
      }
    >({
      query: ({ projectId, integrationId, environment, config }) => ({
        url: `/api/projects/${projectId}/integrations/${integrationId}/${environment}`,
        method: 'PUT',
        body: { config },
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'Integration' as const, id: projectId },
      ],
    }),

    switchIntegrationEnvironment: builder.mutation<
      IntegrationInfo,
      { projectId: string; integrationId: string; environment: 'sandbox' | 'production' }
    >({
      query: ({ projectId, integrationId, environment }) => ({
        url: `/api/projects/${projectId}/integrations/${integrationId}/environment`,
        method: 'PATCH',
        body: { environment },
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'Integration' as const, id: projectId },
      ],
    }),

    deleteIntegration: builder.mutation<
      void,
      { projectId: string; integrationId: string }
    >({
      query: ({ projectId, integrationId }) => ({
        url: `/api/projects/${projectId}/integrations/${integrationId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'Integration' as const, id: projectId },
      ],
    }),

    testIntegrationConnection: builder.mutation<
      { success: boolean; error?: string },
      { projectId: string; integrationId: string; environment?: 'sandbox' | 'production' }
    >({
      query: ({ projectId, integrationId, environment }) => ({
        url: `/api/projects/${projectId}/integrations/${integrationId}/test`,
        method: 'POST',
        body: { environment },
      }),
    }),
  }),
});

export const {
  useGetProjectIntegrationsQuery,
  useGetProjectIntegrationQuery,
  useSetIntegrationConfigMutation,
  useSwitchIntegrationEnvironmentMutation,
  useDeleteIntegrationMutation,
  useTestIntegrationConnectionMutation,
} = integrationsApi;
