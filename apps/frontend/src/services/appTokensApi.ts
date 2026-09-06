import { api } from './api';

/** Mirror of `AppTokenView` in `ce/apps/backend/src/app-tokens/app-tokens.dto.ts`. */
export interface AppToken {
  id: string;
  name: string;
  tokenPrefix: string;
  project: { id: string; owner: string; name: string };
  scopes: string[];
  kind: string; // 'personal' | 'oauth'
  clientId: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface CreateAppTokenDto {
  name: string;
  project: string; // owner/repo
  scopes: string[];
  /** ISO-8601; omitted → the server's 90-day default. Mutually exclusive with `neverExpires`. */
  expiresAt?: string;
  /** Mint a token that never expires (`expiresAt` comes back null). Omit rather than send `false`. */
  neverExpires?: boolean;
}

export interface CreateAppTokenResponse {
  data: AppToken;
  token: string; // shown once
}

export const appTokensApi = api.injectEndpoints({
  endpoints: (builder) => ({
    listAppTokens: builder.query<AppToken[], void>({
      query: () => '/api/app-tokens',
      transformResponse: (response: { data: AppToken[] }) => response.data,
      providesTags: [{ type: 'AppToken' as const, id: 'LIST' }],
    }),
    createAppToken: builder.mutation<CreateAppTokenResponse, CreateAppTokenDto>({
      query: (body) => ({ url: '/api/app-tokens', method: 'POST', body }),
      invalidatesTags: [{ type: 'AppToken' as const, id: 'LIST' }],
    }),
    revokeAppToken: builder.mutation<void, string>({
      query: (id) => ({ url: `/api/app-tokens/${id}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'AppToken' as const, id: 'LIST' }],
    }),
  }),
});

export const { useListAppTokensQuery, useCreateAppTokenMutation, useRevokeAppTokenMutation } =
  appTokensApi;
