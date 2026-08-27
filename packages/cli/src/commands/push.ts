/**
 * `rules push` orchestration: compile a rule-set directory in-memory (same compiler as
 * `rules build`, nothing written to `dist/`), then `PUT /api/proxy-rule-sets/project/
 * :projectId/sync` and render the server's change report.
 *
 * - `--name-suffix pr-42` renames the compiled set to `<name>-pr-42` before syncing —
 *   the preview-deploy pattern (a PR gets its own live set without touching production's).
 * - `source` metadata (repo/gitSha/path) is attached best-effort from the GitHub Actions
 *   env or local git (see api/git-source.ts) so the server can stamp provenance.
 * - Exit semantics (enforced by the caller via `ok`): any HTTP or compile error is a
 *   failure; `missingSecrets` alone is a WARNING (exit 0) — a fresh set legitimately has
 *   blank secret placeholders until someone fills the project secrets.
 */
import { buildRuleSet } from '../compile/build.js';
import { createClient, ApiError, type ClientDeps } from '../api/client.js';
import { resolveProjectId, requireProject } from '../api/resolve.js';
import { collectSourceMetadata, type ExecGit } from '../api/git-source.js';
import { findConfig } from '../config.js';
import type { SyncRequestBody, SyncResponse, SyncRuleRef } from '../api/sync-types.js';

export interface PushOptions {
  nameSuffix?: string;
  pathPrefix?: string;
  prune?: boolean;
  dryRun?: boolean;
  strictSchemas?: boolean;
  apiUrl?: string;
  apiKey?: string;
  project?: string;
}

export interface PushDeps extends ClientDeps {
  execGit?: ExecGit;
}

export interface PushOutcome {
  ok: boolean;
  /** The name the set was (or would have been) synced under — post `nameSuffix`. Present
   *  whenever the set compiled, including when the sync itself then failed; absent only when
   *  the compile failed, since there is no name to report until the set has been built. */
  name?: string;
  /** The rendered change report (present on success). */
  report?: string;
  response?: SyncResponse;
  error?: string;
}

/** The preview-deploy naming rule: `<name>-<suffix>`, or `name` unchanged when no suffix.
 *  Exported so embedders label a sync with the same string `runPushOne` sends, rather than
 *  re-deriving it (and drifting from) this one line. */
export function applyNameSuffix(name: string, suffix?: string): string {
  return suffix ? `${name}-${suffix}` : name;
}

function formatRef(ref: SyncRuleRef): string {
  return `${ref.method ?? 'ANY'} ${ref.pathPattern}`;
}

/** Render the sync response as a human/CI-readable change report. */
export function formatSyncReport(setName: string, res: SyncResponse): string {
  const lines: string[] = [];
  const mode = res.dryRun ? ' (dry run — nothing was written)' : '';
  const created = res.setCreated ? (res.dryRun ? ' [set would be created]' : ' [set created]') : '';
  lines.push(
    `${setName}: ${res.created.length} created, ${res.updated.length} updated, ` +
      `${res.deleted.length} deleted, ${res.unchanged.length} unchanged${created}${mode}`,
  );

  const bucket = (label: string, refs: SyncRuleRef[], marker: string) => {
    if (refs.length === 0) return;
    lines.push(`  ${label}:`);
    for (const ref of refs) lines.push(`    ${marker} ${formatRef(ref)}`);
  };
  bucket('created', res.created, '+');
  bucket('updated', res.updated, '~');
  bucket('deleted', res.deleted, '-');

  if (res.pruneCandidates.length > 0) {
    lines.push(`  would prune (live-only rules; pass --prune to delete):`);
    for (const ref of res.pruneCandidates) lines.push(`    ! ${formatRef(ref)}`);
  }

  if (res.missingSecrets.length > 0) {
    lines.push(
      `  MISSING SECRETS (${res.missingSecrets.length}) — set these in the project's secrets: ` +
        res.missingSecrets.join(', '),
    );
  }

  // Adoption is an action, not a warning: the sync filled in a kind the live
  // schema was missing, so say so rather than leaving it to the schema list.
  const adopted = res.schemaResolutions.filter((r) => r.kindAdopted);
  if (adopted.length > 0) {
    lines.push(`  declared kind adopted by: ${adopted.map((r) => r.name).join(', ')}`);
  }

  for (const w of res.warnings) lines.push(`  warning: ${w}`);

  return lines.join('\n');
}

export async function runPushOne(
  setDir: string,
  opts: PushOptions,
  cwd: string,
  deps?: PushDeps,
): Promise<PushOutcome> {
  let built;
  try {
    built = await buildRuleSet(setDir, { pathPrefix: opts.pathPrefix });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const exp = built.export;
  const name = applyNameSuffix(exp.ruleSet.name, opts.nameSuffix);
  const ruleSet = name === exp.ruleSet.name ? exp.ruleSet : { ...exp.ruleSet, name };

  const source = collectSourceMetadata(setDir, { env: deps?.env, execGit: deps?.execGit });

  const body: SyncRequestBody = {
    ruleSet,
    rules: exp.rules,
    ...(exp.schemas && exp.schemas.length > 0 ? { schemas: exp.schemas } : {}),
    options: {
      prune: opts.prune ?? false,
      dryRun: opts.dryRun ?? false,
      strictSchemas: opts.strictSchemas ?? false,
    },
    ...(source ? { source } : {}),
  };

  try {
    const config = deps?.config !== undefined ? deps.config : (findConfig(cwd)?.config ?? null);
    const client = createClient(opts, cwd, { ...deps, config });
    const project = requireProject(opts.project, config?.project, deps?.remediation);
    const projectId = await resolveProjectId(client, project);
    const response = await client.put<SyncResponse>(
      `/api/proxy-rule-sets/project/${projectId}/sync`,
      body,
      `project ${projectId} (sync target)`,
    );
    return { ok: true, name, report: formatSyncReport(name, response), response };
  } catch (err) {
    if (err instanceof ApiError || err instanceof Error) return { ok: false, name, error: err.message };
    return { ok: false, name, error: String(err) };
  }
}
