/**
 * RemoteFfmpegExecutor end-to-end: the REAL FfmpegHandler driving the REAL Worker
 * (workers/ffmpeg/server.mjs, spawned as a child process) over a REAL MinIO, with
 * every byte moving through presigned URLs — CE only ever signs them.
 *
 * Double-gated, per the repo convention (ternary describe, cf. ffmpeg.handler.spec.ts):
 *   - ffmpeg + ffprobe on PATH (both CE-side fixture generation and the Worker need them)
 *   - FFMPEG_IT_MINIO_ENDPOINT, e.g. http://localhost:9000
 *     (FFMPEG_IT_MINIO_ACCESS_KEY / _SECRET_KEY default to minioadmin/minioadmin,
 *      bucket `ffmpeg-it`, created by the test)
 *
 *   docker run -d --rm -p 9000:9000 --name it-minio minio/minio server /data
 *   cd apps/backend && FFMPEG_IT_MINIO_ENDPOINT=http://localhost:9000 \
 *     pnpm test:integration -- src/pipelines/__tests__/integration/ffmpeg.remote.spec.ts
 *   docker stop it-minio
 */
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { MinioStorageAdapter } from '../../../storage/minio.adapter';
import { ExpressionEvaluator } from '../../execution/expression-evaluator';
import { FfmpegRunnerService } from '../../ffmpeg/ffmpeg-runner.service';
import { FfmpegScratchService } from '../../ffmpeg/ffmpeg-scratch.service';
import { FfmpegExecutorSelector } from '../../ffmpeg/executor/ffmpeg-executor.selector';
import { LocalFfmpegExecutor } from '../../ffmpeg/executor/local-ffmpeg.executor';
import { RemoteFfmpegExecutor } from '../../ffmpeg/executor/remote/remote-ffmpeg.executor';
import { FfmpegHandler } from '../../handlers/ffmpeg.handler';
import type { PipelineContext } from '../../execution/pipeline-context.interface';
import type { PipelineStep } from '../../types';

jest.setTimeout(120_000);

const hasFfmpeg =
  spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;
const MINIO_ENDPOINT = process.env.FFMPEG_IT_MINIO_ENDPOINT;
const RUN = hasFfmpeg && Boolean(MINIO_ENDPOINT);

/** Repo root — workers/ live outside apps/backend. */
const REPO_ROOT = path.resolve(__dirname, '../../../../../..');
const WORKER_ENTRY = path.join(REPO_ROOT, 'workers/ffmpeg/server.mjs');
const BUCKET = 'ffmpeg-it';
const PREFIX = 'o/r/uploads/it';
const SRC_KEY = `${PREFIX}/source.mp4`;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(base: string, deadlineMs = 15_000): Promise<void> {
  const until = Date.now() + deadlineMs;
  let last = 'never answered';
  while (Date.now() < until) {
    try {
      const res = await fetch(`${base}/health`);
      const body = (await res.json()) as { ok?: boolean; ffmpeg?: string | null };
      if (res.ok && body.ok) return;
      last = `health ${res.status} ${JSON.stringify(body)}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`worker did not become healthy: ${last}`);
}

(RUN ? describe : describe.skip)(
  'ffmpeg remote executor (integration: CE ↔ worker ↔ MinIO)',
  () => {
    let adapter: MinioStorageAdapter;
    let handler: FfmpegHandler;
    let child: ChildProcess | undefined;
    let workerUrl: string;
    let workerLog = '';
    let baseDir: string;
    let scratchRoot: string;
    let workerScratch: string;
    let logSpy: jest.SpyInstance;
    const silenced: jest.SpyInstance[] = [];
    const savedEnv: Record<string, string | undefined> = {};

    const context = () =>
      ({
        stepOutputs: {},
        metadata: { body: {}, headers: {} },
        projectId: 'p1',
      }) as unknown as PipelineContext;
    const step = (config: Record<string, unknown>): PipelineStep =>
      ({
        id: 's',
        name: 'it',
        handlerType: 'ffmpeg_handler',
        config,
        isEnabled: true,
      }) as unknown as PipelineStep;

    const setEnv = (key: string, value: string) => {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    };

    /** The one log line the remote executor emits per successful job (D11). */
    const remoteJobLogs = () =>
      logSpy.mock.calls
        .flat()
        .filter(
          (arg): arg is { event: string; ok: boolean; worker: { version: string } } =>
            typeof arg === 'object' &&
            arg !== null &&
            (arg as { event?: string }).event === 'ffmpeg_remote_job',
        );

    beforeAll(async () => {
      // Nest's Logger writes straight to stdout; the MinIO adapter alone would bury
      // the run. Spying also gives the ffmpeg_remote_job assertion its evidence.
      logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      silenced.push(
        logSpy,
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
        jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined),
      );

      baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-remote-it-'));
      scratchRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-remote-it-scratch-'));
      workerScratch = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-remote-it-worker-'));
      setEnv('FFMPEG_SCRATCH_DIR', scratchRoot);

      // 2s 320x240 30fps test video with a 440Hz tone — same recipe as ffmpeg.handler.spec.
      const fixture = path.join(baseDir, 'fixture.mp4');
      const gen = spawnSync('ffmpeg', [
        '-nostdin',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=2:size=320x240:rate=30',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=2',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-shortest',
        fixture,
      ]);
      expect(gen.status).toBe(0);

      const endpoint = new URL(MINIO_ENDPOINT!);
      adapter = new MinioStorageAdapter({
        endPoint: endpoint.hostname,
        port: Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80)),
        useSSL: endpoint.protocol === 'https:',
        accessKey: process.env.FFMPEG_IT_MINIO_ACCESS_KEY || 'minioadmin',
        secretKey: process.env.FFMPEG_IT_MINIO_SECRET_KEY || 'minioadmin',
        bucket: BUCKET,
      });
      // Creates the bucket when missing and proves read/write before anything else runs.
      await adapter.testConnection();
      await adapter.deletePrefix(PREFIX);
      await adapter.upload(await fs.readFile(fixture), SRC_KEY, { mimeType: 'video/mp4' });

      const port = await freePort();
      workerUrl = `http://127.0.0.1:${port}`;
      child = spawn(process.execPath, [WORKER_ENTRY], {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          PORT: String(port),
          WORKER_ALLOW_HTTP: '1',
          WORKER_VERSION: 'it',
          WORKER_SCRATCH_DIR: workerScratch,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const capture = (chunk: Buffer) => {
        workerLog += chunk.toString();
      };
      child.stdout?.on('data', capture);
      child.stderr?.on('data', capture);
      child.on('error', capture as unknown as () => void);
      await waitForHealth(workerUrl);

      setEnv('FFMPEG_EXECUTOR', 'remote');
      setEnv('FFMPEG_REMOTE_URL', workerUrl);
      setEnv('FFMPEG_REMOTE_AUTH', 'none');

      // Capability: the operator flag is on and local binaries exist, so BOTH
      // executors are enabled and the `executor: 'local'` case has a real peer.
      const capability = {
        isFlagOn: async () => true,
        isEnabled: async () => true,
        isAvailable: () => true,
        getVersion: () => 'ffmpeg version (integration)',
      };
      const local = new LocalFfmpegExecutor(
        new FfmpegRunnerService() as never,
        new FfmpegScratchService() as never,
        adapter as never,
      );
      const remote = new RemoteFfmpegExecutor(adapter as never);
      const selector = new FfmpegExecutorSelector(local, remote, capability as never);
      handler = new FfmpegHandler(
        { register: () => undefined } as never,
        new ExpressionEvaluator(),
        capability as never,
        new FfmpegRunnerService() as never,
        new FfmpegScratchService() as never,
        { resolveOwnerRepo: async () => ({ owner: 'o', repo: 'r' }) } as never,
        adapter as never,
        selector,
      );
    });

    afterAll(async () => {
      if (child && child.exitCode === null && !child.killed) child.kill('SIGKILL');
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      if (adapter) await adapter.deletePrefix(PREFIX).catch(() => undefined);
      for (const spy of silenced) spy.mockRestore();
      await Promise.all(
        [baseDir, scratchRoot, workerScratch]
          .filter(Boolean)
          .map((dir) => fs.rm(dir, { recursive: true, force: true })),
      );
    });

    it('probe with no input reports both executors and remote as the default', async () => {
      const r = await handler.execute(context(), step({ operation: 'probe' }));
      expect(r.success).toBe(true);
      const out = r.output as {
        server: boolean;
        executors: string[];
        defaultExecutor: string;
        remote?: { ready: boolean; version?: string };
      };
      expect(out.server).toBe(true);
      expect(out.executors).toEqual(expect.arrayContaining(['local', 'remote']));
      expect(out.defaultExecutor).toBe('remote');
      expect(out.remote).toEqual({ ready: true, version: 'it' });
    });

    it('probe runs on the worker and reads the fixture back through a signed GET', async () => {
      const r = await handler.execute(
        context(),
        step({ operation: 'probe', input: 'it/source.mp4' }),
      );
      expect(r.success).toBe(true);
      const out = r.output as { duration: number; streams: unknown[]; executor: string };
      expect(out.duration).toBeCloseTo(2, 0);
      expect(out.streams.length).toBeGreaterThanOrEqual(2);
      expect(out.executor).toBe('remote');
    });

    it('extract_audio uploads a real wav to MinIO through the signed PUT', async () => {
      logSpy.mockClear();
      const r = await handler.execute(
        context(),
        step({ operation: 'extract_audio', input: 'it/source.mp4', output: 'it/audio.wav' }),
      );
      expect(r.success).toBe(true);
      const out = r.output as {
        storage_path: string;
        content_type: string;
        size: number;
        executor: string;
        bytesIn: number;
        bytesOut: number;
        timings: { totalMs: number; transferInMs: number; transferOutMs: number };
      };
      expect(out.executor).toBe('remote');
      expect(out.storage_path).toBe(`${PREFIX}/audio.wav`);
      expect(out.content_type).toBe('audio/wav');
      expect(out.size).toBeGreaterThan(0);
      expect(out.timings.totalMs).toBeGreaterThan(0);
      expect(out.bytesOut).toBe(out.size);
      expect(out.bytesIn).toBeGreaterThan(0);

      // The object is really in the bucket, with the size and content type the
      // Worker's PUT claimed — the whole point of the round trip.
      const meta = await adapter.getMetadata(`${PREFIX}/audio.wav`);
      expect(meta.size).toBe(out.size);
      expect(meta.mimeType).toBe('audio/wav');
      const wav = await adapter.download(`${PREFIX}/audio.wav`);
      expect(wav.subarray(0, 4).toString()).toBe('RIFF');
      expect(wav.readUInt16LE(22)).toBe(1); // mono
      expect(wav.readUInt32LE(24)).toBe(16000); // 16 kHz

      const logged = remoteJobLogs();
      expect(logged.length).toBe(1);
      expect(logged[0]).toMatchObject({ ok: true, worker: { version: 'it' } });
    });

    it('slice writes both the clip and its wav sidecar', async () => {
      const r = await handler.execute(
        context(),
        step({
          operation: 'slice',
          input: 'it/source.mp4',
          spans: [
            { start: 0.25, end: 0.75 },
            { start: 1.0, end: 1.5 },
          ],
          output: 'it/clip.mp4',
          audioOutput: 'it/clip.wav',
          audioFades: true,
        }),
      );
      expect(r.success).toBe(true);
      const out = r.output as {
        duration: number;
        size: number;
        executor: string;
        audio: { storage_path: string; size: number };
      };
      expect(out.executor).toBe('remote');
      expect(out.duration).toBeCloseTo(1, 3);
      expect(out.size).toBeGreaterThan(0);
      expect(out.audio.storage_path).toBe(`${PREFIX}/clip.wav`);
      expect((await adapter.getMetadata(`${PREFIX}/clip.mp4`)).size).toBe(out.size);
      expect((await adapter.getMetadata(`${PREFIX}/clip.wav`)).size).toBe(out.audio.size);

      const probe = await handler.execute(
        context(),
        step({ operation: 'probe', input: 'it/clip.mp4' }),
      );
      expect((probe.output as { duration: number }).duration).toBeCloseTo(1, 0);
    });

    it('concat stream-copies the clip with itself', async () => {
      const r = await handler.execute(
        context(),
        step({
          operation: 'concat',
          inputs: ['it/clip.mp4', 'it/clip.mp4'],
          output: 'it/final.mp4',
        }),
      );
      expect(r.success).toBe(true);
      const out = r.output as { reencoded: boolean; size: number; executor: string };
      expect(out.executor).toBe('remote');
      expect(out.reencoded).toBe(false);
      expect((await adapter.getMetadata(`${PREFIX}/final.mp4`)).size).toBe(out.size);

      const probe = await handler.execute(
        context(),
        step({ operation: 'probe', input: 'it/final.mp4' }),
      );
      expect((probe.output as { duration: number }).duration).toBeCloseTo(2, 0);
    });

    it("step config executor: 'local' runs in-process on the same handler", async () => {
      logSpy.mockClear();
      const r = await handler.execute(
        context(),
        step({
          operation: 'extract_audio',
          input: 'it/source.mp4',
          output: 'it/audio-local.wav',
          executor: 'local',
        }),
      );
      expect(r.success).toBe(true);
      expect((r.output as { executor: string }).executor).toBe('local');
      expect((await adapter.getMetadata(`${PREFIX}/audio-local.wav`)).size).toBeGreaterThan(0);
      // Nothing went to the Worker.
      expect(remoteJobLogs()).toHaveLength(0);
    });

    it('reports FFMPEG_EXECUTOR_UNAVAILABLE once the worker is gone', async () => {
      child!.kill('SIGKILL');
      await new Promise<void>((resolve) => child!.once('exit', () => resolve()));

      const r = await handler.execute(
        context(),
        step({ operation: 'extract_audio', input: 'it/source.mp4', output: 'it/audio-dead.wav' }),
      );
      expect(r.success).toBe(false);
      expect(r.error?.code).toBe('FFMPEG_EXECUTOR_UNAVAILABLE');
      expect(await adapter.exists(`${PREFIX}/audio-dead.wav`)).toBe(false);
      if (workerLog.includes('handler_error')) throw new Error(`worker logged: ${workerLog}`);
    });
  },
);
