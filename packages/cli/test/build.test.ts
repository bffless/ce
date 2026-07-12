import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildRuleSet, uuidv5, SCHEMA_NAMESPACE } from '../src/compile/build.js';
import type { RuleSetExport } from '../src/format/types.js';

const basicDir = path.resolve('test/fixtures/synthetic/basic');
const EXPORTED_AT = '2026-07-11T00:00:00.000Z';

/** Some restricted environments (e.g. certain CI/container setups) can't create symlinks.
 *  Probe once at module load so the symlink-confinement test can skip gracefully rather than
 *  fail on an unrelated environment limitation. */
const canSymlink = (() => {
  const probeDir = mkdtempSync(path.join(tmpdir(), 'bffless-build-test-symlink-probe-'));
  try {
    symlinkSync(path.join(probeDir, 'target'), path.join(probeDir, 'link'));
    return true;
  } catch {
    return false;
  }
})();

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

  it('(h) $file: object form inlines a file\'s contents nested inside an array', async () => {
    const dir = scratchSet({
      'ruleset.yaml': 'name: s\n',
      'rules/api/x/get.rule.yaml':
        'pipeline:\n  steps:\n    - name: q\n      handler: function_handler\n      config:\n        items:\n          - $file: item1.txt\n          - plain\n',
      'rules/api/x/item1.txt': 'hello world',
    });
    const res = await buildRuleSet(dir, { exportedAt: EXPORTED_AT });
    const step = res.export.rules[0].pipelineConfig?.steps[0];
    expect(step?.config.items).toEqual(['hello world', 'plain']);
  });

  it('(i) $file: traversal outside the rule set directory throws the confinement error', async () => {
    // manifestDir is `<dir>/rules/api/x` (3 levels below `dir`); 4 levels of `../` step past
    // `dir` itself, which is what must be rejected.
    const dir = scratchSet({
      'ruleset.yaml': 'name: s\n',
      'rules/api/x/get.rule.yaml':
        'pipeline:\n  steps:\n    - name: q\n      handler: function_handler\n      config:\n        payload:\n          $file: ../../../../outside.txt\n',
    });
    await expect(buildRuleSet(dir)).rejects.toThrow(
      /file reference escapes the rule set directory: \.\.\/\.\.\/\.\.\/\.\.\/outside\.txt/,
    );
  });

  it('(i2) code: with an absolute path throws the confinement error', async () => {
    const dir = scratchSet({
      'ruleset.yaml': 'name: s\n',
      'rules/api/x/post.rule.yaml':
        'pipeline:\n  steps:\n    - name: fn\n      handler: function_handler\n      code: /etc/hostname.js\n',
    });
    await expect(buildRuleSet(dir)).rejects.toThrow(/file reference escapes the rule set directory: \/etc\/hostname\.js/);
  });

  it.skipIf(!canSymlink)(
    '(i3) $file: through a symlink pointing outside the rule set dir throws the confinement error',
    async () => {
      // Lexical resolution stays inside setDir (rules/api/x/link.txt), but the symlink target
      // resolves (via realpath) to a sibling directory outside setDir — this must fail closed.
      const dir = scratchSet({
        'ruleset.yaml': 'name: s\n',
        'rules/api/x/get.rule.yaml':
          'pipeline:\n  steps:\n    - name: q\n      handler: function_handler\n      config:\n        payload:\n          $file: link.txt\n',
      });
      const outsideDir = mkdtempSync(path.join(tmpdir(), 'bffless-build-test-outside-'));
      const secretFile = path.join(outsideDir, 'secret.txt');
      writeFileSync(secretFile, 'host secret', 'utf8');
      const linkPath = path.join(dir, 'rules/api/x/link.txt');
      symlinkSync(secretFile, linkPath);
      await expect(buildRuleSet(dir)).rejects.toThrow(/file reference escapes the rule set directory: link\.txt/);
    },
  );

  it('(i4) a file legitimately named "..config.txt" inside the rule set dir is accepted', async () => {
    // `..config.txt` is a valid filename that merely starts with `..` — the segment-safe check
    // (rel === '..' || rel.startsWith('../')) must not reject it the way a naive
    // rel.startsWith('..') check would.
    const dir = scratchSet({
      'ruleset.yaml': 'name: s\n',
      'rules/api/x/get.rule.yaml':
        'pipeline:\n  steps:\n    - name: q\n      handler: function_handler\n      config:\n        payload:\n          $file: ..config.txt\n',
      'rules/api/x/..config.txt': 'legit contents',
    });
    const res = await buildRuleSet(dir, { exportedAt: EXPORTED_AT });
    const step = res.export.rules[0].pipelineConfig?.steps[0];
    expect(step?.config.payload).toBe('legit contents');
  });

  it('(j) a raw-UUID schema ref passes through with a warning', async () => {
    const dir = scratchSet({
      'ruleset.yaml': 'name: s\n',
      'rules/api/x/get.rule.yaml':
        'pipeline:\n  steps:\n    - name: q\n      handler: data_query\n      config:\n        schemaId: 11111111-2222-4333-8444-555555555555\n',
    });
    const res = await buildRuleSet(dir, { exportedAt: EXPORTED_AT });
    expect(res.warnings).toEqual([
      'unresolved schema id 11111111-2222-4333-8444-555555555555 in ' + path.join(dir, 'rules/api/x/get.rule.yaml'),
    ]);
    expect(res.export.rules[0].pipelineConfig?.steps[0].config.schemaId).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('(k) collects skillRefs from an ai_handler step with skills.mode "selected"', async () => {
    const dir = scratchSet({
      'ruleset.yaml': 'name: s\n',
      'rules/api/x/post.rule.yaml':
        'pipeline:\n  steps:\n    - name: chat\n      handler: ai_handler\n      config:\n        skills:\n          mode: selected\n          enabled: [alpha, beta]\n',
    });
    const res = await buildRuleSet(dir, { exportedAt: EXPORTED_AT });
    expect(res.skillRefs).toEqual(['alpha', 'beta']);
  });

  it('(l) methods: outside an any rule throws, naming the actual file (single-file shape)', async () => {
    const dir = scratchSet({
      'ruleset.yaml': 'name: s\n',
      'rules/api/x/get.rule.yaml': 'methods: [GET, POST]\ntargetUrl: http://a\n',
    });
    await expect(buildRuleSet(dir)).rejects.toThrow(/'methods:' is only allowed in an 'any' rule \(found in get\.rule\.yaml\)/);
  });

  it('(l2) methods: outside an any rule names <stem>/rule.yaml (directory shape)', async () => {
    const dir = scratchSet({
      'ruleset.yaml': 'name: s\n',
      'rules/api/x/post/rule.yaml': 'methods: [GET, POST]\ntargetUrl: http://a\n',
    });
    await expect(buildRuleSet(dir)).rejects.toThrow(/'methods:' is only allowed in an 'any' rule \(found in post\/rule\.yaml\)/);
  });

  it('(m) method: GET in post.rule.yaml errors (conflicts with the file stem)', async () => {
    const dir = scratchSet({
      'ruleset.yaml': 'name: s\n',
      'rules/api/x/post.rule.yaml': 'method: GET\ntargetUrl: http://a\n',
    });
    await expect(buildRuleSet(dir)).rejects.toThrow(
      /method: GET conflicts with file stem 'post\.rule\.yaml' \(expected POST\)/,
    );
  });

  it('(m2) method: POST in post.rule.yaml (matching the stem) is accepted silently', async () => {
    const dir = scratchSet({
      'ruleset.yaml': 'name: s\n',
      'rules/api/x/post.rule.yaml': 'method: POST\ntargetUrl: http://a\n',
    });
    const res = await buildRuleSet(dir, { exportedAt: EXPORTED_AT });
    expect(res.export.rules[0].method).toBe('POST');
    expect(res.warnings).toEqual([]);
  });

  it('(n) method: DELETE in any.rule.yaml compiles to a DELETE rule', async () => {
    const dir = scratchSet({
      'ruleset.yaml': 'name: s\n',
      'rules/api/x/any.rule.yaml': 'method: DELETE\ntargetUrl: http://a\n',
    });
    const res = await buildRuleSet(dir, { exportedAt: EXPORTED_AT });
    expect(res.export.rules[0].method).toBe('DELETE');
    expect(res.export.rules[0].methods).toBeUndefined();
  });

  it('(n2) method: and methods: may not both be set in an any rule', async () => {
    const dir = scratchSet({
      'ruleset.yaml': 'name: s\n',
      'rules/api/x/any.rule.yaml': 'method: DELETE\nmethods: [GET, POST]\ntargetUrl: http://a\n',
    });
    await expect(buildRuleSet(dir)).rejects.toThrow(/'method:' and 'methods:' may not both be set/);
  });

  it('(o) warns when two rules land on the same order (explicit vs derived collision)', async () => {
    // a/b/c have equal literal/wildcard counts, so their derived (specificity-sort) positions
    // are 0/1/2 in lexicographic order. Giving `a` an explicit order of 2 collides with `c`'s
    // derived order of 2.
    const dir = scratchSet({
      'ruleset.yaml': 'name: s\n',
      'rules/api/a/get.rule.yaml': 'order: 2\ntargetUrl: http://a\n',
      'rules/api/b/get.rule.yaml': 'targetUrl: http://b\n',
      'rules/api/c/get.rule.yaml': 'targetUrl: http://c\n',
    });
    const res = await buildRuleSet(dir, { exportedAt: EXPORTED_AT });
    expect(res.warnings).toEqual([expect.stringContaining('multiple rules share order 2')]);
    expect(res.warnings[0]).toMatch(/api\/a\/get\.rule\.yaml.*api\/c\/get\.rule\.yaml/);
  });

  it('(p) normalizes an absent validator config to {} (backend PipelineValidatorDto.config is required); a set config is untouched', async () => {
    const dir = scratchSet({
      'ruleset.yaml': 'name: s\n',
      'rules/api/x/post.rule.yaml':
        'pipeline:\n' +
        '  steps:\n' +
        '    - name: fn\n' +
        '      handler: function_handler\n' +
        '      config: { code: "x" }\n' +
        '  validators:\n' +
        '    - type: auth_required\n' + // no config: → must compile to config: {}
        '    - type: rate_limit\n' +
        '      config: { maxRequests: 5 }\n',
    });
    const res = await buildRuleSet(dir, { exportedAt: EXPORTED_AT });
    expect(res.export.rules[0].pipelineConfig?.validators).toEqual([
      { type: 'auth_required', config: {} },
      { type: 'rate_limit', config: { maxRequests: 5 } },
    ]);
  });

  it('(p2) validator config normalization also applies on the verbatim pipelineConfig: path', async () => {
    const dir = scratchSet({
      'ruleset.yaml': 'name: s\n',
      'rules/api/x/post.rule.yaml':
        'pipelineConfig:\n' +
        '  name: p\n' +
        '  steps:\n' +
        '    - name: fn\n' +
        '      handlerType: function_handler\n' +
        '      config: { code: "x" }\n' +
        '  validators:\n' +
        '    - type: auth_required\n',
    });
    const res = await buildRuleSet(dir, { exportedAt: EXPORTED_AT });
    expect(res.export.rules[0].pipelineConfig?.validators).toEqual([{ type: 'auth_required', config: {} }]);
  });
});
