/**
 * `rules pull` orchestration — two modes:
 *
 * - **Live pull** (Phase 1): `rules pull <set-name>` resolves the set by name within the
 *   configured project, fetches `GET /api/proxy-rule-sets/:id/export`, and decompiles the
 *   envelope to the authoring layout. A live pull ALWAYS decompiles — there is no "raw
 *   fetch" mode, so no `--decompile` flag is needed (it stays accepted for compatibility
 *   but is a no-op here).
 *
 * - **From-file** (Phase 0, kept 100% backward-compatible): `--from-file <file> --decompile`
 *   reads a local export JSON instead of the server. `--decompile` remains REQUIRED with
 *   `--from-file` — the Phase 0 semantics were an explicit-opt-in decompile, and silently
 *   changing that would surprise existing scripts.
 *
 * Both modes share the output logic: `--output` wins, else
 * `.bffless/proxy-rules/<ruleSet.name>/`; non-empty targets need `--force`.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { decompileExport, writeDecompiled } from '../compile/decompile.js';
import { createClient, ApiError, type ClientDeps } from '../api/client.js';
import { resolveProjectId, resolveRuleSetId, requireProject } from '../api/resolve.js';
import { findConfig } from '../config.js';
import type { RuleSetExport } from '../format/types.js';

export interface PullOptions {
  fromFile?: string;
  decompile?: boolean;
  output?: string;
  force?: boolean;
  apiUrl?: string;
  apiKey?: string;
  project?: string;
}

export interface PullOutcome {
  ok: boolean;
  outDir?: string;
  warnings?: string[];
  error?: string;
}

export type PullDeps = ClientDeps;

/** Recursively find every `*.fn.ts` file under `dir` (best-effort — `dir` may not exist yet). */
function findFnTsFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findFnTsFiles(full, out);
    else if (entry.isFile() && entry.name.endsWith('.fn.ts')) out.push(full);
  }
  return out;
}

export async function runPull(
  setName: string | undefined,
  opts: PullOptions,
  cwd: string,
  deps?: PullDeps,
): Promise<PullOutcome> {
  let exp: RuleSetExport;

  if (opts.fromFile) {
    if (setName !== undefined) {
      return {
        ok: false,
        error: 'a set name and --from-file are mutually exclusive (--from-file names the source already)',
      };
    }
    if (!opts.decompile) {
      return {
        ok: false,
        error: '--decompile is required alongside --from-file (Phase 0 supports no other pull output)',
      };
    }
    try {
      const raw = readFileSync(path.resolve(cwd, opts.fromFile), 'utf8');
      exp = JSON.parse(raw) as RuleSetExport;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  } else {
    if (!setName) {
      return {
        ok: false,
        error: 'a set name is required for a live pull (bffless rules pull <set-name>), or use --from-file <file>',
      };
    }
    try {
      const config = deps?.config !== undefined ? deps.config : (findConfig(cwd)?.config ?? null);
      const client = createClient(opts, cwd, { ...deps, config });
      const project = requireProject(opts.project, config?.project);
      const projectId = await resolveProjectId(client, project);
      const ruleSetId = await resolveRuleSetId(client, projectId, setName);
      exp = await client.get<RuleSetExport>(
        `/api/proxy-rule-sets/${ruleSetId}/export`,
        `rule set "${setName}" (${ruleSetId}) export`,
      );
    } catch (err) {
      if (err instanceof ApiError || err instanceof Error) return { ok: false, error: err.message };
      return { ok: false, error: String(err) };
    }
  }

  const outDir = opts.output
    ? path.resolve(cwd, opts.output)
    : path.resolve(cwd, '.bffless', 'proxy-rules', exp.ruleSet.name);

  let result;
  try {
    result = decompileExport(exp);
    // Warn (don't block) when the target already holds hand-authored .fn.ts sources: decompile
    // only ever emits .fn.js (it has no TypeScript source to regenerate from the compiled
    // export), so an existing .fn.ts here is either about to be left orphaned (non-empty-dir
    // guard below, without --force) or silently dropped (with --force overwriting other files
    // in the same directory) — the author should know either way.
    const existingTs = findFnTsFiles(outDir);
    if (existingTs.length > 0) {
      result.warnings.push(
        `${path.relative(cwd, outDir) || '.'} already has ${existingTs.length} hand-authored .fn.ts handler(s); ` +
          'decompile only emits .fn.js and will not regenerate TypeScript sources',
      );
    }
    await writeDecompiled(result, outDir, { force: opts.force });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  return { ok: true, outDir, warnings: result.warnings };
}
