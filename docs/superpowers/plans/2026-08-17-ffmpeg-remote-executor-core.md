# ffmpeg Remote Executor — Core (CE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a `remote` executor behind the unchanged `ffmpeg_handler` so an instance can run ffmpeg jobs on a stateless Worker (Cloud Run reference deployment) via signed storage URLs, configurable by env vars, with a shippable Worker image — while the existing local path stays byte-for-byte compatible.

**Architecture:** Extract today's spawn/scratch/transfer code out of `FfmpegHandler` into a `LocalFfmpegExecutor` behind an `FfmpegExecutor` seam whose unit of work is an `FfmpegJob` (named scratch files + a short list of argv *commands* over one scratch dir). Add a `RemoteFfmpegExecutor` that turns the same job into a v1 wire envelope (signed GET/PUT URLs, CE-authored argv, placeholders), POSTs it to a Worker with a Google ID token, and maps the result back. A tiny `FfmpegExecutorSelector` owns "which executors exist / are ready / is default", drives the capability probe, and applies `step.config.executor` → env default → `FFMPEG_EXECUTOR_UNAVAILABLE`. The Worker (`workers/ffmpeg/`, Node 20, no framework) is a dumb argv runner: fetch inputs → substitute placeholders → spawn each command → upload outputs on success.

**Tech Stack:** NestJS 10 backend (TypeScript, Jest), `google-auth-library` 9.15.1 (already in the lockfile via `@google-cloud/storage`), Node 20 `fetch`/`node:http`/`node:test` for the Worker, Alpine `apk add ffmpeg`, docker compose profiles, GitHub Actions (`main-release.yml`).

**Spec:** `docs/superpowers/specs/2026-08-17-ffmpeg-remote-executor-design.md` (+ `docs/adr/0004-remote-ffmpeg-worker-is-a-dumb-argv-runner-fed-by-signed-urls.md`, `CONTEXT.md` → *Server video ops*). Published copy: https://handoff.bffless.dev/tree/specs/ffmpeg-cloud-run. Epic: bffless/apps#346.

**Scope of THIS plan (Plan 1 of 3):** epic tasks **T1 seam, T2 remote executor, T3 handler wiring, T4 capability probe, T6 worker, T7 release, T8 tests** — configuration by **env vars only**. Deliberately deferred to follow-on plans: **T5** Admin-Settings Executor UI + DB-stored/encrypted SA key (Plan 2, needs `common/crypto/aes-gcm.ts` + a new settings row), **T9** docs (Plan 2), Studio picker (Plan 3, `bffless/apps`). Plan 1 alone lets an operator set `FFMPEG_EXECUTOR=remote FFMPEG_REMOTE_URL=… FFMPEG_REMOTE_SA_KEY_JSON=…` and get `server:true` on a 1 GB droplet — that is the epic's proof (D12 rollout steps 1–2, 4).

## Global Constraints

- **Local behaviour unchanged (spec §1.1):** existing suites `apps/backend/src/pipelines/handlers/ffmpeg.handler.spec.ts`, `pipelines/ffmpeg/*.spec.ts`, `mcp/tools/proxy-rules.tools.ffmpeg.spec.ts`, and the binary-gated `__tests__/integration/ffmpeg.handler.spec.ts` must stay green. Task 1 (pure refactor) must not edit any existing spec file. Task 4 may only *add* to `createHandler()` in `ffmpeg.handler.spec.ts` (new optional collaborators) and never weaken an assertion.
- **`ffmpeg-args.ts` is the single source of truth for argv (D8).** The Worker never receives an op name; it never contains ffmpeg knowledge beyond "spawn this argv".
- **Bytes never touch CE for `remote` (D3):** inputs via `storageAdapter.getUrl(key, ttl)`, output via `storageAdapter.getPresignedUploadUrl(key, ttl, maxBytes)`. Remote is bucket-only: `ready()` is false when `supportsPresignedUrls?.()` is not `true` — and the local-FS adapter is refused explicitly (its "presigned" URLs are CE-relative `/api/storage/presigned/local?…`, unreachable by a Worker).
- **Auth (D4/D10):** `FFMPEG_REMOTE_AUTH=google_id_token` (default) mints a Google ID token with `audience = worker URL origin`; `none` sends no `Authorization` header. The Worker has no auth code and refuses non-`https` signed URLs unless `WORKER_ALLOW_HTTP=1`.
- **Deadlines (D9):** Cloud Run `--timeout` ≥ `FFMPEG_JOB_MAX_SECONDS` > envelope `maxSeconds` (= `min(FFMPEG_MAX_SECONDS, FFMPEG_JOB_MAX_SECONDS − 60)`). Signed URL TTL = `max(FFMPEG_JOB_MAX_SECONDS, 900)` s. Retry **once**, only on connection-level failure before any response byte (fetch throws, or HTTP 429/503 from the front door); never on ffmpeg failure, timeout, or abort.
- **Concurrency (D5):** Local unchanged (runner slot + memory/disk pre-flight). Remote: in-flight fuse `FFMPEG_REMOTE_MAX_INFLIGHT` (default 8) → `FFMPEG_BUSY` immediately, no queueing.
- **Error codes:** existing list + exactly one new code `FFMPEG_EXECUTOR_UNAVAILABLE`. Worker `INPUT_FETCH_FAILED` → CE `FILE_NOT_FOUND`; `OUTPUT_UPLOAD_FAILED` / `OUTPUT_TOO_LARGE` → `FFMPEG_FAILED` (worker message kept); `FFMPEG_TIMEOUT` stays; transport-level non-2xx / unreachable → `FFMPEG_EXECUTOR_UNAVAILABLE`.
- **Observability (D11):** every op output additionally carries `executor`, `timings{queueMs,transferInMs,ffmpegMs,transferOutMs,totalMs}`, `bytesIn`, `bytesOut`; one structured log event `ffmpeg_remote_job` per remote job. Loggers are `new Logger(<Class>.name)` and log object literals with an `event` key (house style).
- **New env vars** (all read in `ffmpeg-env.ts`, `''` = unset): `FFMPEG_EXECUTOR` (`local`|`remote`, default `local`), `FFMPEG_REMOTE_URL`, `FFMPEG_REMOTE_AUTH` (`google_id_token`|`none`, default `google_id_token`), `FFMPEG_REMOTE_SA_KEY_JSON`, `FFMPEG_REMOTE_MAX_INFLIGHT` (8), `FFMPEG_WORKER_MIN_VERSION` (unset = any), `FFMPEG_MAX_OUTPUT_BYTES` (2 GiB). Every one is passed through in `docker-compose.yml` (backend `environment:` block, next to the existing FFMPEG_* lines ~373–380), mirrored in `docker-compose.build.yml` (~188–195), and documented in `.env.example` §13 (~534–571).
- **Worker image name:** `ghcr.io/bffless/ce-ffmpeg-worker:{<ce-version>,latest}` — the spec wrote `ghcr.io/bffless/ffmpeg-worker`; the release workflow names images `${{ github.repository }}-<name>` (`ce-backend`, `ce-frontend`), so the worker follows the same convention. **Deviation, note it in the epic.**
- **Wire contract deviation (see Task 2 rationale):** the envelope carries `commands: [{id, kind, argv, timeoutSeconds?, fallbackFor?}]` instead of a single top-level `kind`/`argv`. Reason: `slice` + `audioOutput` and `concat`'s re-encode fallback are two ffmpeg invocations over one scratch dir; a single-argv envelope would force a second job that re-downloads the inputs into the Worker (and re-uploads/downloads the clip). The Worker stays a dumb argv runner — it just loops. **Note it in the epic when the wire section is quoted.**
- Node 20 everywhere (Dockerfiles `node:20-alpine`, workflows `node-version: '20'`); pnpm 9; run backend commands from `apps/backend`; TypeScript strict; ESLint/prettier as configured (`pnpm lint` in each app).
- Git: work on branch `feat/ffmpeg-remote-executor` created from `origin/main` in a **new worktree** (`.claude/worktrees/ffmpeg-remote-executor-impl`); the spec docs from branch `spec/ffmpeg-remote-executor` are cherry-picked/copied in as the first commit. Commit per task with conventional-commit messages; **never push or open a PR without the user's go-ahead** (CLAUDE.md).

---

## File structure

**Backend (`apps/backend/src/pipelines/ffmpeg/`)** — new sub-tree `executor/`:

| File | Responsibility |
| --- | --- |
| `executor/ffmpeg-executor.interface.ts` | `FfmpegExecutor`, `FfmpegJob`, `FfmpegJobCommand`, `FfmpegJobResult`, `FfmpegExecutorName`, `EMPTY_TIMINGS` |
| `executor/local-ffmpeg.executor.ts` | `LocalFfmpegExecutor` — moved `downloadToFile` / `uploadFromFile` / `inputSizeBytes` / disk pre-flight / scratch lifecycle / runner calls (Task 1) |
| `executor/remote/envelope.ts` | pure: `FfmpegJob` → wire envelope v1 (placeholders, global flags, TTLs), types `WorkerEnvelope`, `WorkerResponse` (Task 2) |
| `executor/remote/result-mapping.ts` | pure: `WorkerResponse` → `FfmpegJobResult` or typed error (Task 2) |
| `executor/remote/id-token.ts` | `IdTokenMinter` — `google-auth-library` `getIdTokenClient(audience)` cached per audience; `none` → no header (Task 3) |
| `executor/remote/worker-client.ts` | `WorkerClient` — `postJob(envelope, {signal})` with retry-once policy + `health()` (Task 3) |
| `executor/remote/remote-ffmpeg.executor.ts` | `RemoteFfmpegExecutor` — `ready()` (config + presign + healthz cache + min version), fuse, `run()` orchestration, `getMetadata` confirmation, `ffmpeg_remote_job` log (Task 3) |
| `executor/ffmpeg-executor.selector.ts` | `FfmpegExecutorSelector` — enabled set, default, `pick(requested)`, `probe()` payload (Task 4) |
| `ffmpeg-env.ts` | + the new env fields (Task 2) |
| `ffmpeg-errors.ts` | + `FfmpegExecutorUnavailableError` (Task 2) |
| `handlers/ffmpeg.handler.ts` | ops build `FfmpegJob`s and map `FfmpegJobResult`s; executor selection; additive output fields (Tasks 1, 4) |
| `pipelines.module.ts` | providers for `LocalFfmpegExecutor`, `RemoteFfmpegExecutor`, `FfmpegExecutorSelector` (Tasks 1, 4) |

**Surfaces for `executor` config (Task 4):** `execution/step-handler.interface.ts` (TSDoc 672–717), `mcp/tools/proxy-rules.tools.ts:70`, `apps/frontend/src/components/pipelines/handlers/FfmpegHandlerConfig.tsx` + `handlers/types.ts` (~440), and `pipelines/types.ts` needs nothing (handler type unchanged).

**Worker (`workers/ffmpeg/`)** (Task 5): `package.json`, `server.mjs`, `job.mjs`, `Dockerfile`, `README.md`, `test/job.test.mjs`, `test/server.test.mjs`. **Compose/env** (Task 5): `docker-compose.yml` profile `ffmpeg-worker`; `.env.example` §13.

**Integration** (Task 6): `apps/backend/src/pipelines/__tests__/integration/ffmpeg.remote.spec.ts` (gated: ffmpeg binary + `FFMPEG_IT_MINIO_ENDPOINT`). **Release** (Task 7): `.github/workflows/main-release.yml`.

---

### Task 0: Branch + spec docs

**Files:**
- Create worktree `.claude/worktrees/ffmpeg-remote-executor-impl` on branch `feat/ffmpeg-remote-executor` from `origin/main`
- Copy in from `.claude/worktrees/ffmpeg-remote-executor` (uncommitted there): `docs/superpowers/specs/2026-08-17-ffmpeg-remote-executor-design.md`, `docs/adr/0004-remote-ffmpeg-worker-is-a-dumb-argv-runner-fed-by-signed-urls.md`, the `CONTEXT.md` *Server video ops* section, and this plan.

- [ ] **Step 1: Create the worktree**

```bash
cd /home/rico/bffless/repos/ce
git fetch -q origin
git worktree add .claude/worktrees/ffmpeg-remote-executor-impl -b feat/ffmpeg-remote-executor origin/main
cd .claude/worktrees/ffmpeg-remote-executor-impl && git rev-parse --show-toplevel   # must print …/ffmpeg-remote-executor-impl
```

- [ ] **Step 2: Bring the spec docs across**

```bash
SRC=/home/rico/bffless/repos/ce/.claude/worktrees/ffmpeg-remote-executor
cp "$SRC/docs/superpowers/specs/2026-08-17-ffmpeg-remote-executor-design.md" docs/superpowers/specs/
cp "$SRC/docs/adr/0004-remote-ffmpeg-worker-is-a-dumb-argv-runner-fed-by-signed-urls.md" docs/adr/
cp "$SRC/CONTEXT.md" CONTEXT.md
mkdir -p docs/superpowers/plans && cp "$SRC/docs/superpowers/plans/2026-08-17-ffmpeg-remote-executor-core.md" docs/superpowers/plans/
git status --short   # 4 additions + CONTEXT.md modified, nothing else
```

- [ ] **Step 3: Install + baseline**

```bash
pnpm install --frozen-lockfile
cd apps/backend && pnpm test -- ffmpeg 2>&1 | tail -15   # all existing ffmpeg suites PASS before any change
```

- [ ] **Step 4: Commit**

```bash
git add docs CONTEXT.md
git commit -m "docs(ffmpeg): remote executor design spec, ADR-0004 and core implementation plan"
```

---

### Task 1: Executor seam — `FfmpegExecutor` + `LocalFfmpegExecutor` (pure refactor)

**Files:**
- Create: `apps/backend/src/pipelines/ffmpeg/executor/ffmpeg-executor.interface.ts`
- Create: `apps/backend/src/pipelines/ffmpeg/executor/local-ffmpeg.executor.ts`
- Create: `apps/backend/src/pipelines/ffmpeg/executor/local-ffmpeg.executor.spec.ts`
- Modify: `apps/backend/src/pipelines/handlers/ffmpeg.handler.ts` (whole file — ops rewritten to build jobs; `downloadToFile`/`uploadFromFile`/`inputSizeBytes`/`io`/`DISK_MARGIN_BYTES` removed)
- Modify: `apps/backend/src/pipelines/pipelines.module.ts:167-171` (add provider)
- Do NOT modify: `ffmpeg.handler.spec.ts`, `ffmpeg-runner.service.ts`, `ffmpeg-scratch.service.ts`, `ffmpeg-args.ts`.

**Interfaces:**
- Produces (used by Tasks 2–4):

```ts
// executor/ffmpeg-executor.interface.ts
export type FfmpegExecutorName = 'local' | 'remote';

/** A scratch-relative filename → storage key. `name` is the literal file name inside the job's scratch dir. */
export interface FfmpegJobInput { name: string; key: string }
export interface FfmpegJobOutput { name: string; key: string; contentType: string }
/** Small text files CE authors (concat list). Also materialised as `<scratch>/<name>`. */
export interface FfmpegJobFile { name: string; content: string }

/**
 * One binary invocation. `argv` is CE-authored (ffmpeg-args.ts) and refers to scratch files ONLY through
 * placeholders `{in:NAME}` `{out:NAME}` `{file:NAME}` (all resolve to `<scratch>/<NAME>`); the executor
 * substitutes real paths. Global flags (-nostdin/-hide_banner/-y) are NOT in argv — executors add them.
 * `fallbackFor`: run this command only if the named earlier command exited non-zero (FFMPEG_FAILED);
 * a killed/timed-out command aborts the whole job instead. (concat's re-encode fallback.)
 */
export interface FfmpegJobCommand {
  id: string;
  kind: 'ffmpeg' | 'ffprobe';
  argv: string[];
  timeoutSeconds?: number;
  fallbackFor?: string;
}

export interface FfmpegJob {
  /** Correlation only (step id / name). */
  id: string;
  commands: FfmpegJobCommand[];
  inputs: FfmpegJobInput[];
  outputs: FfmpegJobOutput[];
  files: FfmpegJobFile[];
}

export interface FfmpegJobTimings {
  queueMs: number; transferInMs: number; ffmpegMs: number; transferOutMs: number; totalMs: number;
}
export const EMPTY_TIMINGS: FfmpegJobTimings = { queueMs: 0, transferInMs: 0, ffmpegMs: 0, transferOutMs: 0, totalMs: 0 };

export interface FfmpegJobResult {
  executor: FfmpegExecutorName;
  /** stdout of the LAST command that ran (ffprobe json for probe). */
  stdout: string;
  stderrTail: string;
  commands: Array<{ id: string; ran: boolean; exitCode: number | null }>;
  outputs: Array<{ name: string; key: string; bytes: number }>;
  bytesIn: number;
  bytesOut: number;
  timings: FfmpegJobTimings;
  worker?: { version: string; ffmpeg: string };
}

export interface FfmpegExecutorReadiness { ok: boolean; reason?: string; version?: string }

export interface FfmpegExecutor {
  readonly name: FfmpegExecutorName;
  /** `-threads` value CE should bake into argv for this executor (local: FFMPEG_THREADS; remote: 0 = auto). */
  argvThreads(): number;
  ready(): Promise<FfmpegExecutorReadiness>;
  /** Throws the typed ffmpeg-errors (FfmpegBusyError, FfmpegProcessError, …) — the handler maps them. */
  run(job: FfmpegJob, opts: { signal: AbortSignal }): Promise<FfmpegJobResult>;
}
```

- [ ] **Step 1: Write the failing executor spec**

`apps/backend/src/pipelines/ffmpeg/executor/local-ffmpeg.executor.spec.ts`:

```ts
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { LocalFfmpegExecutor } from './local-ffmpeg.executor';
import { FfmpegProcessError } from '../ffmpeg-errors';
import type { FfmpegJob } from './ffmpeg-executor.interface';

function make(overrides: { runner?: { run: jest.Mock } } = {}) {
  const runner = overrides.runner ?? { run: jest.fn().mockResolvedValue({ stdout: '', stderrTail: '' }) };
  const scratch = {
    createJobDir: jest.fn().mockImplementation(() => fsp.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-lx-'))),
    cleanup: jest.fn().mockResolvedValue(undefined),
    assertFreeSpace: jest.fn().mockResolvedValue(undefined),
  };
  const storage = {
    download: jest.fn().mockResolvedValue(Buffer.from('bytes')),
    upload: jest.fn().mockResolvedValue('k'),
    getMetadata: jest.fn().mockResolvedValue({ size: 1000 }),
  };
  const executor = new LocalFfmpegExecutor(runner as never, scratch as never, storage as never);
  // the runner "produces" the last argv token as a file in cwd (mirrors ffmpeg.handler.spec extractSetup)
  runner.run.mockImplementation(async ({ args, cwd }: { args: string[]; cwd: string }) => {
    await fsp.writeFile(path.join(cwd, path.basename(args[args.length - 1])), 'out-bytes');
    return { stdout: '', stderrTail: '' };
  });
  return { executor, runner, scratch, storage };
}

const job = (over: Partial<FfmpegJob> = {}): FfmpegJob => ({
  id: 'j1',
  commands: [{ id: 'main', kind: 'ffmpeg', argv: ['-i', '{in:in.mp4}', '-vn', '{out:out.wav}'] }],
  inputs: [{ name: 'in.mp4', key: 'o/r/uploads/a.mp4' }],
  outputs: [{ name: 'out.wav', key: 'o/r/uploads/a.wav', contentType: 'audio/wav' }],
  files: [],
  ...over,
});

describe('LocalFfmpegExecutor', () => {
  it('materialises inputs, substitutes placeholders with scratch paths, uploads outputs, cleans up', async () => {
    const { executor, runner, scratch, storage } = make();
    const res = await executor.run(job(), { signal: new AbortController().signal });
    const req = runner.run.mock.calls[0][0];
    const cwd = req.cwd as string;
    expect(req.binary).toBe('ffmpeg');
    expect(req.args).toEqual(['-i', path.join(cwd, 'in.mp4'), '-vn', path.join(cwd, 'out.wav')]);
    expect(storage.upload).toHaveBeenCalledWith(expect.any(Buffer), 'o/r/uploads/a.wav', { mimeType: 'audio/wav' });
    expect(res).toMatchObject({
      executor: 'local',
      commands: [{ id: 'main', ran: true, exitCode: 0 }],
      outputs: [{ name: 'out.wav', key: 'o/r/uploads/a.wav', bytes: 9 }],
      bytesIn: 1000,
      bytesOut: 9,
    });
    expect(res.timings.totalMs).toBeGreaterThanOrEqual(0);
    expect(scratch.assertFreeSpace).toHaveBeenCalledWith(2 * 1000 + 64 * 1024 * 1024);
    expect(scratch.cleanup).toHaveBeenCalledTimes(1);
  });

  it('writes job files into scratch and resolves {file:NAME}', async () => {
    const { executor, runner } = make();
    await executor.run(
      job({
        commands: [{ id: 'main', kind: 'ffmpeg', argv: ['-f', 'concat', '-i', '{file:list.txt}', '{out:out.wav}'] }],
        files: [{ name: 'list.txt', content: "file 'in.mp4'\n" }],
      }),
      { signal: new AbortController().signal },
    );
    const { args, cwd } = runner.run.mock.calls[0][0];
    expect(args[3]).toBe(path.join(cwd, 'list.txt'));
    await expect(fsp.readFile(path.join(cwd, 'list.txt'), 'utf8')).resolves.toBe("file 'in.mp4'\n");
  });

  it('runs a fallbackFor command only when its target exits non-zero (FFMPEG_FAILED)', async () => {
    const { executor, runner } = make();
    runner.run
      .mockRejectedValueOnce(new FfmpegProcessError('boom', 1, 'stream mismatch'))
      .mockImplementationOnce(async ({ args, cwd }: { args: string[]; cwd: string }) => {
        await fsp.writeFile(path.join(cwd, path.basename(args[args.length - 1])), 'x');
        return { stdout: '', stderrTail: '' };
      });
    const res = await executor.run(
      job({
        commands: [
          { id: 'copy', kind: 'ffmpeg', argv: ['-c', 'copy', '{out:out.wav}'] },
          { id: 'reencode', kind: 'ffmpeg', argv: ['-c:v', 'libx264', '{out:out.wav}'], fallbackFor: 'copy' },
        ],
      }),
      { signal: new AbortController().signal },
    );
    expect(runner.run).toHaveBeenCalledTimes(2);
    expect(res.commands).toEqual([
      { id: 'copy', ran: true, exitCode: 1 },
      { id: 'reencode', ran: true, exitCode: 0 },
    ]);
  });

  it('skips the fallback when its target succeeded, and rethrows non-FFMPEG_FAILED errors untouched', async () => {
    const { executor, runner } = make();
    const res = await executor.run(
      job({ commands: [
        { id: 'copy', kind: 'ffmpeg', argv: ['{out:out.wav}'] },
        { id: 'reencode', kind: 'ffmpeg', argv: ['{out:out.wav}'], fallbackFor: 'copy' },
      ] }),
      { signal: new AbortController().signal },
    );
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(res.commands[1]).toEqual({ id: 'reencode', ran: false, exitCode: null });

    const busy = Object.assign(new Error('busy'), { code: 'FFMPEG_BUSY' });
    runner.run.mockRejectedValueOnce(busy);
    await expect(executor.run(job(), { signal: new AbortController().signal })).rejects.toBe(busy);
  });

  it('maps a missing input object to FILE_NOT_FOUND and always cleans up', async () => {
    const { executor, storage, scratch } = make();
    storage.download.mockRejectedValue(new Error('File not found: o/r/uploads/a.mp4'));
    await expect(executor.run(job(), { signal: new AbortController().signal })).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
    expect(scratch.cleanup).toHaveBeenCalledTimes(1);
  });

  it('rejects an argv placeholder that names no job file', async () => {
    const { executor } = make();
    await expect(
      executor.run(job({ commands: [{ id: 'm', kind: 'ffmpeg', argv: ['{in:nope.mp4}'] }] }), { signal: new AbortController().signal }),
    ).rejects.toThrow(/unknown placeholder/);
  });
});
```

- [ ] **Step 2: Run it — must fail (module not found)**

```bash
cd apps/backend && pnpm test -- local-ffmpeg.executor 2>&1 | tail -5
```
Expected: FAIL `Cannot find module './local-ffmpeg.executor'`.

- [ ] **Step 3: Create the interface file** (contents exactly as in **Interfaces** above, plus a header comment pointing at the spec §1.1 and ADR-0004).

- [ ] **Step 4: Implement `LocalFfmpegExecutor`**

`apps/backend/src/pipelines/ffmpeg/executor/local-ffmpeg.executor.ts` — the moved code, verbatim where possible:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { createReadStream, createWriteStream } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { STORAGE_ADAPTER, type IStorageAdapter } from '../../../storage/storage.interface';
import { readFfmpegEnv } from '../ffmpeg-env';
import { FfmpegProcessError, FfmpegStepTimeoutError } from '../ffmpeg-errors';
import { FfmpegRunnerService } from '../ffmpeg-runner.service';
import { FfmpegScratchService } from '../ffmpeg-scratch.service';
import type { FfmpegExecutor, FfmpegExecutorReadiness, FfmpegJob, FfmpegJobResult } from './ffmpeg-executor.interface';

/** ~64MB slack demanded beyond the 2× input estimate in the disk pre-flight. */
const DISK_MARGIN_BYTES = 64 * 1024 * 1024;
const PLACEHOLDER = /^\{(in|out|file):([^}]+)\}$/;

/**
 * "Local server": the CE backend materialises the job in a scratch dir, spawns each command through
 * FfmpegRunnerService (slot, memory pre-flight, prlimit/nice, watchdog) and streams outputs back to
 * storage. This is the pre-remote behaviour of FfmpegHandler, moved verbatim behind the executor seam.
 */
@Injectable()
export class LocalFfmpegExecutor implements FfmpegExecutor {
  readonly name = 'local' as const;

  constructor(
    private readonly runner: FfmpegRunnerService,
    private readonly scratch: FfmpegScratchService,
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
  ) {}

  argvThreads(): number { return readFfmpegEnv().threads; }

  async ready(): Promise<FfmpegExecutorReadiness> { return { ok: true }; }

  async run(job: FfmpegJob, _opts: { signal: AbortSignal }): Promise<FfmpegJobResult> {
    const t0 = Date.now();
    const bytesIn = await this.inputSizeBytes(job.inputs.map((i) => i.key));
    await this.scratch.assertFreeSpace(2 * bytesIn + DISK_MARGIN_BYTES);
    const jobDir = await this.scratch.createJobDir();
    const local = (name: string) => path.join(jobDir, name);
    const known = new Set([...job.inputs, ...job.outputs, ...job.files].map((f) => f.name));
    try {
      const tIn = Date.now();
      for (const input of job.inputs) await this.downloadToFile(input.key, local(input.name));
      for (const file of job.files) await fs.writeFile(local(file.name), file.content);
      const transferInMs = Date.now() - tIn;

      const commands: FfmpegJobResult['commands'] = [];
      const failed = new Set<string>();
      let stdout = '';
      let stderrTail = '';
      const tRun = Date.now();
      for (const cmd of job.commands) {
        if (cmd.fallbackFor && !failed.has(cmd.fallbackFor)) {
          commands.push({ id: cmd.id, ran: false, exitCode: null });
          continue;
        }
        const args = cmd.argv.map((token) => {
          const m = PLACEHOLDER.exec(token);
          if (!m) return token;
          if (!known.has(m[2])) throw new Error(`ffmpeg job: unknown placeholder ${token}`);
          return local(m[2]);
        });
        try {
          const out = await this.runner.run({ binary: cmd.kind, args, cwd: jobDir, timeoutSeconds: cmd.timeoutSeconds });
          stdout = out.stdout; stderrTail = out.stderrTail;
          commands.push({ id: cmd.id, ran: true, exitCode: 0 });
        } catch (error) {
          const hasFallback = job.commands.some((c) => c.fallbackFor === cmd.id);
          if (error instanceof FfmpegProcessError && hasFallback) {
            failed.add(cmd.id);
            stderrTail = error.stderrTail;
            commands.push({ id: cmd.id, ran: true, exitCode: error.exitCode });
            continue;
          }
          throw error; // busy/timeout/memory — and FFMPEG_FAILED with no fallback — bubble up untouched
        }
      }
      const ffmpegMs = Date.now() - tRun;

      const tOut = Date.now();
      const outputs: FfmpegJobResult['outputs'] = [];
      let bytesOut = 0;
      for (const o of job.outputs) {
        const { size } = await this.uploadFromFile(local(o.name), o.key, o.contentType);
        outputs.push({ name: o.name, key: o.key, bytes: size });
        bytesOut += size;
      }
      const transferOutMs = Date.now() - tOut;
      return {
        executor: 'local', stdout, stderrTail, commands, outputs, bytesIn, bytesOut,
        timings: { queueMs: 0, transferInMs, ffmpegMs, transferOutMs, totalMs: Date.now() - t0 },
      };
    } finally {
      await this.scratch.cleanup(jobDir);
    }
  }

  // ---- moved verbatim from FfmpegHandler (io / downloadToFile / uploadFromFile / inputSizeBytes) ----
  private withDeadline<T>(work: Promise<T>, seconds: number, phase: string): Promise<T> { /* copy of FfmpegHandler.withDeadline */ }
  private io<T>(work: Promise<T>, phase: string): Promise<T> { return this.withDeadline(work, readFfmpegEnv().ioMaxSeconds, phase); }
  private async downloadToFile(key: string, destPath: string): Promise<void> { /* verbatim */ }
  private async uploadFromFile(srcPath: string, key: string, mimeType: string): Promise<{ size: number }> { /* verbatim */ }
  private async inputSizeBytes(keys: string[]): Promise<number> { /* verbatim */ }
}
```

(The four "verbatim" bodies are the ones at `ffmpeg.handler.ts:131-145` and `:222-282` today — copy them, do not rewrite. `queueMs` stays 0 for local: the runner's slot wait is inside `ffmpegMs`; that is acceptable for v1 and stated in the field's TSDoc.)

- [ ] **Step 5: Run the executor spec — PASS**

```bash
pnpm test -- local-ffmpeg.executor 2>&1 | tail -8
```

- [ ] **Step 6: Rewrite the handler ops on top of the seam**

In `ffmpeg.handler.ts`:
- Constructor: keep the existing 7 params in the same order (the spec constructs it positionally) and build the executor internally for now: `this.local = new LocalFfmpegExecutor(runner, scratch, storageAdapter);` (Task 4 replaces this with injected executors + selector; keeping `runner`/`scratch`/`storageAdapter` params in Task 1 is what keeps `ffmpeg.handler.spec.ts` untouched).
- Delete `io`, `downloadToFile`, `uploadFromFile`, `inputSizeBytes`, `DISK_MARGIN_BYTES`, and the `fs`/`createReadStream`/`createWriteStream`/`pipeline` imports if now unused. Keep `withDeadline`, `toErrorResult`, `pathError`, `resolveKey`, `resolveSpans`.
- Add a private helper that runs a job through the executor and returns the result:

```ts
private async runJob(job: FfmpegJob): Promise<FfmpegJobResult> {
  const controller = new AbortController();
  return this.withDeadline(this.local.run(job, { signal: controller.signal }), readFfmpegEnv().jobMaxSeconds, `${job.id} step`, () => controller.abort());
}
```
  and extend `withDeadline(work, seconds, phase, onTimeout?: () => void)` to call `onTimeout?.()` right before rejecting (local ignores the signal — behaviour unchanged). Remove the outer `withDeadline(op(), jobMaxSeconds, …)` wrapper from `execute` since `runJob` now applies it (the ffprobe `timeoutSeconds: 60` becomes `commands[0].timeoutSeconds = 60`).

- The four ops become job builders. Exact bodies:

```ts
private async runProbe(config, context, stepName): Promise<StepResult> {
  const inputKey = await this.resolveKey(config.input!, context, stepName, 'input');
  const inName = `in${path.posix.extname(inputKey) || '.bin'}`;
  const res = await this.runJob({
    id: stepName,
    commands: [{ id: 'probe', kind: 'ffprobe', argv: buildProbeArgs(`{in:${inName}}`), timeoutSeconds: 60 }],
    inputs: [{ name: inName, key: inputKey }],
    outputs: [], files: [],
  });
  const parsed = JSON.parse(res.stdout) as { format?: { duration?: string }; streams?: unknown[] };
  return { success: true, output: { duration: Number(parsed.format?.duration ?? 0), format: parsed.format ?? {}, streams: parsed.streams ?? [], ...this.telemetry(res) } };
}

private async runExtractAudio(config, context, stepName): Promise<StepResult> {
  const inputKey = await this.resolveKey(config.input!, context, stepName, 'input');
  const outputKey = await this.resolveKey(config.output!, context, stepName, 'output');
  const inName = `in${path.posix.extname(inputKey) || '.bin'}`;
  const res = await this.runJob({
    id: stepName,
    commands: [{ id: 'extract', kind: 'ffmpeg', argv: buildExtractAudioArgs(`{in:${inName}}`, '{out:out.wav}') }],
    inputs: [{ name: inName, key: inputKey }],
    outputs: [{ name: 'out.wav', key: outputKey, contentType: 'audio/wav' }],
    files: [],
  });
  return { success: true, output: { storage_path: outputKey, content_type: 'audio/wav', size: res.outputs[0].bytes, ...this.telemetry(res) } };
}

private async runSlice(config, context, stepName): Promise<StepResult> {
  const spans = this.resolveSpans(config.spans, context, stepName);
  const inputKey = await this.resolveKey(config.input!, context, stepName, 'input');
  const outputKey = await this.resolveKey(config.output!, context, stepName, 'output');
  const audioKey = config.audioOutput ? await this.resolveKey(config.audioOutput, context, stepName, 'output') : null;
  const inName = `in${path.posix.extname(inputKey) || '.mp4'}`;
  const commands: FfmpegJobCommand[] = [{
    id: 'slice', kind: 'ffmpeg',
    argv: buildSliceArgs({ input: `{in:${inName}}`, output: '{out:clip.mp4}', spans, threads: this.local.argvThreads(), audioFades: config.audioFades === true }),
  }];
  const outputs: FfmpegJobOutput[] = [{ name: 'clip.mp4', key: outputKey, contentType: 'video/mp4' }];
  if (audioKey) {
    // Second pass on the (small) clip — keeps the slice graph simple; cost is negligible.
    commands.push({ id: 'wav', kind: 'ffmpeg', argv: buildExtractAudioArgs('{out:clip.mp4}', '{out:clip.wav}') });
    outputs.push({ name: 'clip.wav', key: audioKey, contentType: 'audio/wav' });
  }
  const res = await this.runJob({ id: stepName, commands, inputs: [{ name: inName, key: inputKey }], outputs, files: [] });
  const duration = spans.reduce((n, s) => n + (s.end - s.start), 0);
  const wav = res.outputs.find((o) => o.name === 'clip.wav');
  return { success: true, output: {
    storage_path: outputKey, content_type: 'video/mp4', size: res.outputs[0].bytes,
    duration: Number(duration.toFixed(3)),
    ...(wav && audioKey ? { audio: { storage_path: audioKey, content_type: 'audio/wav', size: wav.bytes } } : {}),
    ...this.telemetry(res),
  } };
}

private async runConcat(config, context, stepName): Promise<StepResult> {
  /* inputs parsing + resolveKey loop + outputKey: unchanged (today's lines 456-478) */
  const inputs = inputKeys.map((key, i) => ({ name: `part-${i}${path.posix.extname(key) || '.mp4'}`, key }));
  const threads = this.local.argvThreads();
  const res = await this.runJob({
    id: stepName,
    commands: [
      { id: 'copy', kind: 'ffmpeg', argv: buildConcatArgs('{file:concat.txt}', '{out:final.mp4}', { reencode: false, threads }) },
      { id: 'reencode', kind: 'ffmpeg', argv: buildConcatArgs('{file:concat.txt}', '{out:final.mp4}', { reencode: true, threads }), fallbackFor: 'copy' },
    ],
    inputs,
    outputs: [{ name: 'final.mp4', key: outputKey, contentType: 'video/mp4' }],
    files: [{ name: 'concat.txt', content: buildConcatListContent(inputs.map((i) => i.name)) }],
  });
  const reencoded = res.commands.some((c) => c.id === 'reencode' && c.ran);
  if (reencoded) this.logger.warn({ event: 'ffmpeg_concat_reencode_fallback', step: stepName });
  return { success: true, output: { storage_path: outputKey, content_type: 'video/mp4', size: res.outputs[0].bytes, reencoded, ...this.telemetry(res) } };
}

/** Additive observability fields (D11) — present on every op output. */
private telemetry(res: FfmpegJobResult) {
  return { executor: res.executor, timings: res.timings, bytesIn: res.bytesIn, bytesOut: res.bytesOut };
}
```

Notes: the concat list now holds scratch-relative names (`file 'part-0.mp4'`) — the concat demuxer resolves them relative to the list file's directory, which is the same scratch dir; `-safe 0` stays. `buildConcatListContent`'s quote/newline guard still applies. `-threads` for slice/concat comes from `argvThreads()` (Task 4 makes it per-chosen-executor).

- [ ] **Step 7: Register the provider**

`pipelines.module.ts`: import `LocalFfmpegExecutor` from `'./ffmpeg/executor/local-ffmpeg.executor'` and add it to `providers` next to `FfmpegRunnerService` (line ~170). (The handler still `new`s its own instance in this task; the provider is used from Task 4 on. Adding it now proves DI resolves — `STORAGE_ADAPTER` is available in this module because the handler already injects it.)

- [ ] **Step 8: Run all ffmpeg suites + typecheck — all green, no spec edited**

```bash
cd apps/backend && pnpm tsc --noEmit -p tsconfig.json && pnpm test -- ffmpeg 2>&1 | tail -20
git status --short apps/backend/src/pipelines/handlers/ffmpeg.handler.spec.ts   # must be empty
pnpm test:integration -- ffmpeg 2>&1 | tail -8   # runs for real if ffmpeg is on PATH here (it is on the VPS? check `which ffmpeg`), else self-skips
```

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/pipelines
git commit -m "refactor(ffmpeg): extract LocalFfmpegExecutor behind an FfmpegExecutor seam (no behaviour change)"
```

---

### Task 2: Env, errors, envelope builder, result mapping (pure)

**Files:**
- Modify: `apps/backend/src/pipelines/ffmpeg/ffmpeg-env.ts`, `ffmpeg-env.spec.ts` (add cases), `ffmpeg-errors.ts`
- Create: `apps/backend/src/pipelines/ffmpeg/executor/remote/envelope.ts`, `envelope.spec.ts`, `result-mapping.ts`, `result-mapping.spec.ts`
- Modify: `docker-compose.yml` (~373–380), `docker-compose.build.yml` (~188–195), `.env.example` §13

**Interfaces:**
- Consumes: `FfmpegJob`, `FfmpegJobResult`, `EMPTY_TIMINGS` (Task 1).
- Produces:

```ts
// ffmpeg-env.ts additions
export type FfmpegExecutorSetting = 'local' | 'remote';
export type FfmpegRemoteAuth = 'google_id_token' | 'none';
export interface FfmpegEnvConfig { /* existing … */
  executor: FfmpegExecutorSetting;        // FFMPEG_EXECUTOR, default 'local'; unknown value → 'local'
  remoteUrl: string | null;               // FFMPEG_REMOTE_URL, trimmed, trailing '/' stripped
  remoteAuth: FfmpegRemoteAuth;           // FFMPEG_REMOTE_AUTH, default 'google_id_token'; unknown → 'google_id_token'
  remoteSaKeyJson: string | null;         // FFMPEG_REMOTE_SA_KEY_JSON (raw string; parsed lazily)
  remoteMaxInflight: number;              // FFMPEG_REMOTE_MAX_INFLIGHT, default 8
  workerMinVersion: string | null;        // FFMPEG_WORKER_MIN_VERSION, e.g. '0.4.31'
  maxOutputBytes: number;                 // FFMPEG_MAX_OUTPUT_BYTES, default 2 * 1024 ** 3
}

// ffmpeg-errors.ts addition
export class FfmpegExecutorUnavailableError extends Error { readonly code = 'FFMPEG_EXECUTOR_UNAVAILABLE'; }

// executor/remote/envelope.ts
export const FFMPEG_GLOBAL_FLAGS = ['-nostdin', '-hide_banner', '-y'];   // same as ffmpeg-runner.service.ts:29
export const FFPROBE_GLOBAL_FLAGS = ['-hide_banner'];                    // same as :31
export interface WorkerEnvelope {
  v: 1; id: string;
  commands: Array<{ id: string; kind: 'ffmpeg' | 'ffprobe'; argv: string[]; timeoutSeconds?: number; fallbackFor?: string }>;
  inputs: Array<{ name: string; url: string }>;
  outputs: Array<{ name: string; url: string; contentType: string }>;
  files: Array<{ name: string; content: string }>;
  maxSeconds: number;
  limits: { maxOutputBytes: number };
}
export type WorkerErrorCode = 'FFMPEG_FAILED' | 'FFMPEG_TIMEOUT' | 'INPUT_FETCH_FAILED' | 'OUTPUT_UPLOAD_FAILED' | 'OUTPUT_TOO_LARGE' | 'BAD_REQUEST';
export interface WorkerResponse {
  v: 1; ok: boolean; code?: WorkerErrorCode; message?: string;
  commands: Array<{ id: string; ran: boolean; exitCode: number | null }>;
  stdout: string; stderrTail: string;
  outputs: Array<{ name: string; bytes: number }>;
  bytesIn: number; bytesOut: number;
  timings: { transferInMs: number; ffmpegMs: number; transferOutMs: number; totalMs: number };
  worker: { version: string; ffmpeg: string };
}
export interface WorkerHealth { ok: boolean; version: string; ffmpeg: string; ops: string[]; uptimeS: number }
export interface SignedUrls { getUrl(key: string, ttlSeconds: number): Promise<string>; putUrl(key: string, ttlSeconds: number, maxBytes: number): Promise<string> }
export function signedUrlTtlSeconds(env: Pick<FfmpegEnvConfig, 'jobMaxSeconds'>): number;        // max(jobMaxSeconds, 900)
export function envelopeMaxSeconds(env: Pick<FfmpegEnvConfig, 'maxSeconds' | 'jobMaxSeconds'>): number; // min(maxSeconds, jobMaxSeconds - 60), floor 60
export async function buildEnvelope(job: FfmpegJob, urls: SignedUrls, env: FfmpegEnvConfig): Promise<WorkerEnvelope>;

// executor/remote/result-mapping.ts
export function mapWorkerResponse(res: WorkerResponse, job: FfmpegJob): FfmpegJobResult;  // throws typed errors on ok:false
export function isWorkerResponse(x: unknown): x is WorkerResponse;                         // shape guard for JSON parse
```

- [ ] **Step 1: Failing env tests** — append to `ffmpeg-env.spec.ts`:

```ts
describe('remote executor env', () => {
  it('defaults', () => {
    const e = readFfmpegEnv({});
    expect(e).toMatchObject({ executor: 'local', remoteUrl: null, remoteAuth: 'google_id_token', remoteSaKeyJson: null, remoteMaxInflight: 8, workerMinVersion: null, maxOutputBytes: 2 * 1024 ** 3 });
  });
  it('reads and normalises', () => {
    const e = readFfmpegEnv({ FFMPEG_EXECUTOR: 'remote', FFMPEG_REMOTE_URL: ' https://w.run.app/ ', FFMPEG_REMOTE_AUTH: 'none', FFMPEG_REMOTE_SA_KEY_JSON: '{"type":"service_account"}', FFMPEG_REMOTE_MAX_INFLIGHT: '2', FFMPEG_WORKER_MIN_VERSION: '0.4.31', FFMPEG_MAX_OUTPUT_BYTES: '1024' });
    expect(e).toMatchObject({ executor: 'remote', remoteUrl: 'https://w.run.app', remoteAuth: 'none', remoteSaKeyJson: '{"type":"service_account"}', remoteMaxInflight: 2, workerMinVersion: '0.4.31', maxOutputBytes: 1024 });
  });
  it('unknown enum values fall back to defaults; empty strings count as unset', () => {
    expect(readFfmpegEnv({ FFMPEG_EXECUTOR: 'cloud', FFMPEG_REMOTE_AUTH: 'basic', FFMPEG_REMOTE_URL: '' })).toMatchObject({ executor: 'local', remoteAuth: 'google_id_token', remoteUrl: null });
  });
});
```

- [ ] **Step 2: Run → FAIL; implement in `ffmpeg-env.ts`** (a `str()` helper mirroring `num()`; enums via `x === 'remote' ? 'remote' : 'local'` etc.); add `FfmpegExecutorUnavailableError` to `ffmpeg-errors.ts`. Run → PASS.

- [ ] **Step 3: Failing envelope tests** — `envelope.spec.ts`:

```ts
import { buildEnvelope, envelopeMaxSeconds, signedUrlTtlSeconds } from './envelope';
import { readFfmpegEnv } from '../../ffmpeg-env';

const urls = { getUrl: jest.fn(async (k: string, ttl: number) => `https://b/get/${k}?ttl=${ttl}`), putUrl: jest.fn(async (k: string, ttl: number, max: number) => `https://b/put/${k}?ttl=${ttl}&max=${max}`) };
const env = readFfmpegEnv({ FFMPEG_MAX_SECONDS: '1800', FFMPEG_JOB_MAX_SECONDS: '3600', FFMPEG_MAX_OUTPUT_BYTES: '4096' });

it('TTL is max(jobMaxSeconds, 900) and maxSeconds is min(maxSeconds, jobMax-60)', () => {
  expect(signedUrlTtlSeconds({ jobMaxSeconds: 120 })).toBe(900);
  expect(signedUrlTtlSeconds({ jobMaxSeconds: 3600 })).toBe(3600);
  expect(envelopeMaxSeconds({ maxSeconds: 1800, jobMaxSeconds: 3600 })).toBe(1800);
  expect(envelopeMaxSeconds({ maxSeconds: 1800, jobMaxSeconds: 1000 })).toBe(940);
  expect(envelopeMaxSeconds({ maxSeconds: 30, jobMaxSeconds: 30 })).toBe(60); // floor
});

it('signs every input/output, prepends per-kind global flags, keeps placeholders verbatim', async () => {
  const envelope = await buildEnvelope({
    id: 's1',
    commands: [
      { id: 'a', kind: 'ffmpeg', argv: ['-i', '{in:in.mp4}', '{out:out.wav}'] },
      { id: 'p', kind: 'ffprobe', argv: ['-show_format', '{in:in.mp4}'], timeoutSeconds: 60 },
    ],
    inputs: [{ name: 'in.mp4', key: 'o/r/uploads/a.mp4' }],
    outputs: [{ name: 'out.wav', key: 'o/r/uploads/a.wav', contentType: 'audio/wav' }],
    files: [{ name: 'list.txt', content: 'x' }],
  }, urls, env);
  expect(envelope).toEqual({
    v: 1, id: 's1',
    commands: [
      { id: 'a', kind: 'ffmpeg', argv: ['-nostdin', '-hide_banner', '-y', '-i', '{in:in.mp4}', '{out:out.wav}'] },
      { id: 'p', kind: 'ffprobe', argv: ['-hide_banner', '-show_format', '{in:in.mp4}'], timeoutSeconds: 60 },
    ],
    inputs: [{ name: 'in.mp4', url: 'https://b/get/o/r/uploads/a.mp4?ttl=3600' }],
    outputs: [{ name: 'out.wav', url: 'https://b/put/o/r/uploads/a.wav?ttl=3600&max=4096', contentType: 'audio/wav' }],
    files: [{ name: 'list.txt', content: 'x' }],
    maxSeconds: 1800,
    limits: { maxOutputBytes: 4096 },
  });
});
```

- [ ] **Step 4: Run → FAIL; implement `envelope.ts`; run → PASS.**

- [ ] **Step 5: Failing result-mapping tests** — `result-mapping.spec.ts`:

```ts
import { mapWorkerResponse, isWorkerResponse } from './result-mapping';
const job = { id: 'j', commands: [], inputs: [], outputs: [{ name: 'out.wav', key: 'o/r/uploads/a.wav', contentType: 'audio/wav' }], files: [] };
const okRes = { v: 1 as const, ok: true, commands: [{ id: 'a', ran: true, exitCode: 0 }], stdout: '{}', stderrTail: '', outputs: [{ name: 'out.wav', bytes: 12 }], bytesIn: 100, bytesOut: 12, timings: { transferInMs: 1, ffmpegMs: 2, transferOutMs: 3, totalMs: 6 }, worker: { version: '0.4.31', ffmpeg: '6.1.1' } };

it('maps a successful response, joining output keys back from the job', () => {
  expect(mapWorkerResponse(okRes, job)).toEqual({
    executor: 'remote', stdout: '{}', stderrTail: '', commands: okRes.commands,
    outputs: [{ name: 'out.wav', key: 'o/r/uploads/a.wav', bytes: 12 }], bytesIn: 100, bytesOut: 12,
    timings: { queueMs: 0, transferInMs: 1, ffmpegMs: 2, transferOutMs: 3, totalMs: 6 }, worker: { version: '0.4.31', ffmpeg: '6.1.1' },
  });
});
it.each([
  ['FFMPEG_FAILED', 'FFMPEG_FAILED'], ['FFMPEG_TIMEOUT', 'FFMPEG_TIMEOUT'], ['INPUT_FETCH_FAILED', 'FILE_NOT_FOUND'],
  ['OUTPUT_UPLOAD_FAILED', 'FFMPEG_FAILED'], ['OUTPUT_TOO_LARGE', 'FFMPEG_FAILED'], ['BAD_REQUEST', 'FFMPEG_EXECUTOR_UNAVAILABLE'],
])('worker code %s → CE code %s, keeping the worker message', (workerCode, ceCode) => {
  expect(() => mapWorkerResponse({ ...okRes, ok: false, code: workerCode as never, message: 'why', stderrTail: 'tail' }, job)).toThrow(expect.objectContaining({ code: ceCode, message: expect.stringContaining('why') }));
});
it('FFMPEG_FAILED carries exitCode + stderrTail like FfmpegProcessError', () => {
  try { mapWorkerResponse({ ...okRes, ok: false, code: 'FFMPEG_FAILED', message: 'exit 1', commands: [{ id: 'a', ran: true, exitCode: 1 }], stderrTail: 'tail' }, job); }
  catch (e) { expect(e).toMatchObject({ code: 'FFMPEG_FAILED', exitCode: 1, stderrTail: 'tail' }); return; }
  throw new Error('did not throw');
});
it('a successful response missing a declared output is FFMPEG_FAILED', () => {
  expect(() => mapWorkerResponse({ ...okRes, outputs: [] }, job)).toThrow(expect.objectContaining({ code: 'FFMPEG_FAILED' }));
});
it('isWorkerResponse guards the shape', () => {
  expect(isWorkerResponse(okRes)).toBe(true);
  expect(isWorkerResponse({ ok: true })).toBe(false);
  expect(isWorkerResponse('nope')).toBe(false);
});
```

- [ ] **Step 6: Run → FAIL; implement `result-mapping.ts`** — `FfmpegProcessError(message, exitCode of the last ran command, stderrTail)` for `FFMPEG_FAILED`/`OUTPUT_*`; `FfmpegTimeoutError`; `Object.assign(new Error(...), {code:'FILE_NOT_FOUND'})`; `FfmpegExecutorUnavailableError` for `BAD_REQUEST` (a CE bug — the envelope was rejected). Run → PASS.

- [ ] **Step 7: Compose + `.env.example` passthrough** — add the seven `FFMPEG_*` lines to both compose files' backend `environment:` blocks (`FFMPEG_EXECUTOR: ${FFMPEG_EXECUTOR:-}` … ), and to `.env.example` §13 add a commented block after `FFMPEG_SCRATCH_DIR`:

```
# --- Remote executor (Worker) -----------------------------------------------
# Run ffmpeg jobs on a stateless Worker instead of in this container. Bytes move
# Worker <-> bucket via signed URLs, so this needs bucket storage (S3/GCS/MinIO/
# Azure) - not local-FS. Cloud Run is the reference deployment; see docs
# "Server Video Ops → Remote executor" and workers/ffmpeg/README.md.
# Which executor runs a step unless the step says otherwise: local | remote
# FFMPEG_EXECUTOR=local
# Worker base URL (https). Setting this enables the remote executor.
# FFMPEG_REMOTE_URL=https://bffless-ffmpeg-xxxx-uc.a.run.app
# google_id_token (Cloud Run IAM; default) | none (private networks ONLY)
# FFMPEG_REMOTE_AUTH=google_id_token
# Service-account JSON key with roles/run.invoker on the Worker (one line).
# Omit on GCP to use ambient credentials (ADC).
# FFMPEG_REMOTE_SA_KEY_JSON=
# Max concurrent remote jobs from this instance (excess fail fast: FFMPEG_BUSY).
# FFMPEG_REMOTE_MAX_INFLIGHT=8
# Refuse Workers older than this CE version (semver, e.g. 0.4.31). Unset = any.
# FFMPEG_WORKER_MIN_VERSION=
# Cap on a single output object (signed single-request PUT). Default 2 GiB.
# FFMPEG_MAX_OUTPUT_BYTES=2147483648
#
# Local dev: `docker compose --profile ffmpeg-worker up -d` then
#   FFMPEG_EXECUTOR=remote FFMPEG_REMOTE_URL=http://ffmpeg-worker:8080 FFMPEG_REMOTE_AUTH=none
```

- [ ] **Step 8: Run the three suites + commit**

```bash
pnpm test -- "ffmpeg-env|envelope|result-mapping" 2>&1 | tail -8
git add -A && git commit -m "feat(ffmpeg): remote executor env config, wire envelope builder and result mapping"
```

---

### Task 3: `RemoteFfmpegExecutor` — ID token, worker client, fuse, ready(), run()

**Files:**
- Modify: `apps/backend/package.json` (add `"google-auth-library": "^9.15.1"` to dependencies — already in the lockfile, so `pnpm install` is a no-op download)
- Create: `executor/remote/id-token.ts` + `.spec.ts`, `executor/remote/worker-client.ts` + `.spec.ts`, `executor/remote/remote-ffmpeg.executor.ts` + `.spec.ts`
- Modify: `pipelines.module.ts` (provider)

**Interfaces:**
- Consumes: Task 1 interface; Task 2 `buildEnvelope`, `mapWorkerResponse`, `isWorkerResponse`, `WorkerHealth`, env fields, `FfmpegExecutorUnavailableError`, `FfmpegBusyError`.
- Produces:

```ts
// id-token.ts
export interface AuthHeaderProvider { headers(url: string): Promise<Record<string, string>> }
export class NoAuth implements AuthHeaderProvider { async headers() { return {}; } }
export class IdTokenMinter implements AuthHeaderProvider {
  /** @param saKeyJson raw JSON string or null (→ ADC). Client is created lazily and cached per audience. */
  constructor(saKeyJson: string | null, private readonly authFactory = defaultAuthFactory) {}
  async headers(url: string): Promise<Record<string, string>>;   // { Authorization: 'Bearer <id token>' } ; audience = new URL(url).origin
}
export function defaultAuthFactory(saKeyJson: string | null): { getIdTokenClient(audience: string): Promise<{ getRequestHeaders(url?: string): Promise<Record<string, string> | Headers> }> };

// worker-client.ts
export class WorkerTransportError extends Error { constructor(message: string, readonly status?: number, readonly retryable = false) }
export class WorkerClient {
  constructor(private readonly baseUrl: string, private readonly auth: AuthHeaderProvider, private readonly fetchImpl: typeof fetch = fetch) {}
  /** POST {baseUrl}/jobs. Retries ONCE on: fetch throwing (before any response byte) or 429/503. Never on abort. */
  postJob(envelope: WorkerEnvelope, opts: { signal: AbortSignal }): Promise<WorkerResponse>;   // throws WorkerTransportError on non-2xx / non-JSON
  health(opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<WorkerHealth>;         // GET /healthz, 5 s default timeout
}

// remote-ffmpeg.executor.ts
@Injectable() export class RemoteFfmpegExecutor implements FfmpegExecutor {
  readonly name = 'remote' as const;
  constructor(@Inject(STORAGE_ADAPTER) storageAdapter: IStorageAdapter, /* test seams: */ deps?: { env?: () => FfmpegEnvConfig; clientFactory?: (env: FfmpegEnvConfig) => WorkerClient; now?: () => number });
  argvThreads(): number;              // 0 → ffmpeg auto-threads on the Worker's cores
  ready(): Promise<FfmpegExecutorReadiness>;   // see rules below; caches the healthz answer 60 s
  run(job, { signal }): Promise<FfmpegJobResult>;
  /** exposed for the settings "Test connection" (Plan 2) */ testConnection(): Promise<WorkerHealth>;
}
```

`ready()` rules, in order, each with a `reason` string: (1) `env.remoteUrl` null → `{ok:false, reason:'FFMPEG_REMOTE_URL is not set'}`; (2) URL not `https:` and auth ≠ `none` → reason `'remote auth google_id_token requires an https worker URL'`; (3) `storageAdapter.supportsPresignedUrls?.() !== true` or `typeof storageAdapter.getPresignedUploadUrl !== 'function'` → `'storage adapter cannot presign (remote executor needs bucket storage: S3/GCS/MinIO/Azure)'`; (4) `storageAdapter.constructor.name === 'LocalStorageAdapter'` OR (`DynamicStorageAdapter` and its wrapped adapter's presigned URLs start with `/api/storage/presigned/local`) → `'local filesystem storage cannot be reached by a worker'` — implement as: `const probe = await storageAdapter.getPresignedUploadUrl('__ffmpeg_remote_probe__', 60); if (probe.startsWith('/')) …` (a relative URL is by definition unreachable) — cache this check with the healthz; (5) `auth === 'google_id_token'` and `remoteSaKeyJson` set but `JSON.parse` fails → `'FFMPEG_REMOTE_SA_KEY_JSON is not valid JSON'`; (6) healthz (cached 60 s, keyed by remoteUrl+auth): transport error → `'worker unreachable: <msg>'`; `ok:false` → `'worker reports not ok'`; `env.workerMinVersion` set and `semverLt(health.version, min)` → `'worker <v> is older than FFMPEG_WORKER_MIN_VERSION <min>'`; else `{ ok:true, version: health.version }`. Write a tiny `semverLt(a,b)` (split on `.`, compare numerically, ignore pre-release) in the executor file with 3 unit cases.

`run()` sequence: `if (inflight >= env.remoteMaxInflight) throw new FfmpegBusyError('remote executor at capacity (FFMPEG_REMOTE_MAX_INFLIGHT)')`; `inflight++`; `t0`; `envelope = await buildEnvelope(job, {getUrl: (k,ttl)=>adapter.getUrl(k,ttl), putUrl: (k,ttl,max)=>adapter.getPresignedUploadUrl!(k,ttl,max)}, env)`; `res = await client.postJob(envelope, {signal})` — `WorkerTransportError` → `throw new FfmpegExecutorUnavailableError(\`worker request failed: ${msg}\`)`, `AbortError` (signal aborted) → rethrow as `FfmpegStepTimeoutError`; `result = mapWorkerResponse(res, job)`; **confirm** each output with `await adapter.getMetadata(o.key)` (missing → `FfmpegProcessError('worker reported success but <key> is not in storage', 0, res.stderrTail)`); use `getMetadata().size` as the authoritative `bytes`; `logger.log({ event:'ffmpeg_remote_job', job: job.id, ok:true, worker: res.worker, timings: result.timings, bytesIn, bytesOut, commands: result.commands.map(c=>c.id+':'+c.exitCode) })` — and on any throw log the same event with `ok:false, code`; `finally inflight--`.

- [ ] **Step 1: Failing `id-token.spec.ts`**

```ts
import { IdTokenMinter, NoAuth } from './id-token';
it('NoAuth sends no headers', async () => { expect(await new NoAuth().headers('https://w')).toEqual({}); });
it('mints an ID token for the URL origin, creating one client per audience and reusing it', async () => {
  const getRequestHeaders = jest.fn().mockResolvedValue({ Authorization: 'Bearer tok' });
  const getIdTokenClient = jest.fn().mockResolvedValue({ getRequestHeaders });
  const factory = jest.fn().mockReturnValue({ getIdTokenClient });
  const minter = new IdTokenMinter('{"type":"service_account"}', factory);
  await minter.headers('https://w.run.app/jobs');
  await minter.headers('https://w.run.app/healthz');
  expect(factory).toHaveBeenCalledWith('{"type":"service_account"}');
  expect(getIdTokenClient).toHaveBeenCalledTimes(1);
  expect(getIdTokenClient).toHaveBeenCalledWith('https://w.run.app');
  expect(await minter.headers('https://w.run.app/jobs')).toEqual({ Authorization: 'Bearer tok' });
});
it('accepts a Headers instance from the library and flattens it', async () => {
  const getRequestHeaders = jest.fn().mockResolvedValue(new Headers({ authorization: 'Bearer h' }));
  const minter = new IdTokenMinter(null, () => ({ getIdTokenClient: async () => ({ getRequestHeaders }) }));
  expect(await minter.headers('https://w/x')).toEqual({ authorization: 'Bearer h' });
});
```

- [ ] **Step 2: Implement `id-token.ts`.** `defaultAuthFactory` = `(saKeyJson) => new GoogleAuth(saKeyJson ? { credentials: JSON.parse(saKeyJson) } : {})` (import `{ GoogleAuth } from 'google-auth-library'`); the library's `IdTokenClient` refreshes its own token ~5 min before expiry, so the minter only caches the client. Add the dependency to `apps/backend/package.json` and run `pnpm install`. Run spec → PASS.

- [ ] **Step 3: Failing `worker-client.spec.ts`**

```ts
import { WorkerClient, WorkerTransportError } from './worker-client';
const okBody = { v: 1, ok: true, commands: [], stdout: '', stderrTail: '', outputs: [], bytesIn: 0, bytesOut: 0, timings: { transferInMs: 0, ffmpegMs: 0, transferOutMs: 0, totalMs: 0 }, worker: { version: '1', ffmpeg: '6' } };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const envelope = { v: 1, id: 'j', commands: [], inputs: [], outputs: [], files: [], maxSeconds: 60, limits: { maxOutputBytes: 1 } } as const;
const auth = { headers: jest.fn().mockResolvedValue({ Authorization: 'Bearer t' }) };

it('POSTs the envelope with auth headers and parses the response', async () => {
  const fetchImpl = jest.fn().mockResolvedValue(json(200, okBody));
  const res = await new WorkerClient('https://w', auth, fetchImpl as never).postJob(envelope as never, { signal: new AbortController().signal });
  expect(res.ok).toBe(true);
  const [url, init] = fetchImpl.mock.calls[0];
  expect(url).toBe('https://w/jobs');
  expect(init.method).toBe('POST');
  expect(init.headers).toMatchObject({ 'content-type': 'application/json', Authorization: 'Bearer t' });
  expect(JSON.parse(init.body)).toEqual(envelope);
});
it('retries once on a thrown fetch, then succeeds', async () => {
  const fetchImpl = jest.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(json(200, okBody));
  await expect(new WorkerClient('https://w', auth, fetchImpl as never).postJob(envelope as never, { signal: new AbortController().signal })).resolves.toMatchObject({ ok: true });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
it.each([429, 503])('retries once on %s, then gives up with a retryable transport error', async (status) => {
  const fetchImpl = jest.fn().mockResolvedValue(json(status, { err: 1 }));
  await expect(new WorkerClient('https://w', auth, fetchImpl as never).postJob(envelope as never, { signal: new AbortController().signal })).rejects.toMatchObject({ status, retryable: true });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
it.each([401, 403, 404, 500])('does NOT retry on %s', async (status) => {
  const fetchImpl = jest.fn().mockResolvedValue(json(status, {}));
  await expect(new WorkerClient('https://w', auth, fetchImpl as never).postJob(envelope as never, { signal: new AbortController().signal })).rejects.toBeInstanceOf(WorkerTransportError);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it('does NOT retry when the signal is aborted', async () => {
  const controller = new AbortController();
  const fetchImpl = jest.fn().mockImplementation(() => { controller.abort(); return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
  await expect(new WorkerClient('https://w', auth, fetchImpl as never).postJob(envelope as never, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it('a 200 with a non-worker body is a transport error (never a silent success)', async () => {
  const fetchImpl = jest.fn().mockResolvedValue(json(200, { hello: 'world' }));
  await expect(new WorkerClient('https://w', auth, fetchImpl as never).postJob(envelope as never, { signal: new AbortController().signal })).rejects.toBeInstanceOf(WorkerTransportError);
});
it('health() GETs /healthz with auth', async () => {
  const fetchImpl = jest.fn().mockResolvedValue(json(200, { ok: true, version: '0.4.31', ffmpeg: '6.1.1', ops: ['ffmpeg', 'ffprobe'], uptimeS: 3 }));
  await expect(new WorkerClient('https://w', auth, fetchImpl as never).health()).resolves.toMatchObject({ ok: true, version: '0.4.31' });
  expect(fetchImpl.mock.calls[0][0]).toBe('https://w/healthz');
});
```

- [ ] **Step 4: Implement `worker-client.ts`**; retry decision: `attempt === 0 && !signal.aborted && (threw || status === 429 || status === 503)`. Wait 500 ms between attempts (`await new Promise(r => setTimeout(r, 500))` — keep it real, tests take 1 s; or inject a `sleep` — the injected form is preferable: `constructor(baseUrl, auth, fetchImpl = fetch, sleep = (ms) => new Promise(r => setTimeout(r, ms)))`, tests pass `async () => {}`). Run → PASS.

- [ ] **Step 5: Failing `remote-ffmpeg.executor.spec.ts`**

```ts
import { RemoteFfmpegExecutor } from './remote-ffmpeg.executor';
import { readFfmpegEnv } from '../../ffmpeg-env';
import { WorkerTransportError } from './worker-client';

const okBody = (over = {}) => ({ v: 1, ok: true, commands: [{ id: 'a', ran: true, exitCode: 0 }], stdout: '', stderrTail: '', outputs: [{ name: 'out.wav', bytes: 5 }], bytesIn: 9, bytesOut: 5, timings: { transferInMs: 1, ffmpegMs: 1, transferOutMs: 1, totalMs: 3 }, worker: { version: '0.4.31', ffmpeg: '6.1.1' }, ...over });
const health = { ok: true, version: '0.4.31', ffmpeg: '6.1.1', ops: ['ffmpeg', 'ffprobe'], uptimeS: 1 };
const job = { id: 'j', commands: [{ id: 'a', kind: 'ffmpeg' as const, argv: ['-i', '{in:in.mp4}', '{out:out.wav}'] }], inputs: [{ name: 'in.mp4', key: 'k/in.mp4' }], outputs: [{ name: 'out.wav', key: 'k/out.wav', contentType: 'audio/wav' }], files: [] };

function make(envOver: Record<string, string> = {}, storageOver: Record<string, unknown> = {}) {
  const env = readFfmpegEnv({ FFMPEG_REMOTE_URL: 'https://w', FFMPEG_REMOTE_AUTH: 'none', ...envOver });
  const client = { postJob: jest.fn().mockResolvedValue(okBody()), health: jest.fn().mockResolvedValue(health) };
  const storage = { supportsPresignedUrls: () => true, getUrl: jest.fn(async (k: string) => `https://b/${k}`), getPresignedUploadUrl: jest.fn(async (k: string) => `https://b/put/${k}`), getMetadata: jest.fn().mockResolvedValue({ size: 5 }), ...storageOver };
  let now = 1_000_000;
  const executor = new RemoteFfmpegExecutor(storage as never, { env: () => env, clientFactory: () => client as never, now: () => now });
  return { executor, client, storage, tick: (ms: number) => { now += ms; } };
}
const sig = () => new AbortController().signal;

describe('ready()', () => {
  it('is false without a URL', async () => { expect(await make({ FFMPEG_REMOTE_URL: '' }).executor.ready()).toMatchObject({ ok: false, reason: expect.stringContaining('FFMPEG_REMOTE_URL') }); });
  it('is false when storage cannot presign / presigns relative (local-FS) URLs', async () => {
    expect(await make({}, { supportsPresignedUrls: () => false }).executor.ready()).toMatchObject({ ok: false, reason: expect.stringContaining('presign') });
    expect(await make({}, { getPresignedUploadUrl: async () => '/api/storage/presigned/local?x' }).executor.ready()).toMatchObject({ ok: false, reason: expect.stringContaining('local filesystem') });
  });
  it('requires https for google_id_token', async () => { expect(await make({ FFMPEG_REMOTE_URL: 'http://w', FFMPEG_REMOTE_AUTH: 'google_id_token' }).executor.ready()).toMatchObject({ ok: false, reason: expect.stringContaining('https') }); });
  it('rejects a malformed SA key', async () => { expect(await make({ FFMPEG_REMOTE_AUTH: 'google_id_token', FFMPEG_REMOTE_SA_KEY_JSON: '{nope' }).executor.ready()).toMatchObject({ ok: false, reason: expect.stringContaining('valid JSON') }); });
  it('is true on a healthy worker and caches healthz for 60 s', async () => {
    const { executor, client, tick } = make();
    expect(await executor.ready()).toEqual({ ok: true, version: '0.4.31' });
    await executor.ready(); tick(59_000); await executor.ready();
    expect(client.health).toHaveBeenCalledTimes(1);
    tick(2_000); await executor.ready();
    expect(client.health).toHaveBeenCalledTimes(2);
  });
  it('unreachable worker and too-old worker are not ready', async () => {
    const a = make(); a.client.health.mockRejectedValue(new WorkerTransportError('ECONNREFUSED'));
    expect(await a.executor.ready()).toMatchObject({ ok: false, reason: expect.stringContaining('unreachable') });
    const b = make({ FFMPEG_WORKER_MIN_VERSION: '0.5.0' });
    expect(await b.executor.ready()).toMatchObject({ ok: false, reason: expect.stringContaining('older than') });
  });
});

describe('run()', () => {
  it('builds the envelope from signed URLs, posts it, confirms outputs via getMetadata, returns a remote result', async () => {
    const { executor, client, storage } = make();
    const res = await executor.run(job, { signal: sig() });
    expect(storage.getUrl).toHaveBeenCalledWith('k/in.mp4', expect.any(Number));
    expect(storage.getPresignedUploadUrl).toHaveBeenCalledWith('k/out.wav', expect.any(Number), 2 * 1024 ** 3);
    expect(client.postJob.mock.calls[0][0]).toMatchObject({ v: 1, inputs: [{ name: 'in.mp4', url: 'https://b/k/in.mp4' }], outputs: [{ name: 'out.wav', url: 'https://b/put/k/out.wav', contentType: 'audio/wav' }] });
    expect(storage.getMetadata).toHaveBeenCalledWith('k/out.wav');
    expect(res).toMatchObject({ executor: 'remote', outputs: [{ name: 'out.wav', key: 'k/out.wav', bytes: 5 }], worker: { version: '0.4.31' } });
  });
  it('a worker "success" whose output is not in storage is FFMPEG_FAILED', async () => {
    const { executor, storage } = make(); storage.getMetadata.mockRejectedValue(new Error('not found'));
    await expect(executor.run(job, { signal: sig() })).rejects.toMatchObject({ code: 'FFMPEG_FAILED' });
  });
  it('transport failure → FFMPEG_EXECUTOR_UNAVAILABLE; worker ok:false codes map through result-mapping', async () => {
    const a = make(); a.client.postJob.mockRejectedValue(new WorkerTransportError('503', 503, true));
    await expect(a.executor.run(job, { signal: sig() })).rejects.toMatchObject({ code: 'FFMPEG_EXECUTOR_UNAVAILABLE' });
    const b = make(); b.client.postJob.mockResolvedValue(okBody({ ok: false, code: 'INPUT_FETCH_FAILED', message: '404 from bucket' }));
    await expect(b.executor.run(job, { signal: sig() })).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
  });
  it('the in-flight fuse fails fast with FFMPEG_BUSY and releases in finally', async () => {
    const { executor, client } = make({ FFMPEG_REMOTE_MAX_INFLIGHT: '1' });
    let release!: (v: unknown) => void;
    client.postJob.mockReturnValueOnce(new Promise((r) => { release = r; }));
    const first = executor.run(job, { signal: sig() });
    await expect(executor.run(job, { signal: sig() })).rejects.toMatchObject({ code: 'FFMPEG_BUSY' });
    release(okBody()); await first;
    await expect(executor.run(job, { signal: sig() })).resolves.toMatchObject({ executor: 'remote' });
  });
  it('argvThreads() is 0 (auto on the worker)', () => { expect(make().executor.argvThreads()).toBe(0); });
});
```

- [ ] **Step 6: Implement `remote-ffmpeg.executor.ts`** per the rules above; the default `clientFactory` = `(env) => new WorkerClient(env.remoteUrl!, env.remoteAuth === 'none' ? new NoAuth() : new IdTokenMinter(env.remoteSaKeyJson))`, memoised by `remoteUrl+auth+saKey` so the token client survives across jobs. Register `RemoteFfmpegExecutor` in `pipelines.module.ts` providers. Run → PASS; `pnpm tsc --noEmit`.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(ffmpeg): RemoteFfmpegExecutor — signed-URL envelope, Google ID token auth, retry-once client, in-flight fuse, healthz readiness"
```

---

### Task 4: Selector, handler wiring, capability probe, `executor` config surfaces

**Files:**
- Create: `apps/backend/src/pipelines/ffmpeg/executor/ffmpeg-executor.selector.ts` + `.spec.ts`
- Modify: `apps/backend/src/pipelines/handlers/ffmpeg.handler.ts` (constructor, `execute`, probe payload), `ffmpeg.handler.spec.ts` (**additive only**: `createHandler` gains optional `selector`, plus new `describe` blocks), `pipelines.module.ts`
- Modify: `apps/backend/src/pipelines/execution/step-handler.interface.ts` (TSDoc 672–717 + `executor?` field), `apps/backend/src/mcp/tools/proxy-rules.tools.ts:70`, `apps/frontend/src/components/pipelines/handlers/types.ts` (~440), `apps/frontend/src/components/pipelines/handlers/FfmpegHandlerConfig.tsx`

**Interfaces:**
- Consumes: `LocalFfmpegExecutor`, `RemoteFfmpegExecutor`, `FfmpegCapabilityService`, `readFfmpegEnv`, `FfmpegExecutorUnavailableError`.
- Produces:

```ts
@Injectable() export class FfmpegExecutorSelector {
  constructor(local: LocalFfmpegExecutor, remote: RemoteFfmpegExecutor, capability: FfmpegCapabilityService, env: () => FfmpegEnvConfig = readFfmpegEnv) {}
  /** Executors an operator has enabled: local iff ffmpeg binaries are present; remote iff FFMPEG_REMOTE_URL is set. */
  enabled(): FfmpegExecutorName[];
  defaultExecutor(): FfmpegExecutorName;   // env.executor if enabled, else the first enabled, else 'local'
  /** requested = evaluated step.config.executor (may be undefined). Throws FfmpegExecutorUnavailableError with a precise reason. */
  pick(requested?: string): Promise<FfmpegExecutor>;
  /** The capability payload (D6/T4). `server` = flag on AND at least one executor ready. */
  probe(): Promise<{ server: boolean; ops: string[]; version: string | null; executors: FfmpegExecutorName[]; defaultExecutor: FfmpegExecutorName; remote?: { version?: string; ready: boolean; reason?: string } }>;
}
```

- [ ] **Step 1: Failing `ffmpeg-executor.selector.spec.ts`**

```ts
import { FfmpegExecutorSelector } from './ffmpeg-executor.selector';
import { readFfmpegEnv } from '../ffmpeg-env';
function make(envOver: Record<string, string> = {}, o: { localAvailable?: boolean; flag?: boolean; remoteReady?: { ok: boolean; reason?: string; version?: string } } = {}) {
  const local = { name: 'local', ready: jest.fn().mockResolvedValue({ ok: true }), run: jest.fn(), argvThreads: () => 3 };
  const remote = { name: 'remote', ready: jest.fn().mockResolvedValue(o.remoteReady ?? { ok: true, version: '0.4.31' }), run: jest.fn(), argvThreads: () => 0 };
  const capability = { isAvailable: () => o.localAvailable ?? true, isEnabled: async () => (o.flag ?? true) && (o.localAvailable ?? true), getVersion: () => 'ffmpeg version 6.1.1', getOps: async () => ['probe', 'extract_audio', 'slice', 'concat'], isFlagOn: async () => o.flag ?? true };
  const env = readFfmpegEnv(envOver);
  return { selector: new FfmpegExecutorSelector(local as never, remote as never, capability as never, () => env), local, remote };
}
it('enabled/default: local only by default; remote joins when FFMPEG_REMOTE_URL is set; FFMPEG_EXECUTOR picks the default', () => {
  expect(make().selector.enabled()).toEqual(['local']);
  expect(make({ FFMPEG_REMOTE_URL: 'https://w' }).selector.enabled()).toEqual(['local', 'remote']);
  expect(make({ FFMPEG_REMOTE_URL: 'https://w', FFMPEG_EXECUTOR: 'remote' }).selector.defaultExecutor()).toBe('remote');
  expect(make({ FFMPEG_EXECUTOR: 'remote' }).selector.defaultExecutor()).toBe('local'); // remote not enabled → falls back
  expect(make({ FFMPEG_REMOTE_URL: 'https://w' }, { localAvailable: false }).selector.enabled()).toEqual(['remote']);
});
it('pick(): explicit request wins; undefined → default; unknown/disabled/not-ready → FFMPEG_EXECUTOR_UNAVAILABLE with a reason', async () => {
  const m = make({ FFMPEG_REMOTE_URL: 'https://w' });
  expect((await m.selector.pick('remote')).name).toBe('remote');
  expect((await m.selector.pick(undefined)).name).toBe('local');
  await expect(m.selector.pick('cloud')).rejects.toMatchObject({ code: 'FFMPEG_EXECUTOR_UNAVAILABLE', message: expect.stringContaining('unknown executor') });
  await expect(make().selector.pick('remote')).rejects.toMatchObject({ code: 'FFMPEG_EXECUTOR_UNAVAILABLE', message: expect.stringContaining('not enabled') });
  await expect(make({ FFMPEG_REMOTE_URL: 'https://w' }, { remoteReady: { ok: false, reason: 'worker unreachable: x' } }).selector.pick('remote')).rejects.toMatchObject({ code: 'FFMPEG_EXECUTOR_UNAVAILABLE', message: expect.stringContaining('worker unreachable') });
});
it('probe(): server = flag && any ready; additive executors/defaultExecutor/remote', async () => {
  await expect(make({ FFMPEG_REMOTE_URL: 'https://w', FFMPEG_EXECUTOR: 'remote' }, { localAvailable: false }).selector.probe()).resolves.toEqual({
    server: true, ops: ['probe', 'extract_audio', 'slice', 'concat'], version: null, executors: ['remote'], defaultExecutor: 'remote', remote: { ready: true, version: '0.4.31' },
  });
  await expect(make({}, { flag: false }).selector.probe()).resolves.toMatchObject({ server: false, ops: [], executors: ['local'], defaultExecutor: 'local' });
  await expect(make({ FFMPEG_REMOTE_URL: 'https://w' }, { localAvailable: false, remoteReady: { ok: false, reason: 'nope' } }).selector.probe()).resolves.toMatchObject({ server: false, remote: { ready: false, reason: 'nope' } });
});
```

Note `version` in the probe stays the **local** ffmpeg version string (`capability.getVersion()`, `null` when binaries are absent) — apps already read it that way; the worker's version lives under `remote.version`.

- [ ] **Step 2: Implement the selector.** `FfmpegCapabilityService` needs one small addition: `isFlagOn(): Promise<boolean>` = `featureFlags.isEnabled(SERVER_VIDEO_OPS_FLAG)` (today's `isEnabled()` conflates flag && binaries; keep `isEnabled()` as-is for callers, add `isFlagOn`). `ops` = flag on && any ready ? the 4 ops : `[]` (compute in the selector — do not change `getOps()`). Register in `pipelines.module.ts`. Run → PASS.

- [ ] **Step 3: Wire the handler.** Constructor becomes

```ts
constructor(
  private readonly registry: StepHandlerRegistry,
  private readonly expressionEvaluator: ExpressionEvaluator,
  private readonly capability: FfmpegCapabilityService,
  private readonly runner: FfmpegRunnerService,          // kept only so the positional spec factory still compiles
  private readonly scratch: FfmpegScratchService,        // (idem)
  private readonly uploadRecord: UploadRecordService,
  @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
  @Optional() private readonly selector?: FfmpegExecutorSelector,
) {
  this.registry.register(this);
  // Direct construction (unit tests) gets a local-only selector so behaviour is exactly the pre-remote one.
  this.selector ??= new FfmpegExecutorSelector(new LocalFfmpegExecutor(runner, scratch, storageAdapter), new RemoteFfmpegExecutor(storageAdapter), capability);
}
```
`execute`: probe-without-input → `return { success: true, output: await this.selector.probe() }`; the gate becomes `if (!(await this.capability.isFlagOn())) return FFMPEG_UNAVAILABLE` (message unchanged); then `const executor = await this.selector.pick(config.executor ? String(this.expressionEvaluator.evaluateExpression(config.executor, context, stepName)) : undefined)` inside the try (so `FfmpegExecutorUnavailableError` flows through `toErrorResult` — add `'FFMPEG_EXECUTOR_UNAVAILABLE'` to its `known` list); each op receives `executor` and uses `executor.argvThreads()` and `this.runJob(executor, job)`.

- [ ] **Step 4: Additive handler spec cases** (append to `ffmpeg.handler.spec.ts`; extend `createHandler` overrides with `selector?: FfmpegExecutorSelector-like`):

```ts
describe('executor selection (remote)', () => {
  it('config.executor is expression-evaluated and routed; output carries executor + timings', async () => {
    const remoteRun = jest.fn().mockResolvedValue({ executor: 'remote', stdout: '', stderrTail: '', commands: [{ id: 'extract', ran: true, exitCode: 0 }], outputs: [{ name: 'out.wav', key: 'o/r/uploads/studio/a.wav', bytes: 7 }], bytesIn: 3, bytesOut: 7, timings: { queueMs: 0, transferInMs: 1, ffmpegMs: 1, transferOutMs: 1, totalMs: 3 }, worker: { version: '0.4.31', ffmpeg: '6' } });
    const selector = { pick: jest.fn().mockResolvedValue({ name: 'remote', argvThreads: () => 0, run: remoteRun }), probe: jest.fn() };
    const { handler } = createHandler({ selector });
    const ctx = context(); (ctx.metadata.body as Record<string, unknown>).executor = 'remote';
    const result = await handler.execute(ctx, step({ operation: 'extract_audio', input: 'studio/a.mp4', output: 'studio/a.wav', executor: '{{request.body.executor}}' }));
    expect(selector.pick).toHaveBeenCalledWith('remote');
    expect(result.output).toMatchObject({ storage_path: 'o/r/uploads/studio/a.wav', size: 7, executor: 'remote', bytesIn: 3, bytesOut: 7, timings: { totalMs: 3 } });
  });
  it('an unavailable executor is FFMPEG_EXECUTOR_UNAVAILABLE', async () => {
    const selector = { pick: jest.fn().mockRejectedValue(Object.assign(new Error('executor remote is not enabled'), { code: 'FFMPEG_EXECUTOR_UNAVAILABLE' })), probe: jest.fn() };
    const { handler } = createHandler({ selector });
    const result = await handler.execute(context(), step({ operation: 'extract_audio', input: 'a.mp4', output: 'a.wav', executor: 'remote' }));
    expect(result).toMatchObject({ success: false, error: { code: 'FFMPEG_EXECUTOR_UNAVAILABLE' } });
  });
  it('probe without input returns the selector payload verbatim', async () => {
    const payload = { server: true, ops: ['probe'], version: 'v', executors: ['local', 'remote'], defaultExecutor: 'remote', remote: { ready: true, version: '0.4.31' } };
    const { handler } = createHandler({ selector: { pick: jest.fn(), probe: jest.fn().mockResolvedValue(payload) } });
    expect((await handler.execute(context(), step({ operation: 'probe' }))).output).toEqual(payload);
  });
});
```
(The existing "probe without input" tests keep passing because the default selector derives `server`/`ops`/`version` from the same `capability` mock — verify; if `capability.isFlagOn` is missing on the literal mock, the selector must treat a missing method as `isEnabled()` — simpler: give the default selector's flag check `capability.isFlagOn?.() ?? capability.isEnabled()`.)

- [ ] **Step 5: The four config surfaces**
  - `step-handler.interface.ts`: add to `FfmpegHandlerConfig`:
    ```ts
    /** Which executor runs the job: 'local' (this backend) | 'remote' (Worker) | an expression resolving to one. Default: the instance's default executor. Unavailable → FFMPEG_EXECUTOR_UNAVAILABLE. */
    executor?: 'local' | 'remote' | string;
    ```
    and in the TSDoc: extend the `probe` bullet to `{ server, ops, version, executors, defaultExecutor, remote? }`, add a paragraph "Executors: `local` runs ffmpeg in this backend; `remote` sends the job to a Worker over signed storage URLs (bucket storage only; see Server Video Ops docs). Every op output additionally reports `executor`, `timings{…}`, `bytesIn`, `bytesOut`.", and add `FFMPEG_EXECUTOR_UNAVAILABLE` to the error mention.
  - `proxy-rules.tools.ts:70`: add `executor?: 'local'|'remote'|expr` to the config list, `executors/defaultExecutor` to the probe sentence, and `FFMPEG_EXECUTOR_UNAVAILABLE` to the error list. Extend `proxy-rules.tools.ffmpeg.spec.ts` with one `parse` case including `executor: 'remote'`.
  - Frontend `types.ts` (~440): `executor?: 'local' | 'remote' | string;` with the same one-line doc.
  - `FfmpegHandlerConfig.tsx`: add `'executor'` to every op's `FIELDS_BY_OPERATION` list except… include it for all four (probe-with-input runs remotely too); render a `<Select>` "Executor" with options *Instance default* (unset) / *Local server* / *Remote worker* + a free-text expression toggle if the file already has that pattern for other fields (check how `input` handles expressions — mirror it; if there is no such pattern, a plain `<Input placeholder="local | remote | {{expression}}">` is acceptable). Update the output-contract card text (184–200) to mention `executor`/`timings`.
  - Frontend typecheck + lint: `cd apps/frontend && pnpm tsc --noEmit && pnpm lint` (lint on main already has 58 pre-existing problems — only fail on *new* ones; compare counts against `git stash`-free baseline by running lint on `origin/main` file list if needed).

- [ ] **Step 6: Run everything**

```bash
cd apps/backend && pnpm tsc --noEmit && pnpm test -- "ffmpeg|proxy-rules.tools" 2>&1 | tail -20
cd ../frontend && pnpm tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(ffmpeg): executor selection (step config → instance default), additive capability probe and step telemetry, executor config surfaces"
```

---

### Task 5: The Worker (`workers/ffmpeg/`) + compose profile

**Files:**
- Create: `workers/ffmpeg/package.json`, `workers/ffmpeg/server.mjs`, `workers/ffmpeg/job.mjs`, `workers/ffmpeg/Dockerfile`, `workers/ffmpeg/README.md`, `workers/ffmpeg/test/job.test.mjs`, `workers/ffmpeg/test/server.test.mjs`, `workers/ffmpeg/.dockerignore`
- Modify: `docker-compose.yml` (new service), `.env.example` (already documented in Task 2 — verify the port matches)

**Interfaces:**
- Consumes: the wire contract from Task 2 (`WorkerEnvelope`, `WorkerResponse`, `WorkerHealth`) — the Worker is a separate Node program with **zero** dependencies; it must never import from `apps/backend`.
- Produces: `POST /jobs`, `GET /healthz`; env `PORT` (default 8080), `WORKER_VERSION` (default `dev`), `WORKER_ALLOW_HTTP` (`1` allows `http:` signed URLs), `WORKER_SCRATCH_DIR` (default `os.tmpdir()`), `WORKER_MAX_BODY_BYTES` (1 MiB).

`job.mjs` exports (pure-ish, testable without HTTP):
```js
export function substituteArgv(argv, names, scratchDir)         // '{in:x}'→ path.join(scratchDir,'x'); throws Error('unknown placeholder {in:x}') if x ∉ names; validates that x has no '/' or '..'
export function validateEnvelope(envelope, { allowHttp })       // throws { code:'BAD_REQUEST', message } on: v!==1, missing/empty commands, bad kind, non-array argv, duplicate names, url not https (unless allowHttp), unresolved-name placeholders, maxSeconds<=0
export async function runJob(envelope, { signal, scratchRoot, ffmpegBin='ffmpeg', ffprobeBin='ffprobe', fetchImpl=fetch, spawnImpl=spawn }) // → WorkerResponse (never throws for job-level failures; only for programmer errors)
```
`runJob` sequence: `mkdtemp(scratchRoot/job-)` → download each input (`fetchImpl(url, {signal})`, non-2xx → `INPUT_FETCH_FAILED` with status, `Readable.fromWeb(body)` piped to file; count bytesIn) → write `files` → for each command: skip if `fallbackFor` names a command that did not fail; else spawn `bin` with `substituteArgv(...)`, `cwd=scratch`, `stdio:['ignore','pipe','pipe']`, keep the last 4096 bytes of stderr, collect stdout (cap 1 MiB); a per-job deadline timer (`maxSeconds`) and the request `signal` both `child.kill('SIGKILL')` → `FFMPEG_TIMEOUT` / abort; exit non-zero: if a later command has `fallbackFor === id` mark failed and continue, else `FFMPEG_FAILED` (message `ffmpeg exited <code>`); after all commands: for each output `stat` (missing → `FFMPEG_FAILED 'command produced no <name>'`; `size > limits.maxOutputBytes` → `OUTPUT_TOO_LARGE`), then `fetchImpl(url, { method:'PUT', headers:{'content-type': contentType, 'content-length': String(size)}, body: Readable.toWeb(createReadStream(path)), duplex:'half', signal })`, non-2xx → `OUTPUT_UPLOAD_FAILED` with status + first 200 chars of the body; count bytesOut → `{ v:1, ok:true, … timings, worker }` ; `finally rm -rf scratch`. Any `ok:false` still returns HTTP 200 with the code (the request itself succeeded).

`server.mjs`: `http.createServer`; `GET /healthz` → `{ ok:true, version: WORKER_VERSION, ffmpeg: <first line of `ffmpeg -version` captured once at boot, or null>, ops:['ffmpeg','ffprobe'], uptimeS }` (`ok:false` + 503 when ffmpeg is missing); `POST /jobs` → read body up to `WORKER_MAX_BODY_BYTES` (413 beyond), `JSON.parse` (400 on failure), `validateEnvelope` (400 `{ok:false, code:'BAD_REQUEST', message}`), then `runJob` with an `AbortController` aborted on `req.on('close')` before the response has been written and on `res.on('close')` — the disconnect → cancel rule; respond 200 JSON. Concurrency: **one job at a time per process** — a second concurrent `POST /jobs` gets 503 `{code:'BUSY'}` (Cloud Run `--concurrency=1` makes this moot; it is the safety net for other hosts, and 503 is what CE retries once). Log one JSON line per job to stdout `{event:'job', id, ok, code, totalMs, bytesIn, bytesOut}`. Everything else → 404. Listen on `PORT`; `SIGTERM` → stop accepting, wait for the in-flight job (Cloud Run gives 10 s by default; document `--no-cpu-throttling` not needed).

- [ ] **Step 1: Failing worker unit tests** — `workers/ffmpeg/test/job.test.mjs` (Node `node:test`, run with `node --test workers/ffmpeg/test/`):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { substituteArgv, validateEnvelope, runJob } from '../job.mjs';

test('substituteArgv maps {in|out|file:NAME} to scratch paths and rejects unknown/unsafe names', () => {
  assert.deepEqual(substituteArgv(['-i', '{in:a.mp4}', '{out:b.wav}', '-x'], new Set(['a.mp4', 'b.wav']), '/s'), ['-i', '/s/a.mp4', '/s/b.wav', '-x']);
  assert.throws(() => substituteArgv(['{in:zzz}'], new Set(['a']), '/s'), /unknown placeholder/);
  assert.throws(() => substituteArgv(['{in:../etc}'], new Set(['../etc']), '/s'), /unsafe/);
});

const okEnvelope = (over = {}) => ({ v: 1, id: 'j', commands: [{ id: 'c', kind: 'ffmpeg', argv: ['-i', '{in:in.mp4}', '{out:out.wav}'] }], inputs: [{ name: 'in.mp4', url: 'https://b/in' }], outputs: [{ name: 'out.wav', url: 'https://b/out', contentType: 'audio/wav' }], files: [], maxSeconds: 60, limits: { maxOutputBytes: 1024 }, ...over });

test('validateEnvelope accepts v1 and rejects http URLs unless allowed, bad kinds, duplicates', () => {
  assert.doesNotThrow(() => validateEnvelope(okEnvelope(), { allowHttp: false }));
  assert.throws(() => validateEnvelope(okEnvelope({ inputs: [{ name: 'in.mp4', url: 'http://b/in' }] }), { allowHttp: false }), /https/);
  assert.doesNotThrow(() => validateEnvelope(okEnvelope({ inputs: [{ name: 'in.mp4', url: 'http://b/in' }] }), { allowHttp: true }));
  assert.throws(() => validateEnvelope(okEnvelope({ commands: [{ id: 'c', kind: 'sh', argv: [] }] }), { allowHttp: false }), /kind/);
  assert.throws(() => validateEnvelope(okEnvelope({ outputs: [{ name: 'in.mp4', url: 'https://b/o', contentType: 'x' }] }), { allowHttp: false }), /duplicate/);
  assert.throws(() => validateEnvelope(okEnvelope({ v: 2 }), { allowHttp: false }), /v/);
});

/** Fake spawn: writes the last argv token as a file, exits with `code` after `delayMs`; ignores SIGKILL unless `killable`. */
function fakeSpawn({ code = 0, delayMs = 0, stderr = 'err', killable = true } = {}) {
  const calls = [];
  const impl = (bin, argv, opts) => {
    calls.push({ bin, argv, opts });
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { if (killable) { clearTimeout(t); child.emit('close', null, 'SIGKILL'); } };
    const t = setTimeout(async () => {
      if (code === 0) await writeFile(argv[argv.length - 1], 'OUT');
      child.stderr.end(stderr); child.stdout.end('{"format":{}}');
      child.emit('close', code, null);
    }, delayMs);
    return child;
  };
  return { impl, calls };
}
/** Fake fetch: GET returns `inputBytes`, PUT records the body and returns `putStatus`. */
function fakeFetch({ getStatus = 200, putStatus = 200, inputBytes = 'INPUT' } = {}) {
  const puts = [];
  const impl = async (url, init = {}) => {
    if ((init.method ?? 'GET') === 'PUT') { let n = 0; for await (const chunk of init.body) n += chunk.length; puts.push({ url, headers: init.headers, bytes: n }); return new Response('', { status: putStatus }); }
    return new Response(getStatus === 200 ? inputBytes : 'nope', { status: getStatus });
  };
  return { impl, puts };
}
const scratchRoot = () => mkdtemp(path.join(tmpdir(), 'wk-'));

test('happy path: downloads, substitutes, runs, uploads only on exit 0, reports bytes + timings', async () => {
  const sp = fakeSpawn(); const f = fakeFetch();
  const res = await runJob(okEnvelope(), { signal: new AbortController().signal, scratchRoot: await scratchRoot(), fetchImpl: f.impl, spawnImpl: sp.impl });
  assert.equal(res.ok, true);
  assert.equal(sp.calls[0].bin, 'ffmpeg');
  assert.match(sp.calls[0].argv[1], /in\.mp4$/);
  assert.equal(f.puts.length, 1);
  assert.equal(f.puts[0].headers['content-type'], 'audio/wav');
  assert.deepEqual(res.outputs, [{ name: 'out.wav', bytes: 3 }]);
  assert.equal(res.bytesIn, 5); assert.equal(res.bytesOut, 3);
  assert.deepEqual(res.commands, [{ id: 'c', ran: true, exitCode: 0 }]);
  for (const k of ['transferInMs', 'ffmpegMs', 'transferOutMs', 'totalMs']) assert.equal(typeof res.timings[k], 'number');
});
test('input 404 → INPUT_FETCH_FAILED, nothing spawned', async () => {
  const sp = fakeSpawn(); const f = fakeFetch({ getStatus: 404 });
  const res = await runJob(okEnvelope(), { signal: new AbortController().signal, scratchRoot: await scratchRoot(), fetchImpl: f.impl, spawnImpl: sp.impl });
  assert.deepEqual([res.ok, res.code], [false, 'INPUT_FETCH_FAILED']); assert.equal(sp.calls.length, 0);
});
test('non-zero exit → FFMPEG_FAILED with stderr tail, no upload', async () => {
  const sp = fakeSpawn({ code: 1, stderr: 'Conversion failed!' }); const f = fakeFetch();
  const res = await runJob(okEnvelope(), { signal: new AbortController().signal, scratchRoot: await scratchRoot(), fetchImpl: f.impl, spawnImpl: sp.impl });
  assert.deepEqual([res.ok, res.code], [false, 'FFMPEG_FAILED']); assert.match(res.stderrTail, /Conversion failed/); assert.equal(f.puts.length, 0);
});
test('fallbackFor runs the fallback only after its target fails', async () => {
  let n = 0; const sp = fakeSpawn(); const first = sp.impl;
  const impl = (bin, argv, opts) => (n++ === 0 ? fakeSpawn({ code: 1 }).impl(bin, argv, opts) : first(bin, argv, opts));
  const f = fakeFetch();
  const env = okEnvelope({ commands: [{ id: 'copy', kind: 'ffmpeg', argv: ['{out:out.wav}'] }, { id: 're', kind: 'ffmpeg', argv: ['{out:out.wav}'], fallbackFor: 'copy' }] });
  const res = await runJob(env, { signal: new AbortController().signal, scratchRoot: await scratchRoot(), fetchImpl: f.impl, spawnImpl: impl });
  assert.equal(res.ok, true); assert.deepEqual(res.commands, [{ id: 'copy', ran: true, exitCode: 1 }, { id: 're', ran: true, exitCode: 0 }]);
});
test('maxSeconds → SIGKILL → FFMPEG_TIMEOUT', async () => {
  const sp = fakeSpawn({ delayMs: 5_000 }); const f = fakeFetch();
  const res = await runJob(okEnvelope({ maxSeconds: 0.05 }), { signal: new AbortController().signal, scratchRoot: await scratchRoot(), fetchImpl: f.impl, spawnImpl: sp.impl });
  assert.deepEqual([res.ok, res.code], [false, 'FFMPEG_TIMEOUT']);
});
test('abort signal (client disconnect) kills the child and reports FFMPEG_TIMEOUT-like cancel', async () => {
  const sp = fakeSpawn({ delayMs: 5_000 }); const f = fakeFetch(); const ac = new AbortController();
  const p = runJob(okEnvelope(), { signal: ac.signal, scratchRoot: await scratchRoot(), fetchImpl: f.impl, spawnImpl: sp.impl });
  setTimeout(() => ac.abort(), 20);
  const res = await p; assert.equal(res.ok, false); assert.equal(res.code, 'CANCELLED');
});
test('output over maxOutputBytes → OUTPUT_TOO_LARGE; upload non-2xx → OUTPUT_UPLOAD_FAILED', async () => {
  const f1 = fakeFetch(); const r1 = await runJob(okEnvelope({ limits: { maxOutputBytes: 2 } }), { signal: new AbortController().signal, scratchRoot: await scratchRoot(), fetchImpl: f1.impl, spawnImpl: fakeSpawn().impl });
  assert.equal(r1.code, 'OUTPUT_TOO_LARGE'); assert.equal(f1.puts.length, 0);
  const f2 = fakeFetch({ putStatus: 403 }); const r2 = await runJob(okEnvelope(), { signal: new AbortController().signal, scratchRoot: await scratchRoot(), fetchImpl: f2.impl, spawnImpl: fakeSpawn().impl });
  assert.equal(r2.code, 'OUTPUT_UPLOAD_FAILED'); assert.match(r2.message, /403/);
});
test('the scratch dir is removed afterwards', async () => {
  const root = await scratchRoot(); const f = fakeFetch();
  await runJob(okEnvelope(), { signal: new AbortController().signal, scratchRoot: root, fetchImpl: f.impl, spawnImpl: fakeSpawn().impl });
  const { readdir } = await import('node:fs/promises'); assert.deepEqual(await readdir(root), []);
});
```

`CANCELLED` is a worker-side code for "the caller went away" — CE never sees it (its request is gone). Add it to the Worker's code list in the README; CE's `WorkerErrorCode` type does not need it. Also add `'CANCELLED'` handling to `result-mapping.ts` as `FFMPEG_EXECUTOR_UNAVAILABLE` for completeness (one line, one test case).

- [ ] **Step 2: `server.test.mjs`** — boots the server on port 0 with a fake `runJob` injected (`createServer({ runJob: fake, allowHttp: true, version: 't' })` exported from `server.mjs`), asserts: `GET /healthz` 200 shape; `POST /jobs` bad JSON → 400; invalid envelope → 400 `BAD_REQUEST`; valid → 200 with the fake's result; second concurrent POST while first pending → 503 `BUSY`; client abort mid-job → the injected `signal` becomes aborted; body > `maxBodyBytes` → 413.

- [ ] **Step 3: Run → FAIL (`node --test workers/ffmpeg/test/`), implement `job.mjs` + `server.mjs`, run → PASS.** `package.json`: `{ "name": "@bffless/ffmpeg-worker", "private": true, "type": "module", "engines": { "node": ">=20" }, "scripts": { "start": "node server.mjs", "test": "node --test test/" } }` — no dependencies. Add `"test:worker": "node --test workers/ffmpeg/test/"` to the **root** `package.json` scripts and call it from `pr-tests.yml` next to the backend tests (one extra step, ~1 s).

- [ ] **Step 4: Dockerfile + compose profile**

`workers/ffmpeg/Dockerfile`:
```dockerfile
FROM node:20-alpine
# Same ffmpeg package line as docker/backend.Dockerfile so flags/versions match the local executor.
RUN apk add --no-cache ffmpeg
ARG VERSION=dev
ENV WORKER_VERSION=$VERSION PORT=8080 NODE_ENV=production
WORKDIR /app
COPY package.json server.mjs job.mjs ./
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
```
`.dockerignore`: `test/`, `README.md`.

`docker-compose.yml` — new service after `redis`:
```yaml
  ffmpeg-worker:
    # Remote executor for server video ops (docs: Server Video Ops → Remote executor).
    # Local-dev / private-network profile: plain http, no auth. Cloud Run is the reference deployment.
    image: ghcr.io/bffless/ce-ffmpeg-worker:${BACKEND_TAG:-latest}
    container_name: assethost-ffmpeg-worker
    profiles:
      - ffmpeg-worker # Only starts with --profile ffmpeg-worker
    environment:
      PORT: 8080
      WORKER_ALLOW_HTTP: "1" # MinIO presigned URLs inside the compose network are http://
    networks:
      - assethost-network
    restart: unless-stopped
```
(`docker-compose.build.yml` gets the same service with `build: { context: ./workers/ffmpeg, args: { VERSION: ${VERSION:-dev} } }` instead of `image:`.) Compose network name: confirm `assethost-network` is the network the backend joins (line ~464) and that MinIO presigned URLs CE generates resolve inside that network (`MINIO_ENDPOINT` — check `storage/minio.adapter.ts` for a public-endpoint option; if CE signs with `localhost:9000` for browser uploads, the Worker cannot reach it — document in the README that the Worker must reach the same host the URLs name; the integration test in Task 6 sidesteps this by running the Worker as a host process).

- [ ] **Step 5: `workers/ffmpeg/README.md`** — 40 lines: what it is (dumb argv runner, ADR-0004), the wire contract (copy the v1 JSON from the spec, adjusted to `commands[]`), env vars, `docker build -t ce-ffmpeg-worker workers/ffmpeg && docker run -p 8080:8080 -e WORKER_ALLOW_HTTP=1 ce-ffmpeg-worker`, the one-command Cloud Run deploy block from the spec §1.7 (with image `ghcr.io/bffless/ce-ffmpeg-worker:<ver>`), and "security: who can call it, not what it runs".

- [ ] **Step 6: Build the image locally and smoke it**

```bash
docker build -t ce-ffmpeg-worker:dev workers/ffmpeg && docker run -d --rm -p 18080:8080 --name wk ce-ffmpeg-worker:dev
curl -s localhost:18080/healthz   # {"ok":true,"version":"dev","ffmpeg":"ffmpeg version 6.x…","ops":["ffmpeg","ffprobe"],"uptimeS":…}
docker stop wk
```

- [ ] **Step 7: Commit**

```bash
git add workers docker-compose.yml docker-compose.build.yml package.json .github/workflows/pr-tests.yml
git commit -m "feat(ffmpeg): ffmpeg Worker image (workers/ffmpeg) — dumb argv runner over signed URLs, compose profile"
```

---

### Task 6: Integration test — CE `RemoteFfmpegExecutor` ↔ real Worker over MinIO

**Files:**
- Create: `apps/backend/src/pipelines/__tests__/integration/ffmpeg.remote.spec.ts`
- Modify: `apps/backend/package.json` (nothing — reuse `test:integration`), `docs/superpowers/plans/…` (record how to run)

**Gate:** `hasFfmpeg` (as the existing integration spec) AND `process.env.FFMPEG_IT_MINIO_ENDPOINT` (e.g. `http://localhost:9000`, with `FFMPEG_IT_MINIO_ACCESS_KEY`/`SECRET_KEY`, default `minioadmin`/`minioadmin`, bucket `ffmpeg-it` created by the test). Otherwise `describe.skip`. Start MinIO with `docker compose --profile minio up -d minio` (host port mapping: check `docker-compose.yml` `minio` service — if the port is not published, use `docker run -d -p 9000:9000 minio/minio server /data` for the test).

- [x] **Step 1: Write the spec**

```ts
// Boots workers/ffmpeg/server.mjs as a child process on a free port with WORKER_ALLOW_HTTP=1,
// builds a real MinioStorageAdapter against FFMPEG_IT_MINIO_ENDPOINT, uploads a generated fixture
// (same lavfi testsrc+sine recipe as ffmpeg.handler.spec integration), and drives the REAL
// FfmpegHandler (LocalFfmpegExecutor + RemoteFfmpegExecutor + FfmpegExecutorSelector, real
// ExpressionEvaluator, capability stub {isFlagOn: true, isAvailable: true}) with
// FFMPEG_EXECUTOR=remote FFMPEG_REMOTE_URL=http://127.0.0.1:<port> FFMPEG_REMOTE_AUTH=none.
// Cases: probe(no input) → executors contains 'remote', defaultExecutor 'remote', server true;
//        probe(input) → duration≈2, streams≥2, output.executor==='remote';
//        extract_audio → object exists in MinIO, size>0, content_type audio/wav, timings.totalMs>0, bytesOut===size;
//        slice (2 spans + audioOutput) → clip + wav both exist, duration≈1;
//        concat (clip twice) → final exists, reencoded false;
//        step.config.executor 'local' on the same handler → output.executor==='local' (both peers on one instance);
//        worker stopped → extract_audio returns FFMPEG_EXECUTOR_UNAVAILABLE.
```
Write it fully (≈150 lines) modelled on `__tests__/integration/ffmpeg.handler.spec.ts` (fixture generation, `beforeAll` env, `afterAll` cleanup incl. `child.kill()` and bucket purge via `deletePrefix`). Assert the `ffmpeg_remote_job` log line by spying on `Logger.prototype.log` and finding an arg with `event === 'ffmpeg_remote_job'`.

- [x] **Step 2: Run it for real**

```bash
docker run -d --rm -p 9000:9000 --name it-minio minio/minio server /data
cd apps/backend && FFMPEG_IT_MINIO_ENDPOINT=http://localhost:9000 pnpm test:integration -- ffmpeg.remote 2>&1 | tail -20
docker stop it-minio
```
Expected: all cases PASS on the VPS (ffmpeg is installed here? `which ffmpeg` — if not, `sudo apt-get install -y ffmpeg` in a real terminal, or run the suite inside the backend image). Fix whatever real MinIO/undici/streaming behaviour the unit tests could not see (e.g. `content-length` on PUT, MinIO presigned PUT rejecting an unexpected `content-type` — if it does, sign the content type into the URL or drop the header for MinIO; record the finding in the spec's Risks).

- [x] **Step 3: Commit**

```bash
git add -A && git commit -m "test(ffmpeg): remote executor integration — CE ↔ real worker over MinIO for all four ops"
```

**Verified (how to run).**

```bash
docker run -d --rm -p 9000:9000 --name it-minio minio/minio server /data
cd apps/backend && FFMPEG_IT_MINIO_ENDPOINT=http://localhost:9000 \
  pnpm test:integration -- src/pipelines/__tests__/integration/ffmpeg.remote.spec.ts
docker stop it-minio
```

`pnpm test:integration -- <pattern>` does reach jest as `--testPathPattern`, but the pattern
is matched against the ABSOLUTE path: inside a worktree named `…/ffmpeg-remote-executor-impl`
the loose pattern `ffmpeg.remote` matches every suite (`.` is a regex wildcard, so it hits the
directory name too). Pass the file path (above) or an anchored pattern
(`'ffmpeg\.remote\.spec'`) to actually filter.

The Worker runs as a host child process on a free port (`WORKER_ALLOW_HTTP=1`,
`WORKER_VERSION=it`, `WORKER_SCRATCH_DIR` in a temp dir), so the `localhost:9000`
presigned URLs CE signs are reachable from it. Without `FFMPEG_IT_MINIO_ENDPOINT` the
suite self-skips, so the normal `pnpm test` / CI run is unaffected (no MinIO in CI).

**Findings from the real run** (no production-code change was needed):
- MinIO's presigned PUT (`presignedPutObject`, SigV4 query auth, `SignedHeaders=host`)
  **accepts** the Worker's unsigned `content-type` header and stores it — the object comes
  back from `statObject` with `content-type: audio/wav`. No need to sign the content type
  into the URL or drop the header.
- The Worker's `content-length` + web-stream `body` + `duplex:'half'` PUT works unchanged
  through undici against MinIO.

---

### Task 7: Release — publish `ce-ffmpeg-worker` next to the backend image

**Files:**
- Modify: `.github/workflows/main-release.yml` (`build-and-push` job: after "Extract metadata - Backend" add an "Extract metadata - ffmpeg worker" step; after "Build and push backend" add "Build and push ffmpeg worker"; extend the release-notes/summary steps at ~211–260 to list the third image)
- Modify: `.github/workflows/preview.yml` / `build-branch.yml` **only if** they build the backend image per branch — mirror the same two steps there so preview channels get a worker tag too (check first: `grep -n backend.Dockerfile .github/workflows/*.yml`).

- [ ] **Step 1: Add the steps**

```yaml
      - name: Extract metadata - ffmpeg worker
        id: meta-ffmpeg-worker
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_PREFIX }}-ffmpeg-worker
          tags: |
            type=raw,value=${{ inputs.channel == 'preview' && 'preview' || 'latest' }}
            type=raw,value=${{ steps.version.outputs.version }}
            type=sha,prefix=main-

      - name: Build and push ffmpeg worker
        uses: docker/build-push-action@v5
        with:
          context: ./workers/ffmpeg
          file: ./workers/ffmpeg/Dockerfile
          push: true
          build-args: |
            VERSION=${{ steps.version.outputs.version }}
          tags: ${{ steps.meta-ffmpeg-worker.outputs.tags }}
          labels: ${{ steps.meta-ffmpeg-worker.outputs.labels }}
```
and add `docker pull ghcr.io/${{ github.repository }}-ffmpeg-worker:${VERSION}` lines to the release-body and step-summary sections.

- [ ] **Step 2: Validate the YAML** — `actionlint .github/workflows/main-release.yml` if installed (`which actionlint`), else `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/main-release.yml'))"`.

- [ ] **Step 3: Commit**

```bash
git add .github && git commit -m "ci(release): build and push ghcr.io/bffless/ce-ffmpeg-worker with the backend image"
```

---

### Task 8: Verification, epic notes, hand-off

- [ ] **Step 1: Full backend + frontend gates**

```bash
cd apps/backend && pnpm tsc --noEmit && pnpm test 2>&1 | tail -15 && pnpm lint 2>&1 | tail -3
cd ../frontend && pnpm tsc --noEmit && pnpm lint 2>&1 | tail -3     # compare problem count with origin/main's 58 — no new ones
cd ../.. && node --test workers/ffmpeg/test/ 2>&1 | tail -5
```

- [ ] **Step 2: Compose smoke (dev profile)** — `docker compose --profile ffmpeg-worker up -d ffmpeg-worker` (using the locally built image tag: `BACKEND_TAG=dev` after `docker tag ce-ffmpeg-worker:dev ghcr.io/bffless/ce-ffmpeg-worker:dev`), `curl` its `/healthz` from inside the backend container's network (`docker run --rm --network <network> curlimages/curl -s http://ffmpeg-worker:8080/healthz`), then `docker compose --profile ffmpeg-worker down`.

- [ ] **Step 3: Update the epic (bffless/apps#346)** with one comment: link to the branch/PR-to-be, the two deliberate deviations (image name `ce-ffmpeg-worker`; envelope `commands[]`), what Plan 1 delivers (env-configured Remote), and that T5 (settings UI + encrypted SA key) / T9 (docs) / Studio follow as Plans 2–3. **Ask the user before pushing the branch or opening the CE PR** (CLAUDE.md git rules; the epic comment itself is fine to post — it is a status note, not a code change).

- [ ] **Step 4: Update memory** `ffmpeg-remote-executor-design.md` → status "core implemented on branch feat/ffmpeg-remote-executor (worktree …-impl), PR pending", and note the two deviations.

---

## Self-review (done while writing)

- **Spec coverage:** §1.1 seam → T1; §1.2 remote executor (envelope, token cache, fuse, retry, ready incl. min-version, getMetadata confirm) → T2/T3; §1.3 wire contract → T2 (+ deviation `commands[]`) and T5; §1.4 worker (streams, maxSeconds SIGKILL, maxOutputBytes, disconnect→abort, scratch wipe, Alpine apk, compose profile, .env.example) → T5/T2; §1.5 probe payload + `executor` config across the 4 surfaces + env overrides → T4/T2 — **settings UI/DB storage deferred to Plan 2 by design**; §1.6 tests → T1–T6 (rules-level smoke in CI = Plan 2 alongside docs, noted); §1.7 docs → Plan 2 (`docs-public/docs/features/server-video-ops.md` is the page); D11 telemetry + `ffmpeg_remote_job` → T1/T3; D7 release → T7.
- **Placeholders:** the four "verbatim" bodies in Task 1 point at exact line ranges of code that exists today; every other step carries code.
- **Type consistency:** `FfmpegJob{id,commands,inputs,outputs,files}` / `FfmpegJobCommand{id,kind,argv,timeoutSeconds?,fallbackFor?}` / `FfmpegJobResult{executor,stdout,stderrTail,commands,outputs,bytesIn,bytesOut,timings,worker?}` are used identically in T1 (local), T2 (envelope/mapping), T3 (remote), T4 (handler), T5 (worker JSON mirrors them). Executor method names `argvThreads()/ready()/run(job,{signal})` and selector `enabled()/defaultExecutor()/pick()/probe()` match across T1/T3/T4.
