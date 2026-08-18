import { authProviderFor, RemoteClient, RemoteTransportError } from './remote-client';
import { IdTokenMinter, NoAuth } from './auth/id-token';
import { RemoteResponseTooLargeError, RemoteUnavailableError } from './remote-errors';

const noSleep = async () => {};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const sig = () => new AbortController().signal;

describe('RemoteClient.request', () => {
  it('POSTs to baseUrl+path with auth headers and returns parsed JSON for any status', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(json(422, { error: 'bad' }));
    const res = await new RemoteClient(
      'https://svc',
      { headers: async () => ({ authorization: 'Bearer t' }) },
      fetchImpl as never,
      noSleep,
    ).request({ path: '/jobs', method: 'POST', body: '{"a":1}', signal: sig() });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://svc/jobs');
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({
      authorization: 'Bearer t',
      'content-type': 'application/json',
    });
    expect(res).toMatchObject({ status: 422, ok: false, body: { error: 'bad' }, attempts: 1 });
  });

  it('returns text bodies for non-JSON content types', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(new Response('pong', { status: 200 }));
    const res = await new RemoteClient(
      'https://svc',
      new NoAuth(),
      fetchImpl as never,
      noSleep,
    ).request({
      path: '/ping',
      method: 'GET',
      signal: sig(),
    });
    expect(res.body).toBe('pong');
  });

  it('retries once on a thrown fetch and on 429/503, then reports attempts', async () => {
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(json(200, { ok: 1 }));
    const res = await new RemoteClient(
      'https://svc',
      new NoAuth(),
      fetchImpl as never,
      noSleep,
    ).request({
      path: '/',
      method: 'POST',
      signal: sig(),
    });
    expect(res.attempts).toBe(2);
    const f2 = jest.fn().mockResolvedValueOnce(json(503, {})).mockResolvedValueOnce(json(503, {}));
    await expect(
      new RemoteClient('https://svc', new NoAuth(), f2 as never, noSleep).request({
        path: '/',
        method: 'POST',
        signal: sig(),
      }),
    ).rejects.toMatchObject({ name: 'RemoteTransportError', status: 503, retryable: true });
  });

  it('does not retry when retry:false or after abort; rethrows AbortError', async () => {
    const f = jest.fn().mockRejectedValueOnce(new Error('boom'));
    await expect(
      new RemoteClient('https://svc', new NoAuth(), f as never, noSleep).request({
        path: '/',
        method: 'POST',
        signal: sig(),
        retry: false,
      }),
    ).rejects.toBeInstanceOf(RemoteTransportError);
    expect(f).toHaveBeenCalledTimes(1);
    const c = new AbortController();
    c.abort();
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const f3 = jest.fn().mockRejectedValueOnce(abort);
    await expect(
      new RemoteClient('https://svc', new NoAuth(), f3 as never, noSleep).request({
        path: '/',
        method: 'POST',
        signal: c.signal,
      }),
    ).rejects.toBe(abort);
  });

  it("never lets a caller header override the connection's own, whatever its casing", async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(json(200, {}));
    await new RemoteClient(
      'https://svc',
      { headers: async () => ({ authorization: 'Bearer minted' }) },
      fetchImpl as never,
      noSleep,
    ).request({
      path: '/jobs',
      method: 'POST',
      body: '{}',
      headers: { Authorization: 'Bearer caller', 'Content-Type': 'text/plain', 'x-trace': 'abc' },
      signal: sig(),
    });
    const sent = fetchImpl.mock.calls[0][1].headers as Record<string, string>;
    // One authorization header, not two concatenated on the wire.
    expect(Object.keys(sent).filter((k) => k.toLowerCase() === 'authorization')).toEqual([
      'authorization',
    ]);
    expect(sent.authorization).toBe('Bearer minted');
    expect(Object.keys(sent).filter((k) => k.toLowerCase() === 'content-type')).toHaveLength(1);
    expect(sent['content-type']).toBe('application/json');
    // Anything that does NOT collide is passed through untouched.
    expect(sent['x-trace']).toBe('abc');
  });

  it('drops a caller header that collides with a differently-cased minted one', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(json(200, {}));
    await new RemoteClient(
      'https://svc',
      { headers: async () => ({ Authorization: 'Bearer minted' }) },
      fetchImpl as never,
      noSleep,
    ).request({
      path: '/',
      method: 'GET',
      headers: { authorization: 'Bearer caller' },
      signal: sig(),
    });
    const sent = fetchImpl.mock.calls[0][1].headers as Record<string, string>;
    expect(Object.entries(sent).filter(([k]) => k.toLowerCase() === 'authorization')).toEqual([
      ['Authorization', 'Bearer minted'],
    ]);
  });

  it('throws a retryable transport error for a 429 it was told not to retry', async () => {
    const f = jest.fn().mockResolvedValue(json(429, { err: 'slow down' }));
    await expect(
      new RemoteClient('https://svc', new NoAuth(), f as never, noSleep).request({
        path: '/',
        method: 'POST',
        signal: sig(),
        retry: false,
      }),
    ).rejects.toMatchObject({ name: 'RemoteTransportError', status: 429, retryable: true });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('rejects bodies over maxResponseBytes', async () => {
    const big = new Response('x'.repeat(2000), {
      status: 200,
      headers: { 'content-length': '2000' },
    });
    await expect(
      new RemoteClient(
        'https://svc',
        new NoAuth(),
        jest.fn().mockResolvedValueOnce(big) as never,
        noSleep,
      ).request({ path: '/', method: 'GET', signal: sig(), maxResponseBytes: 1000 }),
    ).rejects.toBeInstanceOf(RemoteResponseTooLargeError);
  });
});

describe('RemoteClient.probe', () => {
  it('GETs the given path with a 5 s bound and reports latency, never retries', async () => {
    const f = jest.fn().mockResolvedValueOnce(json(200, { ok: true, version: '1.2.3' }));
    const res = await new RemoteClient('https://svc', new NoAuth(), f as never, noSleep).probe({
      path: '/healthz',
    });
    expect(f.mock.calls[0][0]).toBe('https://svc/healthz');
    expect(res).toMatchObject({ status: 200, ok: true, body: { version: '1.2.3' } });
    expect(typeof res.latencyMs).toBe('number');
  });
});

describe('authProviderFor', () => {
  it('maps the supported auth modes and rejects anything else', () => {
    expect(authProviderFor('none', null)).toBeInstanceOf(NoAuth);
    expect(authProviderFor('google_id_token', '{"k":1}')).toBeInstanceOf(IdTokenMinter);
    expect(() => authProviderFor('basic', null)).toThrow(RemoteUnavailableError);
  });
});
