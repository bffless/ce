import { api } from './api';

// Types matching backend DTOs

export interface CacheRule {
  id: string;
  projectId: string;
  pathPattern: string;
  browserMaxAge: number;
  cdnMaxAge: number | null;
  staleWhileRevalidate: number | null;
  immutable: boolean;
  cacheability: 'public' | 'private' | null;
  priority: number;
  isEnabled: boolean;
  name: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCacheRuleDto {
  pathPattern: string;
  browserMaxAge?: number;
  cdnMaxAge?: number | null;
  staleWhileRevalidate?: number | null;
  immutable?: boolean;
  cacheability?: 'public' | 'private' | null;
  priority?: number;
  isEnabled?: boolean;
  name?: string;
  description?: string;
}

export interface UpdateCacheRuleDto {
  pathPattern?: string;
  browserMaxAge?: number;
  cdnMaxAge?: number | null;
  staleWhileRevalidate?: number | null;
  immutable?: boolean;
  cacheability?: 'public' | 'private' | null;
  priority?: number;
  isEnabled?: boolean;
  name?: string;
  description?: string;
}

export const cacheRulesApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // List cache rules for a project
    getCacheRules: builder.query<CacheRule[], string>({
      query: (projectId) => `/api/cache-rules/project/${projectId}`,
      transformResponse: (response: { rules: CacheRule[] }) => response.rules,
      providesTags: (result, _error, projectId) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: 'CacheRule' as const, id })),
              { type: 'CacheRule', id: `LIST-${projectId}` },
            ]
          : [{ type: 'CacheRule', id: `LIST-${projectId}` }],
    }),

    // Get a single cache rule
    getCacheRule: builder.query<CacheRule, string>({
      query: (ruleId) => `/api/cache-rules/${ruleId}`,
      providesTags: (_result, _error, ruleId) => [{ type: 'CacheRule', id: ruleId }],
    }),

    // Create a cache rule
    createCacheRule: builder.mutation<CacheRule, { projectId: string; rule: CreateCacheRuleDto }>({
      query: ({ projectId, rule }) => ({
        url: `/api/cache-rules/project/${projectId}`,
        method: 'POST',
        body: rule,
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'CacheRule', id: `LIST-${projectId}` },
      ],
    }),

    // Update a cache rule
    updateCacheRule: builder.mutation<
      CacheRule,
      { projectId: string; ruleId: string; updates: UpdateCacheRuleDto }
    >({
      query: ({ ruleId, updates }) => ({
        url: `/api/cache-rules/${ruleId}`,
        method: 'PATCH',
        body: updates,
      }),
      invalidatesTags: (_result, _error, { projectId, ruleId }) => [
        { type: 'CacheRule', id: ruleId },
        { type: 'CacheRule', id: `LIST-${projectId}` },
      ],
    }),

    // Delete a cache rule
    deleteCacheRule: builder.mutation<void, { projectId: string; ruleId: string }>({
      query: ({ ruleId }) => ({
        url: `/api/cache-rules/${ruleId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { projectId, ruleId }) => [
        { type: 'CacheRule', id: ruleId },
        { type: 'CacheRule', id: `LIST-${projectId}` },
      ],
    }),

    // Reorder cache rules
    reorderCacheRules: builder.mutation<
      CacheRule[],
      { projectId: string; ruleIds: string[] }
    >({
      query: ({ projectId, ruleIds }) => ({
        url: `/api/cache-rules/project/${projectId}/reorder`,
        method: 'PUT',
        body: { ruleIds },
      }),
      transformResponse: (response: { rules: CacheRule[] }) => response.rules,
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'CacheRule', id: `LIST-${projectId}` },
      ],
    }),
  }),
});

export const {
  useGetCacheRulesQuery,
  useGetCacheRuleQuery,
  useCreateCacheRuleMutation,
  useUpdateCacheRuleMutation,
  useDeleteCacheRuleMutation,
  useReorderCacheRulesMutation,
} = cacheRulesApi;
