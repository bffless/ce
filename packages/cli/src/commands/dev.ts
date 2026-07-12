/**
 * `rules dev` watch mode: a local-first dev loop over one or more rule-set directories.
 *
 * Design decision (operator call, not negotiable from here): the default loop **never
 * touches the network**. `--push` is opt-in and REQUIRES `--name-suffix` — this is a hard
 * error raised before anything else happens (no initial pass, no watcher is created), so a
 * dev loop can never accidentally sync over the live rule set. `--name-suffix` mirrors
 * `rules push`'s preview-deploy pattern: the synced set is always `<name>-<suffix>`, never
 * the bare name.
 *
 * Each pass composes the same building blocks the standalone commands use — `buildOne`
 * (compiles + writes `dist/`, exactly like `rules build`), `validateRuleSet`, and
 * `runFnTests` — in that order, short-circuiting after the first failing stage so a broken
 * build doesn't also try to validate/test stale output. A fully green pass (build ok,
 * zero validate errors, zero failed tests) is the only time `--push` fires.
 *
 * Watching: the default watcher wraps chokidar (`watch(dirs, { ignored, ignoreInitial:
 * true })`), one instance covering every resolved dir, ignoring anything under a `dist/`
 * path segment (both so chokidar doesn't fire on `buildOne`'s own writes, and as a second
 * line of defense in `runDev` itself via `isUnderDist`). Tests inject a fake `DevWatcher`
 * instead of exercising chokidar directly.
 *
 * Debounce is per-set: a change under set X only (re)schedules X's timer, so a burst of
 * saves across two sets each still runs exactly one pass per set, and a burst of saves
 * within one set coalesces into a single rerun of that set only. Failures (build, validate,
 * or test) are logged and never stop the loop — only `close()` (SIGINT, from the command
 * wiring in `index.ts`) ends it.
 */
import path from 'node:path';
import { watch as chokidarWatch } from 'chokidar';
import { buildOne } from './build.js';
import { validateRuleSet } from './validate.js';
import { runFnTests } from './test.js';
import { runPushOne, type PushDeps } from './push.js';

export interface DevOptions {
  push?: boolean;
  nameSuffix?: string;
  apiUrl?: string;
  apiKey?: string;
  project?: string;
}

export interface DevWatcher {
  on(event: 'change', cb: (file: string) => void): void;
  close(): Promise<void>;
}

export interface DevDeps {
  createWatcher?: (dirs: string[]) => DevWatcher;
  pushDeps?: PushDeps;
  log?: (line: string) => void;
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 200;

function defaultLog(line: string): void {
  console.log(line);
}

/** `HH:MM:SS` in local time, matching the brief's `[12:01:03] ...` example. */
function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

/** True when `filePath` (relative to `dir`) has `dist` as its first path segment. */
function isUnderDist(dir: string, filePath: string): boolean {
  const rel = path.relative(dir, path.resolve(filePath));
  const first = rel.split(path.sep)[0];
  return first === 'dist';
}

/** The most specific (longest) entry of `dirs` that contains `filePath`, or `null` if none
 *  does — a nested-rule-set edge case chokidar would otherwise report against both. */
function findOwningDir(dirs: string[], filePath: string): string | null {
  const abs = path.resolve(filePath);
  let best: string | null = null;
  for (const dir of dirs) {
    const rel = path.relative(dir, abs);
    const contained = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    if (contained && (best === null || dir.length > best.length)) best = dir;
  }
  return best;
}

/** Default watcher: chokidar over every resolved dir, ignoring `dist/`. Not covered by
 *  `dev.test.ts` directly — tests inject a fake `DevWatcher` (see module doc). */
function defaultCreateWatcher(dirs: string[]): DevWatcher {
  const watcher = chokidarWatch(dirs, {
    ignoreInitial: true,
    ignored: (filePath: string) => /(^|[/\\])dist([/\\]|$)/.test(filePath),
  });
  return {
    on: (event, cb) => {
      watcher.on(event, cb);
    },
    close: () => watcher.close(),
  };
}

/** Run one build → validate → test pass for `dir`, format its status line, and — when
 *  `opts.push` is set and the pass is fully green — sync it under `<name>-<nameSuffix>`. */
async function runPass(dir: string, opts: DevOptions, cwd: string, pushDeps: PushDeps | undefined): Promise<string> {
  const name = path.basename(dir);
  const ts = timestamp();

  const build = await buildOne(dir);
  if (!build.ok) {
    return `[${ts}] ${name} ✗ build: ${build.summary}`;
  }

  const { errors: validateErrors } = await validateRuleSet(dir);
  if (validateErrors.length > 0) {
    const first = validateErrors[0];
    const loc = first.line !== undefined ? `${first.file}:${first.line}` : first.file;
    return `[${ts}] ${name} ✓ build ✗ validate: ${loc} ${first.message}`;
  }

  const { passed, failed } = await runFnTests(dir);
  if (failed.length > 0) {
    const first = failed[0];
    return (
      `[${ts}] ${name} ✓ build ✓ validate ✗ ${failed.length}/${passed + failed.length} tests: ` +
      `${first.file} > ${first.case}: ${first.message}`
    );
  }

  let pushSuffix = '';
  if (opts.push) {
    const result = await runPushOne(dir, { nameSuffix: opts.nameSuffix, dryRun: false, apiUrl: opts.apiUrl, apiKey: opts.apiKey, project: opts.project }, cwd, pushDeps);
    pushSuffix = result.ok ? ' push ✓' : ` push ✗ ${result.error}`;
  }

  return `[${ts}] ${name} ✓ build ✓ validate ✓ ${passed} tests${pushSuffix}`;
}

/**
 * Watch `dirs` (already-resolved rule-set directories), rerunning build → validate → test
 * (and, opt-in, push) on change. Never throws out of the loop itself — only the startup
 * guard (`--push` without `--name-suffix`) rejects the returned promise, and only before
 * any watcher is created.
 */
export async function runDev(
  dirs: string[],
  opts: DevOptions,
  cwd: string,
  deps?: DevDeps,
): Promise<{ close: () => Promise<void> }> {
  if (opts.push && !opts.nameSuffix) {
    throw new Error(
      'rules dev --push requires --name-suffix (dev mode never syncs to the live/bare-named set)',
    );
  }

  const log = deps?.log ?? defaultLog;
  const debounceMs = deps?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const resolvedDirs = dirs.map((d) => path.resolve(d));

  async function pass(dir: string): Promise<void> {
    try {
      log(await runPass(dir, opts, cwd, deps?.pushDeps));
    } catch (err) {
      // Belt-and-suspenders: runPass's own building blocks don't throw in normal
      // operation, but an unexpected error here must still keep the loop alive.
      log(`[${timestamp()}] ${path.basename(dir)} ✗ ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const dir of resolvedDirs) {
    await pass(dir);
  }

  const createWatcher = deps?.createWatcher ?? defaultCreateWatcher;
  const watcher = createWatcher(resolvedDirs);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  watcher.on('change', (file: string) => {
    const dir = findOwningDir(resolvedDirs, file);
    if (!dir || isUnderDist(dir, file)) return;

    const existing = timers.get(dir);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      timers.delete(dir);
      void pass(dir);
    }, debounceMs);
    timers.set(dir, timer);
  });

  return {
    close: async () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      await watcher.close();
    },
  };
}
