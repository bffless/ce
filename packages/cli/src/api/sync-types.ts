/**
 * Wire types for `PUT /api/proxy-rule-sets/project/:projectId/sync` — mirrors
 * `SyncProxyRuleSetDto` / `SyncProxyRuleSetResponseDto` in the backend and the
 * "Sync response shape" cross-cutting definition of the Phase 1 plan doc.
 */
import type { ExportedRule, ExportedSchema, RuleSetExport } from '../format/types.js';

export interface SyncRuleRef {
  pathPattern: string;
  method: string | null;
}

export interface SyncSchemaResolution {
  name: string;
  action: 'reuse' | 'create';
  targetSchemaId: string | null;
  fieldMismatch: boolean;
}

export interface SyncRequestBody {
  ruleSet: { name: string; description?: string; environment?: string };
  rules: ExportedRule[];
  schemas?: ExportedSchema[];
  options?: { prune?: boolean; dryRun?: boolean; strictSchemas?: boolean };
  source?: { repo?: string; path?: string; gitSha?: string };
}

export interface SyncResponse {
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

/**
 * Wire types for `GET /api/proxy-rule-sets/:id/revisions`, `GET
 * /api/proxy-rule-sets/:id/revisions/:revisionId`, and `POST
 * /api/proxy-rule-sets/:id/rollback/:revisionId` — mirrors
 * `RevisionListItemDto`/`RevisionListResponseDto`/`RevisionDetailResponseDto` in
 * `apps/backend/src/proxy-rules/dto/rule-set-revision.dto.ts` field-for-field. The rollback
 * response is a `SyncResponse` (above) — a rollback IS a sync.
 */
export interface RevisionSource {
  repo?: string;
  path?: string;
  gitSha?: string;
  syncedAt: string;
  contentHash: string;
}

export interface RevisionListItem {
  id: string;
  createdAt: string;
  trigger: string;
  contentHash: string;
  ruleCount: number;
  current: boolean;
  source?: RevisionSource | null;
}

/** Revisions, newest first. */
export interface RevisionListResponse {
  revisions: RevisionListItem[];
}

export interface RevisionDetailResponse extends RevisionListItem {
  snapshot: RuleSetExport;
}
