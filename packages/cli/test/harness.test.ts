import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runHandler, runHandlerFile } from '../src/harness/run-handler.js';
import { createUtils } from '../src/harness/utils.js';

describe('runHandler — happy path', () => {
  it('invokes handler(data) with request spread in and returns the result', async () => {
    const { result } = await runHandler(
      'function handler({ request }) { return request.body.x * 2; }',
      { request: { body: { x: 21 } } },
    );
    expect(result).toBe(42);
  });

  it('supports async handlers', async () => {
    const { result } = await runHandler(
      'async function handler({ request }) { return await Promise.resolve(request.body.n + 1); }',
      { request: { body: { n: 9 } } },
    );
    expect(result).toBe(10);
  });
});

describe('utils bag — parity with backend crypto helpers', () => {
  it('sha256("abc") matches the known hex digest', () => {
    const utils = createUtils();
    expect(utils.sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('sha256 is also reachable inside the sandbox via utils', async () => {
    const { result } = await runHandler(
      "function handler({ utils }) { return utils.sha256('abc'); }",
    );
    expect(result).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('sign/verify round-trip succeeds and a tampered signature fails', async () => {
    const { result } = await runHandler(
      "function handler({ utils }) { const sig = utils.sign('hello'); return { sig, ok: utils.verify('hello', sig), tampered: utils.verify('hello', sig + 'ff') }; }",
    );
    const r = result as { sig: string; ok: boolean; tampered: boolean };
    expect(typeof r.sig).toBe('string');
    expect(r.ok).toBe(true);
    expect(r.tampered).toBe(false);
  });

  it('sign is keyed by opts.signingSecret (different secret -> different signature)', async () => {
    const a = await runHandler("function handler({ utils }) { return utils.sign('m'); }", {}, { signingSecret: 'A' });
    const b = await runHandler("function handler({ utils }) { return utils.sign('m'); }", {}, { signingSecret: 'B' });
    expect(a.result).not.toBe(b.result);
  });

  it('base64url round-trips and randomUUID/randomToken are shaped correctly', () => {
    const utils = createUtils();
    expect(utils.base64urlDecode(utils.base64urlEncode('héllo'))).toBe('héllo');
    expect(utils.randomUUID()).toMatch(/^[0-9a-f-]{36}$/);
    expect(utils.randomToken(8)).toMatch(/^[0-9a-f]{16}$/);
    expect(utils.hmacSha256('m', 'k')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('runHandler — console capture', () => {
  it('captures console.log/warn/error with their level', async () => {
    const { logs } = await runHandler(
      "function handler() { console.log('a', 1); console.warn('b'); console.error('c'); return 0; }",
    );
    expect(logs).toEqual([
      { level: 'log', message: 'a 1' },
      { level: 'warn', message: 'b' },
      { level: 'error', message: 'c' },
    ]);
  });

  it('caps captured logs at 100 entries', async () => {
    const { logs } = await runHandler(
      'function handler() { for (let i = 0; i < 250; i++) console.log(i); return 1; }',
    );
    expect(logs.length).toBe(100);
  });
});

describe('runHandler — frozen data', () => {
  it('deep-freezes the data so mutation attempts are no-ops', async () => {
    const input = { request: { body: { x: 5 } } };
    const { result } = await runHandler(
      'function handler({ request }) { try { request.body.x = 999; } catch (e) {} return request.body.x; }',
      input,
    );
    expect(result).toBe(5);
    // Original caller object is never touched (structuredClone) either.
    expect(input.request.body.x).toBe(5);
  });
});

describe('runHandler — timeout', () => {
  it('rejects an infinite loop with timeout:1000 within ~2s', async () => {
    const start = Date.now();
    await expect(
      runHandler('function handler() { while (true) {} }', {}, { timeout: 1000 }),
    ).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe('runHandler — sandbox isolation', () => {
  it('process and require are undefined inside the sandbox', async () => {
    const { result } = await runHandler(
      'function handler() { return { p: typeof process, r: typeof require }; }',
    );
    expect(result).toEqual({ p: 'undefined', r: 'undefined' });
  });

  it('does not run prohibited-pattern validation (execution only)', async () => {
    // `constructor.name` would be flagged by lint, but the harness only executes.
    const { result } = await runHandler(
      'function handler() { return ({}).constructor.name; }',
    );
    expect(result).toBe('Object');
  });
});

describe('runHandlerFile', () => {
  it('reads a file and runs its handler', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bffless-harness-'));
    const file = path.join(dir, 'handler.fn.js');
    writeFileSync(file, 'function handler({ request }) { return request.body.x + 1; }');
    const { result } = await runHandlerFile(file, { request: { body: { x: 41 } } });
    expect(result).toBe(42);
  });
});
