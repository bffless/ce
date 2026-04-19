import { api } from './api';

export interface ProjectInviteLink {
  id: string;
  projectId: string;
  token: string;
  role: string;
  label: string | null;
  isActive: boolean;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  lastUsedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ValidateProjectInviteTokenResponse {
  valid: boolean;
  projectName?: string;
  projectOwner?: string;
  role?: string;
}

export interface CreateProjectInviteLinkDto {
  role?: string;
  label?: string;
  expiresAt?: string;
  maxUses?: number;
}

export interface UpdateProjectInviteLinkDto {
  label?: string | null;
  isActive?: boolean;
  expiresAt?: string | null;
  maxUses?: number | null;
}

export const projectInviteLinksApi = api.injectEndpoints({
  endpoints: (builder) => ({
    validateProjectInviteToken: builder.query<ValidateProjectInviteTokenResponse, string>({
      query: (token) => `/api/project-invite-links/${token}/validate`,
    }),

    getProjectInviteLinks: builder.query<ProjectInviteLink[], { owner: string; repo: string }>({
      query: ({ owner, repo }) => `/api/projects/${owner}/${repo}/invite-links`,
      providesTags: (_result, _error, { owner, repo }) => [
        { type: 'ProjectInviteLink' as const, id: `${owner}/${repo}` },
      ],
    }),

    createProjectInviteLink: builder.mutation<
      ProjectInviteLink,
      { owner: string; repo: string; dto: CreateProjectInviteLinkDto }
    >({
      query: ({ owner, repo, dto }) => ({
        url: `/api/projects/${owner}/${repo}/invite-links`,
        method: 'POST',
        body: dto,
      }),
      invalidatesTags: (_result, _error, { owner, repo }) => [
        { type: 'ProjectInviteLink' as const, id: `${owner}/${repo}` },
      ],
    }),

    updateProjectInviteLink: builder.mutation<
      ProjectInviteLink,
      { owner: string; repo: string; id: string; dto: UpdateProjectInviteLinkDto }
    >({
      query: ({ owner, repo, id, dto }) => ({
        url: `/api/projects/${owner}/${repo}/invite-links/${id}`,
        method: 'PATCH',
        body: dto,
      }),
      invalidatesTags: (_result, _error, { owner, repo }) => [
        { type: 'ProjectInviteLink' as const, id: `${owner}/${repo}` },
      ],
    }),

    deleteProjectInviteLink: builder.mutation<
      void,
      { owner: string; repo: string; id: string }
    >({
      query: ({ owner, repo, id }) => ({
        url: `/api/projects/${owner}/${repo}/invite-links/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { owner, repo }) => [
        { type: 'ProjectInviteLink' as const, id: `${owner}/${repo}` },
      ],
    }),
  }),
});

export const {
  useValidateProjectInviteTokenQuery,
  useGetProjectInviteLinksQuery,
  useCreateProjectInviteLinkMutation,
  useUpdateProjectInviteLinkMutation,
  useDeleteProjectInviteLinkMutation,
} = projectInviteLinksApi;
