import { describe, it, expect } from 'vitest';
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { decompileExport, writeDecompiled } from '../src/compile/decompile.js';
import { buildRuleSet } from '../src/compile/build.js';
import type { RuleSetExport } from '../src/format/types.js';

const basicDir = path.resolve('test/fixtures/synthetic/basic');
const EXPORTED_AT = '2026-07-11T00:00:00.000Z';

/** Recursively list files under `root` (relative, posix), excluding `expected.json` and
 *  `*.fn.test.yaml` — both are hand-authored fixture scaffolding (Task 6 golden output,
 *  Task 12 `rules test` fixtures respectively), not part of `decompileExport`'s output
 *  vocabulary, so they're not expected to appear in its file set. */
function relFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out.filter((f) => f !== 'expected.json' && !f.endsWith('.fn.test.yaml')).sort();
}

/** Deep-normalize `code:` refs by stripping a leading `./` so `./x.fn.js` compares equal to `x.fn.js`. */
function normalizeCodeRefs(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalizeCodeRefs);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      let nv = normalizeCodeRefs(val);
      if (k === 'code' && typeof nv === 'string') nv = nv.replace(/^\.\//, '');
      out[k] = nv;
    }
    return out;
  }
  return v;
}

function writeFiles(dir: string, files: Map<string, string>): void {
  for (const [rel, content] of files) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
}

describe('decompileExport', () => {
  it('(a) reproduces the synthetic `basic` layout file-for-file', async () => {
    const expected = JSON.parse(readFileSync(path.join(basicDir, 'expected.json'), 'utf8')) as RuleSetExport;
    const { files, warnings } = decompileExport(expected);
    expect(warnings).toEqual([]);

    // Same set of files as the fixture layout.
    expect([...files.keys()].sort()).toEqual(relFiles(basicDir));

    for (const [rel, content] of files) {
      const fixturePath = path.join(basicDir, rel);
      if (rel.endsWith('.fn.js')) {
        // Handler code must be byte-identical.
        expect(content).toBe(readFileSync(fixturePath, 'utf8'));
      } else {
        // YAML must be structurally equal (code-ref `./` prefix normalized).
        expect(normalizeCodeRefs(parseYaml(content))).toEqual(
          normalizeCodeRefs(parseYaml(readFileSync(fixturePath, 'utf8'))),
        );
      }
    }
  });

  it('(a2) round-trips: recompiling the decompiled layout reproduces the export', async () => {
    const expected = JSON.parse(readFileSync(path.join(basicDir, 'expected.json'), 'utf8')) as RuleSetExport;
    const { files } = decompileExport(expected);
    const dir = mkdtempSync(path.join(tmpdir(), 'bffless-decompile-rt-'));
    writeFiles(dir, files);
    const { export: out } = await buildRuleSet(dir, { exportedAt: EXPORTED_AT });
    expect(out).toEqual(expected);
  });

  it('(b) places an inexpressible pattern under _custom with an explicit pathPattern', () => {
    const exp: RuleSetExport = {
      version: 2,
      exportedAt: EXPORTED_AT,
      kind: 'bffless-proxy-rule-set',
      ruleSet: { name: 'custom' },
      rules: [
        {
          pathPattern: '/api/*.json',
          method: 'GET',
          targetUrl: 'http://b',
          stripPrefix: true,
          order: 0,
          timeout: 30000,
          preserveHost: false,
          forwardCookies: false,
          internalRewrite: false,
          proxyType: 'external_proxy',
          isEnabled: true,
          debugEnabled: false,
        },
      ],
    };
    const { files } = decompileExport(exp);
    const customEntry = [...files.keys()].find((k) => k.startsWith('rules/_custom/'));
    expect(customEntry).toBeDefined();
    expect(customEntry).toMatch(/\/get\.rule\.yaml$/);
    const manifest = parseYaml(files.get(customEntry!)!) as Record<string, unknown>;
    expect(manifest.pathPattern).toBe('/api/*.json');
  });

  it('(d) warns on an unknown schema UUID and leaves it untouched', () => {
    const unknownId = '99999999-8888-4777-8666-555555555555';
    const exp: RuleSetExport = {
      version: 2,
      exportedAt: EXPORTED_AT,
      kind: 'bffless-proxy-rule-set',
      ruleSet: { name: 'sref' },
      rules: [
        {
          pathPattern: '/api/x',
          method: 'POST',
          targetUrl: 'http://internal/pipeline',
          proxyType: 'pipeline',
          pipelineConfig: {
            name: 'api/x POST',
            steps: [{ name: 'q', handlerType: 'data_query', config: { schemaId: unknownId } }],
          },
        },
      ],
    };
    const { files, warnings } = decompileExport(exp);
    expect(warnings.some((w) => w.includes(unknownId))).toBe(true);
    const manifest = parseYaml(files.get('rules/api/x/post.rule.yaml')!) as {
      pipeline: { steps: Array<{ config: { schemaId: string } }> };
    };
    expect(manifest.pipeline.steps[0].config.schemaId).toBe(unknownId);
  });
});

describe('writeDecompiled', () => {
  it('(c) refuses a non-empty outDir without force, and writes with force', async () => {
    const res = { files: new Map([['ruleset.yaml', 'name: x\n']]), warnings: [] };

    const dir = mkdtempSync(path.join(tmpdir(), 'bffless-decompile-write-'));
    writeFileSync(path.join(dir, 'preexisting.txt'), 'hi', 'utf8');

    await expect(writeDecompiled(res, dir)).rejects.toThrow();
    await expect(writeDecompiled(res, dir, { force: true })).resolves.toBeUndefined();
    expect(readFileSync(path.join(dir, 'ruleset.yaml'), 'utf8')).toBe('name: x\n');

    // Empty (fresh) dir is fine without force.
    const fresh = mkdtempSync(path.join(tmpdir(), 'bffless-decompile-fresh-'));
    await expect(writeDecompiled(res, fresh)).resolves.toBeUndefined();
  });
});
