import { pgTable, uuid, jsonb, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { proxyRuleSets } from './proxy-rule-sets.schema';
import type { ProxyRuleSetSource } from './proxy-rule-sets.schema';
// Type-only import: avoids a runtime cycle between the db schema layer and
// the proxy-rules service layer (export-format.util imports schema types).
import type { RuleSetExport } from '../../proxy-rules/export-format.util';

/**
 * Proxy Rule Set Revisions — an immutable history of captured snapshots for a
 * rule set, one row per meaningfully-different state.
 *
 * Captured by `ProxyRuleSetRevisionsService.capture()` on mutation paths
 * (sync, import, create, copy, rule edits, rollback) and via
 * `captureIfUnrevisioned()` as a one-time backfill for sets that predate this
 * feature. `snapshot` holds the full v2 export envelope (same shape as
 * `GET :id/export`); `contentHash` is a hash of the envelope minus
 * `exportedAt`/`version`/`kind` so timestamp churn alone never creates a new
 * revision. History is capped at `REVISION_CAP` rows per rule set (oldest
 * pruned first) — see `proxy-rule-set-revisions.service.ts`.
 */
export const proxyRuleSetRevisions = pgTable(
  'proxy_rule_set_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ruleSetId: uuid('rule_set_id')
      .references(() => proxyRuleSets.id, { onDelete: 'cascade' })
      .notNull(),
    // Full v2 export envelope at capture time (import type only — no runtime
    // dependency on the proxy-rules service layer).
    snapshot: jsonb('snapshot').$type<RuleSetExport>().notNull(),
    // Rules-as-code provenance carried over from the rule set at capture
    // time, if any (null for sets never synced from git).
    source: jsonb('source').$type<ProxyRuleSetSource>(),
    trigger: varchar('trigger', { length: 20 }).$type<RevisionTrigger>().notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    // No FK: a revision must survive deletion of the user who triggered it.
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('proxy_rule_set_revisions_set_created_idx').on(t.ruleSetId, t.createdAt)],
);

/** What triggered this capture — see `ProxyRuleSetRevisionsService` for semantics. */
export type RevisionTrigger =
  | 'sync'
  | 'import'
  | 'create'
  | 'copy'
  | 'set_update'
  | 'rule_edit'
  | 'rollback'
  | 'backfill';

export type ProxyRuleSetRevision = typeof proxyRuleSetRevisions.$inferSelect;
export type NewProxyRuleSetRevision = typeof proxyRuleSetRevisions.$inferInsert;
