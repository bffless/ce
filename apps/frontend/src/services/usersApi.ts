import { api } from './api';

export interface User {
  id: string;
  email: string;
  role: string;
  disabled: boolean;
  disabledAt: string | null;
  disabledBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PaginatedUsersResponse {
  data: User[];
  meta: PaginationMeta;
}

export type UserRole = 'admin' | 'user' | 'member';

export interface ListUsersParams {
  page?: number;
  limit?: number;
  search?: string;
  role?: UserRole;
  sortBy?: 'createdAt' | 'updatedAt' | 'email';
  sortOrder?: 'asc' | 'desc';
}

export interface UpdateUserRoleDto {
  role: UserRole;
}

export interface UserResponse {
  message: string;
  user: User;
}

export interface DeleteUserResponse {
  message: string;
  userId: string;
}

export const usersApi = api.injectEndpoints({
  endpoints: (builder) => ({
    listUsers: builder.query<PaginatedUsersResponse, ListUsersParams | void>({
      query: (params) => {
        const searchParams = new URLSearchParams();
        if (params?.page) searchParams.set('page', String(params.page));
        if (params?.limit) searchParams.set('limit', String(params.limit));
        if (params?.search) searchParams.set('search', params.search);
        if (params?.role) searchParams.set('role', params.role);
        if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
        if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);
        const queryString = searchParams.toString();
        return `/api/users${queryString ? `?${queryString}` : ''}`;
      },
      providesTags: (result) =>
        result
          ? [
              ...result.data.map(({ id }) => ({ type: 'User' as const, id })),
              { type: 'User' as const, id: 'LIST' },
            ]
          : [{ type: 'User' as const, id: 'LIST' }],
    }),

    getUser: builder.query<User, string>({
      query: (id) => `/api/users/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'User' as const, id }],
    }),

    updateUserRole: builder.mutation<UserResponse, { id: string; role: UserRole }>({
      query: ({ id, role }) => ({
        url: `/api/users/${id}/role`,
        method: 'PUT',
        body: { role },
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'User' as const, id },
        { type: 'User' as const, id: 'LIST' },
      ],
    }),

    deleteUser: builder.mutation<DeleteUserResponse, string>({
      query: (id) => ({
        url: `/api/users/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, id) => [
        { type: 'User' as const, id },
        { type: 'User' as const, id: 'LIST' },
      ],
    }),

    disableUser: builder.mutation<UserResponse, string>({
      query: (id) => ({
        url: `/api/users/${id}/disable`,
        method: 'POST',
      }),
      invalidatesTags: (_result, _error, id) => [
        { type: 'User' as const, id },
        { type: 'User' as const, id: 'LIST' },
      ],
    }),

    enableUser: builder.mutation<UserResponse, string>({
      query: (id) => ({
        url: `/api/users/${id}/enable`,
        method: 'POST',
      }),
      invalidatesTags: (_result, _error, id) => [
        { type: 'User' as const, id },
        { type: 'User' as const, id: 'LIST' },
      ],
    }),
  }),
});

export const {
  useListUsersQuery,
  useGetUserQuery,
  useUpdateUserRoleMutation,
  useDeleteUserMutation,
  useDisableUserMutation,
  useEnableUserMutation,
} = usersApi;
