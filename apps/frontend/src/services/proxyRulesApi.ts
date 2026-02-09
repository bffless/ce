import { api } from './api';

// Header configuration for proxy rules
export interface HeaderConfig {
  forward?: string[];
  strip?: string[];
  add?: Record<string, string>;
}

// Auth transformation configuration for nginx-level proxying
export interface AuthTransformConfig {
  type: 'cookie-to-bearer';
  cookieName: string;
}

// Proxy rule response from API
export interface ProxyRule {
  id: string;
  ruleSetId: string;
  pathPattern: string;
  targetUrl: string;
  stripPrefix: boolean;
  order: number;
  timeout: number;
  preserveHost: boolean;
  forwardCookies: boolean;
  headerConfig: HeaderConfig | null;
  authTransform: AuthTransformConfig | null;
  internalRewrite: boolean;
  isEnabled: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

// Proxy rule set response from API
export interface ProxyRuleSet {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  environment: string | null;
  createdAt: string;
  updatedAt: string;
}

// Proxy rule set with its rules
export interface ProxyRuleSetWithRules extends ProxyRuleSet {
  rules: ProxyRule[];
}

// DTO for creating a proxy rule set
export interface CreateProxyRuleSetDto {
  name: string;
  description?: string;
  environment?: string;
}

// DTO for updating a proxy rule set
export interface UpdateProxyRuleSetDto {
  name?: string;
  description?: string;
  environment?: string;
}

// DTO for creating a proxy rule
export interface CreateProxyRuleDto {
  pathPattern: string;
  targetUrl: string;
  stripPrefix?: boolean;
  order?: number;
  timeout?: number;
  preserveHost?: boolean;
  forwardCookies?: boolean;
  headerConfig?: HeaderConfig;
  authTransform?: AuthTransformConfig;
  internalRewrite?: boolean;
  description?: string;
  isEnabled?: boolean;
}

// DTO for updating a proxy rule
export interface UpdateProxyRuleDto {
  pathPattern?: string;
  targetUrl?: string;
  stripPrefix?: boolean;
  order?: number;
  timeout?: number;
  preserveHost?: boolean;
  forwardCookies?: boolean;
  headerConfig?: HeaderConfig;
  authTransform?: AuthTransformConfig | null;
  internalRewrite?: boolean;
  description?: string;
  isEnabled?: boolean;
}

// List response wrappers
export interface ProxyRulesListResponse {
  rules: ProxyRule[];
}

export interface ProxyRuleSetsListResponse {
  ruleSets: ProxyRuleSet[];
}

export const proxyRulesApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // ==================== Rule Sets ====================

    // List all rule sets for a project
    getProjectRuleSets: builder.query<ProxyRuleSetsListResponse, string>({
      query: (projectId) => `/api/proxy-rule-sets/project/${projectId}`,
      providesTags: (_result, _error, projectId) => [
        { type: 'ProxyRuleSet' as const, id: `project-${projectId}` },
        'ProxyRuleSet',
      ],
    }),

    // Create a new rule set for a project
    createRuleSet: builder.mutation<
      ProxyRuleSet,
      { projectId: string; data: CreateProxyRuleSetDto }
    >({
      query: ({ projectId, data }) => ({
        url: `/api/proxy-rule-sets/project/${projectId}`,
        method: 'POST',
        body: data,
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'ProxyRuleSet' as const, id: `project-${projectId}` },
        'ProxyRuleSet',
      ],
    }),

    // Get a rule set with its rules
    getRuleSet: builder.query<ProxyRuleSetWithRules, string>({
      query: (id) => `/api/proxy-rule-sets/${id}`,
      providesTags: (_result, _error, id) => [
        { type: 'ProxyRuleSet' as const, id },
        { type: 'ProxyRule' as const, id: `ruleset-${id}` },
      ],
    }),

    // Update a rule set
    updateRuleSet: builder.mutation<
      ProxyRuleSet,
      { id: string; data: UpdateProxyRuleSetDto }
    >({
      query: ({ id, data }) => ({
        url: `/api/proxy-rule-sets/${id}`,
        method: 'PATCH',
        body: data,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'ProxyRuleSet' as const, id },
        'ProxyRuleSet',
      ],
    }),

    // Delete a rule set (cascades to rules)
    deleteRuleSet: builder.mutation<{ success: boolean }, string>({
      query: (id) => ({
        url: `/api/proxy-rule-sets/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['ProxyRuleSet', 'ProxyRule'],
    }),

    // ==================== Rules within a Rule Set ====================

    // List rules in a rule set
    getRuleSetRules: builder.query<ProxyRulesListResponse, string>({
      query: (ruleSetId) => `/api/proxy-rule-sets/${ruleSetId}/rules`,
      providesTags: (_result, _error, ruleSetId) => [
        { type: 'ProxyRule' as const, id: `ruleset-${ruleSetId}` },
      ],
    }),

    // Add a rule to a rule set
    createRuleInSet: builder.mutation<
      ProxyRule,
      { ruleSetId: string; rule: CreateProxyRuleDto }
    >({
      query: ({ ruleSetId, rule }) => ({
        url: `/api/proxy-rule-sets/${ruleSetId}/rules`,
        method: 'POST',
        body: rule,
      }),
      invalidatesTags: (_result, _error, { ruleSetId }) => [
        { type: 'ProxyRule' as const, id: `ruleset-${ruleSetId}` },
        { type: 'ProxyRuleSet' as const, id: ruleSetId },
      ],
    }),

    // Reorder rules in a rule set
    reorderRulesInSet: builder.mutation<
      ProxyRulesListResponse,
      { ruleSetId: string; ruleIds: string[] }
    >({
      query: ({ ruleSetId, ruleIds }) => ({
        url: `/api/proxy-rule-sets/${ruleSetId}/rules/reorder`,
        method: 'PUT',
        body: { ruleIds },
      }),
      invalidatesTags: (_result, _error, { ruleSetId }) => [
        { type: 'ProxyRule' as const, id: `ruleset-${ruleSetId}` },
      ],
    }),

    // ==================== Individual Rule Operations ====================

    getProxyRule: builder.query<ProxyRule, string>({
      query: (id) => `/api/proxy-rules/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'ProxyRule' as const, id }],
    }),

    updateProxyRule: builder.mutation<
      ProxyRule,
      { id: string; updates: UpdateProxyRuleDto }
    >({
      query: ({ id, updates }) => ({
        url: `/api/proxy-rules/${id}`,
        method: 'PATCH',
        body: updates,
      }),
      invalidatesTags: ['ProxyRule', 'ProxyRuleSet'],
    }),

    deleteProxyRule: builder.mutation<{ success: boolean }, string>({
      query: (id) => ({
        url: `/api/proxy-rules/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['ProxyRule', 'ProxyRuleSet'],
    }),
  }),
});

export const {
  // Rule Sets
  useGetProjectRuleSetsQuery,
  useCreateRuleSetMutation,
  useGetRuleSetQuery,
  useUpdateRuleSetMutation,
  useDeleteRuleSetMutation,
  // Rules within a Rule Set
  useGetRuleSetRulesQuery,
  useCreateRuleInSetMutation,
  useReorderRulesInSetMutation,
  // Individual rule operations
  useGetProxyRuleQuery,
  useUpdateProxyRuleMutation,
  useDeleteProxyRuleMutation,
} = proxyRulesApi;
