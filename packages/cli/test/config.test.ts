import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findConfig, resolveRuleSetDirs, BfflessConfigSchema } from '../src/config.js';

function scratchTree(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'bffless-config-test-'));
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents, 'utf8');
  }
  return dir;
}

describe('BfflessConfigSchema', () => {
  it('accepts an empty object (all keys optional)', () => {
    expect(BfflessConfigSchema.parse({})).toEqual({});
  });

  it('accepts apiUrl/project/ruleSets', () => {
    const cfg = { apiUrl: 'https://x.example', project: 'p', ruleSets: ['.bffless/proxy-rules/*'] };
    expect(BfflessConfigSchema.parse(cfg)).toEqual(cfg);
  });

  it('rejects an unknown key (strict)', () => {
    expect(() => BfflessConfigSchema.parse({ bogus: true })).toThrow();
  });
});

describe('findConfig', () => {
  it('returns null when no .bffless/config.json exists above cwd', () => {
    const dir = scratchTree({ 'placeholder.txt': 'x' });
    expect(findConfig(dir)).toBeNull();
  });

  it('finds the nearest config, not an outer one, when walking up', () => {
    const dir = scratchTree({
      '.bffless/config.json': JSON.stringify({ project: 'outer' }),
      'sub/.bffless/config.json': JSON.stringify({ project: 'inner' }),
      'sub/deeper/placeholder.txt': 'x',
    });
    const found = findConfig(path.join(dir, 'sub', 'deeper'));
    expect(found).not.toBeNull();
    expect(found!.config.project).toBe('inner');
    expect(found!.path).toBe(path.join(dir, 'sub', '.bffless', 'config.json'));
  });

  it('walks up past directories with no config to find one further up', () => {
    const dir = scratchTree({
      '.bffless/config.json': JSON.stringify({ project: 'root' }),
      'a/b/c/placeholder.txt': 'x',
    });
    const found = findConfig(path.join(dir, 'a', 'b', 'c'));
    expect(found).not.toBeNull();
    expect(found!.config.project).toBe('root');
  });

  it('throws with the file path when config.json is invalid JSON', () => {
    const dir = scratchTree({ '.bffless/config.json': '{ not json' });
    expect(() => findConfig(dir)).toThrow(/config\.json/);
  });

  it('throws when config.json fails schema validation', () => {
    const dir = scratchTree({ '.bffless/config.json': JSON.stringify({ bogus: true }) });
    expect(() => findConfig(dir)).toThrow(/bogus/);
  });
});

describe('resolveRuleSetDirs — explicit args', () => {
  it('resolves explicit args relative to cwd and ignores any config', () => {
    const dir = scratchTree({
      '.bffless/config.json': JSON.stringify({ ruleSets: ['.bffless/proxy-rules/*'] }),
      'my-set/ruleset.yaml': 'name: my-set\n',
    });
    const dirs = resolveRuleSetDirs(dir, ['my-set']);
    expect(dirs).toEqual([path.resolve(dir, 'my-set')]);
  });

  it('throws when an explicit arg has no ruleset.yaml', () => {
    const dir = scratchTree({ 'not-a-set/placeholder.txt': 'x' });
    expect(() => resolveRuleSetDirs(dir, ['not-a-set'])).toThrow(/ruleset\.yaml/);
  });
});

describe('resolveRuleSetDirs — no args, no config', () => {
  it('throws a helpful error', () => {
    const dir = scratchTree({ 'placeholder.txt': 'x' });
    expect(() => resolveRuleSetDirs(dir, [])).toThrow(/No rule set directories/);
  });
});

describe('resolveRuleSetDirs — config ruleSets globs', () => {
  it('expands single-* globs and filters out matches with no ruleset.yaml', () => {
    const dir = scratchTree({
      '.bffless/config.json': JSON.stringify({
        ruleSets: ['.bffless/proxy-rules/*', 'apps/*/.bffless/proxy-rules/*'],
      }),
      '.bffless/proxy-rules/foo/ruleset.yaml': 'name: foo\n',
      '.bffless/proxy-rules/bar/placeholder.txt': 'x', // matches the glob, but no ruleset.yaml — filtered
      'apps/myapp/.bffless/proxy-rules/baz/ruleset.yaml': 'name: baz\n',
    });
    const dirs = resolveRuleSetDirs(dir, []);
    expect(dirs).toEqual(
      [
        path.join(dir, '.bffless', 'proxy-rules', 'foo'),
        path.join(dir, 'apps', 'myapp', '.bffless', 'proxy-rules', 'baz'),
      ].sort(),
    );
  });

  it('resolves globs relative to the config file\'s own directory, not cwd', () => {
    const dir = scratchTree({
      '.bffless/config.json': JSON.stringify({ ruleSets: ['.bffless/proxy-rules/*'] }),
      '.bffless/proxy-rules/foo/ruleset.yaml': 'name: foo\n',
      'nested/placeholder.txt': 'x',
    });
    // cwd is a subdirectory with no config of its own — findConfig walks up to `dir`,
    // and the glob must resolve against `dir`, not `dir/nested`.
    const dirs = resolveRuleSetDirs(path.join(dir, 'nested'), []);
    expect(dirs).toEqual([path.join(dir, '.bffless', 'proxy-rules', 'foo')]);
  });

  it('throws a helpful error when the nearest config has no ruleSets', () => {
    const dir = scratchTree({ '.bffless/config.json': JSON.stringify({ project: 'p' }) });
    expect(() => resolveRuleSetDirs(dir, [])).toThrow(/No rule set directories/);
  });
});
