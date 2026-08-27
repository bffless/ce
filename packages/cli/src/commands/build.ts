/**
 * `rules build` orchestration: runs `buildRuleSet` over one rule-set directory, writes the
 * canonical export JSON to disk, and reports a one-line summary. Command wiring (commander,
 * multi-dir looping, process.exit) lives in `index.ts` — this module handles exactly one
 * directory so the caller controls aggregation/exit-code behavior across `[dirs...]`.
 *
 * Output path decision: when `-o <file>` is given, that exact path is used verbatim and is
 * the *only* side effect — no `dist/.gitignore` is written next to it, since the caller chose
 * a path outside the generated-artifacts convention. The default path (`<set>/dist/<name>
 * .proxy-rules.json`) is a build-output directory the compiled JSON does not belong in git for,
 * so the `dist/.gitignore` ("*") is written alongside it every time the *default* path is used.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildRuleSet } from '../compile/build.js';
import { stringifyExport } from '../format/canonical.js';

export interface BuildOutcome {
  ok: boolean;
  outFile?: string;
  summary?: string;
  warnings?: string[];
}

/** Build a single rule-set directory. Never throws — build failures are reported via `ok: false`. */
export async function buildOne(setDir: string, opts?: { output?: string; pathPrefix?: string }): Promise<BuildOutcome> {
  let result;
  try {
    result = await buildRuleSet(setDir, { pathPrefix: opts?.pathPrefix });
  } catch (err) {
    return { ok: false, summary: err instanceof Error ? err.message : String(err) };
  }

  const usingDefault = !opts?.output;
  const outFile = opts?.output
    ? path.resolve(opts.output)
    : path.join(setDir, 'dist', `${result.export.ruleSet.name}.proxy-rules.json`);

  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, stringifyExport(result.export), 'utf8');
  if (usingDefault) {
    writeFileSync(path.join(path.dirname(outFile), '.gitignore'), '*\n', 'utf8');
  }

  const schemaCount = result.export.schemas?.length ?? 0;
  const summary = `${result.export.rules.length} rules, ${schemaCount} schemas, ${result.secrets.length} secrets referenced`;
  return { ok: true, outFile, summary, warnings: result.warnings };
}
