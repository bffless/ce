import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runFnTests } from '../src/commands/test.js';

const basicDir = path.resolve('test/fixtures/synthetic/basic');

/** Materialize a throwaway rule set from a { relpath: contents } map and return its dir,
 *  mirroring the `scratchSet` helper in build.test.ts / validate.test.ts. */
function scratchSet(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'bffless-rules-test-'));
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents, 'utf8');
  }
  return dir;
}

describe('runFnTests — basic fixture', () => {
  it('reports 2 passed, 0 failed', async () => {
    const result = await runFnTests(basicDir);
    expect(result.failed).toEqual([]);
    expect(result.passed).toBe(2);
  });
});

describe('runFnTests — wrong expectation', () => {
  it('reports the case name and a readable expected-vs-actual message', async () => {
    const dir = scratchSet({
      'rules/api/x/post/add.fn.js': 'function handler({ steps }) { return steps.n + 1; }',
      'rules/api/x/post/add.fn.test.yaml': [
        'handler: ./add.fn.js',
        'cases:',
        '  - name: adds one',
        '    data: { steps: { n: 1 } }',
        '    expect: { result: 999 }',
        '',
      ].join('\n'),
    });

    const result = await runFnTests(dir);
    expect(result.passed).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].case).toBe('adds one');
    // Readable: mentions both the expected and actual values.
    expect(result.failed[0].message).toContain('999');
    expect(result.failed[0].message).toContain('2');
  });

  it('reports a mismatched `expect.throws` substring with both strings', async () => {
    const dir = scratchSet({
      'rules/api/y/post/boom.fn.js': "function handler() { throw new Error('nope'); }",
      'rules/api/y/post/boom.fn.test.yaml': [
        'handler: ./boom.fn.js',
        'cases:',
        '  - name: throws the wrong thing',
        '    expect: { throws: "totally different" }',
        '',
      ].join('\n'),
    });

    const result = await runFnTests(dir);
    expect(result.passed).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].case).toBe('throws the wrong thing');
    expect(result.failed[0].message).toContain('totally different');
    expect(result.failed[0].message).toContain('nope');
  });
});

describe('runFnTests — missing handler file', () => {
  it('fails only that file’s cases, and other fixture files still run', async () => {
    const dir = scratchSet({
      // File A: handler ref does not exist on disk.
      'rules/api/a/post/missing.fn.test.yaml': [
        'handler: ./nope.fn.js',
        'cases:',
        '  - name: case one',
        '    expect: { result: 1 }',
        '  - name: case two',
        '    expect: { result: 2 }',
        '',
      ].join('\n'),
      // File B: valid handler + passing case, in a sibling directory.
      'rules/api/b/post/ok.fn.js': 'function handler() { return 42; }',
      'rules/api/b/post/ok.fn.test.yaml': [
        'handler: ./ok.fn.js',
        'cases:',
        '  - name: returns 42',
        '    expect: { result: 42 }',
        '',
      ].join('\n'),
    });

    const result = await runFnTests(dir);

    // File B's case still ran and passed.
    expect(result.passed).toBe(1);

    // File A's two cases are both surfaced as failures (not a single aborted run).
    expect(result.failed).toHaveLength(2);
    const names = result.failed.map((f) => f.case).sort();
    expect(names).toEqual(['case one', 'case two']);
    for (const f of result.failed) {
      expect(f.file).toBe(path.join('rules', 'api', 'a', 'post', 'missing.fn.test.yaml'));
      expect(f.message).toContain('nope.fn.js');
    }
  });
});
