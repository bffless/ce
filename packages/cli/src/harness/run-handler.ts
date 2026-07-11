import * as vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createUtils } from './utils.js';

/**
 * Data passed to a handler as its single argument. Mirrors the shape the CE
 * runtime spreads into `data` before calling `handler(data)`
 * (function-runner.service.ts ~250-333). `utils` is spread in on top.
 */
export interface HandlerData {
  user?: unknown;
  request?: unknown;
  steps?: unknown;
  deployment?: unknown;
}

/** A single captured console line, with its level preserved. */
export interface HandlerLog {
  level: 'log' | 'warn' | 'error';
  message: string;
}

/** Result of running a handler in the harness. */
export interface HandlerRun {
  result: unknown;
  logs: HandlerLog[];
}

/** Options for {@link runHandler}. */
export interface RunHandlerOptions {
  /** Timeout in ms, clamped to 1000-30000 (default 5000). */
  timeout?: number;
  /** Base secret keying `utils.sign`/`utils.verify`. */
  signingSecret?: string;
}

const MAX_LOGS = 100;

/**
 * Deep-freeze an object in place, mirroring the runtime's `deepFreeze`
 * (function-runner.service.ts ~422-439).
 */
function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  for (const name of Object.getOwnPropertyNames(obj)) {
    const value = (obj as Record<string, unknown>)[name];
    if (value && typeof value === 'object') {
      deepFreeze(value);
    }
  }
  return Object.freeze(obj);
}

/**
 * Execute a handler in a `node:vm` sandbox that mirrors the CE pipeline
 * function runtime (apps/backend/src/pipelines/function-runner.service.ts).
 *
 * Parity notes:
 * - Sandbox globals are the exact allow-list from the runtime (~250-308):
 *   Math, Date, JSON, Array, Object, String, Number, Boolean, RegExp, Map, Set,
 *   WeakMap, WeakSet, Promise, Symbol, BigInt, parseInt, parseFloat, isNaN,
 *   isFinite, decodeURI, decodeURIComponent, encodeURI, encodeURIComponent, and
 *   a captured `console`. No require/process/fetch/Buffer/setTimeout is exposed.
 * - `data` is a deep-frozen `structuredClone` of the input, with `utils` spread
 *   in; the handler is called as `await handler(data)` using the same wrapper.
 * - Timeout defaults to 5000, clamped 1000-30000, enforced by BOTH the vm
 *   `runInContext` timeout and a reject timer.
 *
 * Unlike the runtime, this does NOT run prohibited-pattern validation — linting
 * is a separate concern (Task 9). This module only executes.
 */
export async function runHandler(
  code: string,
  data: HandlerData = {},
  opts: RunHandlerOptions = {},
): Promise<HandlerRun> {
  const timeout = Math.min(Math.max(opts.timeout || 5000, 1000), 30000);
  const logs: HandlerLog[] = [];

  // NOTE: Intentional deviation from backend: we cap all log levels (log, warn, error) uniformly at MAX_LOGS=100.
  // The backend caps only console.log at 100; warn/error are uncapped (likely a backend bug).
  const push = (level: HandlerLog['level'], args: unknown[]): void => {
    const message = args
      .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
      .join(' ');
    logs.push({ level, message });
    if (logs.length > MAX_LOGS) {
      logs.shift();
    }
  };

  // Frozen clone of the caller data; utils is attached AFTER the clone because
  // functions are not structured-cloneable (matches runtime ~243-247).
  const frozenData = deepFreeze(structuredClone(data)) as Record<string, unknown>;
  const utils = createUtils(opts.signingSecret);

  const sandbox: vm.Context = {
    data: { ...frozenData, utils },
    utils,

    // Safe built-ins (exact allow-list from the runtime).
    Math,
    Date,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Symbol,
    BigInt,

    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    decodeURI,
    decodeURIComponent,
    encodeURI,
    encodeURIComponent,

    console: {
      log: (...args: unknown[]) => push('log', args),
      warn: (...args: unknown[]) => push('warn', args),
      error: (...args: unknown[]) => push('error', args),
    },

    __result__: undefined as unknown,
  };

  vm.createContext(sandbox);

  const wrappedCode = `
    (async function() {
      try {
        ${code}

        if (typeof handler !== 'function') {
          throw new Error('You must define a handler function. Example: function handler({ input }) { return input; }');
        }

        __result__ = await handler(data);
      } catch (e) {
        __result__ = { __error__: true, message: e && e.message ? e.message : String(e), stack: e && e.stack };
      }
    })();
  `;

  const script = new vm.Script(wrappedCode, { filename: 'user-function.js' });

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Execution timeout'));
    }, timeout);

    try {
      const promise = script.runInContext(sandbox, {
        timeout,
        displayErrors: true,
      });
      Promise.resolve(promise)
        .then(() => {
          clearTimeout(timeoutId);
          resolve();
        })
        .catch((err) => {
          clearTimeout(timeoutId);
          reject(err);
        });
    } catch (err) {
      clearTimeout(timeoutId);
      reject(err);
    }
  });

  const result = sandbox.__result__;
  if (result && typeof result === 'object' && '__error__' in (result as object)) {
    const errorResult = result as { message?: string; stack?: string };
    const err = new Error(errorResult.message ?? 'Handler threw');
    if (errorResult.stack) err.stack = errorResult.stack;
    throw err;
  }

  return { result, logs };
}

/** Read a handler file and run it via {@link runHandler}. */
export async function runHandlerFile(
  file: string,
  data: HandlerData = {},
  opts: RunHandlerOptions = {},
): Promise<HandlerRun> {
  const code = await readFile(file, 'utf8');
  return runHandler(code, data, opts);
}
