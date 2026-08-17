import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { STORAGE_ADAPTER } from '../../../../storage/storage.interface';
import { RemoteFfmpegExecutor, semverLt } from './remote-ffmpeg.executor';
import { readFfmpegEnv } from '../../ffmpeg-env';
import { WorkerTransportError } from './worker-client';

const okBody = (over = {}) => ({
  v: 1,
  ok: true,
  commands: [{ id: 'a', ran: true, exitCode: 0 }],
  stdout: '',
  stderrTail: '',
  outputs: [{ name: 'out.wav', bytes: 5 }],
  bytesIn: 9,
  bytesOut: 5,
  timings: { transferInMs: 1, ffmpegMs: 1, transferOutMs: 1, totalMs: 3 },
  worker: { version: '0.4.31', ffmpeg: '6.1.1' },
  ...over,
});
const health = {
  ok: true,
  version: '0.4.31',
  ffmpeg: '6.1.1',
  ops: ['ffmpeg', 'ffprobe'],
  uptimeS: 1,
};
const job = {
  id: 'j',
  commands: [{ id: 'a', kind: 'ffmpeg' as const, argv: ['-i', '{in:in.mp4}', '{out:out.wav}'] }],
  inputs: [{ name: 'in.mp4', key: 'k/in.mp4' }],
  outputs: [{ name: 'out.wav', key: 'k/out.wav', contentType: 'audio/wav' }],
  files: [],
};

function make(envOver: Record<string, string> = {}, storageOver: Record<string, unknown> = {}) {
  const env = readFfmpegEnv({
    FFMPEG_REMOTE_URL: 'https://w',
    FFMPEG_REMOTE_AUTH: 'none',
    ...envOver,
  });
  const client = {
    postJob: jest.fn().mockResolvedValue(okBody()),
    health: jest.fn().mockResolvedValue(health),
  };
  const storage = {
    supportsPresignedUrls: () => true,
    getUrl: jest.fn(async (k: string) => `https://b/${k}`),
    getPresignedUploadUrl: jest.fn(async (k: string) => `https://b/put/${k}`),
    getMetadata: jest.fn().mockResolvedValue({ size: 5 }),
    ...storageOver,
  };
  let now = 1_000_000;
  const executor = new RemoteFfmpegExecutor(storage as never, {
    env: () => env,
    clientFactory: () => client as never,
    now: () => now,
  });
  return {
    executor,
    client,
    storage,
    tick: (ms: number) => {
      now += ms;
    },
  };
}
const sig = () => new AbortController().signal;

// The executor logs one structured line per job; keep it out of the test output
// while still asserting what it says.
let logSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;
beforeEach(() => {
  logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('semverLt()', () => {
  it('compares numerically, not lexically', () => {
    expect(semverLt('0.9.0', '0.10.0')).toBe(true);
    expect(semverLt('1.2.3', '1.2.3')).toBe(false);
    expect(semverLt('0.4.31-rc.1', '0.5.0')).toBe(true);
  });
});

describe('ready()', () => {
  it('is false without a URL', async () => {
    expect(await make({ FFMPEG_REMOTE_URL: '' }).executor.ready()).toMatchObject({
      ok: false,
      reason: expect.stringContaining('FFMPEG_REMOTE_URL'),
    });
  });
  it('is false when storage cannot presign / presigns relative (local-FS) URLs', async () => {
    expect(await make({}, { supportsPresignedUrls: () => false }).executor.ready()).toMatchObject({
      ok: false,
      reason: expect.stringContaining('presign'),
    });
    expect(
      await make(
        {},
        { getPresignedUploadUrl: async () => '/api/storage/presigned/local?x' },
      ).executor.ready(),
    ).toMatchObject({ ok: false, reason: expect.stringContaining('local filesystem') });
  });
  it('requires https for google_id_token', async () => {
    expect(
      await make({
        FFMPEG_REMOTE_URL: 'http://w',
        FFMPEG_REMOTE_AUTH: 'google_id_token',
      }).executor.ready(),
    ).toMatchObject({ ok: false, reason: expect.stringContaining('https') });
  });
  it('rejects a malformed SA key', async () => {
    expect(
      await make({
        FFMPEG_REMOTE_AUTH: 'google_id_token',
        FFMPEG_REMOTE_SA_KEY_JSON: '{nope',
      }).executor.ready(),
    ).toMatchObject({ ok: false, reason: expect.stringContaining('valid JSON') });
  });
  it('is true on a healthy worker and caches healthz for 60 s', async () => {
    const { executor, client, tick } = make();
    expect(await executor.ready()).toEqual({ ok: true, version: '0.4.31' });
    await executor.ready();
    tick(59_000);
    await executor.ready();
    expect(client.health).toHaveBeenCalledTimes(1);
    tick(2_000);
    await executor.ready();
    expect(client.health).toHaveBeenCalledTimes(2);
  });
  it('unreachable worker and too-old worker are not ready', async () => {
    const a = make();
    a.client.health.mockRejectedValue(new WorkerTransportError('ECONNREFUSED'));
    expect(await a.executor.ready()).toMatchObject({
      ok: false,
      reason: expect.stringContaining('unreachable'),
    });
    const b = make({ FFMPEG_WORKER_MIN_VERSION: '0.5.0' });
    expect(await b.executor.ready()).toMatchObject({
      ok: false,
      reason: expect.stringContaining('older than'),
    });
  });
});

it('resolves through Nest DI with only the storage adapter provided', async () => {
  const moduleRef = await Test.createTestingModule({
    providers: [RemoteFfmpegExecutor, { provide: STORAGE_ADAPTER, useValue: {} }],
  }).compile();
  expect(moduleRef.get(RemoteFfmpegExecutor).name).toBe('remote');
});

describe('run()', () => {
  it('builds the envelope from signed URLs, posts it, confirms outputs via getMetadata, returns a remote result', async () => {
    const { executor, client, storage } = make();
    const res = await executor.run(job, { signal: sig() });
    expect(storage.getUrl).toHaveBeenCalledWith('k/in.mp4', expect.any(Number));
    expect(storage.getPresignedUploadUrl).toHaveBeenCalledWith(
      'k/out.wav',
      expect.any(Number),
      2 * 1024 ** 3,
    );
    expect(client.postJob.mock.calls[0][0]).toMatchObject({
      v: 1,
      inputs: [{ name: 'in.mp4', url: 'https://b/k/in.mp4' }],
      outputs: [{ name: 'out.wav', url: 'https://b/put/k/out.wav', contentType: 'audio/wav' }],
    });
    expect(storage.getMetadata).toHaveBeenCalledWith('k/out.wav');
    expect(res).toMatchObject({
      executor: 'remote',
      outputs: [{ name: 'out.wav', key: 'k/out.wav', bytes: 5 }],
      worker: { version: '0.4.31' },
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'ffmpeg_remote_job',
        job: 'j',
        ok: true,
        commands: ['a:0'],
      }),
    );
  });
  it('a worker "success" whose output is not in storage is FFMPEG_FAILED', async () => {
    const { executor, storage } = make();
    storage.getMetadata.mockRejectedValue(new Error('not found'));
    await expect(executor.run(job, { signal: sig() })).rejects.toMatchObject({
      code: 'FFMPEG_FAILED',
    });
  });
  it('transport failure → FFMPEG_EXECUTOR_UNAVAILABLE; worker ok:false codes map through result-mapping', async () => {
    const a = make();
    a.client.postJob.mockRejectedValue(new WorkerTransportError('503', 503, true));
    await expect(a.executor.run(job, { signal: sig() })).rejects.toMatchObject({
      code: 'FFMPEG_EXECUTOR_UNAVAILABLE',
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'ffmpeg_remote_job',
        ok: false,
        code: 'FFMPEG_EXECUTOR_UNAVAILABLE',
      }),
    );
    const b = make();
    b.client.postJob.mockResolvedValue(
      okBody({ ok: false, code: 'INPUT_FETCH_FAILED', message: '404 from bucket' }),
    );
    await expect(b.executor.run(job, { signal: sig() })).rejects.toMatchObject({
      code: 'FILE_NOT_FOUND',
    });
  });
  it('the in-flight fuse fails fast with FFMPEG_BUSY and releases in finally', async () => {
    const { executor, client } = make({ FFMPEG_REMOTE_MAX_INFLIGHT: '1' });
    let release!: (v: unknown) => void;
    client.postJob.mockReturnValueOnce(
      new Promise((r) => {
        release = r;
      }),
    );
    const first = executor.run(job, { signal: sig() });
    await expect(executor.run(job, { signal: sig() })).rejects.toMatchObject({
      code: 'FFMPEG_BUSY',
    });
    release(okBody());
    await first;
    await expect(executor.run(job, { signal: sig() })).resolves.toMatchObject({
      executor: 'remote',
    });
  });
  it('argvThreads() is 0 (auto on the worker)', () => {
    expect(make().executor.argvThreads()).toBe(0);
  });
});
