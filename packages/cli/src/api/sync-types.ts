/**
 * Wire types for `PUT /api/proxy-rule-sets/project/:projectId/sync` — mirrors
 * `SyncProxyRuleSetDto` / `SyncProxyRuleSetResponseDto` in the backend and the
 * "Sync response shape" cross-cutting definition of the Phase 1 plan doc.
 */
import type { ExportedRule, ExportedSchema } from '../format/types.js';

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
