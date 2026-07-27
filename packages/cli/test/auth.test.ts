import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runLogin, runLogout, runAuthStatus, runAuthToken } from '../src/commands/auth.js';
import { getStoredKey, storeKey } from '../src/api/credentials.js';
import type { FetchLike } from '../src/api/client.js';

function tmpFile(): string {
  return path.join(mkdtempSync(path.join(os.tmpdir(), 'bffless-auth-')), 'credentials.json');
}

/** fetch stub keyed by `METHOD url`, answering by the request's X-API-Key. */
function fetchByKey(url: string, keyStatus: Record<string, number>): FetchLike {
  return async (reqUrl, init) => {
    if (reqUrl !== `${url}/api/projects`) throw new Error(`unexpected url ${reqUrl}`);
    const key = (init?.headers as Record<string, string>)['X-API-Key'];
    const status = keyStatus[key] ?? 401;
    return new Response(status === 200 ? '[]' : '{"message":"Invalid API key"}', {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

describe('runLogin', () => {
  it('validates the pasted key then stores it under the normalized URL', async () => {
    const file = tmpFile();
    const logs: string[] = [];
    const result = await runLogin({ apiUrl: 'https://Api.Test/' }, '/tmp', {
      env: {},
      credentialsFile: file,
      fetchImpl: fetchByKey('https://api.test', { 'k-good': 200 }),
      promptSecret: async () => 'k-good',
      log: (m) => logs.push(m),
    });
    expect(result).toEqual({ ok: true, apiUrl: 'https://api.test' });
    expect(getStoredKey('https://api.test', file)).toBe('k-good');
    expect(logs.join('\n')).toMatch(/API key/i);
  });

  it('stores NOTHING when validation fails', async () => {
    const file = tmpFile();
    const result = await runLogin({ apiUrl: 'https://api.test' }, '/tmp', {
      env: {},
      credentialsFile: file,
      fetchImpl: fetchByKey('https://api.test', {}),
      promptSecret: async () => 'k-bad',
      log: () => {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/nothing (was )?stored/i);
    expect(existsSync(file)).toBe(false);
  });

  it('rejects an empty key without a network call', async () => {
    const result = await runLogin({ apiUrl: 'https://api.test' }, '/tmp', {
      env: {},
      credentialsFile: tmpFile(),
      fetchImpl: async () => { throw new Error('must not be called'); },
      promptSecret: async () => '  ',
      log: () => {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/empty/i);
  });

  it('errors when no apiUrl is resolvable', async () => {
    const result = await runLogin({}, os.tmpdir(), {
      env: {},
      credentialsFile: tmpFile(),
      promptSecret: async () => 'k',
      log: () => {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/--api-url/);
  });

  it('falls back to BFFLESS_API_URL from env', async () => {
    const file = tmpFile();
    const result = await runLogin({}, os.tmpdir(), {
      env: { BFFLESS_API_URL: 'https://env.test' },
      credentialsFile: file,
      fetchImpl: fetchByKey('https://env.test', { 'k-good': 200 }),
      promptSecret: async () => 'k-good',
      log: () => {},
    });
    expect(result).toEqual({ ok: true, apiUrl: 'https://env.test' });
  });
});

describe('runLogout', () => {
  it('removes the entry and reports removed: true, then false on repeat', () => {
    const file = tmpFile();
    storeKey('https://api.test', 'k', file);
    const deps = { env: {}, credentialsFile: file };
    expect(runLogout({ apiUrl: 'https://api.test' }, '/tmp', deps)).toEqual({
      ok: true,
      apiUrl: 'https://api.test',
      removed: true,
    });
    expect(runLogout({ apiUrl: 'https://api.test' }, '/tmp', deps)).toEqual({
      ok: true,
      apiUrl: 'https://api.test',
      removed: false,
    });
  });
});

describe('runAuthStatus', () => {
  it('lists each stored instance with a key prefix and live validity', async () => {
    const file = tmpFile();
    storeKey('https://a.test', 'k-valid-12345', file);
    storeKey('https://b.test', 'k-revoked-999', file);
    const fetchImpl: FetchLike = async (reqUrl) =>
      new Response(reqUrl.startsWith('https://a.test') ? '[]' : '{"message":"Invalid API key"}', {
        status: reqUrl.startsWith('https://a.test') ? 200 : 401,
        headers: { 'Content-Type': 'application/json' },
      });
    const rows = await runAuthStatus({ credentialsFile: file, fetchImpl });
    expect(rows).toEqual([
      { apiUrl: 'https://a.test', keyPrefix: 'k-valid-…', valid: true },
      { apiUrl: 'https://b.test', keyPrefix: 'k-revoke…', valid: false },
    ]);
  });

  it('returns [] when nothing is stored', async () => {
    expect(await runAuthStatus({ credentialsFile: tmpFile() })).toEqual([]);
  });
});

describe('runAuthToken', () => {
  it('returns the stored key for the resolved instance', () => {
    const file = tmpFile();
    storeKey('https://api.test', 'k-tok', file);
    expect(runAuthToken({ apiUrl: 'https://api.test' }, '/tmp', { env: {}, credentialsFile: file })).toEqual({
      ok: true,
      token: 'k-tok',
    });
  });

  it('errors with login remediation when nothing is stored for the instance', () => {
    const result = runAuthToken({ apiUrl: 'https://api.test' }, '/tmp', { env: {}, credentialsFile: tmpFile() });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/bffless login/);
      expect(result.error).toMatch(/BFFLESS_API_KEY/);
    }
  });
});
