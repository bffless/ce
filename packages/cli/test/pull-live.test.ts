import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runPull } from '../src/commands/pull.js';
import { API_URL, PROJECT_UUID, SET_UUID, happyRoutes, readBasicExpected, stubFetch } from './live-helpers.js';
import type { PullDeps } from '../src/commands/pull.js';

const config = { apiUrl: API_URL, project: 'proj' };
const env = { BFFLESS_API_KEY: 'k-test' };

function deps(routes: Parameters<typeof stubFetch>[0]): PullDeps & { calls: ReturnType<typeof stubFetch>['calls'] } {
  const { fetchImpl, calls } = stubFetch(routes);
  return { fetchImpl, env, config, calls };
}

function scratchDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'bffless-pull-live-'));
}

describe('rules pull — live path', () => {
  it('happy path: resolves project by name, set by name, fetches the export, and writes the authoring layout', async () => {
    const d = deps(happyRoutes(readBasicExpected()));
    const outDir = path.join(scratchDir(), 'out');
    const result = await runPull('basic', { output: outDir }, '/nowhere', d);

    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.outDir).toBe(path.resolve('/nowhere', outDir));
    expect(existsSync(path.join(outDir, 'ruleset.yaml'))).toBe(true);
    expect(existsSync(path.join(outDir, 'rules'))).toBe(true);
    expect(existsSync(path.join(outDir, 'schemas', 'items.schema.yaml'))).toBe(true);

    // Verify the live pull hit exactly the three expected endpoints, with the API key.
    expect(d.calls.map((c) => c.url)).toEqual([
      `${API_URL}/api/projects`,
      `${API_URL}/api/proxy-rule-sets/project/${PROJECT_UUID}`,
      `${API_URL}/api/proxy-rule-sets/${SET_UUID}/export`,
    ]);
    for (const call of d.calls) {
      expect((call.init?.headers as Record<string, string>)['X-API-Key']).toBe('k-test');
    }
  });

  it('defaults the output dir to <cwd>/.bffless/proxy-rules/<ruleSet.name>', async () => {
    const d = deps(happyRoutes(readBasicExpected()));
    const cwd = scratchDir();
    const result = await runPull('basic', {}, cwd, d);
    expect(result.ok, result.error).toBe(true);
    expect(result.outDir).toBe(path.join(cwd, '.bffless', 'proxy-rules', 'basic'));
    expect(existsSync(path.join(cwd, '.bffless', 'proxy-rules', 'basic', 'ruleset.yaml'))).toBe(true);
  });

  it('a project UUID in config skips the projects list endpoint', async () => {
    const routes = happyRoutes(readBasicExpected());
    delete routes[`GET ${API_URL}/api/projects`]; // stubFetch would throw if it were called
    const { fetchImpl } = stubFetch(routes);
    const outDir = path.join(scratchDir(), 'out');
    const result = await runPull(
      'basic',
      { output: outDir },
      '/nowhere',
      { fetchImpl, env, config: { apiUrl: API_URL, project: PROJECT_UUID } },
    );
    expect(result.ok, result.error).toBe(true);
  });

  it('an unknown set name fails, naming the URL tried and the available sets', async () => {
    const d = deps(happyRoutes(readBasicExpected()));
    const result = await runPull('missing-set', { output: path.join(scratchDir(), 'out') }, '/nowhere', d);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/rule set "missing-set" not found via GET .*Available rule sets: basic/);
  });

  it('a 403 on export surfaces the auth hint (X-API-Key / BFFLESS_API_KEY)', async () => {
    const routes = happyRoutes(readBasicExpected());
    routes[`GET ${API_URL}/api/proxy-rule-sets/${SET_UUID}/export`] = { status: 403, body: {} };
    const d = deps(routes);
    const result = await runPull('basic', { output: path.join(scratchDir(), 'out') }, '/nowhere', d);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/X-API-Key/);
  });

  it('without an API key the error explains the flag/env sources', async () => {
    const result = await runPull('basic', {}, '/nowhere', {
      fetchImpl: stubFetch({}).fetchImpl,
      env: {},
      config,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/--api-key or set BFFLESS_API_KEY/);
  });

  it('refuses a non-empty output dir without --force, honors --force', async () => {
    const outDir = path.join(scratchDir(), 'out');
    const first = await runPull('basic', { output: outDir }, '/nowhere', deps(happyRoutes(readBasicExpected())));
    expect(first.ok, first.error).toBe(true);

    const second = await runPull('basic', { output: outDir }, '/nowhere', deps(happyRoutes(readBasicExpected())));
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/non-empty directory/);

    const forced = await runPull(
      'basic',
      { output: outDir, force: true },
      '/nowhere',
      deps(happyRoutes(readBasicExpected())),
    );
    expect(forced.ok, forced.error).toBe(true);
  });
});

describe('rules pull — from-file backward compatibility (unit level)', () => {
  it('still requires --decompile with --from-file', async () => {
    const result = await runPull(undefined, { fromFile: 'x.json' }, '/nowhere', { env: {}, config: null });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/--decompile is required alongside --from-file/);
  });

  it('rejects combining a set name with --from-file', async () => {
    const result = await runPull('basic', { fromFile: 'x.json', decompile: true }, '/nowhere', {
      env: {},
      config: null,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/mutually exclusive/);
  });

  it('without a set name and without --from-file explains both usages', async () => {
    const result = await runPull(undefined, {}, '/nowhere', { env: {}, config: null });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/set name is required for a live pull.*--from-file/s);
  });
});
