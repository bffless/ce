/**
 * remote_request handler end-to-end: the REAL RemoteRequestHandler driving the
 * REAL ffmpeg Worker (workers/ffmpeg/server.mjs, spawned as a child process) over
 * HTTP, through a REAL RemoteConnectionsService resolving an env-pinned
 * connection (`REMOTE_CONNECTION_WORKER_*`). No storage/MinIO involved — the
 * Worker is reused only because it is the one HTTP service this repo already
 * spawns for integration tests, and its `/health` + `/jobs` routes are enough
 * to exercise a real request/response round trip and a real remote-side error.
 *
 * Double-gated, same convention as ffmpeg.remote.spec.ts (and deliberately the
 * SAME gate, so both suites run — or skip — together under one compose profile):
 *   - ffmpeg + ffprobe on PATH (the Worker reports /health 503 without them)
 *   - FFMPEG_IT_MINIO_ENDPOINT, e.g. http://localhost:9000
 *     (unused by this file directly; kept as the shared gate)
 *
 *   docker run -d --rm -p 9000:9000 --name it-minio minio/minio server /data
 *   cd apps/backend && FFMPEG_IT_MINIO_ENDPOINT=http://localhost:9000 \
 *     pnpm test:integration -- src/pipelines/__tests__/integration/remote-request.spec.ts
 *   docker stop it-minio
 */
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import * as net from 'net';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import type { Request } from 'express';
import { ExpressionEvaluator } from '../../execution/expression-evaluator';
import { StepHandlerRegistry } from '../../execution/step-handler.registry';
import { RemoteRequestHandler } from '../../handlers/remote-request.handler';
import { RemoteConnectionsService } from '../../../remote-connections/remote-connections.service';
import type { RemoteConnectionsPort } from '../../../remote-connections/remote-connections.tokens';
import type { PipelineContext, StepResult } from '../../execution/pipeline-context.interface';
import type { PipelineStep } from '../../types';

jest.setTimeout(60_000);

const hasFfmpeg =
  spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;
const MINIO_ENDPOINT = process.env.FFMPEG_IT_MINIO_ENDPOINT;
const RUN = hasFfmpeg && Boolean(MINIO_ENDPOINT);

/** Repo root — workers/ live outside apps/backend. Same depth as ffmpeg.remote.spec.ts. */
const REPO_ROOT = path.resolve(__dirname, '../../../../../..');
const WORKER_ENTRY = path.join(REPO_ROOT, 'workers/ffmpeg/server.mjs');

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
      const body = (await res.json()) as { ok?: boolean };
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
  'remote_request handler (integration: CE -> RemoteConnectionsService -> worker)',
  () => {
    let child: ChildProcess | undefined;
    let workerUrl: string;
    let handler: RemoteRequestHandler;
    let workerLog = '';
    const silenced: jest.SpyInstance[] = [];

    const context = (): PipelineContext => ({
      request: { headers: {} } as unknown as Request,
      user: undefined,
      stepOutputs: {},
      projectId: 'p1',
      pipelineId: 'pl-1',
      metadata: { path: '/', method: 'POST', headers: {}, query: {}, body: {} },
    });

    const step = (config: Record<string, unknown>): PipelineStep =>
      ({
        id: 's',
        pipelineId: 'pl-1',
        name: 'call',
        handlerType: 'remote_request',
        config: config as PipelineStep['config'],
        order: 0,
        isEnabled: true,
      }) as PipelineStep;

    beforeAll(async () => {
      silenced.push(
        jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
        jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined),
      );

      const port = await freePort();
      workerUrl = `http://127.0.0.1:${port}`;
      child = spawn(process.execPath, [WORKER_ENTRY], {
        cwd: REPO_ROOT,
        env: { ...process.env, PORT: String(port), WORKER_ALLOW_HTTP: '1', WORKER_VERSION: 'it' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const capture = (chunk: Buffer) => {
        workerLog += chunk.toString();
      };
      child.stdout?.on('data', capture);
      child.stderr?.on('data', capture);
      await waitForHealth(workerUrl);

      // NODE_ENV=test (jest's default) short-circuits onModuleInit's DB reload,
      // so this connection is entirely env-driven — no Postgres involved.
      const svc = new RemoteConnectionsService(
        () =>
          ({
            REMOTE_CONNECTION_WORKER_URL: workerUrl,
            REMOTE_CONNECTION_WORKER_AUTH: 'none',
          }) as unknown as NodeJS.ProcessEnv,
      );
      const port_: RemoteConnectionsPort = {
        resolve: (n) => svc.resolve(n),
        client: (c) => svc.client(c),
        acquire: (c) => svc.fuse.acquire(c.name, c.maxInflight),
      };
      handler = new RemoteRequestHandler(
        { register: () => undefined } as unknown as StepHandlerRegistry,
        new ExpressionEvaluator(),
        port_,
      );
    });

    afterAll(async () => {
      if (child && child.exitCode === null && !child.killed) child.kill('SIGKILL');
      for (const spy of silenced) spy.mockRestore();
    });

    it('GET /health round-trips through the real worker connection', async () => {
      const r: StepResult = await handler.execute(
        context(),
        step({ connection: 'worker', path: '/health', method: 'GET' }),
      );
      expect(r.success).toBe(true);
      const out = r.output as { ok: boolean; status: number; body: { ok: boolean } };
      expect(out.status).toBe(200);
      expect(out.body.ok).toBe(true);
    });

    it('a bad envelope fails the step with REMOTE_REQUEST_ERROR carrying the worker’s 400', async () => {
      const r: StepResult = await handler.execute(
        context(),
        step({ connection: 'worker', path: '/jobs', method: 'POST', body: '{"v":1}' }),
      );
      expect(r.success).toBe(false);
      expect(r.error?.code).toBe('REMOTE_REQUEST_ERROR');
      expect((r.error?.details as { status: number }).status).toBe(400);
      if (workerLog.includes('handler_error')) throw new Error(`worker logged: ${workerLog}`);
    });

    it('failOnError: false turns the same bad envelope into a tolerated success', async () => {
      const r: StepResult = await handler.execute(
        context(),
        step({
          connection: 'worker',
          path: '/jobs',
          method: 'POST',
          body: '{"v":1}',
          failOnError: false,
        }),
      );
      expect(r.success).toBe(true);
      const out = r.output as { ok: boolean; status: number };
      expect(out.ok).toBe(false);
      expect(out.status).toBe(400);
    });
  },
);
