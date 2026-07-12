/**
 * `rules rollback` — replay a captured revision through the sync endpoint (POST
 * /api/proxy-rule-sets/:id/rollback/:revisionId). The response IS a `SyncResponse` (rollback
 * is a sync under the hood) — rendered by the caller with the existing `formatSyncReport`
 * from `push.ts`, so the change plan looks identical to a `rules push` report.
 *
 * Default target (no `--to`): the newest revision with `current: false`. The `/revisions`
 * list is already newest-first, so that's simply the first non-current entry — erroring
 * loudly when there isn't one beats guessing (the only non-current revision to roll back to
 * IS the live state, i.e. there's nothing to revert).
 */
import { createClient, ApiError, type ClientDeps } from '../api/client.js';
import { requireProject, resolveProjectId, resolveRuleSetId } from '../api/resolve.js';
import { findConfig } from '../config.js';
import type { RevisionListItem, RevisionListResponse, SyncResponse } from '../api/sync-types.js';

export interface RollbackOptions {
  apiUrl?: string;
  apiKey?: string;
  project?: string;
  to?: string;
  dryRun?: boolean;
}

export interface RollbackOutcome {
  ok: boolean;
  response?: SyncResponse;
  revisionId?: string;
  error?: string;
}

/** Newest revision with `current: false` (the list is already newest-first); `null` when
 *  every captured revision is current (nothing to roll back to). */
export function pickDefaultRollbackTarget(revisions: RevisionListItem[]): RevisionListItem | null {
  return revisions.find((r) => !r.current) ?? null;
}

export async function runRollback(
  setName: string,
  opts: RollbackOptions,
  cwd: string,
  deps?: ClientDeps,
): Promise<RollbackOutcome> {
  try {
    const config = deps?.config !== undefined ? deps.config : (findConfig(cwd)?.config ?? null);
    const client = createClient(opts, cwd, { ...deps, config });
    const project = requireProject(opts.project, config?.project);
    const projectId = await resolveProjectId(client, project);
    const ruleSetId = await resolveRuleSetId(client, projectId, setName);

    let revisionId = opts.to;
    if (!revisionId) {
      const { revisions } = await client.get<RevisionListResponse>(
        `/api/proxy-rule-sets/${ruleSetId}/revisions`,
        `rule set "${setName}" (${ruleSetId}) revisions`,
      );
      const target = pickDefaultRollbackTarget(revisions);
      if (!target) {
        return {
          ok: false,
          error:
            `rule set "${setName}" has no non-current revision to roll back to — the current ` +
            `state already IS the newest captured revision, so there is nothing to revert to. ` +
            `Pass --to <revisionId> to target a specific revision explicitly (see \`bffless ` +
            `rules revisions ${setName}\`).`,
        };
      }
      revisionId = target.id;
    }

    const response = await client.post<SyncResponse>(
      `/api/proxy-rule-sets/${ruleSetId}/rollback/${revisionId}`,
      { dryRun: opts.dryRun ?? false },
      `rule set "${setName}" (${ruleSetId}) revision ${revisionId}`,
    );
    return { ok: true, response, revisionId };
  } catch (err) {
    if (err instanceof ApiError || err instanceof Error) return { ok: false, error: err.message };
    return { ok: false, error: String(err) };
  }
}
