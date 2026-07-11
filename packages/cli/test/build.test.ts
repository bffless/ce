import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildRuleSet, uuidv5, SCHEMA_NAMESPACE } from '../src/compile/build.js';
import type { RuleSetExport } from '../src/format/types.js';

const basicDir = path.resolve('test/fixtures/synthetic/basic');
const EXPORTED_AT = '2026-07-11T00:00:00.000Z';

/** Materialize a throwaway rule set from a { relpath: contents } map and return its dir. */
function scratchSet(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'bffless-build-test-'));
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents, 'utf8');
  }
  return dir;
}

describe('buildRuleSet', () => {
  it('(a) compiles the synthetic fixture to its expected.json', async () => {
    const expected = JSON.parse(readFileSync(path.join(basicDir, 'expected.json'), 'utf8')) as RuleSetExport;
    const { export: out } = await buildRuleSet(basicDir, { exportedAt: EXPORTED_AT });
    expect(out).toEqual(expected);
  });

  it('(a2) reports the referenced schema once and no warnings/secrets', async () => {
    const res = await buildRuleSet(basicDir, { exportedAt: EXPORTED_AT });
    expect(res.export.schemas).toHaveLength(1);
    expect(res.warnings).toEqual([]);
    expect(res.secrets).toEqual([]);
    expect(res.skillRefs).toEqual([]);
  });

  it('(b) throws with the path when a step code file is missing', async () => {
    const dir = scratchSet({
      'ruleset.yaml': 'name: s\n',
      'rules/api/x/post.rule.yaml':
        'pipeline:\n  steps:\n    - name: fn\n      handler: function_handler\n      code: missing.js\n',
    });
    await expect(buildRuleSet(dir)).rejects.toThrow(/code file not found:.*missing\.js/);
  });

  it('(c) throws naming both files on duplicate (pathPattern, method)', async () => {
    const dir = scratchSet({
      'ruleset.yaml': 'name: s\n',
      'rules/api/x/get.rule.yaml': 'targetUrl: http://a\n',
      'rules/api/y/get.rule.yaml': 'pathPattern: /api/x\ntargetUrl: http://b\n',
    });
    await expect(buildRuleSet(dir)).rejects.toThrow(/duplicate rule/);
    await expect(buildRuleSet(dir)).rejects.toThrow(/api\/x\/get\.rule\.yaml[\s\S]*api\/y\/get\.rule\.yaml/);
  });

  it('(d) throws when a $schema: ref has no manifest file', async () => {
    const dir = scratchSet({
      'ruleset.yaml': 'name: s\n',
      'rules/api/x/get.rule.yaml':
        'pipeline:\n  steps:\n    - name: q\n      handler: data_query\n      config:\n        schemaId: $schema:ghost\n',
    });
    await expect(buildRuleSet(dir)).rejects.toThrow(/ghost/);
  });

  it('(e) throws on a non-empty headerConfig.add value', async () => {
    const dir = scratchSet({
      'ruleset.yaml': 'name: s\n',
      'rules/api/x/get.rule.yaml': 'targetUrl: http://a\nheaderConfig:\n  add:\n    X-Api-Key: real-secret\n',
    });
    await expect(buildRuleSet(dir)).rejects.toThrow(/secret values must not be committed/);
  });

  it('(f) collects secrets from {{secrets.NAME}} occurrences', async () => {
    const dir = scratchSet({
      'ruleset.yaml': 'name: s\n',
      'rules/api/x/post.rule.yaml':
        'pipeline:\n  steps:\n    - name: call\n      handler: http_handler\n      config:\n        url: https://api/{{secrets.API_KEY}}\n',
    });
    const res = await buildRuleSet(dir, { exportedAt: EXPORTED_AT });
    expect(res.secrets).toContain('API_KEY');
  });

  it('(g) uuidv5 is deterministic (same name → same id)', async () => {
    // Direct: same inputs → identical, version-5 uuid.
    const a = uuidv5('widgets', SCHEMA_NAMESPACE);
    const b = uuidv5('widgets', SCHEMA_NAMESPACE);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    // Through the compiler: a schema with no explicit id resolves stably across two builds.
    const files: Record<string, string> = {
      'ruleset.yaml': 'name: s\n',
      'rules/api/x/get.rule.yaml':
        'pipeline:\n  steps:\n    - name: q\n      handler: data_query\n      config:\n        schemaId: $schema:widgets\n',
      'schemas/widgets.schema.yaml': 'name: widgets\nfields:\n  - name: id\n    type: string\n',
    };
    const d1 = scratchSet(files);
    const d2 = scratchSet(files);
    const r1 = await buildRuleSet(d1, { exportedAt: EXPORTED_AT });
    const r2 = await buildRuleSet(d2, { exportedAt: EXPORTED_AT });
    expect(r1.export.schemas?.[0].id).toBe(uuidv5('widgets', SCHEMA_NAMESPACE));
    expect(r1.export.schemas?.[0].id).toBe(r2.export.schemas?.[0].id);
  });
});
