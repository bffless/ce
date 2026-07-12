import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runDev } from '../src/commands/dev.js';
import type { DevWatcher } from '../src/commands/dev.js';
import type { PushDeps } from '../src/commands/push.js';
import type { SyncResponse, SyncRequestBody } from '../src/api/sync-types.js';
import { API_URL, PROJECT_UUID, SET_UUID, stubFetch } from './live-helpers.js';

/** A minimal-but-real rule set: one route, one function_handler, one passing fixture case.
 *  Written fresh per test (not the shared `basic` fixture) so each test can freely mutate
 *  its own files — including making the build red — without touching version-controlled
 *  fixtures or other tests. */
function scratchSet(name: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `bffless-dev-test-${name}-`));
  mkdirSync(path.join(dir, 'rules/api/hello/get'), { recursive: true });
  writeFileSync(path.join(dir, 'ruleset.yaml'), `name: ${name}\n`, 'utf8');
  writeFileSync(
    path.join(dir, 'rules/api/hello/get/rule.yaml'),
    'pipeline:\n  steps:\n    - name: fn\n      handler: function_handler\n      code: hello.fn.js\n',
    'utf8',
  );
  writeFileSync(path.join(dir, 'rules/api/hello/get/hello.fn.js'), 'function handler() { return { ok: true }; }\n', 'utf8');
  writeFileSync(
    path.join(dir, 'rules/api/hello/get/hello.fn.test.yaml'),
    'handler: ./hello.fn.js\ncases:\n  - name: returns ok\n    data: {}\n    expect: { result: { ok: true } }\n',
    'utf8',
  );
  return dir;
}

/** Breaks the rule set so `buildOne` fails: rewrite the manifest to reference a
 *  nonexistent code file. */
function breakSet(dir: string): void {
  writeFileSync(
    path.join(dir, 'rules/api/hello/get/rule.yaml'),
    'pipeline:\n  steps:\n    - name: fn\n      handler: function_handler\n      code: missing.fn.js\n',
    'utf8',
  );
}

/** Restores the rule set to the green state `scratchSet` originally wrote. */
function fixSet(dir: string): void {
  writeFileSync(
    path.join(dir, 'rules/api/hello/get/rule.yaml'),
    'pipeline:\n  steps:\n    - name: fn\n      handler: function_handler\n      code: hello.fn.js\n',
    'utf8',
  );
}

/** A fake `DevWatcher`: no real fs watching, just an emit hook for tests to fire `change`
 *  events on and a spy for `close()`. */
function fakeWatcher(): { watcher: DevWatcher; emit: (file: string) => void; close: ReturnType<typeof vi.fn> } {
  let cb: ((file: string) => void) | undefined;
  const close = vi.fn(async () => {});
  return {
    watcher: {
      on: (event, handler) => {
        if (event === 'change') cb = handler;
      },
      close,
    },
    emit: (file: string) => cb?.(file),
    close,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Short enough to keep tests fast, long enough to reliably separate "coalesced" from
 *  "separate" timer fires under CI jitter. */
const DEBOUNCE_MS = 10;
const SETTLE_MS = DEBOUNCE_MS * 4;

const SYNC_URL = `${API_URL}/api/proxy-rule-sets/project/${PROJECT_UUID}/sync`;
const noGit: PushDeps['execGit'] = () => {
  throw new Error('git unavailable');
};

function syncResponse(overrides?: Partial<SyncResponse>): SyncResponse {
  return {
    ruleSetId: SET_UUID,
    created: [],
    updated: [],
    deleted: [],
    unchanged: [],
    pruneCandidates: [],
    schemaResolutions: [],
    missingSecrets: [],
    warnings: [],
    dryRun: false,
    setCreated: false,
    ...overrides,
  };
}

function pushDeps(response: SyncResponse): PushDeps & { sentBodies: () => SyncRequestBody[] } {
  const { fetchImpl, calls } = stubFetch({ [`PUT ${SYNC_URL}`]: { body: response } });
  return {
    fetchImpl,
    env: { BFFLESS_API_KEY: 'k-test' },
    config: { apiUrl: API_URL, project: PROJECT_UUID },
    execGit: noGit,
    sentBodies: () => calls.map((c) => JSON.parse(c.init?.body as string) as SyncRequestBody),
  };
}

describe('runDev', () => {
  it('runs an initial pass for every resolved dir', async () => {
    const dirA = scratchSet('a');
    const dirB = scratchSet('b');
    const { watcher } = fakeWatcher();
    const factory = vi.fn(() => watcher);
    const log = vi.fn();

    const handle = await runDev([dirA, dirB], {}, '/nowhere', { createWatcher: factory, log, debounceMs: DEBOUNCE_MS });

    expect(log).toHaveBeenCalledTimes(2);
    const lines = log.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.includes(path.basename(dirA)))).toBe(true);
    expect(lines.some((l) => l.includes(path.basename(dirB)))).toBe(true);
    for (const line of lines) {
      expect(line).toMatch(/^\[\d\d:\d\d:\d\d\] \S+ ✓ build ✓ validate ✓ 1 tests$/);
    }
    expect(factory).toHaveBeenCalledWith([path.resolve(dirA), path.resolve(dirB)]);

    await handle.close();
  });

  it('a change under set X reruns only X after debounce', async () => {
    const dirA = scratchSet('resx-a');
    const dirB = scratchSet('resx-b');
    const { watcher, emit } = fakeWatcher();
    const log = vi.fn();

    const handle = await runDev([dirA, dirB], {}, '/nowhere', {
      createWatcher: () => watcher,
      log,
      debounceMs: DEBOUNCE_MS,
    });
    log.mockClear();

    emit(path.join(dirA, 'rules/api/hello/get/hello.fn.js'));
    await sleep(SETTLE_MS);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain(path.basename(dirA));
    expect(log.mock.calls[0][0]).not.toContain(path.basename(dirB));

    await handle.close();
  });

  it('two rapid changes to the same set coalesce into one pass', async () => {
    const dir = scratchSet('coalesce');
    const { watcher, emit } = fakeWatcher();
    const log = vi.fn();

    const handle = await runDev([dir], {}, '/nowhere', { createWatcher: () => watcher, log, debounceMs: DEBOUNCE_MS });
    log.mockClear();

    emit(path.join(dir, 'rules/api/hello/get/hello.fn.js'));
    await sleep(DEBOUNCE_MS / 2);
    emit(path.join(dir, 'rules/api/hello/get/hello.fn.js'));
    await sleep(SETTLE_MS);

    expect(log).toHaveBeenCalledTimes(1);

    await handle.close();
  });

  it('a change under dist/ is ignored (belt-and-suspenders alongside the watcher ignore)', async () => {
    const dir = scratchSet('distignore');
    const { watcher, emit } = fakeWatcher();
    const log = vi.fn();

    const handle = await runDev([dir], {}, '/nowhere', { createWatcher: () => watcher, log, debounceMs: DEBOUNCE_MS });
    log.mockClear();

    emit(path.join(dir, 'dist', `${'distignore'}.proxy-rules.json`));
    await sleep(SETTLE_MS);

    expect(log).not.toHaveBeenCalled();

    await handle.close();
  });

  it('a red build logs a ✗ status line with the first error and keeps watching', async () => {
    const dir = scratchSet('red');
    const { watcher, emit } = fakeWatcher();
    const log = vi.fn();

    const handle = await runDev([dir], {}, '/nowhere', { createWatcher: () => watcher, log, debounceMs: DEBOUNCE_MS });
    log.mockClear();

    breakSet(dir);
    emit(path.join(dir, 'rules/api/hello/get/rule.yaml'));
    await sleep(SETTLE_MS);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/^\[\d\d:\d\d:\d\d\] \S+ ✗ build:/);
    expect(log.mock.calls[0][0]).toMatch(/missing\.fn\.js/);

    // The loop survives: fixing the set and firing another change produces a green pass.
    log.mockClear();
    fixSet(dir);
    emit(path.join(dir, 'rules/api/hello/get/rule.yaml'));
    await sleep(SETTLE_MS);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/✓ build ✓ validate ✓ 1 tests$/);

    await handle.close();
  });

  it('--push calls runPushOne only after a green pass, with the suffix', async () => {
    const dir = scratchSet('pushme');
    const { watcher, emit } = fakeWatcher();
    const log = vi.fn();
    const deps = pushDeps(syncResponse());

    const handle = await runDev([dir], { push: true, nameSuffix: 'dev-42' }, '/nowhere', {
      createWatcher: () => watcher,
      log,
      pushDeps: deps,
      debounceMs: DEBOUNCE_MS,
    });

    // Initial (green) pass pushes once, under the suffixed name.
    expect(deps.sentBodies()).toHaveLength(1);
    expect(deps.sentBodies()[0].ruleSet.name).toBe('pushme-dev-42');
    expect(log.mock.calls[0][0]).toContain('push ✓');

    // A red rerun must not push again.
    log.mockClear();
    breakSet(dir);
    emit(path.join(dir, 'rules/api/hello/get/rule.yaml'));
    await sleep(SETTLE_MS);
    expect(deps.sentBodies()).toHaveLength(1); // unchanged — still just the initial push

    await handle.close();
  });

  it('--push without --name-suffix rejects before any watcher is created', async () => {
    const dir = scratchSet('nosuffix');
    const factory = vi.fn();

    await expect(runDev([dir], { push: true }, '/nowhere', { createWatcher: factory })).rejects.toThrow(
      /--name-suffix/,
    );
    expect(factory).not.toHaveBeenCalled();
  });

  it('close() closes the watcher', async () => {
    const dir = scratchSet('close');
    const { watcher, close } = fakeWatcher();

    const handle = await runDev([dir], {}, '/nowhere', { createWatcher: () => watcher, log: () => {}, debounceMs: DEBOUNCE_MS });
    expect(close).not.toHaveBeenCalled();
    await handle.close();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
