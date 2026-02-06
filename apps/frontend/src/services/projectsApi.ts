import { api } from './api';

export type UnauthorizedBehavior = 'not_found' | 'redirect_login';
export type RequiredRole = 'authenticated' | 'viewer' | 'contributor' | 'admin' | 'owner';

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
  }),
});

export const {
  useGetProjectQuery,
  useGetProjectByIdQuery,
  useListUserProjectsQuery,
  useCreateProjectMutation,
  useUpdateProjectMutation,
  useDeleteProjectMutation,
} = projectsApi;
