import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bundleHandler } from '../src/compile/bundle.js';
import { validateHandlerSource } from '../src/lint/patterns.js';
import { runHandler } from '../src/harness/run-handler.js';

/** Some restricted environments (e.g. certain CI/container setups) can't create symlinks.
 *  Probe once at module load so the symlink-confinement test can skip gracefully rather than
 *  fail on an unrelated environment limitation. (Mirrors test/build.test.ts.) */
const canSymlink = (() => {
  const probeDir = mkdtempSync(path.join(tmpdir(), 'bffless-bundle-test-symlink-probe-'));
  try {
    symlinkSync(path.join(probeDir, 'target'), path.join(probeDir, 'link'));
    return true;
  } catch {
    return false;
  }
})();

/** Materialize a throwaway rule set dir from a { relpath: contents } map. */
function scratchSet(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'bffless-bundle-test-'));
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents, 'utf8');
  }
  return dir;
}

describe('bundleHandler', () => {
  it('(a) inlines a relative import; the bundle passes lint and executes via the harness proving the util ran', async () => {
    const dir = scratchSet({
      'rules/api/x/handler.fn.ts':
        "import { greet } from './util.js';\n" + 'export default function handler(ctx) {\n  return greet(ctx.request.path);\n}\n',
      'rules/api/x/util.ts': 'export function greet(name) {\n  return `hello ${name}`;\n}\n',
    });
    const entry = path.join(dir, 'rules/api/x/handler.fn.ts');
    const { code, warnings } = await bundleHandler(entry, dir);

    expect(warnings).toEqual([]);
    expect(validateHandlerSource(code)).toEqual([]);

    const { result } = await runHandler(code, { request: { path: 'world' } });
    expect(result).toBe('hello world');
  });

  it('(a2) extensionless relative import also resolves (author writes "./util" with no extension)', async () => {
    const dir = scratchSet({
      'rules/api/x/handler.fn.ts':
        "import { greet } from './util';\n" + 'export default function handler(ctx) {\n  return greet(ctx.request.path);\n}\n',
      'rules/api/x/util.ts': 'export function greet(name) {\n  return `hi ${name}`;\n}\n',
    });
    const entry = path.join(dir, 'rules/api/x/handler.fn.ts');
    const { code } = await bundleHandler(entry, dir);
    const { result } = await runHandler(code, { request: { path: 'there' } });
    expect(result).toBe('hi there');
  });

  it('(b) a bare (non-relative) import is a build-time error naming the specifier', async () => {
    const dir = scratchSet({
      'rules/api/x/handler.fn.ts': "import { z } from 'zod';\nexport default function handler(ctx) {\n  return z;\n}\n",
    });
    const entry = path.join(dir, 'rules/api/x/handler.fn.ts');
    await expect(bundleHandler(entry, dir)).rejects.toThrow(
      /only relative imports within the rule-set directory are supported in \.fn\.ts handlers.*zod/,
    );
  });

  it('(c) an import escaping the rule set directory via ../ traversal is a confinement error', async () => {
    const dir = scratchSet({
      'rules/api/x/handler.fn.ts':
        "import { x } from '../../../../etc/passwd';\nexport default function handler(ctx) {\n  return x;\n}\n",
    });
    const entry = path.join(dir, 'rules/api/x/handler.fn.ts');
    await expect(bundleHandler(entry, dir)).rejects.toThrow(/file reference escapes the rule set directory/);
  });

  it.skipIf(!canSymlink)(
    '(d) an import resolving (lexically inside setDir) through a symlink pointing outside setDir is a confinement error',
    async () => {
      const dir = scratchSet({
        'rules/api/x/handler.fn.ts':
          "import { x } from './link.js';\nexport default function handler(ctx) {\n  return x;\n}\n",
      });
      const outsideDir = mkdtempSync(path.join(tmpdir(), 'bffless-bundle-test-outside-'));
      const secretFile = path.join(outsideDir, 'secret.ts');
      writeFileSync(secretFile, 'export const x = "host secret";\n', 'utf8');
      const linkPath = path.join(dir, 'rules/api/x/link.ts');
      symlinkSync(secretFile, linkPath);

      const entry = path.join(dir, 'rules/api/x/handler.fn.ts');
      await expect(bundleHandler(entry, dir)).rejects.toThrow(/file reference escapes the rule set directory/);
    },
  );

  it('(e) a named (non-default) "export function handler" also bundles and runs', async () => {
    const dir = scratchSet({
      'rules/api/x/handler.fn.ts': 'export function handler(ctx) {\n  return ctx.request.path + "!";\n}\n',
    });
    const entry = path.join(dir, 'rules/api/x/handler.fn.ts');
    const { code } = await bundleHandler(entry, dir);
    expect(validateHandlerSource(code)).toEqual([]);
    const { result } = await runHandler(code, { request: { path: 'ok' } });
    expect(result).toBe('ok!');
  });

  it('(f) an entry with neither a default nor a named "handler" export is a bundle-time error', async () => {
    const dir = scratchSet({
      'rules/api/x/handler.fn.ts': 'export function notHandler(ctx) {\n  return ctx;\n}\n',
    });
    const entry = path.join(dir, 'rules/api/x/handler.fn.ts');
    await expect(bundleHandler(entry, dir)).rejects.toThrow(/no default or named "handler" export/);
  });

  it('(g) sourcemap: true attaches an inline source map comment; default/false omits it', async () => {
    const dir = scratchSet({
      'rules/api/x/handler.fn.ts': 'export default function handler(ctx) {\n  return 1;\n}\n',
    });
    const entry = path.join(dir, 'rules/api/x/handler.fn.ts');

    const withMap = await bundleHandler(entry, dir, { sourcemap: true });
    expect(withMap.code).toMatch(/\/\/# sourceMappingURL=data:/);

    const withoutMap = await bundleHandler(entry, dir);
    expect(withoutMap.code).not.toMatch(/sourceMappingURL/);
  });

  it('(h) an entry file outside the rule set directory is rejected before any bundling occurs', async () => {
    const dir = scratchSet({ 'ruleset.yaml': 'name: s\n' });
    const outsideDir = mkdtempSync(path.join(tmpdir(), 'bffless-bundle-test-outside-entry-'));
    const outsideEntry = path.join(outsideDir, 'handler.fn.ts');
    writeFileSync(outsideEntry, 'export default function handler(ctx) {\n  return 1;\n}\n', 'utf8');

    await expect(bundleHandler(outsideEntry, dir)).rejects.toThrow(/outside the rule set directory/);
  });
});
