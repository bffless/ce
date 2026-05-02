import { api } from './api';

export type ProjectRole = 'owner' | 'admin' | 'contributor' | 'viewer' | 'guest';

/**
 * Mirror of `MyProjectMembership` from
 * `ce/apps/backend/src/permissions/permissions.service.ts`. Powers the
 * "My Sites" admin hub at `/account`.
 */
export interface MyProjectMembership {
  projectId: string;
  projectName: string;
  projectSlug: string;
  primaryUrl: string | null;
  role: ProjectRole;
  joinedAt: string;
  ownerEmail: string | null;
}

export const meApi = api.injectEndpoints({
  endpoints: (builder) => ({
    listMyProjects: builder.query<MyProjectMembership[], void>({
      query: () => '/api/me/projects',
      providesTags: [{ type: 'MyProjects' as const, id: 'LIST' }],
    }),

    leaveProject: builder.mutation<void, { projectId: string }>({
      query: ({ projectId }) => ({
        url: `/api/me/projects/${projectId}`,
        method: 'DELETE',
      }),
      invalidatesTags: [{ type: 'MyProjects' as const, id: 'LIST' }],
    }),
  }),
});

export const { useListMyProjectsQuery, useLeaveProjectMutation } = meApi;
