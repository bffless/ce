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

/** Poll `condition` until it's true (or `timeout` elapses). Used instead of a fixed sleep
 *  wherever an assertion depends on a debounce timer/pass having actually completed — a
 *  fixed sleep races the real debounce timer under CPU contention (the timer can fire
 *  after the sleep resolves), which is exactly the flakiness this helper avoids. Only
 *  genuinely negative assertions (nothing happened, and never will) still use a fixed
 *  sleep, since there's no positive signal to poll for there. */
async function waitFor(condition: () => boolean, options: { timeout?: number; interval?: number } = {}): Promise<void> {
  const { timeout = 2000, interval = 5 } = options;
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error(`waitFor: condition not met within ${timeout}ms`);
    }
    await sleep(interval);
  }
}

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

/**
 * A `PushDeps` whose `fetchImpl` never resolves on its own — every call parks on an
 * internal FIFO queue of resolvers until the test calls `release()`. Because a `--push`
 * pass's last step awaits the sync `fetch`, this is a fully deps-injected way to hold a
 * *whole* `runPass` in flight for as long as a test needs, without mocking `buildOne`/
 * `validateRuleSet`/`runFnTests` or adding any production hook: `runPass` only returns
 * once the fetch it's awaiting resolves, so holding the fetch holds the pass.
 *
 * `inFlight`/`maxInFlight` track concurrently-parked calls — the serialization tests use
 * `maxInFlight` as the "did two passes ever overlap" witness.
 */
function deferredPushDeps(response: SyncResponse): PushDeps & {
  callCount: () => number;
  inFlight: () => number;
  maxInFlight: () => number;
  release: () => void;
} {
  const pending: Array<() => void> = [];
  let calls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchImpl: PushDeps['fetchImpl'] = async () => {
    calls += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise<void>((resolve) => pending.push(resolve));
    inFlight -= 1;
    return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return {
    fetchImpl,
    env: { BFFLESS_API_KEY: 'k-test' },
    config: { apiUrl: API_URL, project: PROJECT_UUID },
    execGit: noGit,
    callCount: () => calls,
    inFlight: () => inFlight,
    maxInFlight: () => maxInFlight,
    release: () => pending.shift()?.(),
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
    await waitFor(() => log.mock.calls.length >= 1);

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
    await waitFor(() => log.mock.calls.length >= 1);

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
    await waitFor(() => log.mock.calls.length >= 1);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/^\[\d\d:\d\d:\d\d\] \S+ ✗ build:/);
    expect(log.mock.calls[0][0]).toMatch(/missing\.fn\.js/);

    // The loop survives: fixing the set and firing another change produces a green pass.
    log.mockClear();
    fixSet(dir);
    emit(path.join(dir, 'rules/api/hello/get/rule.yaml'));
    await waitFor(() => log.mock.calls.length >= 1);

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
    // Wait for the red pass to actually complete (positive signal: it always logs,
    // even on failure) before checking the push count didn't move.
    await waitFor(() => log.mock.calls.length >= 1);
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

  describe('per-set pass serialization (trailing rerun, no overlap)', () => {
    it('a change fired while a pass is running queues exactly one trailing pass — never two concurrent passes', async () => {
      const dir = scratchSet('serialize-a');
      const { watcher, emit } = fakeWatcher();
      const log = vi.fn();
      const fc = deferredPushDeps(syncResponse());

      const handlePromise = runDev([dir], { push: true, nameSuffix: 'x' }, '/nowhere', {
        createWatcher: () => watcher,
        log,
        pushDeps: fc,
        debounceMs: DEBOUNCE_MS,
      });

      // Let the initial pass reach (and park on) its push fetch, then release it so
      // `runDev` itself resolves.
      await waitFor(() => fc.callCount() >= 1);
      expect(fc.callCount()).toBe(1);
      fc.release();
      const handle = await handlePromise;
      log.mockClear();

      // A change starts pass #2, which runs its way to the push fetch and parks there —
      // i.e. it is now "running" for the whole duration of the park.
      emit(path.join(dir, 'rules/api/hello/get/hello.fn.js'));
      await waitFor(() => fc.callCount() >= 2);
      expect(fc.callCount()).toBe(2);
      expect(fc.inFlight()).toBe(1);

      // A second change arrives *while pass #2 is still running*. If it started a
      // concurrent pass, that pass would reach its own push fetch and bump the call
      // count/inFlight before pass #2 is released — the bug this test targets.
      emit(path.join(dir, 'rules/api/hello/get/hello.fn.js'));
      await sleep(SETTLE_MS);
      expect(fc.callCount()).toBe(2);
      expect(fc.maxInFlight()).toBe(1);

      // Releasing pass #2 lets it finish; exactly one trailing pass should then run
      // (coalescing the queued change), never overlapping with pass #2.
      fc.release();
      await waitFor(() => fc.callCount() >= 3);
      expect(fc.callCount()).toBe(3);
      expect(fc.inFlight()).toBe(1);
      expect(fc.maxInFlight()).toBe(1);

      fc.release();
      await sleep(SETTLE_MS);
      expect(fc.callCount()).toBe(3); // no further trailing pass — nothing else was queued
      expect(fc.maxInFlight()).toBe(1); // passes never overlapped

      await handle.close();
    });

    it('three changes during a running pass still coalesce into exactly one trailing pass', async () => {
      const dir = scratchSet('serialize-b');
      const { watcher, emit } = fakeWatcher();
      const log = vi.fn();
      const fc = deferredPushDeps(syncResponse());

      const handlePromise = runDev([dir], { push: true, nameSuffix: 'x' }, '/nowhere', {
        createWatcher: () => watcher,
        log,
        pushDeps: fc,
        debounceMs: DEBOUNCE_MS,
      });
      await waitFor(() => fc.callCount() >= 1);
      fc.release(); // initial pass
      const handle = await handlePromise;
      log.mockClear();

      emit(path.join(dir, 'rules/api/hello/get/hello.fn.js'));
      await waitFor(() => fc.callCount() >= 2);
      expect(fc.callCount()).toBe(2); // pass #2 running, parked on push

      // Three changes land back-to-back while pass #2 is running.
      emit(path.join(dir, 'rules/api/hello/get/hello.fn.js'));
      await sleep(DEBOUNCE_MS / 2);
      emit(path.join(dir, 'rules/api/hello/get/hello.fn.js'));
      await sleep(DEBOUNCE_MS / 2);
      emit(path.join(dir, 'rules/api/hello/get/hello.fn.js'));
      await sleep(SETTLE_MS);

      expect(fc.callCount()).toBe(2); // none of the three started a concurrent pass
      expect(fc.maxInFlight()).toBe(1);

      fc.release(); // finish pass #2
      await waitFor(() => fc.callCount() >= 3);
      expect(fc.callCount()).toBe(3); // exactly one trailing pass, coalescing all three
      expect(fc.maxInFlight()).toBe(1);

      fc.release();
      await sleep(SETTLE_MS);
      expect(fc.callCount()).toBe(3); // no second trailing pass

      await handle.close();
    });

    it('close() during a running pass with a queued trailing rerun starts no further pass', async () => {
      const dir = scratchSet('serialize-close');
      const { watcher, emit } = fakeWatcher();
      const log = vi.fn();
      const fc = deferredPushDeps(syncResponse());

      const handlePromise = runDev([dir], { push: true, nameSuffix: 'x' }, '/nowhere', {
        createWatcher: () => watcher,
        log,
        pushDeps: fc,
        debounceMs: DEBOUNCE_MS,
      });
      await waitFor(() => fc.callCount() >= 1);
      fc.release(); // initial pass
      const handle = await handlePromise;
      log.mockClear();

      emit(path.join(dir, 'rules/api/hello/get/hello.fn.js'));
      await waitFor(() => fc.callCount() >= 2);
      expect(fc.callCount()).toBe(2); // pass #2 running, parked on push

      // A change lands and its debounce timer fires *while pass #2 is still running* —
      // this is what queues the trailing rerun (as opposed to a still-pending timer,
      // which `close()` clearing timers would trivially cancel either way).
      emit(path.join(dir, 'rules/api/hello/get/hello.fn.js'));
      await sleep(SETTLE_MS);
      expect(fc.callCount()).toBe(2); // still no concurrent pass — rerun is queued, not started

      await handle.close();

      // Let the in-flight pass #2 finish. Because close() drops the queued trailing
      // rerun, no further pass should start.
      fc.release();
      await sleep(SETTLE_MS);
      expect(fc.callCount()).toBe(2);
    });
  });
});
