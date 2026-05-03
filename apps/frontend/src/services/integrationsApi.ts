import { api } from './api';

export interface IntegrationInfo {
  id: string;
  enabled: boolean;
  activeEnvironment: 'sandbox' | 'production';
  hasSandboxConfig: boolean;
  hasProductionConfig: boolean;
  publicConfig?: Record<string, unknown>;
}

export interface CalendarSummary {
  id: string;
  summary: string;
  primary?: boolean;
  timeZone: string;
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

    // ===== Google Calendar OAuth =====

    initiateGoogleCalendarOAuth: builder.query<
      { authUrl: string },
      { projectId: string; redirectUri: string }
    >({
      query: ({ projectId, redirectUri }) =>
        `/api/projects/${projectId}/integrations/google-calendar/oauth/initiate?redirectUri=${encodeURIComponent(redirectUri)}`,
    }),

    completeGoogleCalendarOAuth: builder.mutation<
      { success: boolean; connectedEmail: string },
      { projectId: string; code: string; state: string; redirectUri: string }
    >({
      query: ({ projectId, code, state, redirectUri }) => ({
        url: `/api/projects/${projectId}/integrations/google-calendar/oauth/callback`,
        method: 'POST',
        body: { code, state, redirectUri },
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'Integration' as const, id: projectId },
      ],
    }),

    disconnectGoogleCalendarOAuth: builder.mutation<void, { projectId: string }>({
      query: ({ projectId }) => ({
        url: `/api/projects/${projectId}/integrations/google-calendar/oauth`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'Integration' as const, id: projectId },
      ],
    }),

    listGoogleCalendarCalendars: builder.query<{ calendars: CalendarSummary[] }, string>({
      query: (projectId) =>
        `/api/projects/${projectId}/integrations/google-calendar/calendars`,
      providesTags: (_result, _error, projectId) => [
        { type: 'Integration' as const, id: projectId },
      ],
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
  useLazyInitiateGoogleCalendarOAuthQuery,
  useCompleteGoogleCalendarOAuthMutation,
  useDisconnectGoogleCalendarOAuthMutation,
  useListGoogleCalendarCalendarsQuery,
} = integrationsApi;
