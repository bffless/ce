/**
 * `rules pull` orchestration. Phase 0 only supports pulling from a local export file
 * (`--from-file`) and decompiling it to the authoring layout — there is no server export
 * endpoint yet, so a live pull (no `--from-file`) is a hard error pointing at Phase 1.
 *
 * `--decompile` is required alongside `--from-file` in Phase 0: it is the only supported
 * output mode (there is no "just fetch the raw export" mode yet), so rather than silently
 * decompiling regardless of the flag, an explicit omission is treated the same as a missing
 * `--from-file` — a clear Phase-0-scope error instead of silently guessing intent.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { decompileExport, writeDecompiled } from '../compile/decompile.js';
import type { RuleSetExport } from '../format/types.js';

export interface PullOptions {
  fromFile?: string;
  decompile?: boolean;
  output?: string;
  force?: boolean;
}

export interface PullOutcome {
  ok: boolean;
  outDir?: string;
  warnings?: string[];
  error?: string;
}

export async function runPull(opts: PullOptions, cwd: string): Promise<PullOutcome> {
  if (!opts.fromFile) {
    return { ok: false, error: 'live pull requires a server export endpoint (Phase 1)' };
  }
  if (!opts.decompile) {
    return { ok: false, error: '--decompile is required alongside --from-file (Phase 0 supports no other pull output)' };
  }

  let exp: RuleSetExport;
  try {
    const raw = readFileSync(path.resolve(cwd, opts.fromFile), 'utf8');
    exp = JSON.parse(raw) as RuleSetExport;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const outDir = opts.output ? path.resolve(cwd, opts.output) : path.resolve(cwd, '.bffless', 'proxy-rules', exp.ruleSet.name);

  const result = decompileExport(exp);
  try {
    await writeDecompiled(result, outDir, { force: opts.force });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  return { ok: true, outDir, warnings: result.warnings };
}
