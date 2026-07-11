/**
 * Round-trip golden test — the make-or-break gate for Tasks 2-7.
 *
 * For each real fixture in test/fixtures/real/ (reader, handoff, studio-blog):
 *   decompileExport → writeDecompiled(tmpdir) → buildRuleSet(tmpdir)
 * must reproduce the original under exportsEquivalent (zero diffs), and every
 * function_handler config.code string must be byte-identical after the round-trip.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decompileExport, writeDecompiled } from '../src/compile/decompile.js';
import { buildRuleSet } from '../src/compile/build.js';
import { exportsEquivalent } from '../src/format/canonical.js';
import type { RuleSetExport } from '../src/format/types.js';

const realDir = path.resolve('test/fixtures/real');

describe.each(readdirSync(realDir))('round-trip %s', (file) => {
  const original = JSON.parse(readFileSync(path.join(realDir, file), 'utf8')) as RuleSetExport;

  it('decompile → build reproduces the original export', async () => {
    const out = mkdtempSync(path.join(tmpdir(), 'bffless-rt-'));
    const dec = decompileExport(original);
    await writeDecompiled(dec, out, { force: true });
    const rebuilt = await buildRuleSet(out, { exportedAt: original.exportedAt });
    const cmp = exportsEquivalent(original, rebuilt.export);
    expect(cmp.diffs).toEqual([]); // print the actual paths on failure
  });

  it('every function_handler code string is byte-identical after round-trip', async () => {
    const out = mkdtempSync(path.join(tmpdir(), 'bffless-rt-'));
    await writeDecompiled(decompileExport(original), out, { force: true });
    const rebuilt = await buildRuleSet(out, { exportedAt: original.exportedAt });
    const codes = (e: RuleSetExport) =>
      e.rules
        .flatMap((r) =>
          (r.pipelineConfig?.steps ?? [])
            .filter((s) => s.handlerType === 'function_handler')
            .map((s) => [r.pathPattern, r.method ?? '', s.name, s.config.code as string] as const),
        )
        .sort((a, b) => (a[0] + a[1] + a[2]).localeCompare(b[0] + b[1] + b[2]));
    expect(codes(rebuilt.export)).toEqual(codes(original));
  });
});
