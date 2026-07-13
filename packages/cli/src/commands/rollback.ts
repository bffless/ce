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
 *
 * `--to` accepts either a full uuid (used as-is, no extra network call) or any unique prefix
 * of one — notably the 8-char short id `rules revisions` prints, which is otherwise
 * unusable because the rollback route guards `:revisionId` with a `ParseUUIDPipe`.
 */
import { createClient, ApiError, type ClientDeps } from '../api/client.js';
import { requireProject, resolveProjectId, resolveRuleSetId } from '../api/resolve.js';
import { findConfig } from '../config.js';
import { UUID_RE } from '../format/routes.js';
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

/** Expand a `--to` value to a full revision uuid against the fetched list. A prefix that
 *  matches exactly one revision wins; zero or several is an error naming the short ids that
 *  DO exist, so a mistyped or stale id is a one-glance fix. Comparison is case-insensitive
 *  because a uuid pasted from anywhere may be upper-cased. */
export function resolveRevisionId(to: string, revisions: RevisionListItem[]): string {
  if (to === '')
    throw new Error(
      '--to needs a revision id (a full uuid or a unique prefix, e.g. the 8-char id from `rules revisions`)',
    );
  const prefix = to.toLowerCase();
  const matches = revisions.filter((r) => r.id.toLowerCase().startsWith(prefix));
  if (matches.length === 1) return matches[0].id;

  const available = revisions.map((r) => r.id.slice(0, 8));
  if (matches.length === 0) {
    throw new Error(
      `revision "${to}" not found. Available revisions: ` +
        `${available.length > 0 ? available.join(', ') : '(none captured yet)'}`,
    );
  }
  const candidates = matches.map((r) => r.id).join(', ');
  throw new Error(
    `revision "${to}" is ambiguous — matches ${candidates}. Use a longer prefix or the full uuid.`,
  );
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

    // A full uuid goes straight to the rollback endpoint; anything else (a short id, a
    // partial paste) has to be expanded against the list first — the route's ParseUUIDPipe
    // rejects a prefix with a 400 before the handler ever runs.
    const to = opts.to?.trim();
    let revisionId = to;
    if (to === undefined || !UUID_RE.test(to)) {
      const { revisions } = await client.get<RevisionListResponse>(
        `/api/proxy-rule-sets/${ruleSetId}/revisions`,
        `rule set "${setName}" (${ruleSetId}) revisions`,
      );

      if (to !== undefined) {
        revisionId = resolveRevisionId(to, revisions);
      } else {
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
