import { api } from './api';

/**
 * RTK Query slice for the admin app-catalog surface (Task 12 of the
 * app-catalog spec). Mirrors the backend shapes 1:1 — see
 * `apps/backend/src/app-catalog/app-catalog.service.ts`,
 * `app-preflight.service.ts`, `app-installer.service.ts`, and
 * `app-install-jobs.service.ts` for the source of truth.
 *
 * `preflightApp`/`installApp`/`getInstallJob`/`undoJob` back
 * the 1-click install wizard dialog (Tasks 13–14 wire them up); this task
 * only wires `getAppCatalog` (catalog page) and the simpler one-shot actions
 * (`updateApp`, `uninstallApp`, `getEjectPayload`) directly into `AppCard`.
 */

export type GateStatus = 'pass' | 'fail' | 'warn';

export interface GateResult {
  // Mirrors GateResult['id'] in apps/backend/src/app-catalog/app-preflight.service.ts.
  id:
    | 'storage'
    | 'ce-version'
    | 'platform-config'
    | 'platform-cert-scope'
    | 'dns'
    | 'app-host-tls'
    | 'name-collision'
    | 'data-tables';
  status: GateStatus;
  message: string;
  remediation?: string;
  deepLink?: string;
  /** DNS is blocking-but-retryable; name collisions are not. */
  retryable?: boolean;
}

export type AppliesWhen =
  | 'always'
  | 'bucketStorage'
  | 'localStorage'
  | 'platformMode'
  | 'selfHosted';

// Mirrors AppManualStepExternalLink in apps/backend/src/app-catalog/app-manifest.types.ts — keep both in sync.
export interface AppManualStepExternalLink {
  label: string;
  url: string;
}

export interface AppManualStep {
  id: string;
  title: string;
  body: string;
  deepLink?: string;
  externalLink?: AppManualStepExternalLink;
  appliesWhen?: AppliesWhen;
}

export type InstalledAppStatus = 'installing' | 'installed' | 'failed';

export interface CatalogEntry {
  id: string;
  name: string;
  summary?: string;
  /**
   * Long-form markdown blurb for the details dialog. Registry-only — an
   * installed app that has dropped out of the registry has none.
   */
  description?: string;
  category?: string;
  iconUrl?: string;
  /** Wide card image for the catalog grid. Registry-only. */
  thumbnailUrl?: string;
  /** Absolute https URLs, already ordered by the registry. Registry-only. */
  screenshots?: string[];
  docsUrl?: string;
  sourceUrl?: string;
  /** Absent when the registry is unavailable, or this app isn't (or no longer) listed in it. */
  registryVersion?: string;
  /** Instance-level gates only (storage/CE-version/platform-config) — project gates are preflight-only. */
  gates: GateResult[];
  /** Every instance gate passed AND the app is present in the registry. */
  installable: boolean;
  installed?: {
    installedAppId: string;
    version: string;
    projectId: string;
    projectName: string;
    alias: string;
    appUrl?: string;
    status: InstalledAppStatus;
    updateAvailable: boolean;
    manualSteps: AppManualStep[];
  };
}

export interface CatalogListResult {
  data: CatalogEntry[];
  registryError?: string;
}

export interface NewProjectInput {
  owner: string;
  name: string;
}

export interface PreflightRequest {
  projectId?: string;
  newProject?: NewProjectInput;
  /** Overrides the manifest's default `install.domain.subdomain` for this install. */
  subdomain?: string;
}

export interface SyncSchemaResolutionLike {
  name: string;
  action: 'reuse' | 'create';
  fieldMismatch: boolean;
}

export interface SyncPlanSummary {
  ruleSet: string;
  created: number;
  updated: number;
  unchanged: number;
  pruneCandidates: number;
  schemaResolutions: SyncSchemaResolutionLike[];
}

export interface PreflightResponse {
  gates: GateResult[];
  syncPlans: SyncPlanSummary[];
  appHost: string | null;
  appUrl?: string;
}

export type InstallStepId =
  | 'preflight'
  | 'fetch'
  | 'sync-rules'
  | 'deploy'
  | 'domain'
  | 'certificate'
  | 'schedules'
  | 'record';

export interface InstallStepState {
  id: InstallStepId;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'action-required';
  detail?: string;
  error?: string;
}

/** One field an app update and a local edit both changed. */
export interface SyncFieldConflict {
  field: string;
  ours: unknown;
  theirs: unknown;
}

/** A rule left contested by an update; the local value was kept. */
export interface SyncRuleConflict {
  pathPattern: string;
  method: string | null;
  fields: SyncFieldConflict[];
  liveId?: string;
}

export interface InstallJob {
  id: string;
  kind: 'install' | 'update';
  appId: string;
  /** null until the project is resolved (the `newProject` path). */
  projectId: string | null;
  status: 'running' | 'succeeded' | 'failed' | 'undone';
  steps: InstallStepState[];
  installedAppId?: string;
  /** Manifest steps filtered by `manualStepApplies`, plus cert-synthesized ones. */
  manualSteps?: AppManualStep[];
  appUrl?: string;
  /** Rules where this update and a local edit changed the same field. The local
   *  value was kept; the dialog offers a per-field choice. */
  conflicts?: SyncRuleConflict[];
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

export interface UninstallPreview {
  dataTables: Array<{ name: string; recordCount: number; createdByInstall: boolean }>;
}

export interface UninstallSummary {
  removed: {
    ruleSets: number;
    alias: boolean;
    domain: boolean;
    deployment: boolean;
    schedules: number;
  };
  dataTables: {
    /** Table names left in place — every reused table, plus created tables when `deleteData` is false. */
    kept: string[];
    /** Table names actually dropped (`deleteData: true`, created-by-install tables only). */
    deleted: string[];
    /** Record count captured (via `getByIdWithCount`) BEFORE each deleted table was dropped. */
    deletedRecordCounts: Record<string, number>;
  };
  note: string;
  /** `kind:id` labels of deletions that failed. Absent/omitted when everything succeeded. */
  failures?: string[];
}

export interface EjectPayload {
  repo: string;
  appPath: string;
  deployWorkflow: string;
  /** https://github.com/<repo>/fork */
  forkUrl: string;
  variables: Record<string, string>;
  secrets: string[];
  alias: string;
  note: string;
}

export const appCatalogApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getAppCatalog: builder.query<CatalogListResult, void>({
      query: () => '/api/admin/apps',
      providesTags: ['AppCatalog'],
    }),

    preflightApp: builder.mutation<PreflightResponse, { appId: string; body: PreflightRequest }>({
      query: ({ appId, body }) => ({
        url: `/api/admin/apps/${appId}/preflight`,
        method: 'POST',
        body,
      }),
    }),

    installApp: builder.mutation<{ jobId: string }, { appId: string; body: PreflightRequest }>({
      query: ({ appId, body }) => ({
        url: `/api/admin/apps/${appId}/install`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['AppCatalog', 'InstalledApp'],
    }),

    getInstallJob: builder.query<InstallJob, string>({
      query: (jobId) => `/api/admin/apps/jobs/${jobId}`,
      // no tags — polling replaces invalidation (migrationApi precedent)
    }),

    undoJob: builder.mutation<InstallJob, string>({
      query: (jobId) => ({
        url: `/api/admin/apps/jobs/${jobId}/undo`,
        method: 'POST',
      }),
      invalidatesTags: ['AppCatalog', 'InstalledApp'],
    }),

    updateApp: builder.mutation<{ jobId: string }, { id: string; prune?: boolean }>({
      query: ({ id, prune }) => ({
        url: `/api/admin/apps/installed/${id}/update`,
        method: 'POST',
        body: { prune },
      }),
      invalidatesTags: ['AppCatalog', 'InstalledApp'],
    }),

    getUninstallPreview: builder.query<UninstallPreview, string>({
      query: (id) => `/api/admin/apps/installed/${id}/uninstall-preview`,
    }),

    uninstallApp: builder.mutation<UninstallSummary, { id: string; deleteData?: boolean }>({
      query: ({ id, deleteData }) => ({
        url: `/api/admin/apps/installed/${id}`,
        method: 'DELETE',
        params: deleteData === undefined ? undefined : { deleteData },
      }),
      invalidatesTags: ['AppCatalog', 'InstalledApp'],
    }),

    getEjectPayload: builder.query<EjectPayload, string>({
      query: (id) => `/api/admin/apps/installed/${id}/eject`,
    }),
  }),
});

export const {
  useGetAppCatalogQuery,
  usePreflightAppMutation,
  useInstallAppMutation,
  useGetInstallJobQuery,
  useUndoJobMutation,
  useUpdateAppMutation,
  useGetUninstallPreviewQuery,
  useLazyGetUninstallPreviewQuery,
  useUninstallAppMutation,
  useGetEjectPayloadQuery,
  useLazyGetEjectPayloadQuery,
} = appCatalogApi;
