import { api } from './api';

export interface ApiKey {
  id: string;
  name: string;
  key: string; // Only returned on creation
  userId: string;
  projectId: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface ApiKeyListItem {
  id: string;
  name: string;
  userId: string;
  projectId: string | null;
  project?: {
    id: string;
    owner: string;
    name: string;
  } | null;
  isGlobal: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  // Note: key is NOT included in list responses (security)
}

export interface CreateApiKeyDto {
  name: string;
  repository?: string; // "owner/repo" format - required unless isGlobal=true
  expiresAt?: string;
  isGlobal?: boolean; // Create a global API key (admin only)
}

export interface CreateApiKeyResponse {
  message: string;
  data: {
    id: string;
    name: string;
    projectId: string;
    expiresAt: string | null;
    createdAt: string;
  };
  key: string; // Full key only shown once
}

export interface ListApiKeysResponse {
  data: ApiKeyListItem[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export const apiKeysApi = api.injectEndpoints({
  endpoints: (builder) => ({
    listApiKeys: builder.query<ApiKeyListItem[], void>({
      query: () => '/api/api-keys',
      transformResponse: (response: ListApiKeysResponse) => response.data,
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: 'ApiKey' as const, id })),
              { type: 'ApiKey' as const, id: 'LIST' },
            ]
          : [{ type: 'ApiKey' as const, id: 'LIST' }],
    }),

    getApiKey: builder.query<ApiKeyListItem, string>({
      query: (id) => `/api/api-keys/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'ApiKey' as const, id }],
    }),

    createApiKey: builder.mutation<CreateApiKeyResponse, CreateApiKeyDto>({
      query: (dto) => ({
        url: '/api/api-keys',
        method: 'POST',
        body: dto,
      }),
      invalidatesTags: [{ type: 'ApiKey' as const, id: 'LIST' }],
    }),

    deleteApiKey: builder.mutation<void, string>({
      query: (id) => ({
        url: `/api/api-keys/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, id) => [
        { type: 'ApiKey' as const, id },
        { type: 'ApiKey' as const, id: 'LIST' },
      ],
    }),
  }),
});

export const {
  useListApiKeysQuery,
  useGetApiKeyQuery,
  useCreateApiKeyMutation,
  useDeleteApiKeyMutation,
} = apiKeysApi;
