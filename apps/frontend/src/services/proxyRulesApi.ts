import { api } from './api';
import type { HandlerType, TestPipelineDto, TestPipelineResult, ValidatorConfig } from './pipelinesApi';
import type { SchemaField } from './pipelineSchemasApi';

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

// Proxy rule type
export type ProxyType = 'external_proxy' | 'internal_rewrite' | 'email_form_handler' | 'pipeline';

// Email handler configuration for email_form_handler proxy rules
export interface EmailHandlerConfig {
  destinationEmail: string;
  subject?: string;
  successRedirect?: string;
  corsOrigin?: string;
  honeypotField?: string;
  replyToField?: string;
  requireAuth?: boolean;
}

// Pipeline step configuration
export interface PipelineStepConfig {
  /** Optional: the UI mints one for steps it creates, but steps authored via the
   *  CLI or imported JSON have none. Matches `id?: string` in the backend schema.
   *  Steps are referenced by `name` at runtime — never rely on `id` for identity. */
  id?: string;
  name: string; // Required - used to reference step output in subsequent steps
  handlerType: HandlerType;
  config: Record<string, unknown>;
  /** Optional, mirroring the backend schema; absent means enabled. Test with
   *  `isEnabled !== false`, never `isEnabled === true`. */
  isEnabled?: boolean;
}

// Pipeline configuration for pipeline proxy rules
export interface PipelineConfig {
  name: string;
  description?: string;
  steps: PipelineStepConfig[];
  postSteps?: PipelineStepConfig[];
  validators?: ValidatorConfig[];
}

// HTTP methods supported for method filtering
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

// Proxy rule response from API
export interface ProxyRule {
  id: string;
  ruleSetId: string;
  pathPattern: string;
  method: HttpMethod | null; // null = match any method
  methods?: HttpMethod[] | null;
  targetUrl: string;
  stripPrefix: boolean;
  order: number;
  timeout: number;
  preserveHost: boolean;
  forwardCookies: boolean;
  headerConfig: HeaderConfig | null;
  authTransform: AuthTransformConfig | null;
  internalRewrite: boolean;
  proxyType: ProxyType | null;
  emailHandlerConfig: EmailHandlerConfig | null;
  pipelineConfig: PipelineConfig | null;
  isEnabled: boolean;
  debugEnabled: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

// Provenance metadata for a rule set managed from git via the sync endpoint
// (PUT /api/proxy-rule-sets/project/:projectId/sync). repo/path/gitSha are
// caller-supplied best-effort; syncedAt and contentHash are stamped
// server-side on every successful sync. Null/absent for sets never synced.
export interface ProxyRuleSetSource {
  repo?: string;
  path?: string;
  gitSha?: string;
  syncedAt: string;
  contentHash: string;
}

// Proxy rule set response from API
export interface ProxyRuleSet {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  environment: string | null;
  // Present when the set is managed from git (rules-as-code sync); kept even
  // after manual edits — the UI warns instead of clearing it.
  source?: ProxyRuleSetSource | null;
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
  method?: HttpMethod | null; // null or omitted = match any method
  methods?: HttpMethod[] | null;
  targetUrl: string;
  stripPrefix?: boolean;
  order?: number;
  timeout?: number;
  preserveHost?: boolean;
  forwardCookies?: boolean;
  headerConfig?: HeaderConfig;
  authTransform?: AuthTransformConfig;
  internalRewrite?: boolean;
  proxyType?: ProxyType;
  emailHandlerConfig?: EmailHandlerConfig;
  pipelineConfig?: PipelineConfig;
  description?: string;
  isEnabled?: boolean;
}

// DTO for updating a proxy rule
export interface UpdateProxyRuleDto {
  pathPattern?: string;
  method?: HttpMethod | null; // null = match any method
  methods?: HttpMethod[] | null;
  targetUrl?: string;
  stripPrefix?: boolean;
  order?: number;
  timeout?: number;
  preserveHost?: boolean;
  forwardCookies?: boolean;
  headerConfig?: HeaderConfig;
  authTransform?: AuthTransformConfig | null;
  internalRewrite?: boolean;
  proxyType?: ProxyType;
  emailHandlerConfig?: EmailHandlerConfig | null;
  description?: string;
  isEnabled?: boolean;
  debugEnabled?: boolean;
}

// A single proxy rule as represented in an export file (no server-managed fields).
// Mirrors the server's canonical export shape (`export-format.util.ts` /
// `ExportedProxyRuleDto`): null keys are stripped server-side, so everything but
// `pathPattern`/`targetUrl` is optional. Includes `methods` (the #448 fix).
export interface ExportedProxyRule {
  pathPattern: string;
  method?: HttpMethod;
  methods?: HttpMethod[];
  targetUrl: string;
  stripPrefix?: boolean;
  order?: number;
  timeout?: number;
  preserveHost?: boolean;
  forwardCookies?: boolean;
  headerConfig?: HeaderConfig;
  authTransform?: AuthTransformConfig;
  internalRewrite?: boolean;
  proxyType?: ProxyType;
  emailHandlerConfig?: EmailHandlerConfig;
  pipelineConfig?: PipelineConfig;
  isEnabled?: boolean;
  debugEnabled?: boolean;
  description?: string;
}

// A schema dependency bundled in an export (definitions only — name + fields).
// `id` is the original (source-project) schema id as referenced in the rules.
export interface ExportedSchema {
  id: string;
  name: string;
  fields: SchemaField[];
}

// Portable export envelope for a proxy rule set, its rules, and schema deps.
// version 1: no `schemas`. version 2: bundles referenced schema definitions.
// This is the server's canonical envelope (GET /api/proxy-rule-sets/:id/export);
// null-valued ruleSet keys are stripped and `schemas` is omitted when empty
// (`| null` remains for older client-assembled export files fed to import).
export interface ProxyRuleSetExport {
  version: number;
  exportedAt: string;
  kind: 'bffless-proxy-rule-set';
  ruleSet: {
    name: string;
    description?: string | null;
    environment?: string | null;
  };
  rules: ExportedProxyRule[];
  schemas?: ExportedSchema[];
}

// How to resolve one bundled schema in the target project on import
export interface ImportSchemaResolution {
  sourceId: string;
  name: string;
  fields: SchemaField[];
  action: 'reuse' | 'create';
  targetSchemaId?: string;
}

// Import payload: the export envelope, with `schemas` carrying per-schema resolutions
export type ImportRuleSetPayload = Omit<ProxyRuleSetExport, 'schemas'> & {
  schemas?: ImportSchemaResolution[];
};

// Pipeline execution log summary (list view)
export interface PipelineExecutionLogSummary {
  id: string;
  success: boolean;
  statusCode: number;
  method: string;
  path: string;
  durationMs: number;
  stepsCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  errorStep: string | null;
  createdAt: string;
}

// Pipeline execution log with full debug data
export interface PipelineExecutionLog extends PipelineExecutionLogSummary {
  projectId: string;
  proxyRuleId: string;
  requestMeta: { ip?: string; userAgent?: string; userId?: string } | null;
  debug: {
    validators: Array<{
      type: string;
      passed: boolean;
      durationMs: number;
      skipped?: boolean;
      error?: { code: string; message: string };
    }>;
    steps: Array<{
      stepId: string;
      stepName?: string;
      handlerType: string;
      startTime: string;
      endTime: string;
      durationMs: number;
      status: 'success' | 'failed' | 'skipped';
      input: { requestBody: Record<string, unknown>; previousStepOutputs: Record<string, unknown> };
      output?: unknown;
      error?: { code: string; message: string; details?: unknown };
      warning?: string;
      condition?: string;
      conditionResult?: boolean;
    }>;
    postSteps?: Array<{
      stepId: string;
      stepName?: string;
      handlerType: string;
      startTime: string;
      endTime: string;
      durationMs: number;
      status: 'success' | 'failed' | 'skipped';
      input: { requestBody: Record<string, unknown>; previousStepOutputs: Record<string, unknown> };
      output?: unknown;
      error?: { code: string; message: string; details?: unknown };
      warning?: string;
      condition?: string;
      conditionResult?: boolean;
    }>;
    totalDurationMs: number;
    startTime: string;
    endTime: string;
  };
}

// Paginated logs response
export interface PipelineLogsResponse {
  logs: PipelineExecutionLogSummary[];
  total: number;
  page: number;
  pageSize: number;
}

// Email config status response
export interface EmailConfigStatusResponse {
  isConfigured: boolean;
}

// ==================== Revision History & Rollback ====================

// What triggered a revision capture (server: RevisionTrigger).
export type RevisionTrigger =
  | 'sync'
  | 'import'
  | 'create'
  | 'copy'
  | 'set_update'
  | 'rule_edit'
  | 'rollback'
  | 'backfill';

// One captured revision (GET /api/proxy-rule-sets/:id/revisions). Mirrors the
// server's RevisionListItemDto / CLI's RevisionListItem — keep field names in
// sync. `current` is computed per request (contentHash === live envelope hash).
export interface RuleSetRevisionListItem {
  id: string;
  createdAt: string;
  trigger: RevisionTrigger;
  contentHash: string;
  ruleCount: number;
  current: boolean;
  source?: ProxyRuleSetSource | null;
}

export interface RuleSetRevisionsResponse {
  revisions: RuleSetRevisionListItem[]; // newest first
}

// A rule reference in a sync/rollback response (SyncRuleRefDto).
export interface SyncRuleRef {
  pathPattern: string;
  method: string | null;
}

// How a bundled schema was resolved during sync/rollback (SyncSchemaResolutionDto).
export interface SyncSchemaResolution {
  name: string;
  action: 'reuse' | 'create';
  targetSchemaId: string | null;
  fieldMismatch: boolean;
}

// Response of the sync endpoint — also the rollback response, since rollback
// replays the snapshot through the same sync path (SyncProxyRuleSetResponseDto).
export interface RuleSetSyncResponse {
  ruleSetId: string | null;
  created: SyncRuleRef[];
  updated: SyncRuleRef[];
  deleted: SyncRuleRef[];
  unchanged: SyncRuleRef[];
  pruneCandidates: SyncRuleRef[];
  schemaResolutions: SyncSchemaResolution[];
  missingSecrets: string[];
  warnings: string[];
  dryRun: boolean;
  setCreated: boolean;
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

    // Copy a rule set with all its rules
    copyRuleSet: builder.mutation<ProxyRuleSetWithRules, string>({
      query: (id) => ({
        url: `/api/proxy-rule-sets/${id}/copy`,
        method: 'POST',
      }),
      invalidatesTags: ['ProxyRuleSet', 'ProxyRule'],
    }),

    // Get the canonical export envelope for a rule set. The server assembles it
    // (schema bundling, secret blanking, null-stripping, key order) — clients
    // download the payload verbatim. Deliberately untagged and uncached: each
    // Export click is a fresh lazy fetch, and tags would make unrelated
    // invalidations background-refetch the heavy export assembly.
    getRuleSetExport: builder.query<ProxyRuleSetExport, string>({
      query: (id) => `/api/proxy-rule-sets/${id}/export`,
      keepUnusedDataFor: 0,
    }),

    // Import a rule set (with rules) from an exported JSON definition
    importRuleSet: builder.mutation<
      ProxyRuleSetWithRules,
      { projectId: string; data: ImportRuleSetPayload }
    >({
      query: ({ projectId, data }) => ({
        url: `/api/proxy-rule-sets/project/${projectId}/import`,
        method: 'POST',
        body: data,
      }),
      invalidatesTags: (_result, _error, { projectId }) => [
        { type: 'ProxyRuleSet' as const, id: `project-${projectId}` },
        'ProxyRuleSet',
      ],
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

    // Test a pipeline-type proxy rule with sample data
    testProxyRule: builder.mutation<TestPipelineResult, { id: string; data: TestPipelineDto; file?: File }>({
      query: ({ id, data, file }) => {
        if (file) {
          const formData = new FormData();
          formData.append('file', file);
          formData.append('data', JSON.stringify(data));
          return {
            url: `/api/proxy-rules/${id}/test`,
            method: 'POST',
            body: formData,
          };
        }
        return {
          url: `/api/proxy-rules/${id}/test`,
          method: 'POST',
          body: data,
        };
      },
    }),

    // ==================== Pipeline Execution Logs ====================

    // List execution logs for a rule
    getRuleLogs: builder.query<PipelineLogsResponse, { ruleId: string; page?: number; pageSize?: number }>({
      query: ({ ruleId, page = 1, pageSize = 20 }) =>
        `/api/proxy-rules/${ruleId}/logs?page=${page}&pageSize=${pageSize}`,
      providesTags: (_result, _error, { ruleId }) => [
        { type: 'PipelineLog' as const, id: `rule-${ruleId}` },
      ],
    }),

    // Get log count for badge display
    getRuleLogCount: builder.query<{ count: number }, string>({
      query: (ruleId) => `/api/proxy-rules/${ruleId}/logs/count`,
      providesTags: (_result, _error, ruleId) => [
        { type: 'PipelineLog' as const, id: `count-${ruleId}` },
      ],
    }),

    // Get full detail of a single execution log
    getLogDetail: builder.query<PipelineExecutionLog, string>({
      query: (logId) => `/api/pipeline-logs/${logId}`,
    }),

    // Clear all logs for a rule
    clearRuleLogs: builder.mutation<{ success: boolean }, string>({
      query: (ruleId) => ({
        url: `/api/proxy-rules/${ruleId}/logs`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, ruleId) => [
        { type: 'PipelineLog' as const, id: `rule-${ruleId}` },
        { type: 'PipelineLog' as const, id: `count-${ruleId}` },
      ],
    }),

    // ==================== Revision History & Rollback ====================

    // List captured revisions for a rule set, newest first
    getRuleSetRevisions: builder.query<RuleSetRevisionsResponse, string>({
      query: (ruleSetId) => `/api/proxy-rule-sets/${ruleSetId}/revisions`,
      providesTags: ['ProxyRuleSetRevision'],
    }),

    // Roll back a rule set to a prior revision (replays the snapshot through
    // the sync path — see rule-set-revision.dto.ts on the server)
    rollbackRuleSet: builder.mutation<
      RuleSetSyncResponse,
      { id: string; revisionId: string; dryRun?: boolean }
    >({
      query: ({ id, revisionId, dryRun }) => ({
        url: `/api/proxy-rule-sets/${id}/rollback/${revisionId}`,
        method: 'POST',
        body: dryRun !== undefined ? { dryRun } : {},
      }),
      invalidatesTags: ['ProxyRuleSet', 'ProxyRule', 'ProxyRuleSetRevision'],
    }),

    // ==================== Settings ====================

    // Get email configuration status (public endpoint)
    getEmailConfigStatus: builder.query<EmailConfigStatusResponse, void>({
      query: () => '/api/settings/email/status-public',
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
  useCopyRuleSetMutation,
  useLazyGetRuleSetExportQuery,
  useImportRuleSetMutation,
  // Rules within a Rule Set
  useGetRuleSetRulesQuery,
  useCreateRuleInSetMutation,
  useReorderRulesInSetMutation,
  // Individual rule operations
  useGetProxyRuleQuery,
  useLazyGetProxyRuleQuery,
  useUpdateProxyRuleMutation,
  useDeleteProxyRuleMutation,
  useTestProxyRuleMutation,
  // Pipeline Execution Logs
  useGetRuleLogsQuery,
  useGetRuleLogCountQuery,
  useGetLogDetailQuery,
  useClearRuleLogsMutation,
  // Revision History & Rollback
  useGetRuleSetRevisionsQuery,
  useRollbackRuleSetMutation,
  // Settings
  useGetEmailConfigStatusQuery,
} = proxyRulesApi;
