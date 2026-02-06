import { api } from './api';

export interface UserGroup {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserGroupMember {
  id: string;
  groupId: string;
  userId: string;
  addedBy: string | null;
  addedAt: string;
  user: {
    id: string;
    email: string;
    name: string | null;
  };
}

export interface UserGroupWithMembers extends UserGroup {
  members: UserGroupMember[];
}

export interface CreateGroupDto {
  name: string;
  description?: string;
}

export interface UpdateGroupDto {
  name?: string;
  description?: string;
}

export interface AddMemberDto {
  userId: string;
}

export const userGroupsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    listUserGroups: builder.query<UserGroup[], void>({
      query: () => '/api/user-groups',
      transformResponse: (response: { groups: UserGroup[] }) => response.groups,
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: 'UserGroup' as const, id })),
              { type: 'UserGroup' as const, id: 'LIST' },
            ]
          : [{ type: 'UserGroup' as const, id: 'LIST' }],
    }),

    getGroup: builder.query<UserGroupWithMembers, string>({
      query: (id) => `/api/user-groups/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'UserGroup' as const, id }],
    }),

    getGroupMembers: builder.query<UserGroupMember[], string>({
      query: (id) => `/api/user-groups/${id}/members`,
      providesTags: (_result, _error, id) => [
        { type: 'UserGroup' as const, id: `${id}-members` },
      ],
    }),

    createGroup: builder.mutation<UserGroup, CreateGroupDto>({
      query: (dto) => ({
        url: '/api/user-groups',
        method: 'POST',
        body: dto,
      }),
      invalidatesTags: [{ type: 'UserGroup' as const, id: 'LIST' }],
    }),

    updateGroup: builder.mutation<
      UserGroup,
      { id: string; updates: UpdateGroupDto }
    >({
      query: ({ id, updates }) => ({
        url: `/api/user-groups/${id}`,
        method: 'PATCH',
        body: updates,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'UserGroup' as const, id },
        { type: 'UserGroup' as const, id: 'LIST' },
      ],
    }),

    deleteGroup: builder.mutation<void, string>({
      query: (id) => ({
        url: `/api/user-groups/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, id) => [
        { type: 'UserGroup' as const, id },
        { type: 'UserGroup' as const, id: 'LIST' },
      ],
    }),

    addMember: builder.mutation<void, { groupId: string; dto: AddMemberDto }>({
      query: ({ groupId, dto }) => ({
        url: `/api/user-groups/${groupId}/members`,
        method: 'POST',
        body: dto,
      }),
      invalidatesTags: (_result, _error, { groupId }) => [
        { type: 'UserGroup' as const, id: groupId },
        { type: 'UserGroup' as const, id: `${groupId}-members` },
      ],
    }),

    removeMember: builder.mutation<void, { groupId: string; userId: string }>({
      query: ({ groupId, userId }) => ({
        url: `/api/user-groups/${groupId}/members/${userId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { groupId }) => [
        { type: 'UserGroup' as const, id: groupId },
        { type: 'UserGroup' as const, id: `${groupId}-members` },
      ],
    }),
  }),
});

export const {
  useListUserGroupsQuery,
  useGetGroupQuery,
  useGetGroupMembersQuery,
  useCreateGroupMutation,
  useUpdateGroupMutation,
  useDeleteGroupMutation,
  useAddMemberMutation,
  useRemoveMemberMutation,
} = userGroupsApi;
