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

export interface ListAppTokensArgs {
  /** Also list revoked and expired tokens; the server omits them by default. */
  includeInactive?: boolean;
}

/** One page of `GET /api/app-tokens`; `nextCursor` is null on the last page. */
export interface ListAppTokensPage {
  data: AppToken[];
  nextCursor: string | null;
}

export const appTokensApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // Cursor-paged: each page is fetched with the previous page's `nextCursor`;
    // a mint or revoke invalidates the whole list and every loaded page refetches.
    listAppTokens: builder.infiniteQuery<ListAppTokensPage, ListAppTokensArgs, string | null>({
      infiniteQueryOptions: {
        initialPageParam: null,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
      query: ({ queryArg, pageParam }) => {
        const params = new URLSearchParams();
        if (queryArg.includeInactive) params.set('includeInactive', 'true');
        if (pageParam) params.set('cursor', pageParam);
        const qs = params.toString();
        return `/api/app-tokens${qs ? `?${qs}` : ''}`;
      },
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

export const {
  useListAppTokensInfiniteQuery,
  useCreateAppTokenMutation,
  useRevokeAppTokenMutation,
} = appTokensApi;
