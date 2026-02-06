import { api } from './api';

// Types matching backend DTOs

export type PathMode = 'include' | 'exclude';

export interface LastRunSummary {
  deletedCommits: number;
  partialCommits: number;
  deletedAssets: number;
  freedBytes: number;
  errors?: string[];
}

export interface RetentionRule {
  id: string;
  projectId: string;
  name: string;
  branchPattern: string;
  excludeBranches: string[];
  retentionDays: number;
  keepWithAlias: boolean;
  keepMinimum: number;
  enabled: boolean;
  pathPatterns?: string[];
  pathMode?: PathMode;
  lastRunAt?: string;
  nextRunAt?: string;
  executionStartedAt?: string;
  lastRunSummary?: LastRunSummary;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRetentionRuleDto {
  name: string;
  branchPattern: string;
  excludeBranches?: string[];
  retentionDays: number;
  keepWithAlias?: boolean;
  keepMinimum?: number;
  enabled?: boolean;
  pathPatterns?: string[];
  pathMode?: PathMode;
}

export interface UpdateRetentionRuleDto {
  name?: string;
  branchPattern?: string;
  excludeBranches?: string[];
  retentionDays?: number;
  keepWithAlias?: boolean;
  keepMinimum?: number;
  enabled?: boolean;
  pathPatterns?: string[];
  pathMode?: PathMode;
}

export interface PreviewCommit {
  sha: string;
  branch: string;
  ageDays: number;
  assetCount: number;
  sizeBytes: number;
  createdAt: string;
  isPartial: boolean;
  totalAssetCount?: number;
  totalSizeBytes?: number;
}

export interface PreviewDeletionResponse {
  commits: PreviewCommit[];
  totalAssets: number;
  totalBytes: number;
}

export interface ExecuteRuleResponse {
  started: boolean;
  message: string;
}

export interface RetentionLog {
  id: string;
  projectId: string;
  ruleId?: string;
  commitSha: string;
  branch?: string;
  assetCount: number;
  freedBytes: number;
  isPartial: boolean;
  deletedAt: string;
}

export interface ListRetentionLogsResponse {
  data: RetentionLog[];
  total: number;
}

export interface StorageOverview {
  totalBytes: number;
  commitCount: number;
  branchCount: number;
  oldestCommitAt?: string;
  oldestCommitBranch?: string;
}

export const retentionApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // Get storage overview for a project
    getStorageOverview: builder.query<StorageOverview, string>({
      query: (projectId) => `/api/retention/projects/${projectId}/overview`,
      providesTags: (_result, _error, projectId) => [
        { type: 'StorageOverview', id: projectId },
      ],
    }),

    // List retention rules for a project
    getRetentionRules: builder.query<RetentionRule[], string>({
      query: (projectId) => `/api/retention/projects/${projectId}/rules`,
      transformResponse: (response: { data: RetentionRule[] }) => response.data,
      providesTags: (result, _error, projectId) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: 'RetentionRule' as const, id })),
              { type: 'RetentionRule', id: `LIST-${projectId}` },
            ]
          : [{ type: 'RetentionRule', id: `LIST-${projectId}` }],
    }),

    // Get a single retention rule
    getRetentionRule: builder.query<RetentionRule, { projectId: string; ruleId: string }>({
      query: ({ ruleId }) => `/api/retention/rules/${ruleId}`,
      providesTags: (_result, _error, { ruleId }) => [{ type: 'RetentionRule', id: ruleId }],
    }),

    // Create a retention rule
    createRetentionRule: builder.mutation<
      RetentionRule,
      { projectId: string; rule: CreateRetentionRuleDto }
    >({
      query: ({ projectId, rule }) => ({
        url: `/api/retention/projects/${projectId}/rules`,
        method: 'POST',
        body: rule,
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'RetentionRule', id: `LIST-${projectId}` },
      ],
    }),

    // Update a retention rule
    updateRetentionRule: builder.mutation<
      RetentionRule,
      { projectId: string; ruleId: string; updates: UpdateRetentionRuleDto }
    >({
      query: ({ ruleId, updates }) => ({
        url: `/api/retention/rules/${ruleId}`,
        method: 'PUT',
        body: updates,
      }),
      invalidatesTags: (_result, _error, { ruleId }) => [{ type: 'RetentionRule', id: ruleId }],
    }),

    // Delete a retention rule
    deleteRetentionRule: builder.mutation<void, { projectId: string; ruleId: string }>({
      query: ({ ruleId }) => ({
        url: `/api/retention/rules/${ruleId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, { projectId, ruleId }) => [
        { type: 'RetentionRule', id: ruleId },
        { type: 'RetentionRule', id: `LIST-${projectId}` },
      ],
    }),

    // Preview what would be deleted by a rule
    previewRetentionRule: builder.query<
      PreviewDeletionResponse,
      { projectId: string; ruleId: string }
    >({
      query: ({ ruleId }) => `/api/retention/rules/${ruleId}/preview`,
      // Don't cache preview results - always fetch fresh data
      keepUnusedDataFor: 0,
    }),

    // Execute a retention rule manually
    executeRetentionRule: builder.mutation<
      ExecuteRuleResponse,
      { projectId: string; ruleId: string }
    >({
      query: ({ ruleId }) => ({
        url: `/api/retention/rules/${ruleId}/execute`,
        method: 'POST',
      }),
      invalidatesTags: (_result, _error, { projectId, ruleId }) => [
        { type: 'RetentionRule', id: ruleId },
        { type: 'RetentionLog', id: `LIST-${projectId}` },
        { type: 'StorageOverview', id: projectId },
      ],
    }),

    // Get retention logs for a project
    getRetentionLogs: builder.query<
      ListRetentionLogsResponse,
      { projectId: string; page?: number; limit?: number; ruleId?: string }
    >({
      query: ({ projectId, page = 1, limit = 20, ruleId }) => {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(limit),
        });
        if (ruleId) params.append('ruleId', ruleId);
        return `/api/retention/projects/${projectId}/logs?${params}`;
      },
      providesTags: (_result, _error, { projectId }) => [
        { type: 'RetentionLog', id: `LIST-${projectId}` },
      ],
    }),
  }),
});

export const {
  useGetStorageOverviewQuery,
  useGetRetentionRulesQuery,
  useGetRetentionRuleQuery,
  useCreateRetentionRuleMutation,
  useUpdateRetentionRuleMutation,
  useDeleteRetentionRuleMutation,
  useLazyPreviewRetentionRuleQuery,
  useExecuteRetentionRuleMutation,
  useGetRetentionLogsQuery,
} = retentionApi;
