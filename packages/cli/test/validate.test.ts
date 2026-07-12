import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateRuleSet } from '../src/commands/validate.js';

const basicDir = path.resolve('test/fixtures/synthetic/basic');
const brokenDir = path.resolve('test/fixtures/synthetic/broken/.bffless/proxy-rules/broken');
const tsHandlersDir = path.resolve('test/fixtures/synthetic/ts-handlers');

function scratchSet(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'bffless-validate-test-'));
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents, 'utf8');
  }
  return dir;
}

describe('validateRuleSet — basic fixture (clean)', () => {
  it('yields zero errors and zero warnings', async () => {
    const { errors, warnings } = await validateRuleSet(basicDir);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });
});

describe('validateRuleSet — ts-handlers fixture (clean .fn.ts)', () => {
  it('yields zero errors and zero warnings (a .fn.ts handler with a relative import lints clean)', async () => {
    const { errors, warnings } = await validateRuleSet(tsHandlersDir);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });
});

describe('validateRuleSet — a .fn.ts whose bundle violates a prohibited pattern', () => {
  it('flags the process.env access (in an imported util) against the bundle, pointing at the .fn.ts source', async () => {
    const dir = scratchSet({
      'ruleset.yaml': 'name: s\n',
      'rules/api/x/post.rule.yaml': [
        'pipeline:',
        '  steps:',
        '    - name: fn',
        '      handler: function_handler',
        '      code: ./bad.fn.ts',
        '',
      ].join('\n'),
      'rules/api/x/bad.fn.ts': [
        "import { leak } from './util.js';",
        'export default function handler(ctx) {',
        '  return leak();',
        '}',
        '',
      ].join('\n'),
      // Raw TS source has no `process.` — the violation is only visible once the util is
      // inlined by bundling, which is exactly why validate must lint the BUNDLE, not the
      // raw .fn.ts text (the regexes can't see across an import statement).
      'rules/api/x/util.ts': ['export function leak() {', '  return process.env.SECRET;', '}', ''].join('\n'),
    });

    const { errors } = await validateRuleSet(dir);
    const issue = errors.find((e) => e.file === path.join('rules', 'api', 'x', 'bad.fn.ts'));
    expect(issue, JSON.stringify(errors, null, 2)).toBeTruthy();
    expect(issue!.message).toMatch(/Prohibited pattern/);
  });
});

describe('validateRuleSet — not a rule set', () => {
  it('reports a single error when ruleset.yaml is missing', async () => {
    const dir = scratchSet({ 'placeholder.txt': 'x' });
    const { errors } = await validateRuleSet(dir);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/no ruleset\.yaml/);
  });
});

describe('validateRuleSet — broken fixture (five distinct issues)', () => {
  it('yields exactly five errors and zero warnings', async () => {
    const { errors, warnings } = await validateRuleSet(brokenDir);
    expect(warnings).toEqual([]);
    expect(errors).toHaveLength(5);
  });

  it('(a) flags the zod-invalid manifest (unknown key)', async () => {
    const { errors } = await validateRuleSet(brokenDir);
    const issue = errors.find((e) => e.file === path.join('rules', 'api', 'a', 'post.rule.yaml'));
    expect(issue, JSON.stringify(errors, null, 2)).toBeTruthy();
    expect(issue!.message).toMatch(/notARealKey/);
  });

  it('(b) flags the dangling code: ref', async () => {
    const { errors } = await validateRuleSet(brokenDir);
    const issue = errors.find((e) => e.file === path.join('rules', 'api', 'b', 'post.rule.yaml'));
    expect(issue, JSON.stringify(errors, null, 2)).toBeTruthy();
    expect(issue!.message).toMatch(/code file not found.*missing\.js/);
  });

  it('(c) flags the unresolved $schema:nope ref', async () => {
    const { errors } = await validateRuleSet(brokenDir);
    const issue = errors.find((e) => e.file === path.join('rules', 'api', 'c', 'post.rule.yaml'));
    expect(issue, JSON.stringify(errors, null, 2)).toBeTruthy();
    expect(issue!.message).toMatch(/\$schema:nope/);
    expect(issue!.message).toMatch(/nope\.schema\.yaml/);
  });

  it('(d) flags the process.env access in the .fn.js handler', async () => {
    const { errors } = await validateRuleSet(brokenDir);
    const issue = errors.find((e) => e.file === path.join('rules', 'api', 'd', 'post', 'bad.fn.js'));
    expect(issue, JSON.stringify(errors, null, 2)).toBeTruthy();
    expect(issue!.message).toMatch(/Prohibited pattern/);
    expect(issue!.line).toBe(2);
  });

  it('(e) flags the missing "does-not-exist" skill against the real skills root', async () => {
    const { errors } = await validateRuleSet(brokenDir);
    const issue = errors.find((e) => /does-not-exist/.test(e.message));
    expect(issue, JSON.stringify(errors, null, 2)).toBeTruthy();
    expect(issue!.file).toBe(path.join('rules', 'api', 'e', 'post.rule.yaml'));
    expect(issue!.message).toMatch(/not found in .*skills/);
  });
});

describe('validateRuleSet — dedup by (file, message), not file alone', () => {
  it('a manifest with both a committed header secret and a dangling code ref reports BOTH', async () => {
    const dir = scratchSet({
      '.bffless/proxy-rules/myset/ruleset.yaml': 'name: myset\n',
      '.bffless/proxy-rules/myset/rules/api/x/post.rule.yaml': [
        'headerConfig:',
        '  add:',
        '    X-Api-Key: shhh-secret-value',
        'pipeline:',
        '  steps:',
        '    - name: fn',
        '      handler: function_handler',
        '      code: ./missing.js',
        '',
      ].join('\n'),
    });
    const setDir = path.join(dir, '.bffless', 'proxy-rules', 'myset');
    const { errors } = await validateRuleSet(setDir);
    const file = path.join('rules', 'api', 'x', 'post.rule.yaml');
    const fileErrors = errors.filter((e) => e.file === file);
    expect(fileErrors, JSON.stringify(errors, null, 2)).toHaveLength(2);
    expect(fileErrors.some((e) => /code file not found.*missing\.js/.test(e.message))).toBe(true);
    expect(fileErrors.some((e) => /secret values must not be committed/.test(e.message))).toBe(true);
  });
});

describe('validateRuleSet — code: ref confinement', () => {
  it('a code: ref that escapes the set dir but resolves to an existing file is flagged, not silently passed', async () => {
    const outsideDir = mkdtempSync(path.join(tmpdir(), 'bffless-validate-outside-'));
    const outsideFile = path.join(outsideDir, 'outside.js');
    writeFileSync(outsideFile, 'module.exports = () => {};\n', 'utf8');

    const dir = scratchSet({
      '.bffless/proxy-rules/myset/ruleset.yaml': 'name: myset\n',
    });
    const setDir = path.join(dir, '.bffless', 'proxy-rules', 'myset');
    const manifestDir = path.join(setDir, 'rules', 'api', 'x');
    mkdirSync(manifestDir, { recursive: true });
    const ref = path.relative(manifestDir, outsideFile);
    writeFileSync(
      path.join(manifestDir, 'post.rule.yaml'),
      ['pipeline:', '  steps:', '    - name: fn', '      handler: function_handler', `      code: ${ref}`, ''].join('\n'),
      'utf8',
    );

    const { errors } = await validateRuleSet(setDir);
    const file = path.join('rules', 'api', 'x', 'post.rule.yaml');
    const issue = errors.find((e) => e.file === file && /escapes the rule set directory/.test(e.message));
    expect(issue, JSON.stringify(errors, null, 2)).toBeTruthy();
  });
});

describe('validateRuleSet — skills cross-ref', () => {
  const AI_RULE = [
    'pipeline:',
    '  steps:',
    '    - name: chat',
    '      handler: ai_handler',
    '      config:',
    '        skills:',
    '          mode: selected',
    '          enabled:',
    '            - some-skill',
    '',
  ].join('\n');

  it('error branch: a skills root exists but the named skill dir does not', async () => {
    const dir = scratchSet({
      '.bffless/proxy-rules/myset/ruleset.yaml': 'name: myset\n',
      '.bffless/proxy-rules/myset/rules/api/chat/post.rule.yaml': AI_RULE,
      '.bffless/skills/other-skill/SKILL.md': '# other-skill\n',
    });
    const setDir = path.join(dir, '.bffless', 'proxy-rules', 'myset');
    const { errors, warnings } = await validateRuleSet(setDir);
    expect(warnings).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/skill "some-skill" not found/);
  });

  it('warning branch: no .bffless/proxy-rules/ ancestor at all → warns instead of erroring', async () => {
    const dir = scratchSet({
      'ruleset.yaml': 'name: myset\n',
      'rules/api/chat/post.rule.yaml': AI_RULE,
    });
    const { errors, warnings } = await validateRuleSet(dir);
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/skills unresolved/);
    expect(warnings[0].message).toMatch(/some-skill/);
  });

  it('a rule set with no skill refs at all triggers neither branch', async () => {
    const dir = scratchSet({
      'ruleset.yaml': 'name: myset\n',
      'rules/api/x/get.rule.yaml': 'targetUrl: http://example.com\n',
    });
    const { errors, warnings } = await validateRuleSet(dir);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
