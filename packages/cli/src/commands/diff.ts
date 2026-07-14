/**
 * `rules diff` orchestration — the CI drift-check contract:
 *
 * Compile the local rule-set directory in-memory, fetch the live export for the set with
 * the same name, and compare with `exportsEquivalent` (defaults-normalized, exportedAt
 * ignored — the same equivalence the round-trip tests use).
 *
 * Outcomes (the caller maps these to exit codes — documented in `--help`):
 * - `clean` (exit 0): local and live are equivalent.
 * - `drift` (exit 1): differences found, or the set does not exist on the server at all
 *   (a missing set IS drift — the git state says it should exist).
 * - `error` (exit 2): compile/auth/network failure — distinguishable from drift in CI.
 */
import { buildRuleSet } from '../compile/build.js';
import { exportsEquivalent } from '../format/canonical.js';
import { walkSchemaRefs } from '../format/schema-refs.js';
import { createClient, ApiError, type ClientDeps } from '../api/client.js';
import { resolveProjectId, requireProject, findRuleSetByName } from '../api/resolve.js';
import { findConfig } from '../config.js';
import type { RuleSetExport } from '../format/types.js';

/**
 * Align the LOCAL export's schema identity to the LIVE export's, by NAME — mirroring what the
 * server does on push (`resolveSchemasByName` + `remapSchemaIds` in
 * `apps/backend/src/proxy-rules/proxy-rule-sets.service.ts`): schemas are resolved by name in
 * the target project and every step-config schema ref is rewritten to the project's DB ids.
 * So a locally-derived schema id (uuidv5(name) from `build.ts`, or an authored one) that
 * differs from the live DB id is NOT drift as long as the names match — without this
 * alignment, `rules diff` would report permanent false drift on sets that push cleanly as
 * "unchanged".
 *
 * Returns a deep copy of `local` where, for every local schema whose name also exists live
 * (with a different id), `schemas[].id` is substituted with the live id and every schema ref
 * in the rules (`walkSchemaRefs`, same key list as the backend's `SCHEMA_REF_KEYS`) is
 * rewritten localId → liveId. Everything else is left untouched, so it surfaces as genuine
 * drift: schemas present on only one side, name mismatches, and differing schema fields.
 */
function alignLocalSchemaIdsToLive(local: RuleSetExport, live: RuleSetExport): RuleSetExport {
  const localSchemas = local.schemas ?? [];
  const liveSchemas = live.schemas ?? [];
  if (localSchemas.length === 0 || liveSchemas.length === 0) return local;

  const liveIdByName = new Map(liveSchemas.map((s) => [s.name, s.id] as const));
  const idMap = new Map<string, string>();
  for (const s of localSchemas) {
    const liveId = liveIdByName.get(s.name);
    if (liveId !== undefined && liveId !== s.id) idMap.set(s.id, liveId);
  }
  if (idMap.size === 0) return local;

  const aligned = structuredClone(local);
  for (const s of aligned.schemas ?? []) {
    const mapped = idMap.get(s.id);
    if (mapped !== undefined) s.id = mapped;
  }
  walkSchemaRefs(aligned.rules, (ref, set) => {
    const mapped = idMap.get(ref);
    if (mapped !== undefined) set(mapped);
  });
  return aligned;
}

export interface DiffOptions {
  apiUrl?: string;
  apiKey?: string;
  project?: string;
}

export type DiffDeps = ClientDeps;

export interface DiffOutcome {
  status: 'clean' | 'drift' | 'error';
  /** Set name the comparison ran for (when compilation succeeded). */
  setName?: string;
  message?: string;
  diffs?: string[];
}

export async function runDiffOne(
  setDir: string,
  opts: DiffOptions,
  cwd: string,
  deps?: DiffDeps,
): Promise<DiffOutcome> {
  let local: RuleSetExport;
  try {
    local = (await buildRuleSet(setDir)).export;
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
  const setName = local.ruleSet.name;

  let live: RuleSetExport;
  try {
    const config = deps?.config !== undefined ? deps.config : (findConfig(cwd)?.config ?? null);
    const client = createClient(opts, cwd, { ...deps, config });
    const project = requireProject(opts.project, config?.project, deps?.remediation);
    const projectId = await resolveProjectId(client, project);
    const match = await findRuleSetByName(client, projectId, setName);
    if (!match) {
      return {
        status: 'drift',
        setName,
        message:
          `rule set "${setName}" does not exist on the server (project ${projectId}) — ` +
          `local state has it; run \`bffless rules push\` to create it`,
      };
    }
    live = await client.get<RuleSetExport>(
      `/api/proxy-rule-sets/${match.id}/export`,
      `rule set "${setName}" (${match.id}) export`,
    );
  } catch (err) {
    if (err instanceof ApiError || err instanceof Error) {
      return { status: 'error', setName, message: err.message };
    }
    return { status: 'error', setName, message: String(err) };
  }

  const { equal, diffs } = exportsEquivalent(alignLocalSchemaIdsToLive(local, live), live);
  if (equal) return { status: 'clean', setName, message: `${setName}: in sync` };
  return { status: 'drift', setName, message: `${setName}: drift detected (local != live)`, diffs };
}
