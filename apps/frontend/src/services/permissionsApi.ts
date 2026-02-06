import { api } from './api';

export type ProjectRole = 'owner' | 'admin' | 'contributor' | 'viewer';
export type ProjectGroupRole = 'admin' | 'contributor' | 'viewer';

export interface UserPermission {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  grantedBy: string | null;
  grantedAt: string;
  user: {
    id: string;
    email: string;
    name: string | null;
  };
}

export interface GroupPermission {
  id: string;
  projectId: string;
  groupId: string;
  role: ProjectGroupRole;
  grantedBy: string | null;
  grantedAt: string;
  group: {
    id: string;
    name: string;
    description: string | null;
  };
}

export interface ProjectPermissionsResponse {
  userPermissions: UserPermission[];
  groupPermissions: GroupPermission[];
}

export interface GrantUserPermissionDto {
  userId: string;
  role: ProjectRole;
}

export interface GrantGroupPermissionDto {
  groupId: string;
  role: ProjectGroupRole;
}

export const permissionsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getProjectPermissions: builder.query<
      ProjectPermissionsResponse,
      { owner: string; repo: string }
    >({
      query: ({ owner, repo }) => `/api/projects/${owner}/${repo}/permissions`,
      providesTags: (_result, _error, { owner, repo }) => [
        { type: 'Permission' as const, id: `${owner}/${repo}` },
      ],
    }),

    grantUserPermission: builder.mutation<
      void,
      { owner: string; repo: string; dto: GrantUserPermissionDto }
    >({
      query: ({ owner, repo, dto }) => ({
        url: `/api/projects/${owner}/${repo}/permissions/users`,
        method: 'POST',
        body: dto,
      }),
      invalidatesTags: (_result, _error, { owner, repo }) => [
        { type: 'Permission' as const, id: `${owner}/${repo}` },
      ],
    }),

    revokeUserPermission: builder.mutation<
      void,
      { owner: string; repo: string; userId: string }
    >({
      query: ({ owner, repo, userId }) => ({
        url: `/api/projects/${owner}/${repo}/permissions/users/${userId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { owner, repo }) => [
        { type: 'Permission' as const, id: `${owner}/${repo}` },
      ],
    }),

    grantGroupPermission: builder.mutation<
      void,
      { owner: string; repo: string; dto: GrantGroupPermissionDto }
    >({
      query: ({ owner, repo, dto }) => ({
        url: `/api/projects/${owner}/${repo}/permissions/groups`,
        method: 'POST',
        body: dto,
      }),
      invalidatesTags: (_result, _error, { owner, repo }) => [
        { type: 'Permission' as const, id: `${owner}/${repo}` },
      ],
    }),

    revokeGroupPermission: builder.mutation<
      void,
      { owner: string; repo: string; groupId: string }
    >({
      query: ({ owner, repo, groupId }) => ({
        url: `/api/projects/${owner}/${repo}/permissions/groups/${groupId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { owner, repo }) => [
        { type: 'Permission' as const, id: `${owner}/${repo}` },
      ],
    }),
  }),
});

export const {
  useGetProjectPermissionsQuery,
  useGrantUserPermissionMutation,
  useRevokeUserPermissionMutation,
  useGrantGroupPermissionMutation,
  useRevokeGroupPermissionMutation,
} = permissionsApi;
