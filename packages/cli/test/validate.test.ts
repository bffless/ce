import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateRuleSet } from '../src/commands/validate.js';

const basicDir = path.resolve('test/fixtures/synthetic/basic');
const brokenDir = path.resolve('test/fixtures/synthetic/broken/.bffless/proxy-rules/broken');

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
