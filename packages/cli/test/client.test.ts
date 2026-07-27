import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ApiClient, ApiError, createClient, type FetchLike } from '../src/api/client.js';
import { CLI_REMEDIATION, resolveRemediation } from '../src/api/remediation.js';
import { requireProject } from '../src/api/resolve.js';
import { storeKey } from '../src/api/credentials.js';

interface RecordedCall {
  url: string;
  init?: RequestInit;
}

/** A fetch stub that records calls and answers from a `METHOD url` → response map. */
function stubFetch(
  routes: Record<string, { status?: number; body?: unknown; text?: string }>,
): { fetchImpl: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const key = `${init?.method ?? 'GET'} ${url}`;
    const route = routes[key];
    if (!route) throw new Error(`stubFetch: no route for ${key}`);
    const text = route.text ?? JSON.stringify(route.body ?? {});
    return new Response(text, {
      status: route.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fetchImpl, calls };
}

describe('ApiClient', () => {
  it('sends the X-API-Key header and Accept: application/json on GET', async () => {
    const { fetchImpl, calls } = stubFetch({ 'GET https://api.test/api/projects': { body: [] } });
    const client = new ApiClient({ apiUrl: 'https://api.test', apiKey: 'k-123', fetchImpl });
    await client.get('/api/projects');
    expect(calls).toHaveLength(1);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('k-123');
    expect(headers.Accept).toBe('application/json');
  });

  it('PUT serializes the body as JSON with Content-Type', async () => {
    const { fetchImpl, calls } = stubFetch({ 'PUT https://api.test/api/x': { body: { ok: true } } });
    const client = new ApiClient({ apiUrl: 'https://api.test', apiKey: 'k', fetchImpl });
    const out = await client.put<{ ok: boolean }>('/api/x', { a: 1 });
    expect(out).toEqual({ ok: true });
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(calls[0].init?.body).toBe('{"a":1}');
  });

  it('POST serializes the body as JSON, sets X-API-Key and Content-Type', async () => {
    const { fetchImpl, calls } = stubFetch({ 'POST https://api.test/api/x/rollback/r1': { body: { ok: true } } });
    const client = new ApiClient({ apiUrl: 'https://api.test', apiKey: 'k-post', fetchImpl });
    const out = await client.post<{ ok: boolean }>('/api/x/rollback/r1', { dryRun: true });
    expect(out).toEqual({ ok: true });
    expect(calls[0].init?.method).toBe('POST');
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('k-post');
    expect(headers['Content-Type']).toBe('application/json');
    expect(calls[0].init?.body).toBe('{"dryRun":true}');
  });

  it('normalizes a trailing slash on the base URL', async () => {
    const { fetchImpl, calls } = stubFetch({ 'GET https://api.test/api/projects': { body: [] } });
    const client = new ApiClient({ apiUrl: 'https://api.test/', apiKey: 'k', fetchImpl });
    await client.get('/api/projects');
    expect(calls[0].url).toBe('https://api.test/api/projects');
  });

  it('401 maps to an auth error naming X-API-Key and BFFLESS_API_KEY', async () => {
    const { fetchImpl } = stubFetch({
      'GET https://api.test/api/projects': { status: 401, body: { message: 'Invalid API key' } },
    });
    const client = new ApiClient({ apiUrl: 'https://api.test', apiKey: 'bad', fetchImpl });
    await expect(client.get('/api/projects')).rejects.toThrow(/X-API-Key/);
    await expect(client.get('/api/projects')).rejects.toThrow(/BFFLESS_API_KEY/);
    await expect(client.get('/api/projects')).rejects.toThrow(/Invalid API key/);
  });

  it('403 maps to the same auth guidance', async () => {
    const { fetchImpl } = stubFetch({ 'GET https://api.test/api/x': { status: 403, body: {} } });
    const client = new ApiClient({ apiUrl: 'https://api.test', apiKey: 'k', fetchImpl });
    await expect(client.get('/api/x')).rejects.toThrow(/HTTP 403 .*authentication failed.*X-API-Key/s);
  });

  it('404 names what was looked up and the URL', async () => {
    const { fetchImpl } = stubFetch({ 'GET https://api.test/api/rs/abc/export': { status: 404, body: {} } });
    const client = new ApiClient({ apiUrl: 'https://api.test', apiKey: 'k', fetchImpl });
    await expect(client.get('/api/rs/abc/export', 'rule set "studio" export')).rejects.toThrow(
      /HTTP 404 GET https:\/\/api\.test\/api\/rs\/abc\/export: rule set "studio" export not found/,
    );
  });

  it('other non-2xx includes the status and the parsed message field (array form joined)', async () => {
    const { fetchImpl } = stubFetch({
      'PUT https://api.test/api/x': { status: 400, body: { message: ['rules.0.targetUrl invalid', 'nope'] } },
    });
    const client = new ApiClient({ apiUrl: 'https://api.test', apiKey: 'k', fetchImpl });
    await expect(client.put('/api/x', {})).rejects.toThrow(
      /HTTP 400 PUT https:\/\/api\.test\/api\/x — rules\.0\.targetUrl invalid; nope/,
    );
  });

  it('a network-level failure is wrapped with the method and URL', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('ECONNREFUSED');
    };
    const client = new ApiClient({ apiUrl: 'https://api.test', apiKey: 'k', fetchImpl });
    const err = await client.get('/api/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
    expect((err as ApiError).message).toMatch(/request failed: GET https:\/\/api\.test\/api\/x — ECONNREFUSED/);
  });
});

describe('createClient — precedence and sourcing rules', () => {
  const okFetch = stubFetch({ 'GET https://flag.test/api/x': { body: {} } }).fetchImpl;

  it('--api-url flag beats BFFLESS_API_URL env beats config apiUrl', async () => {
    const { fetchImpl, calls } = stubFetch({
      'GET https://flag.test/api/x': { body: {} },
      'GET https://env.test/api/x': { body: {} },
      'GET https://config.test/api/x': { body: {} },
    });
    const env = { BFFLESS_API_URL: 'https://env.test', BFFLESS_API_KEY: 'k' };
    const config = { apiUrl: 'https://config.test' };

    await createClient({ apiUrl: 'https://flag.test' }, '/nowhere', { env, config, fetchImpl }).get('/api/x');
    expect(calls.at(-1)?.url).toBe('https://flag.test/api/x');

    await createClient({}, '/nowhere', { env, config, fetchImpl }).get('/api/x');
    expect(calls.at(-1)?.url).toBe('https://env.test/api/x');

    await createClient({}, '/nowhere', { env: { BFFLESS_API_KEY: 'k' }, config, fetchImpl }).get('/api/x');
    expect(calls.at(-1)?.url).toBe('https://config.test/api/x');
  });

  it('errors when no API URL is available anywhere, naming all three sources', () => {
    expect(() => createClient({}, '/nowhere', { env: {}, config: null })).toThrow(
      /--api-url.*BFFLESS_API_URL.*apiUrl/s,
    );
  });

  it('--api-key flag beats BFFLESS_API_KEY env', async () => {
    const { fetchImpl, calls } = stubFetch({ 'GET https://a.test/api/x': { body: {} } });
    const env = { BFFLESS_API_KEY: 'env-key' };
    await createClient({ apiUrl: 'https://a.test', apiKey: 'flag-key' }, '/nowhere', {
      env,
      config: null,
      fetchImpl,
    }).get('/api/x');
    expect((calls[0].init?.headers as Record<string, string>)['X-API-Key']).toBe('flag-key');

    await createClient({ apiUrl: 'https://a.test' }, '/nowhere', { env, config: null, fetchImpl }).get('/api/x');
    expect((calls[1].init?.headers as Record<string, string>)['X-API-Key']).toBe('env-key');
  });

  it('the API key is NEVER read from config.json — a config-only setup errors', () => {
    // The config schema has no apiKey field at all; even a fully-populated config cannot
    // supply a key. The error explains where keys may come from and why config is excluded.
    const config = { apiUrl: 'https://config.test', project: 'p' };
    expect(() => createClient({}, '/nowhere', { env: {}, config, fetchImpl: okFetch })).toThrow(
      /--api-key.*set BFFLESS_API_KEY.*bffless login.*never read from \.bffless\/config\.json/s,
    );
  });
});

describe('remediation overrides', () => {
  it('an override replaces the CLI wording; unset fields keep the default', () => {
    const remediation = { apiKey: 'set the `api-key` input on the action' };

    expect(() =>
      createClient({ apiUrl: 'https://api.test' }, '/nowhere', { env: {}, config: null, remediation }),
    ).toThrow('no API key configured — set the `api-key` input on the action');
    // apiUrl was not overridden, so it still names the CLI's own affordances.
    expect(() => createClient({}, '/nowhere', { env: {}, config: null, remediation })).toThrow(
      /--api-url.*BFFLESS_API_URL/s,
    );
  });

  it('the auth (401/403) hint is overridable and drops every CLI-only affordance', async () => {
    const client = new ApiClient({
      apiUrl: 'https://api.test',
      apiKey: 'bad',
      fetchImpl: stubFetch({ 'GET https://api.test/api/x': { status: 401 } }).fetchImpl,
      remediation: { auth: 'The `api-key` input is sent as X-API-Key; check the repo secret.' },
    });
    await expect(client.get('/api/x')).rejects.toThrow(
      /HTTP 401 .*authentication failed.* The `api-key` input is sent as X-API-Key/s,
    );
    await expect(client.get('/api/x')).rejects.not.toThrow(/--api-key/);
  });

  it('requireProject uses the override, and CLI_REMEDIATION when there is none', () => {
    expect(() => requireProject(undefined, undefined)).toThrow(/--project/);
    expect(() => requireProject(undefined, undefined, { project: 'set the `project` input' })).toThrow(
      'no project configured — set the `project` input',
    );
    expect(requireProject('flag-project', 'config-project')).toBe('flag-project');
  });

  it('resolveRemediation merges over the CLI defaults', () => {
    const merged = resolveRemediation({ project: 'X' });
    expect(merged.project).toBe('X');
    expect(merged.apiKey).toBe(CLI_REMEDIATION.apiKey);
    expect(resolveRemediation()).toEqual(CLI_REMEDIATION);
  });
});

describe('createClient credential-store fallback', () => {
  function seededStore(apiUrl: string, key: string): string {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'bffless-cred-')), 'credentials.json');
    storeKey(apiUrl, key, file);
    return file;
  }

  it('uses the stored key when flag and env are absent', async () => {
    const file = seededStore('https://api.test', 'k-stored');
    const { fetchImpl, calls } = stubFetch({ 'GET https://api.test/api/projects': { body: [] } });
    const client = createClient({}, '/tmp', {
      env: {},
      config: { apiUrl: 'https://api.test' },
      credentialsFile: file,
      fetchImpl,
    });
    await client.get('/api/projects');
    expect((calls[0].init?.headers as Record<string, string>)['X-API-Key']).toBe('k-stored');
  });

  it('flag and env both beat the store', async () => {
    const file = seededStore('https://api.test', 'k-stored');
    const base = { config: { apiUrl: 'https://api.test' }, credentialsFile: file } as const;
    const a = stubFetch({ 'GET https://api.test/api/projects': { body: [] } });
    await createClient({ apiKey: 'k-flag' }, '/tmp', { ...base, env: {}, fetchImpl: a.fetchImpl }).get('/api/projects');
    expect((a.calls[0].init?.headers as Record<string, string>)['X-API-Key']).toBe('k-flag');

    const b = stubFetch({ 'GET https://api.test/api/projects': { body: [] } });
    await createClient({}, '/tmp', { ...base, env: { BFFLESS_API_KEY: 'k-env' }, fetchImpl: b.fetchImpl }).get('/api/projects');
    expect((b.calls[0].init?.headers as Record<string, string>)['X-API-Key']).toBe('k-env');
  });

  it('store lookup matches by normalized URL (config URL with trailing slash)', async () => {
    const file = seededStore('https://api.test', 'k-stored');
    const { fetchImpl, calls } = stubFetch({ 'GET https://api.test/api/projects': { body: [] } });
    const client = createClient({}, '/tmp', {
      env: {},
      config: { apiUrl: 'https://api.test/' },
      credentialsFile: file,
      fetchImpl,
    });
    await client.get('/api/projects');
    expect((calls[0].init?.headers as Record<string, string>)['X-API-Key']).toBe('k-stored');
  });

  it('no flag, env, or store entry → error mentions bffless login', () => {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'bffless-cred-')), 'credentials.json');
    expect(() =>
      createClient({}, '/tmp', { env: {}, config: { apiUrl: 'https://api.test' }, credentialsFile: file }),
    ).toThrow(/bffless login/);
  });
});
