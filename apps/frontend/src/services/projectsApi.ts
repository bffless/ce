import { api } from './api';

export type UnauthorizedBehavior = 'not_found' | 'redirect_login';
export type RequiredRole = 'authenticated' | 'guest' | 'viewer' | 'contributor' | 'admin' | 'owner';

// AI Provider types
export type AIProviderType = 'openai' | 'anthropic' | 'google';
export type ModelTier = 'economy' | 'balanced' | 'premium';

export interface ModelInfo {
  id: string;
  name: string;
  tier: ModelTier;
  contextWindow?: number;
  description?: string;
}

export interface ConfiguredProvider {
  provider: AIProviderType;
  providerName: string;
  apiKey: string; // Masked
  isDefault: boolean;
  defaultModel?: string;
  suggestedModels: ModelInfo[];
}

export interface AIStatusResponse {
  hasAIConfigured: boolean;
  defaultProvider?: AIProviderType;
  providers: ConfiguredProvider[];
}

export interface AddAIProviderDto {
  provider: AIProviderType;
  config: {
    apiKey: string;
    defaultModel?: string;
  };
  isDefault?: boolean;
}

export interface SetDefaultProviderDto {
  provider: AIProviderType;
}

export interface TestAIResponse {
  success: boolean;
  provider: AIProviderType;
  model: string;
  message?: string;
  error?: string;
}

export interface AvailableProvider {
  provider: AIProviderType;
  displayName: string;
  models: ModelInfo[];
}

// AI Service types
export type AIServiceType = 'replicate';

export interface AIServicesStatus {
  services: {
    service: AIServiceType;
    apiToken: string; // Masked
    createdAt: string;
  }[];
}

// Plugin types
export interface PluginListItem {
  id: string;
  name: string;
  description: string;
  category: string;
  icon?: string;
  requiresOAuth?: boolean;
  oauthProvider?: string;
  enabled: boolean;
  hasConfig: boolean;
  configSchema?: Record<string, unknown>;
  oauthConnectedEmail?: string;
  pipelineOptionsSchema?: Record<string, unknown>;
}

export interface CalendarListItem {
  id: string;
  summary: string;
  primary: boolean;
}

// Skill types
export interface SkillSummary {
  name: string;
  description: string;
}

export interface Project {
  id: string;
  owner: string;
  name: string;
  displayName: string | null;
  description: string | null;
  isPublic: boolean;
  unauthorizedBehavior: UnauthorizedBehavior;
  requiredRole: RequiredRole;
  allowPublicSignup: boolean;
  settings: Record<string, any> | null;
  defaultProxyRuleSetId: string | null;
  defaultProxyRuleSetIds?: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectDto {
  owner: string;
  name: string;
  displayName?: string;
  description?: string;
  isPublic?: boolean;
  settings?: Record<string, any>;
}

export interface UpdateProjectDto {
  displayName?: string;
  description?: string;
  isPublic?: boolean;
  unauthorizedBehavior?: UnauthorizedBehavior;
  requiredRole?: RequiredRole;
  allowPublicSignup?: boolean;
  settings?: Record<string, any>;
  defaultProxyRuleSetId?: string | null;
  defaultProxyRuleSetIds?: string[];
}

export const projectsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getProject: builder.query<Project, { owner: string; name: string }>({
      query: ({ owner, name }) => `/api/projects/${owner}/${name}`,
      providesTags: (result, _error, { owner, name }) => [
        { type: 'Project' as const, id: `${owner}/${name}` },
        ...(result ? [{ type: 'Project' as const, id: result.id }] : []),
      ],
    }),

    getProjectById: builder.query<Project, string>({
      query: (id) => `/api/projects/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'Project' as const, id }],
    }),

    listUserProjects: builder.query<Project[], void>({
      query: () => '/api/projects',
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: 'Project' as const, id })),
              { type: 'Project' as const, id: 'LIST' },
            ]
          : [{ type: 'Project' as const, id: 'LIST' }],
    }),

    createProject: builder.mutation<Project, CreateProjectDto>({
      query: (dto) => ({
        url: '/api/projects',
        method: 'POST',
        body: dto,
      }),
      invalidatesTags: [
        { type: 'Project' as const, id: 'LIST' },
        { type: 'Repository' as const, id: 'FEED' },
      ],
    }),

    updateProject: builder.mutation<
      Project,
      { id: string; updates: UpdateProjectDto }
    >({
      query: ({ id, updates }) => ({
        url: `/api/projects/${id}`,
        method: 'PATCH',
        body: updates,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Project' as const, id },
        { type: 'Project' as const, id: 'LIST' },
      ],
    }),

    deleteProject: builder.mutation<void, string>({
      query: (id) => ({
        url: `/api/projects/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: [
        { type: 'Project' as const, id: 'LIST' },
        'Repository',
      ],
    }),

    // AI Settings endpoints
    getProjectAIStatus: builder.query<AIStatusResponse, string>({
      query: (projectId) => `/api/projects/${projectId}/ai`,
      providesTags: (_result, _error, projectId) => [
        { type: 'ProjectAI' as const, id: projectId },
      ],
    }),

    addProjectAIProvider: builder.mutation<
      AIStatusResponse,
      { projectId: string; dto: AddAIProviderDto }
    >({
      query: ({ projectId, dto }) => ({
        url: `/api/projects/${projectId}/ai`,
        method: 'POST',
        body: dto,
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'ProjectAI' as const, id: projectId },
      ],
    }),

    removeProjectAIProvider: builder.mutation<
      AIStatusResponse,
      { projectId: string; provider: AIProviderType }
    >({
      query: ({ projectId, provider }) => ({
        url: `/api/projects/${projectId}/ai/${provider}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'ProjectAI' as const, id: projectId },
      ],
    }),

    setProjectDefaultAIProvider: builder.mutation<
      AIStatusResponse,
      { projectId: string; provider: AIProviderType }
    >({
      query: ({ projectId, provider }) => ({
        url: `/api/projects/${projectId}/ai/default`,
        method: 'POST',
        body: { provider },
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'ProjectAI' as const, id: projectId },
      ],
    }),

    testProjectAI: builder.mutation<
      TestAIResponse,
      { projectId: string; provider?: AIProviderType }
    >({
      query: ({ projectId, provider }) => ({
        url: `/api/projects/${projectId}/ai/test${provider ? `?provider=${provider}` : ''}`,
        method: 'POST',
      }),
    }),

    getAvailableAIProviders: builder.query<
      { providers: AvailableProvider[] },
      string
    >({
      query: (projectId) => `/api/projects/${projectId}/ai/providers`,
    }),

    // AI Plugin endpoints
    listProjectPlugins: builder.query<PluginListItem[], string>({
      query: (id) => `/api/projects/${id}/ai-plugins`,
      providesTags: (_result, _error, projectId) => [
        { type: 'ProjectPlugin' as const, id: projectId },
      ],
    }),

    enableProjectPlugin: builder.mutation<
      PluginListItem,
      { projectId: string; pluginId: string; config?: Record<string, unknown> }
    >({
      query: ({ projectId, pluginId, config }) => ({
        url: `/api/projects/${projectId}/ai-plugins/${pluginId}`,
        method: 'POST',
        body: { config },
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'ProjectPlugin' as const, id: projectId },
      ],
    }),

    updateProjectPluginConfig: builder.mutation<
      PluginListItem,
      { projectId: string; pluginId: string; config: Record<string, unknown> }
    >({
      query: ({ projectId, pluginId, config }) => ({
        url: `/api/projects/${projectId}/ai-plugins/${pluginId}`,
        method: 'PUT',
        body: { config },
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'ProjectPlugin' as const, id: projectId },
      ],
    }),

    disableProjectPlugin: builder.mutation<
      void,
      { projectId: string; pluginId: string }
    >({
      query: ({ projectId, pluginId }) => ({
        url: `/api/projects/${projectId}/ai-plugins/${pluginId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'ProjectPlugin' as const, id: projectId },
      ],
    }),

    // OAuth Plugin endpoints
    initiatePluginOAuth: builder.query<
      { authUrl: string },
      { projectId: string; pluginId: string; redirectUri: string }
    >({
      query: ({ projectId, pluginId, redirectUri }) =>
        `/api/projects/${projectId}/ai-plugins/${pluginId}/oauth/initiate?redirectUri=${encodeURIComponent(redirectUri)}`,
    }),

    completePluginOAuth: builder.mutation<
      { success: boolean; connectedEmail: string },
      { projectId: string; pluginId: string; code: string; state: string; redirectUri: string }
    >({
      query: ({ projectId, pluginId, code, state, redirectUri }) => ({
        url: `/api/projects/${projectId}/ai-plugins/${pluginId}/oauth/callback`,
        method: 'POST',
        body: { code, state, redirectUri },
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'ProjectPlugin' as const, id: projectId },
      ],
    }),

    disconnectPluginOAuth: builder.mutation<
      void,
      { projectId: string; pluginId: string }
    >({
      query: ({ projectId, pluginId }) => ({
        url: `/api/projects/${projectId}/ai-plugins/${pluginId}/oauth`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'ProjectPlugin' as const, id: projectId },
      ],
    }),

    listPluginCalendars: builder.query<
      { calendars: CalendarListItem[] },
      string
    >({
      query: (projectId) =>
        `/api/projects/${projectId}/ai-plugins/google-calendar/calendars`,
    }),

    // AI Services endpoints
    getProjectAIServices: builder.query<AIServicesStatus, string>({
      query: (projectId) => `/api/projects/${projectId}/ai-services`,
      providesTags: (_result, _error, projectId) => [
        { type: 'ProjectAIServices' as const, id: projectId },
      ],
    }),

    addProjectAIService: builder.mutation<
      AIServicesStatus,
      { projectId: string; service: AIServiceType; apiToken: string }
    >({
      query: ({ projectId, service, apiToken }) => ({
        url: `/api/projects/${projectId}/ai-services`,
        method: 'POST',
        body: { service, apiToken },
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'ProjectAIServices' as const, id: projectId },
      ],
    }),

    removeProjectAIService: builder.mutation<
      AIServicesStatus,
      { projectId: string; service: AIServiceType }
    >({
      query: ({ projectId, service }) => ({
        url: `/api/projects/${projectId}/ai-services/${service}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'ProjectAIServices' as const, id: projectId },
      ],
    }),

    testProjectAIService: builder.mutation<
      TestAIResponse,
      { projectId: string; service: AIServiceType; apiToken: string }
    >({
      query: ({ projectId, service, apiToken }) => ({
        url: `/api/projects/${projectId}/ai-services/test`,
        method: 'POST',
        body: { service, apiToken },
      }),
    }),

    // Skills endpoint
    listProjectSkills: builder.query<
      { skills: SkillSummary[] },
      { projectId: string; commitSha?: string }
    >({
      query: ({ projectId, commitSha }) => ({
        url: `/api/projects/${projectId}/ai/skills`,
        params: commitSha ? { commitSha } : undefined,
      }),
      providesTags: (_result, _error, { projectId }) => [
        { type: 'ProjectAI' as const, id: `${projectId}-skills` },
      ],
    }),
    // Skills path
    getProjectSkillsPath: builder.query<
      { skillsPath: string },
      { projectId: string }
    >({
      query: ({ projectId }) => `/api/projects/${projectId}/ai/skills-path`,
      providesTags: (_result, _error, { projectId }) => [
        { type: 'ProjectAI' as const, id: `${projectId}-skills-path` },
      ],
    }),
    setProjectSkillsPath: builder.mutation<
      { skillsPath: string },
      { projectId: string; skillsPath: string }
    >({
      query: ({ projectId, skillsPath }) => ({
        url: `/api/projects/${projectId}/ai/skills-path`,
        method: 'PUT',
        body: { skillsPath },
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'ProjectAI' as const, id: `${projectId}-skills-path` },
        { type: 'ProjectAI' as const, id: `${projectId}-skills` },
      ],
    }),
  }),
});

export const {
  useGetProjectQuery,
  useGetProjectByIdQuery,
  useListUserProjectsQuery,
  useCreateProjectMutation,
  useUpdateProjectMutation,
  useDeleteProjectMutation,
  // AI Settings
  useGetProjectAIStatusQuery,
  useAddProjectAIProviderMutation,
  useRemoveProjectAIProviderMutation,
  useSetProjectDefaultAIProviderMutation,
  useTestProjectAIMutation,
  useGetAvailableAIProvidersQuery,
  // Plugins
  useListProjectPluginsQuery,
  useEnableProjectPluginMutation,
  useUpdateProjectPluginConfigMutation,
  useDisableProjectPluginMutation,
  // Plugin OAuth
  useLazyInitiatePluginOAuthQuery,
  useCompletePluginOAuthMutation,
  useDisconnectPluginOAuthMutation,
  useListPluginCalendarsQuery,
  // AI Services
  useGetProjectAIServicesQuery,
  useAddProjectAIServiceMutation,
  useRemoveProjectAIServiceMutation,
  useTestProjectAIServiceMutation,
  // Skills
  useListProjectSkillsQuery,
  useGetProjectSkillsPathQuery,
  useSetProjectSkillsPathMutation,
} = projectsApi;
