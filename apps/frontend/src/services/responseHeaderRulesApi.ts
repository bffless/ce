import { api } from './api';

export interface ResponseHeaderRule {
  id: string;
  projectId: string;
  pathPattern: string;
  framePolicy: 'sameorigin' | 'allow' | 'deny';
  allowedOrigins: string[] | null;
  customHeaders: Record<string, string | null> | null;
  priority: number;
  isEnabled: boolean;
  name: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateResponseHeaderRuleDto {
  pathPattern: string;
  framePolicy?: 'sameorigin' | 'allow' | 'deny';
  allowedOrigins?: string[];
  customHeaders?: Record<string, string | null>;
  priority?: number;
  isEnabled?: boolean;
  name?: string;
  description?: string;
}

export interface UpdateResponseHeaderRuleDto {
  pathPattern?: string;
  framePolicy?: 'sameorigin' | 'allow' | 'deny';
  allowedOrigins?: string[];
  customHeaders?: Record<string, string | null>;
  priority?: number;
  isEnabled?: boolean;
  name?: string;
  description?: string;
}

export const responseHeaderRulesApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getResponseHeaderRules: builder.query<ResponseHeaderRule[], string>({
      query: (projectId) => `/api/response-header-rules/project/${projectId}`,
      transformResponse: (response: { rules: ResponseHeaderRule[] }) => response.rules,
      providesTags: (result, _error, projectId) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: 'ResponseHeaderRule' as const, id })),
              { type: 'ResponseHeaderRule', id: `LIST-${projectId}` },
            ]
          : [{ type: 'ResponseHeaderRule', id: `LIST-${projectId}` }],
    }),

    createResponseHeaderRule: builder.mutation<
      ResponseHeaderRule,
      { projectId: string; rule: CreateResponseHeaderRuleDto }
    >({
      query: ({ projectId, rule }) => ({
        url: `/api/response-header-rules/project/${projectId}`,
        method: 'POST',
        body: rule,
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'ResponseHeaderRule', id: `LIST-${projectId}` },
      ],
    }),

    updateResponseHeaderRule: builder.mutation<
      ResponseHeaderRule,
      { projectId: string; ruleId: string; updates: UpdateResponseHeaderRuleDto }
    >({
      query: ({ ruleId, updates }) => ({
        url: `/api/response-header-rules/${ruleId}`,
        method: 'PATCH',
        body: updates,
      }),
      invalidatesTags: (_result, _error, { projectId, ruleId }) => [
        { type: 'ResponseHeaderRule', id: ruleId },
        { type: 'ResponseHeaderRule', id: `LIST-${projectId}` },
      ],
    }),

    deleteResponseHeaderRule: builder.mutation<void, { projectId: string; ruleId: string }>({
      query: ({ ruleId }) => ({
        url: `/api/response-header-rules/${ruleId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { projectId, ruleId }) => [
        { type: 'ResponseHeaderRule', id: ruleId },
        { type: 'ResponseHeaderRule', id: `LIST-${projectId}` },
      ],
    }),
  }),
});

export const {
  useGetResponseHeaderRulesQuery,
  useCreateResponseHeaderRuleMutation,
  useUpdateResponseHeaderRuleMutation,
  useDeleteResponseHeaderRuleMutation,
} = responseHeaderRulesApi;
