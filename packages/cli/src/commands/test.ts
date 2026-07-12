/**
 * `rules test` orchestration: declarative handler fixtures (`*.fn.test.yaml`) run through
 * the Task 10 `node:vm` harness. Command wiring (commander, process.exit) is Task 13 —
 * this module only discovers fixture files and returns pass/fail counts.
 *
 * Discovery mirrors `compile/build.ts` / `commands/validate.ts`'s manual `readdirSync`
 * recursion style (no glob dependency): every `*.fn.test.yaml` file anywhere under
 * `<setDir>/rules/` is a fixture manifest, parsed with `FnTestManifestSchema` (Task 5).
 *
 * Failure isolation: a problem with one `*.fn.test.yaml` file (invalid YAML/schema, or a
 * `handler:` ref that doesn't resolve to an existing file) only fails *that file's* cases
 * — it does not abort discovery or execution of any other fixture file in the run.
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { deepStrictEqual } from 'node:assert';
import { FnTestManifestSchema, parseYamlFile } from '../format/manifest.js';
import { runHandlerFile } from '../harness/run-handler.js';
import type { HandlerData } from '../harness/run-handler.js';

/** A single failed case (or a whole failed fixture file, when `case` is a placeholder). */
export interface FailedCase {
  file: string;
  case: string;
  message: string;
}

export interface FnTestRunResult {
  passed: number;
  failed: FailedCase[];
}

/** Recursively find every `*.fn.test.yaml` file under `dir`, sorted for deterministic
 *  output across filesystems (same convention as `discoverFnJsFiles` in validate.ts). */
function discoverFnTestFiles(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      discoverFnTestFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.fn.test.yaml')) {
      out.push(full);
    }
  }
}

/** Readable expected-vs-actual message for a failed `expect.result` comparison. */
function resultMismatchMessage(expected: unknown, actual: unknown): string {
  return `expected result ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}

/** Run every `*.fn.test.yaml` fixture under `<setDir>/rules/` and tally pass/fail. */
export async function runFnTests(setDir: string): Promise<FnTestRunResult> {
  const absSetDir = path.resolve(setDir);
  const testFiles: string[] = [];
  discoverFnTestFiles(path.join(absSetDir, 'rules'), testFiles);
  testFiles.sort();

  let passed = 0;
  const failed: FailedCase[] = [];

  for (const testFile of testFiles) {
    const relTestFile = path.relative(absSetDir, testFile);

    let manifest;
    try {
      manifest = parseYamlFile(testFile, FnTestManifestSchema);
    } catch (err) {
      // Invalid YAML/schema: fails this file only, as a single synthetic "case".
      failed.push({ file: relTestFile, case: '(file)', message: (err as Error).message });
      continue;
    }

    const handlerPath = path.resolve(path.dirname(testFile), manifest.handler);
    if (!existsSync(handlerPath)) {
      // Missing handler: fails every case declared in THIS file, not the whole run.
      for (const c of manifest.cases) {
        failed.push({
          file: relTestFile,
          case: c.name,
          message: `handler not found: ${manifest.handler} (resolved to ${path.relative(absSetDir, handlerPath)})`,
        });
      }
      continue;
    }

    for (const c of manifest.cases) {
      let outcome: { ok: true; result: unknown } | { ok: false; error: Error };
      try {
        const { result } = await runHandlerFile(handlerPath, (c.data ?? {}) as HandlerData, { setDir: absSetDir });
        outcome = { ok: true, result };
      } catch (err) {
        outcome = { ok: false, error: err as Error };
      }

      if (c.expect.throws !== undefined) {
        if (!outcome.ok) {
          if (outcome.error.message.includes(c.expect.throws)) {
            passed++;
          } else {
            failed.push({
              file: relTestFile,
              case: c.name,
              message: `expected error to contain "${c.expect.throws}", got "${outcome.error.message}"`,
            });
          }
        } else {
          failed.push({
            file: relTestFile,
            case: c.name,
            message: `expected handler to throw containing "${c.expect.throws}", but it returned ${JSON.stringify(outcome.result)}`,
          });
        }
        continue;
      }

      // expect.result path (FnTestCaseExpectSchema guarantees at least one of
      // result/throws is present, so reaching here means `result` was set).
      if (!outcome.ok) {
        failed.push({
          file: relTestFile,
          case: c.name,
          message: `expected result ${JSON.stringify(c.expect.result)}, but handler threw: ${outcome.error.message}`,
        });
        continue;
      }
      try {
        deepStrictEqual(outcome.result, c.expect.result);
        passed++;
      } catch {
        failed.push({ file: relTestFile, case: c.name, message: resultMismatchMessage(c.expect.result, outcome.result) });
      }
    }
  }

  return { passed, failed };
}
