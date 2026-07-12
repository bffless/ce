import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const bin = path.resolve(fileURLToPath(import.meta.url), '../../dist/index.js');
const basicSrcDir = path.resolve('test/fixtures/synthetic/basic');
const brokenDir = path.resolve('test/fixtures/synthetic/broken/.bffless/proxy-rules/broken');

/** Copy the `basic` fixture into a scratch tmpdir so `rules build` doesn't write a `dist/`
 *  under version-controlled `test/fixtures/`. */
function scratchBasicDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'bffless-cli-test-basic-'));
  cpSync(basicSrcDir, dir, { recursive: true });
  return dir;
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Run the built bin, capturing status/stdout/stderr instead of throwing on nonzero exit. */
function run(args: string[]): RunResult {
  try {
    const stdout = execFileSync('node', [bin, ...args], { encoding: 'utf8', stdio: 'pipe' });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status: number | null; stdout: string; stderr: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/** Strip `exportedAt` before deep-equal comparison — it's a build-time timestamp. */
function withoutExportedAt(obj: Record<string, unknown>): Record<string, unknown> {
  const { exportedAt: _exportedAt, ...rest } = obj;
  return rest;
}

beforeAll(() => {
  // Ensure the bin is built before spawning it (mirrors the `pnpm build && vitest run` test script).
  if (!existsSync(bin)) {
    execFileSync('pnpm', ['build'], { cwd: path.resolve('.'), stdio: 'inherit' });
  }
});

describe('bffless rules build', () => {
  it('compiles the basic fixture to dist/<name>.proxy-rules.json + dist/.gitignore, matching expected.json modulo exportedAt', () => {
    const dir = scratchBasicDir();
    const result = run(['rules', 'build', dir]);
    expect(result.stderr, result.stderr).toBe('');
    expect(result.status).toBe(0);

    const outFile = path.join(dir, 'dist', 'basic.proxy-rules.json');
    expect(existsSync(outFile)).toBe(true);
    expect(result.stdout).toContain(outFile);
    expect(result.stdout).toMatch(/\d+ rules, \d+ schemas, \d+ secrets referenced/);

    const gitignoreFile = path.join(dir, 'dist', '.gitignore');
    expect(existsSync(gitignoreFile)).toBe(true);
    expect(readFileSync(gitignoreFile, 'utf8')).toContain('*');

    const actual = JSON.parse(readFileSync(outFile, 'utf8'));
    const expected = JSON.parse(readFileSync(path.join(basicSrcDir, 'expected.json'), 'utf8'));
    expect(withoutExportedAt(actual)).toEqual(withoutExportedAt(expected));
  });

  it('-o writes to the exact given path with no dist/.gitignore side effect', () => {
    const dir = scratchBasicDir();
    const outFile = path.join(dir, 'custom-out.json');
    const result = run(['rules', 'build', dir, '-o', outFile]);
    expect(result.status).toBe(0);
    expect(existsSync(outFile)).toBe(true);
    expect(existsSync(path.join(dir, 'dist'))).toBe(false);
  });

  it('a broken rule set fails cleanly (message, not a stack trace) with nonzero exit', () => {
    const result = run(['rules', 'build', brokenDir]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain('at buildRuleSet'); // no stack trace leaking through
  });
});

describe('bffless rules validate', () => {
  it('the basic fixture is clean: exit 0, no output issues', () => {
    const result = run(['rules', 'validate', basicSrcDir]);
    expect(result.status).toBe(0);
  });

  it('the broken fixture exits 1 and prints the known dangling-ref/invalid-manifest issues', () => {
    const result = run(['rules', 'validate', brokenDir]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('notARealKey');
    expect(result.stderr).toMatch(/rules[\\/]api[\\/]a[\\/]post\.rule\.yaml/);
  });
});

describe('bffless rules test', () => {
  it('the basic fixture passes: exit 0, prints "<n> passed, 0 failed"', () => {
    const result = run(['rules', 'test', basicSrcDir]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/\d+ passed, 0 failed/);
  });
});

describe('bffless rules pull', () => {
  it('without --from-file and without a set name exits 1 with a usage error', () => {
    const result = run(['rules', 'pull']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('a set name is required for a live pull');
  });

  it('--from-file <expected.json> --decompile -o <tmp> recreates the authoring layout, and a follow-up build round-trips', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'bffless-cli-test-pull-'));
    const fromFile = path.join(basicSrcDir, 'expected.json');
    const pullResult = run(['rules', 'pull', '--from-file', fromFile, '--decompile', '-o', outDir]);
    expect(pullResult.stderr, pullResult.stderr).toBe('');
    expect(pullResult.status).toBe(0);
    expect(pullResult.stdout).toContain(outDir);

    expect(existsSync(path.join(outDir, 'ruleset.yaml'))).toBe(true);
    expect(existsSync(path.join(outDir, 'rules'))).toBe(true);
    expect(existsSync(path.join(outDir, 'schemas', 'items.schema.yaml'))).toBe(true);

    const buildResult = run(['rules', 'build', outDir]);
    expect(buildResult.stderr, buildResult.stderr).toBe('');
    expect(buildResult.status).toBe(0);

    const rebuilt = JSON.parse(readFileSync(path.join(outDir, 'dist', 'basic.proxy-rules.json'), 'utf8'));
    const expected = JSON.parse(readFileSync(fromFile, 'utf8'));
    expect(withoutExportedAt(rebuilt)).toEqual(withoutExportedAt(expected));
  });

  it('refuses to write into a non-empty output dir without --force', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'bffless-cli-test-pull-nonempty-'));
    cpSync(basicSrcDir, outDir, { recursive: true }); // pre-populate so the dir is non-empty
    const fromFile = path.join(basicSrcDir, 'expected.json');
    const result = run(['rules', 'pull', '--from-file', fromFile, '--decompile', '-o', outDir]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/non-empty directory/);
  });
});

describe('bffless rules — multiple dirs', () => {
  it('validate aggregates across dirs: one broken among two fails the whole run', () => {
    const result = run(['rules', 'validate', basicSrcDir, brokenDir]);
    expect(result.status).toBe(1);
    // Per-dir headers when more than one dir is resolved.
    expect(result.stdout + result.stderr).toContain(basicSrcDir);
    expect(result.stdout + result.stderr).toContain(brokenDir);
  });
});

describe('bffless rules — dist artifacts are not left under version-controlled fixtures', () => {
  it('test/fixtures/synthetic/basic has no dist/ directory on disk', () => {
    expect(existsSync(path.join(basicSrcDir, 'dist'))).toBe(false);
    if (existsSync(basicSrcDir)) {
      expect(readdirSync(basicSrcDir)).not.toContain('dist');
    }
  });
});
