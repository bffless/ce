import { WorkerClient, WorkerTransportError } from './worker-client';

const okBody = {
  v: 1,
  ok: true,
  commands: [],
  stdout: '',
  stderrTail: '',
  outputs: [],
  bytesIn: 0,
  bytesOut: 0,
  timings: { transferInMs: 0, ffmpegMs: 0, transferOutMs: 0, totalMs: 0 },
  worker: { version: '1', ffmpeg: '6' },
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const envelope = {
  v: 1,
  id: 'j',
  commands: [],
  inputs: [],
  outputs: [],
  files: [],
  maxSeconds: 60,
  limits: { maxOutputBytes: 1 },
} as const;
const auth = { headers: jest.fn().mockResolvedValue({ Authorization: 'Bearer t' }) };
const noSleep = async () => {};

it('POSTs the envelope with auth headers and parses the response', async () => {
  const fetchImpl = jest.fn().mockResolvedValue(json(200, okBody));
  const res = await new WorkerClient('https://w', auth, fetchImpl as never, noSleep).postJob(
    envelope as never,
    { signal: new AbortController().signal },
  );
  expect(res.ok).toBe(true);
  const [url, init] = fetchImpl.mock.calls[0];
  expect(url).toBe('https://w/jobs');
  expect(init.method).toBe('POST');
  expect(init.headers).toMatchObject({
    'content-type': 'application/json',
    Authorization: 'Bearer t',
  });
  expect(JSON.parse(init.body)).toEqual(envelope);
});

it('retries once on a thrown fetch, then succeeds', async () => {
  const fetchImpl = jest
    .fn()
    .mockRejectedValueOnce(new TypeError('fetch failed'))
    .mockResolvedValueOnce(json(200, okBody));
  await expect(
    new WorkerClient('https://w', auth, fetchImpl as never, noSleep).postJob(envelope as never, {
      signal: new AbortController().signal,
    }),
  ).resolves.toMatchObject({ ok: true });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it.each([429, 503])(
  'retries once on %s, then gives up with a retryable transport error',
  async (status) => {
    const fetchImpl = jest.fn().mockResolvedValue(json(status, { err: 1 }));
    await expect(
      new WorkerClient('https://w', auth, fetchImpl as never, noSleep).postJob(envelope as never, {
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ status, retryable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  },
);

it.each([401, 403, 404, 500])('does NOT retry on %s', async (status) => {
  const fetchImpl = jest.fn().mockResolvedValue(json(status, {}));
  await expect(
    new WorkerClient('https://w', auth, fetchImpl as never, noSleep).postJob(envelope as never, {
      signal: new AbortController().signal,
    }),
  ).rejects.toBeInstanceOf(WorkerTransportError);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it('does NOT retry when the signal is aborted', async () => {
  const controller = new AbortController();
  const fetchImpl = jest.fn().mockImplementation(() => {
    controller.abort();
    return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  });
  await expect(
    new WorkerClient('https://w', auth, fetchImpl as never, noSleep).postJob(envelope as never, {
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it('a 200 with a non-worker body is a transport error (never a silent success)', async () => {
  const fetchImpl = jest.fn().mockResolvedValue(json(200, { hello: 'world' }));
  await expect(
    new WorkerClient('https://w', auth, fetchImpl as never, noSleep).postJob(envelope as never, {
      signal: new AbortController().signal,
    }),
  ).rejects.toBeInstanceOf(WorkerTransportError);
});

it('health() GETs /healthz with auth', async () => {
  const fetchImpl = jest.fn().mockResolvedValue(
    json(200, {
      ok: true,
      version: '0.4.31',
      ffmpeg: '6.1.1',
      ops: ['ffmpeg', 'ffprobe'],
      uptimeS: 3,
    }),
  );
  await expect(
    new WorkerClient('https://w', auth, fetchImpl as never, noSleep).health(),
  ).resolves.toMatchObject({ ok: true, version: '0.4.31' });
  expect(fetchImpl.mock.calls[0][0]).toBe('https://w/healthz');
});
