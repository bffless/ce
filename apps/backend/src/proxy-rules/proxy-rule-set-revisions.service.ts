import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { eq, and, desc, inArray } from 'drizzle-orm';
import * as crypto from 'crypto';
import { db } from '../db/client';
import { proxyRuleSetRevisions } from '../db/schema/proxy-rule-set-revisions.schema';
import type {
  ProxyRuleSetRevision,
  RevisionTrigger,
} from '../db/schema/proxy-rule-set-revisions.schema';
import type { ProxyRuleSet } from '../db/schema/proxy-rule-sets.schema';
import type { ProxyRule } from '../db/schema/proxy-rules.schema';
import { PipelineSchemasService } from '../pipelines/pipeline-schemas.service';
import { collectSchemaIds } from './schema-refs.util';
import {
  buildExportEnvelope,
  serializeRuleForExport,
  type ExportedSchema,
  type RuleSetExport,
} from './export-format.util';

/** Maximum number of revisions retained per rule set; oldest are pruned after each capture. */
export const REVISION_CAP = 20;

/**
 * Content hash of a captured revision — sha256 hex over `{ ruleSet, rules,
 * schemas }` from the canonical export envelope, deliberately EXCLUDING
 * `exportedAt`/`version`/`kind` so a fresh export timestamp alone never
 * produces a "different" revision. This is what `capture()` dedupes against
 * (skip insert when it matches the newest revision's hash) and what the
 * `current` flag on the wire (`RevisionListItem.current`) compares against
 * the live envelope's hash, computed per request.
 */
export function computeRevisionHash(envelope: RuleSetExport): string {
  const { ruleSet, rules, schemas } = envelope;
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ ruleSet, rules, schemas }))
    .digest('hex');
}

export interface CaptureInput {
  /** Current rule set row (id, name, description, environment, source). */
  ruleSet: ProxyRuleSet;
  /** Decrypted rules, as returned by `ProxyRulesService.getRulesByRuleSetId`. */
  rules: ProxyRule[];
  trigger: RevisionTrigger;
  userId?: string;
}

/**
 * Captures point-in-time snapshots of proxy rule sets for history/rollback.
 *
 * Depends ONLY on `PipelineSchemasService` (never on `ProxyRuleSetsService` /
 * `ProxyRulesService`) to avoid a DI cycle — callers on the mutation paths
 * (sync/import/create/copy/rule edits/rollback) pass the current rule set row
 * and already-decrypted rules in directly.
 *
 * Capture is post-mutation, post-commit, best-effort: `capture()` never
 * throws — a failure logs a warning and the caller's response is unaffected,
 * mirroring the nginx-regeneration post-commit pattern in
 * `ProxyRuleSetsService.syncRuleSet`.
 */
@Injectable()
export class ProxyRuleSetRevisionsService {
  private readonly logger = new Logger(ProxyRuleSetRevisionsService.name);

  constructor(
    @Inject(forwardRef(() => PipelineSchemasService))
    private readonly pipelineSchemasService: PipelineSchemasService,
  ) {}

  /**
   * Assemble the canonical export envelope for `input` (same assembly as
   * `ProxyRuleSetsService.exportRuleSet`: serialize rules, walk pipeline
   * configs for referenced schema ids, bundle resolvable same-project
   * schemas), hash it, and — unless the hash matches the newest existing
   * revision for this rule set — insert a new revision row and prune history
   * beyond `REVISION_CAP`.
   *
   * Never throws: any failure (including from the schema lookups or the DB)
   * is caught and logged as a warning.
   */
  async capture(input: CaptureInput): Promise<void> {
    try {
      const serializedRules = input.rules.map((rule) => serializeRuleForExport(rule));

      const schemas: ExportedSchema[] = [];
      for (const schemaId of collectSchemaIds(serializedRules)) {
        const schema = await this.pipelineSchemasService.getById(schemaId);
        // Skip silently, mirroring exportRuleSet: missing/foreign-project refs
        // stay unbundled rather than failing the capture.
        if (!schema || schema.projectId !== input.ruleSet.projectId) continue;
        schemas.push({ id: schema.id, name: schema.name, fields: schema.fields });
      }

      const envelope = buildExportEnvelope({
        ruleSet: {
          name: input.ruleSet.name,
          description: input.ruleSet.description,
          environment: input.ruleSet.environment,
        },
        rules: serializedRules,
        schemas,
        exportedAt: new Date().toISOString(),
      });

      const contentHash = computeRevisionHash(envelope);

      const [newest] = await db
        .select()
        .from(proxyRuleSetRevisions)
        .where(eq(proxyRuleSetRevisions.ruleSetId, input.ruleSet.id))
        .orderBy(desc(proxyRuleSetRevisions.createdAt))
        .limit(1);

      if (newest && newest.contentHash === contentHash) {
        return;
      }

      await db.insert(proxyRuleSetRevisions).values({
        ruleSetId: input.ruleSet.id,
        snapshot: envelope,
        source: input.ruleSet.source ?? null,
        trigger: input.trigger,
        contentHash,
        createdBy: input.userId ?? null,
      });

      await this.prune(input.ruleSet.id);
    } catch (error) {
      this.logger.warn(
        `Failed to capture revision for rule set ${input.ruleSet.id}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Backfill hook for destructive mutation paths (sync on an existing set,
   * rule-level mutations, rollback): if the set has at least one rule and NO
   * revisions yet, capture the pre-mutation state with trigger `'backfill'`
   * so the first post-upgrade mutation remains reversible. No-ops (without
   * touching the DB) when there are no rules, and no-ops when a revision
   * already exists. Never throws.
   */
  async captureIfUnrevisioned(input: Omit<CaptureInput, 'trigger'>): Promise<void> {
    try {
      if (input.rules.length === 0) return;

      // Existence check (not a true count): we only need to distinguish
      // zero vs. at-least-one revision, so LIMIT 1 is sufficient and cheaper.
      const [existing] = await db
        .select({ id: proxyRuleSetRevisions.id })
        .from(proxyRuleSetRevisions)
        .where(eq(proxyRuleSetRevisions.ruleSetId, input.ruleSet.id))
        .limit(1);

      if (existing) return;

      await this.capture({ ...input, trigger: 'backfill' });
    } catch (error) {
      this.logger.warn(
        `Failed to backfill revision for rule set ${input.ruleSet.id}: ${(error as Error).message}`,
      );
    }
  }

  /** All revisions for a rule set, newest first. */
  async listRevisions(ruleSetId: string): Promise<ProxyRuleSetRevision[]> {
    return db
      .select()
      .from(proxyRuleSetRevisions)
      .where(eq(proxyRuleSetRevisions.ruleSetId, ruleSetId))
      .orderBy(desc(proxyRuleSetRevisions.createdAt));
  }

  /** A single revision, or null if it doesn't exist or belongs to another rule set. */
  async getRevision(ruleSetId: string, revisionId: string): Promise<ProxyRuleSetRevision | null> {
    const [row] = await db
      .select()
      .from(proxyRuleSetRevisions)
      .where(
        and(
          eq(proxyRuleSetRevisions.ruleSetId, ruleSetId),
          eq(proxyRuleSetRevisions.id, revisionId),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /** Delete all but the newest `REVISION_CAP` revisions for a rule set. */
  private async prune(ruleSetId: string): Promise<void> {
    const rows = await db
      .select({ id: proxyRuleSetRevisions.id })
      .from(proxyRuleSetRevisions)
      .where(eq(proxyRuleSetRevisions.ruleSetId, ruleSetId))
      .orderBy(desc(proxyRuleSetRevisions.createdAt));

    if (rows.length > REVISION_CAP) {
      const idsToDelete = rows.slice(REVISION_CAP).map((r) => r.id);
      await db.delete(proxyRuleSetRevisions).where(inArray(proxyRuleSetRevisions.id, idsToDelete));
    }
  }
}
