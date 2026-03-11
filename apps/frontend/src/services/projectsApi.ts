import { api } from './api';

export type UnauthorizedBehavior = 'not_found' | 'redirect_login';
export type RequiredRole = 'authenticated' | 'viewer' | 'contributor' | 'admin' | 'owner';

// AI Provider types
export type AIProviderType = 'openai' | 'anthropic' | 'google';
export type ModelTier = 'economy' | 'balanced' | 'premium';

export interface ModelInfo {
  id: string;
  name: string;
  tier: ModelTier;
  contextWindow: number;
  description?: string;
}

export interface ConfiguredProvider {
  provider: AIProviderType;
  isDefault: boolean;
  defaultModel?: string;
  models: ModelInfo[];
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

export interface Project {
  id: string;
  owner: string;
  name: string;
  displayName: string | null;
  description: string | null;
  isPublic: boolean;
  unauthorizedBehavior: UnauthorizedBehavior;
  requiredRole: RequiredRole;
  settings: Record<string, any> | null;
  defaultProxyRuleSetId: string | null;
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
  settings?: Record<string, any>;
  defaultProxyRuleSetId?: string | null;
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
} = projectsApi;
