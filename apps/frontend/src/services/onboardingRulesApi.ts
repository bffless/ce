import { api } from './api';

// ============================================================================
// Types
// ============================================================================

export type OnboardingTrigger = 'user_signup' | 'invite_accepted';
export type OnboardingActionType = 'grant_repo_access' | 'assign_role' | 'add_to_group';

export interface OnboardingAction {
  type: OnboardingActionType;
  params: Record<string, unknown>;
}

export interface OnboardingCondition {
  type: 'email_domain' | 'email_pattern';
  value: string;
}

export interface OnboardingRule {
  id: string;
  name: string;
  description: string | null;
  trigger: OnboardingTrigger;
  actions: OnboardingAction[];
  conditions: OnboardingCondition[] | null;
  enabled: boolean;
  priority: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOnboardingRuleDto {
  name: string;
  description?: string;
  trigger?: OnboardingTrigger;
  actions: OnboardingAction[];
  conditions?: OnboardingCondition[] | null;
  enabled?: boolean;
  priority?: number;
}

export interface UpdateOnboardingRuleDto {
  name?: string;
  description?: string | null;
  trigger?: OnboardingTrigger;
  actions?: OnboardingAction[];
  conditions?: OnboardingCondition[] | null;
  enabled?: boolean;
  priority?: number;
}

export type ExecutionStatus = 'success' | 'partial' | 'failed' | 'skipped';

export interface ActionExecutionResult {
  action: OnboardingAction;
  success: boolean;
  message?: string;
  error?: string;
}

export interface OnboardingRuleExecution {
  id: string;
  ruleId: string | null;
  ruleName: string;
  userId: string;
  trigger: OnboardingTrigger;
  status: ExecutionStatus;
  details: ActionExecutionResult[] | null;
  errorMessage: string | null;
  executedAt: string;
}

export interface ListOnboardingRulesResponse {
  rules: OnboardingRule[];
}

export interface ListExecutionsResponse {
  executions: OnboardingRuleExecution[];
}

// ============================================================================
// API Endpoints
// ============================================================================

export const onboardingRulesApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // Get all onboarding rules
    getOnboardingRules: builder.query<ListOnboardingRulesResponse, void>({
      query: () => '/api/onboarding-rules',
      providesTags: ['OnboardingRule'],
    }),

    // Get a single onboarding rule
    getOnboardingRule: builder.query<OnboardingRule, string>({
      query: (id) => `/api/onboarding-rules/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'OnboardingRule', id }],
    }),

    // Create a new onboarding rule
    createOnboardingRule: builder.mutation<OnboardingRule, CreateOnboardingRuleDto>({
      query: (data) => ({
        url: '/api/onboarding-rules',
        method: 'POST',
        body: data,
      }),
      invalidatesTags: ['OnboardingRule'],
    }),

    // Update an onboarding rule
    updateOnboardingRule: builder.mutation<OnboardingRule, { id: string; data: UpdateOnboardingRuleDto }>({
      query: ({ id, data }) => ({
        url: `/api/onboarding-rules/${id}`,
        method: 'PATCH',
        body: data,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        'OnboardingRule',
        { type: 'OnboardingRule', id },
      ],
    }),

    // Delete an onboarding rule
    deleteOnboardingRule: builder.mutation<{ success: boolean }, string>({
      query: (id) => ({
        url: `/api/onboarding-rules/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['OnboardingRule'],
    }),

    // Get recent rule executions (audit log)
    getRecentExecutions: builder.query<ListExecutionsResponse, number | void>({
      query: (limit = 50) => `/api/onboarding-rules/executions/recent?limit=${limit}`,
      providesTags: ['OnboardingRule'],
    }),
  }),
});

export const {
  useGetOnboardingRulesQuery,
  useGetOnboardingRuleQuery,
  useCreateOnboardingRuleMutation,
  useUpdateOnboardingRuleMutation,
  useDeleteOnboardingRuleMutation,
  useGetRecentExecutionsQuery,
} = onboardingRulesApi;
