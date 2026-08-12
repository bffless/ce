# CE ffmpeg Pipeline Handler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a curated, resource-guarded `ffmpeg_handler` pipeline handler to CE so apps (Studio first) can run video ops — probe, audio extract, slice/assemble, concat — server-side against storage objects, replacing 15-minute wasm encodes with native-speed ones.

**Architecture:** A new `StepHandler` sibling of `replicate`/`image_convert_handler` that spawns `ffmpeg`/`ffprobe` as strictly-guarded child processes (address-space cap, nice, thread cap, concurrency-1 queue, watchdog, pre-flight memory/disk checks). Inputs and outputs are storage paths; bytes stream storage → temp file → ffmpeg → temp file → storage, never buffering whole objects in heap. Placement in `postSteps` (which have **no engine timeout** — verified) makes long ops async under the existing fire-and-poll pattern; job rows are authored by apps, not CE.

**Tech Stack:** NestJS (backend), `node:child_process.spawn` (argv arrays, no shell), Jest, Alpine Docker image (`apk`, not apt).

**Spec:** `docs/superpowers/specs/2026-08-12-ce-ffmpeg-pipeline-handler-design.md` (same worktree). This plan covers **Part 1 (CE)** only; Part 2 (Studio adoption) is a separate plan in `bffless/apps`.

## Global Constraints

- Env vars (exact names/defaults from the spec): `FFMPEG_HANDLER_ENABLED` (default on when binary exists), `FFMPEG_MEMORY_MB` (default `1024`), `FFMPEG_THREADS` (default `max(1, cores − 1)`), `FFMPEG_QUEUE_MAX` (default `8`), `FFMPEG_MAX_SECONDS` (default `1800`). This plan adds `FFMPEG_SCRATCH_DIR` (default `path.join(os.tmpdir(), 'bffless-ffmpeg')`).
- **Curated operations only, never raw ffmpeg args** (security: no arg injection). Spawn with argv arrays, never a shell string.
- Inputs/outputs are **storage paths confined to the project's `{owner}/{repo}/uploads/` root**; reject `..` and `//`; no filesystem paths in configs.
- **Stream both ways**; never hold a whole video in a Buffer (the file-serve OOM lesson). Temp files live in one bounded scratch dir, cleaned in `finally`, with an orphan sweep on boot + hourly.
- **Global concurrency 1** with a bounded queue; enqueue beyond depth fails fast with a "server busy" error the client can back off on.
- The CE backend image is **`node:20-alpine`** — packages via `apk add --no-cache`, and `prlimit` requires `util-linux-misc`. Both `docker/backend.Dockerfile` **and** `docker/backend.umbrel.Dockerfile` must change; do NOT add ffmpeg to the `apk del` shrink line.
- Every new env var must ALSO be added to the `docker-compose.yml` backend `environment:` block (`FOO: ${FOO:-default}`) or the container never sees it (see the `ONBOARDING_TOKEN` war story at `docker-compose.yml:282-288`). Treat `''` as unset when parsing.
- Port the **wasm-proven flag sets verbatim from Studio** (`repos/apps/apps/studio/src/lib/export/slice.ts` + `assemble.ts`): `libx264 -preset ultrafast` (NOT the spec table's `veryfast -crf` parenthetical — the spec's own "keep the wasm-proven flag sets" instruction wins), `-pix_fmt yuv420p`, `-c:a aac`, `-movflags +faststart`, `-fps_mode passthrough`, shared-origin `trim`/`atrim` (`PTS-<start>/TB`), `-ss`-before-`-i` + `-copyts` fast seek for single spans, `-f concat -safe 0 -fflags +genpts -c copy` for stitch.
- Handler step output composes with existing handlers: `{ storage_path, content_type, size, ... }` (what `replicate.findContentTypeFromSteps` and `file_upload_handler`'s sourceUrl mode expect).
- postSteps have **no engine timeout and no cancellation** (verified: `pipeline-execution.service.ts:600` is a bare `await`; the only `Promise.race` is main steps' 30 s default at `:454-466`, and it does NOT kill the loser). The handler owns its watchdog and must SIGKILL its child itself.
- Backend Jest specs are colocated `*.spec.ts` under `src/`, direct `new Handler(...)` construction (no `Test.createTestingModule`), collaborators as object literals cast `as never`, real `ExpressionEvaluator`. Integration specs go in `src/**/__tests__/integration/` (picked up by `jest.integration.config.js`, serial, 30 s timeout) — run via `pnpm test:integration`.
- Run single unit tests from `apps/backend` with `pnpm test -- <pattern>` (note: `pnpm test` runs jest `--coverage`; on a memory-tight box use `NODE_OPTIONS=--max-old-space-size=4096`).
- Commit after every task (this worktree's branch: `feat/ffmpeg-pipeline-handler`).

## Contract exported to the Studio plan (Part 2)

The Studio plan consumes exactly this; do not drift from it without updating both plans.

- Handler type string: `ffmpeg_handler`. Config shape: see `FfmpegHandlerConfig` in Task 6.
- `probe` with **no `input`** never fails and returns `{ server: boolean, ops: string[], version: string | null }` — this is the `/api/video/capabilities` payload.
- `probe` with `input` returns `{ duration: number, format: object, streams: array }`.
- `extract_audio` returns `{ storage_path, content_type: 'audio/wav', size }` (16 kHz mono WAV — the story 01b transcription contract).
- `slice` returns `{ storage_path, content_type: 'video/mp4', size, duration, audio? }` where `audio` (present when `audioOutput` configured) is `{ storage_path, content_type: 'audio/wav', size }`.
- `concat` returns `{ storage_path, content_type: 'video/mp4', size, reencoded: boolean }`.
- Error codes (in `StepResult.error.code`): `FFMPEG_UNAVAILABLE`, `FFMPEG_BUSY`, `FFMPEG_INSUFFICIENT_MEMORY`, `FFMPEG_INSUFFICIENT_DISK`, `FFMPEG_TIMEOUT`, `FFMPEG_FAILED`, `INVALID_INPUT_PATH`, `INVALID_OUTPUT_PATH`, `INVALID_SPANS`, `FILE_NOT_FOUND`.
- Input paths accept either a full storage key (`{owner}/{repo}/uploads/...`), an uploads-relative path (`studio/videos/x.mp4`), or an `/api/uploads/...` serve URL. Output paths are uploads-relative.
- **Redeploy-kills-job caveat:** postSteps die with the process and CE does not know app job tables, so the "sweep `running` rows older than the watchdog" mitigation from the spec lands in the **Studio plan** (client/rule side: treat a `running` row older than `FFMPEG_MAX_SECONDS` as `error("interrupted")`).

## File Structure

New (backend):

- `apps/backend/src/pipelines/ffmpeg/ffmpeg-env.ts` — pure env parsing (`readFfmpegEnv`)
- `apps/backend/src/pipelines/ffmpeg/ffmpeg-args.ts` — pure argv builders (port of Studio's slice/assemble/concat)
- `apps/backend/src/pipelines/ffmpeg/ffmpeg-capability.service.ts` — boot probe (`ffmpeg -version`/`ffprobe -version`, ENOENT-tolerant)
- `apps/backend/src/pipelines/ffmpeg/ffmpeg-scratch.service.ts` — per-job temp dirs, free-space check, boot + hourly orphan sweep
- `apps/backend/src/pipelines/ffmpeg/ffmpeg-runner.service.ts` — queue, memory pre-flight, guarded spawn, watchdog; typed errors in `apps/backend/src/pipelines/ffmpeg/ffmpeg-errors.ts`
- `apps/backend/src/pipelines/handlers/ffmpeg.handler.ts` — the `StepHandler`
- colocated `*.spec.ts` for each of the above
- `apps/backend/src/pipelines/__tests__/integration/ffmpeg.handler.spec.ts` — binary-gated end-to-end

New (frontend):

- `apps/frontend/src/components/pipelines/handlers/FfmpegHandlerConfig.tsx`

Modified:

- `apps/backend/src/storage/storage.interface.ts`, `local.adapter.ts`, `minio.adapter.ts`, `gcs.adapter.ts`, `azure.adapter.ts`, `dynamic-storage.adapter.ts`, `cache/caching-storage.adapter.ts` (add `uploadStream`)
- `apps/backend/src/pipelines/types.ts` (union), `handlers/index.ts` (barrel), `pipelines.module.ts` (providers), `execution/step-handler.interface.ts` (config type)
- `apps/backend/src/mcp/tools/proxy-rules.tools.ts` (zod enum + config prose)
- `apps/frontend/src/services/pipelinesApi.ts`, `components/pipelines/PipelineConfig.tsx`, `components/pipelines/handlers/HandlerConfigWrapper.tsx`, `components/pipelines/handlers/types.ts`
- `docker/backend.Dockerfile`, `docker/backend.umbrel.Dockerfile`, `docker-compose.yml`, `.env.example`

---

### Task 1: `uploadStream` on the storage layer

The interface has streaming download (`downloadStream`, all five adapters) but **no streaming upload** — `upload(file: Buffer, ...)` is the only write path. Add an optional `uploadStream` and forward it through both wrappers. **The `DynamicStorageAdapter` forward MUST be a getter, not a method** — a plain method resurrects the `downloadStream` capability-detection bug documented at `dynamic-storage.adapter.ts:102-114` (proxy method always truthy even when the live adapter can't stream).

**Files:**
- Modify: `apps/backend/src/storage/storage.interface.ts` (interface, after `downloadStream` at ~line 209)
- Modify: `apps/backend/src/storage/local.adapter.ts`, `minio.adapter.ts`, `gcs.adapter.ts`, `azure.adapter.ts` (S3 inherits MinIO's — `s3.adapter.ts` extends it and defines only a constructor; verify, don't edit)
- Modify: `apps/backend/src/storage/dynamic-storage.adapter.ts` (getter), `apps/backend/src/storage/cache/caching-storage.adapter.ts` (pass-through + same cache invalidation as `upload`)
- Test: `apps/backend/src/storage/local.adapter.spec.ts` (or a new `upload-stream.spec.ts` colocated in `src/storage/`), `apps/backend/src/storage/dynamic-storage.adapter.spec.ts` (extend if exists, else create)

**Interfaces:**
- Produces (later tasks rely on):
  ```ts
  // storage.interface.ts
  uploadStream?(
    stream: NodeJS.ReadableStream,
    key: string,
    size: number,
    metadata?: Record<string, any>,
  ): Promise<string>;  // returns the sanitized (unprefixed) key, same as upload()
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/backend/src/storage/upload-stream.spec.ts
/**
 * uploadStream — streaming write path added for the ffmpeg handler so multi-GB
 * transcode outputs never enter the backend heap. Mirrors upload()'s key
 * sanitization and metadata handling.
 */
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import { LocalStorageAdapter } from './local.adapter';
import { DynamicStorageAdapter } from './dynamic-storage.adapter';

describe('LocalStorageAdapter.uploadStream', () => {
  let dir: string;
  let adapter: LocalStorageAdapter;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'upload-stream-'));
    adapter = new LocalStorageAdapter({ basePath: dir });
  });
  afterEach(async () => fs.rm(dir, { recursive: true, force: true }));

  it('streams bytes to the key and round-trips via download', async () => {
    const bytes = Buffer.from('streamed-video-bytes');
    const key = await adapter.uploadStream!(Readable.from(bytes), 'o/r/uploads/a.mp4', bytes.length, {
      mimeType: 'video/mp4',
    });
    expect(key).toBe('o/r/uploads/a.mp4');
    expect(await adapter.download('o/r/uploads/a.mp4')).toEqual(bytes);
  });

  it('rejects traversal keys like upload() does', async () => {
    await expect(
      adapter.uploadStream!(Readable.from(Buffer.from('x')), '../escape', 1),
    ).rejects.toThrow();
  });
});

describe('DynamicStorageAdapter.uploadStream forwarding', () => {
  it('is undefined when the live adapter lacks uploadStream (capability detection)', () => {
    const dynamic = new DynamicStorageAdapter();
    dynamic.setAdapter({ upload: jest.fn() } as never);
    expect(dynamic.uploadStream).toBeUndefined();
  });

  it('delegates to the live adapter when present', async () => {
    const inner = { uploadStream: jest.fn().mockResolvedValue('k') };
    const dynamic = new DynamicStorageAdapter();
    dynamic.setAdapter(inner as never);
    const stream = Readable.from(Buffer.from('x'));
    await dynamic.uploadStream!(stream, 'k', 1, { mimeType: 'video/mp4' });
    expect(inner.uploadStream).toHaveBeenCalledWith(stream, 'k', 1, { mimeType: 'video/mp4' });
  });
});
```

Adjust the `LocalStorageAdapter` constructor call to its real config shape (open the file; it takes the base path in its config object) and reuse its existing spec's setup if `local.adapter.spec.ts` already has one. If `DynamicStorageAdapter`'s constructor needs args, mirror how `dynamic-storage.adapter.ts` is constructed in `storage.module.ts:106`.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && pnpm test -- upload-stream`
Expected: FAIL — `uploadStream` is not a function / undefined.

- [ ] **Step 3: Implement**

`storage.interface.ts` (below `downloadStream`, with TSDoc mirroring its style):

```ts
  /**
   * Streaming upload — write a readable stream to storage without buffering the
   * whole object in memory. Optional: callers must feature-detect and fall back
   * to upload(). `size` is the total byte length (known from fs.stat of the temp
   * file); some backends (MinIO) use it to size the write. Returns the sanitized
   * key, same as upload().
   */
  uploadStream?(
    stream: NodeJS.ReadableStream,
    key: string,
    size: number,
    metadata?: Record<string, any>,
  ): Promise<string>;
```

Per adapter — **mirror each adapter's existing `upload()` body** (same `sanitizeKey`/`prefixKey` calls, same metadata normalization, same contentType derivation `metadata?.mimeType || metadata?.['content-type'] || 'application/octet-stream'`, same return value and error wrapping), swapping only the write call:

- Local (`local.adapter.ts`): `await fs.mkdir(path.dirname(fullPath), { recursive: true })` then `await pipeline(stream, createWriteStream(fullPath))` (`stream/promises`); keep the `.meta.json` side-write if `upload()` does it.
- MinIO (`minio.adapter.ts`): `await this.client.putObject(this.bucket, storageKey, stream as Readable, size, /* same metadata object upload() builds */)`.
- GCS (`gcs.adapter.ts`): `await pipeline(stream, blob.createWriteStream({ contentType, chunkSize: GcsStorageAdapter.UPLOAD_CHUNK_BYTES, metadata: { metadata: this.normalizeMetadata(metadata) } }))` — keep the bounded chunkSize; its comment exists precisely because of a 384 MB-container OOM.
- Azure (`azure.adapter.ts`): `await blockBlobClient.uploadStream(stream as Readable, 8 * 1024 * 1024, 5, { blobHTTPHeaders: { blobContentType: contentType }, tier: this.config.accessTier || 'Hot', metadata: this.normalizeMetadata(metadata) })`.
- `dynamic-storage.adapter.ts` — copy the `downloadStream` getter shape exactly (lines 115-121), including a doc comment pointing at the incident note above it:

```ts
  get uploadStream():
    | ((stream: NodeJS.ReadableStream, key: string, size: number, metadata?: Record<string, any>) => Promise<string>)
    | undefined {
    return this.adapter.uploadStream
      ? (stream, key, size, metadata) => this.adapter.uploadStream!(stream, key, size, metadata)
      : undefined;
  }
```

- `caching-storage.adapter.ts` — same getter pattern delegating to the wrapped adapter, plus whatever cache invalidation `upload()` performs for the written key (open its `upload()` and mirror the eviction lines).

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/backend && pnpm test -- upload-stream`
Expected: PASS. Also `pnpm exec tsc --noEmit` from `apps/backend` (S3/caching adapters must still typecheck).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/storage
git commit -m "feat(storage): optional uploadStream on IStorageAdapter with proxy-safe forwarding"
```

---

### Task 2: env config + capability probe service

**Files:**
- Create: `apps/backend/src/pipelines/ffmpeg/ffmpeg-env.ts`
- Create: `apps/backend/src/pipelines/ffmpeg/ffmpeg-capability.service.ts`
- Test: `apps/backend/src/pipelines/ffmpeg/ffmpeg-env.spec.ts`, `ffmpeg-capability.service.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FfmpegEnvConfig {
    enabled: boolean; memoryMb: number; threads: number;
    queueMax: number; maxSeconds: number; scratchDir: string;
  }
  export function readFfmpegEnv(env?: NodeJS.ProcessEnv): FfmpegEnvConfig;

  @Injectable() class FfmpegCapabilityService implements OnModuleInit {
    async probe(): Promise<void>;
    isAvailable(): boolean;           // binaries exist
    isEnabled(): boolean;             // available && env switch not 'false'
    getVersion(): string | null;      // first line of `ffmpeg -version`
    getOps(): string[];               // ['probe','extract_audio','slice','concat'] when enabled, else []
  }
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// ffmpeg-env.spec.ts
import * as os from 'os';
import * as path from 'path';
import { readFfmpegEnv } from './ffmpeg-env';

describe('readFfmpegEnv', () => {
  it('applies spec defaults when unset', () => {
    const cfg = readFfmpegEnv({});
    expect(cfg.enabled).toBe(true);
    expect(cfg.memoryMb).toBe(1024);
    expect(cfg.threads).toBe(Math.max(1, os.cpus().length - 1));
    expect(cfg.queueMax).toBe(8);
    expect(cfg.maxSeconds).toBe(1800);
    expect(cfg.scratchDir).toBe(path.join(os.tmpdir(), 'bffless-ffmpeg'));
  });

  it('treats empty string as unset (compose passthrough leaves FOO: "" when unconfigured)', () => {
    expect(readFfmpegEnv({ FFMPEG_MEMORY_MB: '' }).memoryMb).toBe(1024);
  });

  it('rejects garbage numbers back to defaults', () => {
    expect(readFfmpegEnv({ FFMPEG_QUEUE_MAX: 'lots' }).queueMax).toBe(8);
    expect(readFfmpegEnv({ FFMPEG_MAX_SECONDS: '-5' }).maxSeconds).toBe(1800);
  });

  it('only the literal string false disables', () => {
    expect(readFfmpegEnv({ FFMPEG_HANDLER_ENABLED: 'false' }).enabled).toBe(false);
    expect(readFfmpegEnv({ FFMPEG_HANDLER_ENABLED: 'true' }).enabled).toBe(true);
    expect(readFfmpegEnv({ FFMPEG_HANDLER_ENABLED: '0' }).enabled).toBe(false);
  });
});
```

```ts
// ffmpeg-capability.service.spec.ts
/**
 * Boot probe for ffmpeg/ffprobe presence. Missing binaries must degrade
 * gracefully (ENOENT → capability false, one warning) — the wasm fallback in
 * apps depends on this never throwing (spec success criterion 3).
 */
import { FfmpegCapabilityService } from './ffmpeg-capability.service';

jest.mock('child_process', () => ({ execFile: jest.fn() }));
import { execFile } from 'child_process';

/** Make the mocked callback-style execFile succeed/fail per binary name. */
function armExecFile(impl: (cmd: string) => { error?: NodeJS.ErrnoException; stdout?: string }) {
  (execFile as unknown as jest.Mock).mockImplementation(
    (cmd: string, _args: string[], cb: (e: Error | null, out: { stdout: string; stderr: string }) => void) => {
      const r = impl(cmd);
      // promisify(execFile) resolves {stdout, stderr} — reproduce that contract
      if (r.error) cb(r.error, { stdout: '', stderr: '' });
      else cb(null, { stdout: r.stdout ?? '', stderr: '' });
    },
  );
}

describe('FfmpegCapabilityService', () => {
  it('reports available with version when both binaries respond', async () => {
    armExecFile(() => ({ stdout: 'ffmpeg version 6.1.1 Copyright...\nbuilt with gcc' }));
    const svc = new FfmpegCapabilityService();
    await svc.probe();
    expect(svc.isAvailable()).toBe(true);
    expect(svc.getVersion()).toBe('ffmpeg version 6.1.1 Copyright...');
    expect(svc.getOps()).toEqual(['probe', 'extract_audio', 'slice', 'concat']);
  });

  it('degrades to unavailable on ENOENT without throwing', async () => {
    const enoent = Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' });
    armExecFile(() => ({ error: enoent }));
    const svc = new FfmpegCapabilityService();
    await expect(svc.probe()).resolves.toBeUndefined();
    expect(svc.isAvailable()).toBe(false);
    expect(svc.getOps()).toEqual([]);
  });

  it('unavailable when ffprobe alone is missing (both binaries are required)', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    armExecFile((cmd) => (cmd === 'ffprobe' ? { error: enoent } : { stdout: 'ffmpeg version 6.0' }));
    const svc = new FfmpegCapabilityService();
    await svc.probe();
    expect(svc.isAvailable()).toBe(false);
  });

  it('isEnabled honors FFMPEG_HANDLER_ENABLED=false even when available', async () => {
    armExecFile(() => ({ stdout: 'ffmpeg version 6.0' }));
    const svc = new FfmpegCapabilityService();
    await svc.probe();
    process.env.FFMPEG_HANDLER_ENABLED = 'false';
    try {
      expect(svc.isEnabled()).toBe(false);
    } finally {
      delete process.env.FFMPEG_HANDLER_ENABLED;
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && pnpm test -- 'pipelines/ffmpeg'`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement**

```ts
// ffmpeg-env.ts
import * as os from 'os';
import * as path from 'path';

export interface FfmpegEnvConfig {
  enabled: boolean;
  memoryMb: number;
  threads: number;
  queueMax: number;
  maxSeconds: number;
  scratchDir: string;
}

/** '' counts as unset — compose passthrough materializes unconfigured vars as empty strings. */
function num(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function readFfmpegEnv(env: NodeJS.ProcessEnv = process.env): FfmpegEnvConfig {
  const rawEnabled = env.FFMPEG_HANDLER_ENABLED;
  return {
    enabled: rawEnabled === undefined || rawEnabled === '' || !['false', '0', 'no'].includes(rawEnabled.toLowerCase()),
    memoryMb: num(env.FFMPEG_MEMORY_MB, 1024),
    threads: num(env.FFMPEG_THREADS, Math.max(1, os.cpus().length - 1)),
    queueMax: num(env.FFMPEG_QUEUE_MAX, 8),
    maxSeconds: num(env.FFMPEG_MAX_SECONDS, 1800),
    scratchDir: env.FFMPEG_SCRATCH_DIR && env.FFMPEG_SCRATCH_DIR !== '' ? env.FFMPEG_SCRATCH_DIR : path.join(os.tmpdir(), 'bffless-ffmpeg'),
  };
}
```

```ts
// ffmpeg-capability.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFfmpegEnv } from './ffmpeg-env';

const execFileAsync = promisify(execFile);

/**
 * Boot-time capability probe: ffmpeg + ffprobe both present → server video ops
 * capability. Missing binaries are normal (local dev without ffmpeg, minimal
 * images) — degrade silently to unavailable, warn once, never block boot.
 * Mirrors EdgeBlocklistService's ENOENT tolerance (domains/edge-blocklist.service.ts).
 */
@Injectable()
export class FfmpegCapabilityService implements OnModuleInit {
  private readonly logger = new Logger(FfmpegCapabilityService.name);
  private available = false;
  private version: string | null = null;

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.probe();
  }

  async probe(): Promise<void> {
    try {
      const { stdout } = await execFileAsync('ffmpeg', ['-version']);
      await execFileAsync('ffprobe', ['-version']);
      this.version = stdout.split('\n')[0]?.trim() || null;
      this.available = true;
      this.logger.log({ event: 'ffmpeg_capability', available: true, version: this.version });
    } catch (error) {
      this.available = false;
      this.version = null;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        this.logger.warn('ffmpeg/ffprobe not found — server video ops disabled (wasm fallback applies)');
      } else {
        this.logger.warn({ event: 'ffmpeg_probe_failed', error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  isEnabled(): boolean {
    return this.available && readFfmpegEnv().enabled;
  }

  getVersion(): string | null {
    return this.version;
  }

  getOps(): string[] {
    return this.isEnabled() ? ['probe', 'extract_audio', 'slice', 'concat'] : [];
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/backend && pnpm test -- 'pipelines/ffmpeg'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/pipelines/ffmpeg
git commit -m "feat(pipelines): ffmpeg env config and boot capability probe"
```

---

### Task 3: pure argv builders (`ffmpeg-args.ts`)

Direct port of Studio's pure command builders — same module style (pure, no side effects, heavily unit-tested). Read `repos/apps/apps/studio/src/lib/export/slice.ts` and `assemble.ts` module docstrings before touching this: the shared-origin trim (`PTS-<start>/TB`, NOT `PTS-STARTPTS`) and `-fps_mode passthrough` encode hard-won A/V-sync and frame-rate bugs; drop either and variable-fps screen recordings break.

**Files:**
- Create: `apps/backend/src/pipelines/ffmpeg/ffmpeg-args.ts`
- Test: `apps/backend/src/pipelines/ffmpeg/ffmpeg-args.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Span { start: number; end: number }
  export function buildExtractAudioArgs(input: string, output: string): string[];
  export function buildSliceArgs(opts: {
    input: string; output: string; spans: Span[]; threads: number; audioFades?: boolean;
  }): string[];
  export function buildConcatArgs(listPath: string, output: string, opts: { reencode: boolean; threads: number }): string[];
  export function buildConcatListContent(paths: string[]): string;
  export function buildProbeArgs(input: string): string[]; // for ffprobe, not ffmpeg
  ```
- Consumes: nothing (pure).

- [ ] **Step 1: Write the failing tests** (port the assertions from Studio's `slice.test.ts` / `assemble.test.ts`)

```ts
// ffmpeg-args.spec.ts
import {
  buildConcatArgs, buildConcatListContent, buildExtractAudioArgs, buildProbeArgs, buildSliceArgs,
} from './ffmpeg-args';

const argAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe('buildExtractAudioArgs', () => {
  it('is the 16kHz mono WAV transcription contract', () => {
    expect(buildExtractAudioArgs('in.mp4', 'out.wav')).toEqual([
      '-i', 'in.mp4', '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', 'out.wav',
    ]);
  });
});

describe('buildSliceArgs — single span (fast-seek cut, port of slice.ts)', () => {
  const args = buildSliceArgs({ input: 'src.mp4', output: 'clip.mp4', spans: [{ start: 104, end: 228 }], threads: 2 });

  it('fast-seeks before -i and keeps absolute timestamps', () => {
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(argAfter(args, '-ss')).toBe('104');
    expect(args).toContain('-copyts');
    expect(argAfter(args, '-to')).toBe('228');
    expect(args.indexOf('-to')).toBeGreaterThan(args.indexOf('-i'));
  });

  it('trims both streams against one shared origin (A/V sync)', () => {
    const graph = argAfter(args, '-filter_complex');
    expect(graph).toContain('[0:v]trim=104:228,setpts=PTS-104/TB[v0]');
    expect(graph).toContain('[0:a]atrim=104:228,asetpts=PTS-104/TB[a0]');
  });

  it('keeps the wasm-proven encode profile and fps passthrough', () => {
    expect(argAfter(args, '-c:v')).toBe('libx264');
    expect(argAfter(args, '-preset')).toBe('ultrafast');
    expect(argAfter(args, '-pix_fmt')).toBe('yuv420p');
    expect(argAfter(args, '-c:a')).toBe('aac');
    expect(argAfter(args, '-fps_mode')).toBe('passthrough');
    expect(argAfter(args, '-movflags')).toBe('+faststart');
    expect(argAfter(args, '-threads')).toBe('2');
    expect(args[args.length - 1]).toBe('clip.mp4');
  });

  it('clamps degenerate spans (start<0, end<start)', () => {
    const a = buildSliceArgs({ input: 's', output: 'o', spans: [{ start: -2, end: -1 }], threads: 1 });
    expect(argAfter(a, '-ss')).toBe('0');
  });
});

describe('buildSliceArgs — multi-span (assemble, port of assemble.ts)', () => {
  const spans = [{ start: 0, end: 2 }, { start: 5, end: 8.5 }];
  const args = buildSliceArgs({ input: 'clip.mp4', output: 'out.mp4', spans, threads: 2, audioFades: true });
  const graph = argAfter(args, '-filter_complex');

  it('does NOT fast-seek (whole input feeds the graph)', () => {
    expect(args).not.toContain('-ss');
    expect(args).not.toContain('-copyts');
  });

  it('emits per-span shared-origin trims and an interleaved concat', () => {
    expect(graph).toContain('[0:v]trim=0:2,setpts=PTS-0/TB[v0]');
    expect(graph).toContain('[0:v]trim=5:8.5,setpts=PTS-5/TB[v1]');
    expect(graph).toContain('[v0][a0][v1][a1]concat=n=2:v=1:a=1[vout][aout]');
  });

  it('audioFades adds ~10ms edge fades anchored per piece', () => {
    expect(graph).toContain('afade=t=in:st=0:d=0.01');
    expect(graph).toContain(`afade=t=out:st=${3.5 - 0.01}`);
  });

  it('omits fades when audioFades is false/undefined', () => {
    const noFade = buildSliceArgs({ input: 'c', output: 'o', spans, threads: 1 });
    expect(argAfter(noFade, '-filter_complex')).not.toContain('afade');
  });
});

describe('buildConcatArgs / buildConcatListContent', () => {
  it('stream-copies via the concat demuxer with regenerated PTS', () => {
    expect(buildConcatArgs('list.txt', 'final.mp4', { reencode: false, threads: 2 })).toEqual([
      '-f', 'concat', '-safe', '0', '-fflags', '+genpts', '-i', 'list.txt',
      '-c', 'copy', '-movflags', '+faststart', 'final.mp4',
    ]);
  });

  it('re-encode fallback swaps -c copy for the shared encode profile', () => {
    const args = buildConcatArgs('list.txt', 'final.mp4', { reencode: true, threads: 2 });
    expect(args).not.toContain('copy');
    expect(argAfter(args, '-c:v')).toBe('libx264');
    expect(argAfter(args, '-preset')).toBe('ultrafast');
    expect(argAfter(args, '-c:a')).toBe('aac');
  });

  it('list content is one file directive per part', () => {
    expect(buildConcatListContent(['a.mp4', 'b.mp4'])).toBe("file 'a.mp4'\nfile 'b.mp4'\n");
  });

  it('rejects paths containing single quotes (list-file injection)', () => {
    expect(() => buildConcatListContent(["evil'.mp4"])).toThrow();
  });
});

describe('buildProbeArgs', () => {
  it('asks ffprobe for json format+streams', () => {
    expect(buildProbeArgs('in.mp4')).toEqual([
      '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', 'in.mp4',
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && pnpm test -- ffmpeg-args`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// ffmpeg-args.ts
/**
 * Pure ffmpeg argv builders — a direct port of the wasm-proven commands in
 * Studio (repos/apps: apps/studio/src/lib/export/{slice,assemble}.ts). Two
 * details are load-bearing and must not be "simplified":
 *
 * 1. trim/atrim rebase to ONE shared origin (`PTS-<start>/TB`, never
 *    `PTS-STARTPTS`): video can only cut on whole frames while audio is
 *    sample-exact; rebasing each to its own first sample shifts the picture up
 *    to 1/fps ahead of the sound at EVERY cut.
 * 2. `-fps_mode passthrough`: setpts clears the frame rate on the filter link
 *    and ffmpeg falls back to 25 fps, resampling — dropping over half the
 *    frames of a 60 fps screen recording.
 *
 * Encode profile is the wasm one (libx264 ultrafast / yuv420p / aac /
 * +faststart) so server clips stream-copy-concat with wasm clips and with each
 * other. Builders are pure; the runner prepends global flags (-nostdin -y).
 */

export interface Span {
  start: number;
  end: number;
}

/** Trim trailing zeros off a fixed-precision seconds value for the argv. */
function secs(v: number): string {
  return Number(v.toFixed(3)).toString();
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** ~10ms audio edge fade per kept piece, kills clicks at cut joins (assemble.ts FADE). */
const FADE = 0.01;

const ENCODE_PROFILE = (threads: number): string[] => [
  '-fps_mode', 'passthrough',
  '-c:v', 'libx264',
  '-preset', 'ultrafast',
  '-threads', String(threads),
  '-pix_fmt', 'yuv420p',
  '-c:a', 'aac',
  '-movflags', '+faststart',
];

/** 16 kHz mono WAV — the transcription contract (Studio story 01b). */
export function buildExtractAudioArgs(input: string, output: string): string[] {
  return ['-i', input, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', output];
}

function spanFilterGraph(spans: Span[], audioFades: boolean): string {
  const parts: string[] = [];
  spans.forEach((v, i) => {
    const s = secs(v.start);
    const e = secs(v.end);
    const origin = `PTS-${s}/TB`;
    parts.push(`[0:v]trim=${s}:${e},setpts=${origin}[v${i}]`);
    const len = v.end - v.start;
    const fade = audioFades
      ? `,afade=t=in:st=0:d=${secs(FADE)},afade=t=out:st=${secs(Math.max(0, len - FADE))}:d=${secs(FADE)}`
      : '';
    parts.push(`[0:a]atrim=${s}:${e},asetpts=${origin}${fade}[a${i}]`);
  });
  const labels = spans.map((_, i) => `[v${i}][a${i}]`).join('');
  parts.push(`${labels}concat=n=${spans.length}:v=1:a=1[vout][aout]`);
  return parts.join(';');
}

/**
 * Cut the kept spans out of `input` and concat them into one clip.
 * Single span → fast-seek (`-ss` before `-i`) + `-copyts` so the trim graph
 * addresses original-video seconds without decoding from 0 (slice.ts). Multi
 * span → whole input through the graph (assemble.ts).
 */
export function buildSliceArgs(opts: {
  input: string;
  output: string;
  spans: Span[];
  threads: number;
  audioFades?: boolean;
}): string[] {
  const spans = opts.spans.map((v) => {
    const start = Math.max(0, v.start);
    return { start, end: Math.max(start, v.end) };
  });
  const graph = spanFilterGraph(spans, opts.audioFades === true);
  const inputArgs =
    spans.length === 1
      ? ['-ss', secs(spans[0].start), '-copyts', '-i', opts.input, '-to', secs(spans[0].end)]
      : ['-i', opts.input];
  return [
    ...inputArgs,
    '-filter_complex', graph,
    '-map', '[vout]',
    '-map', '[aout]',
    ...ENCODE_PROFILE(opts.threads),
    opts.output,
  ];
}

/** One `file '<part>'` line per part, in order (concat demuxer list). */
export function buildConcatListContent(paths: string[]): string {
  for (const p of paths) {
    // Scratch filenames are UUID-based so this never fires in practice; it is a
    // guard against list-file directive injection if that ever changes.
    if (p.includes("'") || p.includes('\n')) {
      throw new Error(`concat list entry contains illegal character: ${p}`);
    }
  }
  return paths.map((p) => `file '${p}'`).join('\n') + '\n';
}

/**
 * Stitch uniformly-encoded parts. Stream-copy first (near-instant, ~no memory);
 * `reencode: true` is the automatic fallback for stream-mismatch failures.
 * `-fflags +genpts` regenerates PTS so scene boundaries are clean.
 */
export function buildConcatArgs(
  listPath: string,
  output: string,
  opts: { reencode: boolean; threads: number },
): string[] {
  const codec = opts.reencode
    ? ENCODE_PROFILE(opts.threads).filter((a) => a !== '-fps_mode' && a !== 'passthrough')
    : ['-c', 'copy', '-movflags', '+faststart'];
  return ['-f', 'concat', '-safe', '0', '-fflags', '+genpts', '-i', listPath, ...codec, output];
}

/** ffprobe (not ffmpeg) argv: json essentials — duration, streams. */
export function buildProbeArgs(input: string): string[] {
  return ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', input];
}
```

Note on the concat re-encode filter: `-fps_mode passthrough` applies to filter-graph output, and the concat demuxer path has no filter graph — strip it there (the `.filter(...)` above; verify the resulting argv against the test and adjust the test if you instead build the re-encode list explicitly, which is also fine and arguably clearer).

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/backend && pnpm test -- ffmpeg-args`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/pipelines/ffmpeg
git commit -m "feat(pipelines): pure ffmpeg argv builders ported from Studio wasm commands"
```

---

### Task 4: scratch dir service + orphan sweeps

**Files:**
- Create: `apps/backend/src/pipelines/ffmpeg/ffmpeg-scratch.service.ts`
- Test: `apps/backend/src/pipelines/ffmpeg/ffmpeg-scratch.service.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  @Injectable() class FfmpegScratchService implements OnModuleInit {
    createJobDir(): Promise<string>;                  // mkdtemp under scratchDir
    cleanup(dir: string): Promise<void>;              // rm -rf, never throws
    assertFreeSpace(requiredBytes: number): Promise<void>; // throws FfmpegInsufficientDiskError
    sweepOrphans(): Promise<number>;                  // rm job dirs w/ newest mtime older than cutoff
  }
  ```
- Consumes: `readFfmpegEnv` (Task 2), `FfmpegInsufficientDiskError` (defined here in `ffmpeg-errors.ts`, extended in Task 5).

- [ ] **Step 1: Create the errors module first** (Task 5 adds more classes to it)

```ts
// apps/backend/src/pipelines/ffmpeg/ffmpeg-errors.ts
/** Typed failures the handler maps 1:1 onto StepResult error codes. */
export class FfmpegInsufficientDiskError extends Error {
  readonly code = 'FFMPEG_INSUFFICIENT_DISK';
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// ffmpeg-scratch.service.spec.ts
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FfmpegScratchService } from './ffmpeg-scratch.service';

describe('FfmpegScratchService', () => {
  let root: string;
  let svc: FfmpegScratchService;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-scratch-spec-'));
    process.env.FFMPEG_SCRATCH_DIR = root;
    svc = new FfmpegScratchService();
  });
  afterEach(async () => {
    delete process.env.FFMPEG_SCRATCH_DIR;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('creates isolated job dirs under the scratch root', async () => {
    const a = await svc.createJobDir();
    const b = await svc.createJobDir();
    expect(a).not.toBe(b);
    expect(path.dirname(a)).toBe(root);
    await expect(fs.stat(a)).resolves.toBeDefined();
  });

  it('cleanup removes the dir and tolerates repeats', async () => {
    const dir = await svc.createJobDir();
    await fs.writeFile(path.join(dir, 'x.mp4'), 'bytes');
    await svc.cleanup(dir);
    await expect(fs.stat(dir)).rejects.toThrow();
    await expect(svc.cleanup(dir)).resolves.toBeUndefined(); // idempotent
  });

  it('sweepOrphans removes stale job dirs but spares fresh ones', async () => {
    const stale = await svc.createJobDir();
    const fresh = await svc.createJobDir();
    // Age the stale dir well past the cutoff (2 × FFMPEG_MAX_SECONDS default).
    const old = Date.now() / 1000 - 4000;
    await fs.utimes(stale, old, old);
    process.env.FFMPEG_MAX_SECONDS = '1'; // cutoff = max(2×1s, floor) — see impl floor note
    const removed = await svc.sweepOrphans();
    expect(removed).toBe(1);
    await expect(fs.stat(stale)).rejects.toThrow();
    await expect(fs.stat(fresh)).resolves.toBeDefined();
    delete process.env.FFMPEG_MAX_SECONDS;
  });

  it('assertFreeSpace passes for tiny requirements and throws for absurd ones', async () => {
    await expect(svc.assertFreeSpace(1024)).resolves.toBeUndefined();
    await expect(svc.assertFreeSpace(Number.MAX_SAFE_INTEGER)).rejects.toMatchObject({
      code: 'FFMPEG_INSUFFICIENT_DISK',
    });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd apps/backend && pnpm test -- ffmpeg-scratch`
Expected: FAIL.

- [ ] **Step 4: Implement**

```ts
// ffmpeg-scratch.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs/promises';
import * as path from 'path';
import { readFfmpegEnv } from './ffmpeg-env';
import { FfmpegInsufficientDiskError } from './ffmpeg-errors';

/**
 * Bounded scratch space for ffmpeg temp transcodes. One mkdtemp dir per job,
 * removed in the handler's finally; the sweeps are the backstop for crashes.
 *
 * Liveness is inferred from mtime, like LocalUploadWriterService.sweepTempFiles
 * (storage/local-upload-writer.service.ts): an actively-written output file
 * refreshes its mtime on every write, so a dir whose NEWEST content mtime is
 * older than 2× the watchdog ceiling cannot belong to a live job (the watchdog
 * kills at 1×). A floor of 1h guards against tiny FFMPEG_MAX_SECONDS values.
 */
@Injectable()
export class FfmpegScratchService implements OnModuleInit {
  private readonly logger = new Logger(FfmpegScratchService.name);

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    try {
      await this.sweepOrphans();
    } catch (error) {
      // A failed sweep must never block boot.
      this.logger.error({ event: 'ffmpeg_scratch_boot_sweep_failed', error: String(error) });
    }
  }

  private scratchRoot(): string {
    return readFfmpegEnv().scratchDir;
  }

  async createJobDir(): Promise<string> {
    const root = this.scratchRoot();
    await fs.mkdir(root, { recursive: true });
    return fs.mkdtemp(path.join(root, 'job-'));
  }

  async cleanup(dir: string): Promise<void> {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (error) {
      this.logger.warn({ event: 'ffmpeg_scratch_cleanup_failed', dir, error: String(error) });
    }
  }

  /**
   * Pre-flight: require free space ≥ requiredBytes on the scratch volume.
   * Callers pass 2× total input size + margin (input temp + output estimate).
   */
  async assertFreeSpace(requiredBytes: number): Promise<void> {
    const root = this.scratchRoot();
    await fs.mkdir(root, { recursive: true });
    let free: number;
    try {
      const s = await fs.statfs(root);
      free = s.bsize * s.bavail;
    } catch {
      return; // statfs unavailable → skip the check rather than false-refuse
    }
    if (free < requiredBytes) {
      throw new FfmpegInsufficientDiskError(
        `insufficient scratch disk for server video ops: need ${requiredBytes} bytes free, have ${free}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async sweepScheduled(): Promise<void> {
    try {
      const n = await this.sweepOrphans();
      if (n > 0) this.logger.log({ event: 'ffmpeg_scratch_sweep', removed: n });
    } catch (error) {
      this.logger.error({ event: 'ffmpeg_scratch_sweep_failed', error: String(error) });
    }
  }

  async sweepOrphans(): Promise<number> {
    const root = this.scratchRoot();
    const cfg = readFfmpegEnv();
    const cutoffMs = Math.max(2 * cfg.maxSeconds * 1000, 60 * 60 * 1000);
    let entries: string[];
    try {
      entries = await fs.readdir(root);
    } catch {
      return 0; // root doesn't exist yet
    }
    let removed = 0;
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.startsWith('job-')) continue;
      const dir = path.join(root, entry);
      try {
        const newest = await this.newestMtime(dir);
        if (now - newest > cutoffMs) {
          await fs.rm(dir, { recursive: true, force: true });
          removed++;
        }
      } catch {
        // raced with a concurrent cleanup — fine
      }
    }
    return removed;
  }

  /** Newest mtime of the dir itself or anything inside it (one level is enough — jobs write flat). */
  private async newestMtime(dir: string): Promise<number> {
    const stat = await fs.stat(dir);
    let newest = stat.mtimeMs;
    for (const f of await fs.readdir(dir)) {
      try {
        newest = Math.max(newest, (await fs.stat(path.join(dir, f))).mtimeMs);
      } catch {
        /* file vanished mid-scan */
      }
    }
    return newest;
  }
}
```

**Note for the sweep test:** the implementation floors the cutoff at 1 h, so the test's `FFMPEG_MAX_SECONDS='1'` still uses a 1 h cutoff — age the stale dir with `Date.now()/1000 - 4000` (≈66 min) as written. `fs.statfs` exists on Node 20 (`fs/promises`); if TS complains, the `@types/node` in this repo may lag — use `(fs as any).statfs` with a comment rather than upgrading types in this PR.

- [ ] **Step 5: Run to verify pass**

Run: `cd apps/backend && pnpm test -- ffmpeg-scratch`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/pipelines/ffmpeg
git commit -m "feat(pipelines): ffmpeg scratch dir service with boot and hourly orphan sweeps"
```

---

### Task 5: runner service — queue, memory pre-flight, guarded spawn, watchdog

The containment core: concurrency-1 semaphore with bounded queue, cgroup memory pre-flight, `prlimit --as` + `nice -n 10` wrapping (with graceful fallback when those binaries are absent — dev hosts), SIGKILL watchdog, stderr tail capture. **This is the only place ffmpeg is ever spawned.**

**Files:**
- Create: `apps/backend/src/pipelines/ffmpeg/ffmpeg-runner.service.ts`
- Modify: `apps/backend/src/pipelines/ffmpeg/ffmpeg-errors.ts` (add the remaining error classes)
- Test: `apps/backend/src/pipelines/ffmpeg/ffmpeg-runner.service.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  // ffmpeg-errors.ts additions
  export class FfmpegBusyError extends Error { readonly code = 'FFMPEG_BUSY'; }
  export class FfmpegInsufficientMemoryError extends Error { readonly code = 'FFMPEG_INSUFFICIENT_MEMORY'; }
  export class FfmpegTimeoutError extends Error { readonly code = 'FFMPEG_TIMEOUT'; }
  export class FfmpegProcessError extends Error {
    readonly code = 'FFMPEG_FAILED';
    constructor(message: string, readonly exitCode: number | null, readonly stderrTail: string);
  }

  // ffmpeg-runner.service.ts
  interface FfmpegRunRequest {
    binary: 'ffmpeg' | 'ffprobe';
    args: string[];
    cwd: string;                 // the job's scratch dir
    timeoutSeconds?: number;     // default readFfmpegEnv().maxSeconds
  }
  interface FfmpegRunResult { stdout: string; stderrTail: string }
  @Injectable() class FfmpegRunnerService {
    run(req: FfmpegRunRequest): Promise<FfmpegRunResult>;
  }
  ```
- Consumes: `readFfmpegEnv` (Task 2).

- [ ] **Step 1: Write the failing tests**

Mock `child_process.spawn` with an EventEmitter-based fake:

```ts
// ffmpeg-runner.service.spec.ts
import { EventEmitter } from 'events';

jest.mock('child_process', () => ({ spawn: jest.fn() }));
import { spawn } from 'child_process';
import { FfmpegRunnerService } from './ffmpeg-runner.service';

/** A controllable fake child: emit 'close'/'error' and feed stdout/stderr yourself. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter; stderr: EventEmitter; kill: jest.Mock; killed: boolean;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = jest.fn(() => { child.killed = true; });
  return child;
}
const spawnMock = spawn as unknown as jest.Mock;

describe('FfmpegRunnerService', () => {
  beforeEach(() => spawnMock.mockReset());

  it('wraps the command in prlimit --as and nice -n 10', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const svc = new FfmpegRunnerService();
    const done = svc.run({ binary: 'ffmpeg', args: ['-i', 'a', 'b'], cwd: '/tmp' });
    child.emit('close', 0);
    await done;
    const [cmd, argv] = spawnMock.mock.calls[0];
    expect(cmd).toBe('prlimit');
    expect(argv).toEqual([
      `--as=${1024 * 1024 * 1024}`, '--', 'nice', '-n', '10',
      'ffmpeg', '-nostdin', '-hide_banner', '-y', '-i', 'a', 'b',
    ]);
  });

  it('falls back past a missing prlimit (ENOENT) to nice, then bare', async () => {
    const first = fakeChild();
    const second = fakeChild();
    spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const svc = new FfmpegRunnerService();
    const done = svc.run({ binary: 'ffmpeg', args: ['-i', 'a', 'b'], cwd: '/tmp' });
    first.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    second.emit('close', 0);
    await done;
    expect(spawnMock.mock.calls[1][0]).toBe('nice');
  });

  it('rejects with FFMPEG_FAILED carrying the stderr tail on non-zero exit', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const svc = new FfmpegRunnerService();
    const done = svc.run({ binary: 'ffmpeg', args: [], cwd: '/tmp' });
    child.stderr.emit('data', Buffer.from('Invalid data found when processing input'));
    child.emit('close', 1);
    await expect(done).rejects.toMatchObject({
      code: 'FFMPEG_FAILED',
      stderrTail: expect.stringContaining('Invalid data'),
    });
  });

  it('SIGKILLs and rejects FFMPEG_TIMEOUT when the watchdog fires', async () => {
    jest.useFakeTimers();
    try {
      const child = fakeChild();
      spawnMock.mockReturnValue(child);
      const svc = new FfmpegRunnerService();
      const done = svc.run({ binary: 'ffmpeg', args: [], cwd: '/tmp', timeoutSeconds: 5 });
      jest.advanceTimersByTime(5001);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
      child.emit('close', null); // the kill lands
      await expect(done).rejects.toMatchObject({ code: 'FFMPEG_TIMEOUT' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('serializes runs (concurrency 1) and fails fast beyond the queue depth', async () => {
    process.env.FFMPEG_QUEUE_MAX = '1';
    try {
      const first = fakeChild();
      spawnMock.mockReturnValue(first);
      const svc = new FfmpegRunnerService();
      const run1 = svc.run({ binary: 'ffmpeg', args: [], cwd: '/tmp' });   // running
      const run2 = svc.run({ binary: 'ffmpeg', args: [], cwd: '/tmp' });   // queued (depth 1)
      await expect(svc.run({ binary: 'ffmpeg', args: [], cwd: '/tmp' }))   // over depth
        .rejects.toMatchObject({ code: 'FFMPEG_BUSY' });
      expect(spawnMock).toHaveBeenCalledTimes(1); // run2 not spawned while run1 holds the slot
      const second = fakeChild();
      spawnMock.mockReturnValue(second);
      first.emit('close', 0);
      await run1;
      await new Promise((r) => setImmediate(r)); // let the queue hand over
      expect(spawnMock).toHaveBeenCalledTimes(2);
      second.emit('close', 0);
      await run2;
    } finally {
      delete process.env.FFMPEG_QUEUE_MAX;
    }
  });

  it('refuses when cgroup headroom is insufficient', async () => {
    const svc = new FfmpegRunnerService();
    // limit − rss < memoryMb + headroom → refuse
    jest.spyOn(svc as never as { readCgroupLimitBytes: () => Promise<number | null> }, 'readCgroupLimitBytes')
      .mockResolvedValue(512 * 1024 * 1024);
    await expect(svc.run({ binary: 'ffmpeg', args: [], cwd: '/tmp' })).rejects.toMatchObject({
      code: 'FFMPEG_INSUFFICIENT_MEMORY',
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && pnpm test -- ffmpeg-runner`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// ffmpeg-errors.ts (final full contents)
/** Typed failures the handler maps 1:1 onto StepResult error codes. */
export class FfmpegBusyError extends Error {
  readonly code = 'FFMPEG_BUSY';
}
export class FfmpegInsufficientMemoryError extends Error {
  readonly code = 'FFMPEG_INSUFFICIENT_MEMORY';
}
export class FfmpegInsufficientDiskError extends Error {
  readonly code = 'FFMPEG_INSUFFICIENT_DISK';
}
export class FfmpegTimeoutError extends Error {
  readonly code = 'FFMPEG_TIMEOUT';
}
export class FfmpegProcessError extends Error {
  readonly code = 'FFMPEG_FAILED';
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stderrTail: string,
  ) {
    super(message);
  }
}
```

```ts
// ffmpeg-runner.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import { readFfmpegEnv } from './ffmpeg-env';
import {
  FfmpegBusyError, FfmpegInsufficientMemoryError, FfmpegProcessError, FfmpegTimeoutError,
} from './ffmpeg-errors';

export interface FfmpegRunRequest {
  binary: 'ffmpeg' | 'ffprobe';
  args: string[];
  cwd: string;
  timeoutSeconds?: number;
}

export interface FfmpegRunResult {
  stdout: string;
  stderrTail: string;
}

/** Keep only the last N chars of stderr — enough for ffmpeg's actual error. */
const STDERR_TAIL_BYTES = 8192;
/** Headroom demanded beyond FFMPEG_MEMORY_MB before admitting a job (MB). */
const MEMORY_HEADROOM_MB = 128;
/** Global flags for every invocation: never prompt, never read stdin. */
const GLOBAL_FLAGS = ['-nostdin', '-hide_banner', '-y'];

/**
 * The only place ffmpeg/ffprobe are spawned. Containment (all required by the
 * spec — a droplet-crash is the failure mode being designed against):
 *  - global concurrency 1, bounded FIFO queue (FFMPEG_QUEUE_MAX), fail-fast busy
 *  - cgroup memory pre-flight: refuse rather than gamble on the OOM killer
 *  - `prlimit --as` so ffmpeg (not the backend) dies on breach; `nice -n 10` +
 *    `-threads` (callers bake threads into argv) so the API stays interactive
 *  - SIGKILL watchdog (FFMPEG_MAX_SECONDS) for wedged processes
 * prlimit/nice may be absent outside Docker (dev hosts) — degrade with one warn.
 */
@Injectable()
export class FfmpegRunnerService {
  private readonly logger = new Logger(FfmpegRunnerService.name);
  private busy = false;
  private readonly waiting: Array<() => void> = [];
  private warnedNoPrlimit = false;
  private warnedNoNice = false;

  async run(req: FfmpegRunRequest): Promise<FfmpegRunResult> {
    await this.assertMemoryHeadroom();
    await this.acquire();
    try {
      return await this.spawnGuarded(req);
    } finally {
      this.release();
    }
  }

  // --- queue -----------------------------------------------------------

  private async acquire(): Promise<void> {
    if (!this.busy && this.waiting.length === 0) {
      this.busy = true;
      return;
    }
    const { queueMax } = readFfmpegEnv();
    if (this.waiting.length >= queueMax) {
      throw new FfmpegBusyError(
        `server busy: ffmpeg queue full (${this.waiting.length} waiting, max ${queueMax}) — retry later`,
      );
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next(); // hand the slot over; busy stays true
    else this.busy = false;
  }

  // --- pre-flight --------------------------------------------------------

  /** cgroup v2 then v1; null = no limit readable (bare host) → skip the check. */
  private async readCgroupLimitBytes(): Promise<number | null> {
    for (const file of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
      try {
        const raw = (await fs.readFile(file, 'utf8')).trim();
        if (raw === 'max') return null;
        const n = Number(raw);
        // v1 reports a huge sentinel (~9.2e18) when unlimited
        if (Number.isFinite(n) && n > 0 && n < 2 ** 60) return n;
      } catch {
        /* try next */
      }
    }
    return null;
  }

  private async assertMemoryHeadroom(): Promise<void> {
    const limit = await this.readCgroupLimitBytes();
    if (limit === null) return;
    const { memoryMb } = readFfmpegEnv();
    const needed = (memoryMb + MEMORY_HEADROOM_MB) * 1024 * 1024;
    const rss = process.memoryUsage().rss;
    if (limit - rss < needed) {
      throw new FfmpegInsufficientMemoryError(
        'insufficient memory for server video ops — raise the backend memory cap or lower FFMPEG_MEMORY_MB',
      );
    }
  }

  // --- spawn -------------------------------------------------------------

  /** Guard-wrapping fallback chain: prlimit+nice → nice → bare binary. */
  private commandChain(binary: string, args: string[]): Array<{ cmd: string; argv: string[] }> {
    const fullArgs = [...GLOBAL_FLAGS, ...args];
    const memBytes = readFfmpegEnv().memoryMb * 1024 * 1024;
    return [
      { cmd: 'prlimit', argv: [`--as=${memBytes}`, '--', 'nice', '-n', '10', binary, ...fullArgs] },
      { cmd: 'nice', argv: ['-n', '10', binary, ...fullArgs] },
      { cmd: binary, argv: fullArgs },
    ];
  }

  private async spawnGuarded(req: FfmpegRunRequest): Promise<FfmpegRunResult> {
    const chain = this.commandChain(req.binary, req.args);
    const timeoutMs = (req.timeoutSeconds ?? readFfmpegEnv().maxSeconds) * 1000;

    for (let i = 0; i < chain.length; i++) {
      const { cmd, argv } = chain[i];
      try {
        return await this.spawnOnce(cmd, argv, req.cwd, timeoutMs);
      } catch (error) {
        const isSpawnEnoent =
          (error as NodeJS.ErrnoException).code === 'ENOENT' && i < chain.length - 1;
        if (!isSpawnEnoent) throw error;
        if (cmd === 'prlimit' && !this.warnedNoPrlimit) {
          this.warnedNoPrlimit = true;
          this.logger.warn('prlimit not found — ffmpeg memory cap not enforced (install util-linux)');
        }
        if (cmd === 'nice' && !this.warnedNoNice) {
          this.warnedNoNice = true;
          this.logger.warn('nice not found — ffmpeg runs at normal priority');
        }
      }
    }
    // Unreachable: the last chain entry rethrows.
    throw new Error('ffmpeg spawn chain exhausted');
  }

  private spawnOnce(cmd: string, argv: string[], cwd: string, timeoutMs: number): Promise<FfmpegRunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderrTail = '';
      let timedOut = false;

      const watchdog = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d: Buffer) => {
        stderrTail = (stderrTail + d.toString()).slice(-STDERR_TAIL_BYTES);
      });

      child.on('error', (error) => {
        clearTimeout(watchdog);
        reject(error); // ENOENT lands here → fallback chain
      });

      child.on('close', (code) => {
        clearTimeout(watchdog);
        if (timedOut) {
          reject(new FfmpegTimeoutError(`ffmpeg watchdog killed the process after ${timeoutMs / 1000}s`));
        } else if (code === 0) {
          resolve({ stdout, stderrTail });
        } else {
          // 137 = SIGKILL (address-space breach under prlimit shows up as an
          // ffmpeg malloc failure exit, cgroup kill as 137) — the message keeps
          // the tail so job rows get a human-readable failure.
          reject(
            new FfmpegProcessError(
              `ffmpeg exited with code ${code}: ${stderrTail.split('\n').filter(Boolean).pop() ?? 'no stderr'}`,
              code,
              stderrTail,
            ),
          );
        }
      });
    });
  }
}
```

Watch the queue test: acquiring the slot happens **after** the memory pre-flight so a refused job never occupies the queue. The `stdout`/`stderr` fake child in the spec must exist before `spawnOnce` wires listeners — it does (spawn returns it synchronously).

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/backend && pnpm test -- ffmpeg-runner`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/pipelines/ffmpeg
git commit -m "feat(pipelines): guarded ffmpeg runner — queue-of-1, cgroup pre-flight, prlimit/nice, watchdog"
```

---

### Task 6: the handler — config type, wiring, `probe` op

Registers `ffmpeg_handler` end-to-end and implements the cheapest op. Storage-touching ops land in Tasks 7–8.

**Files:**
- Create: `apps/backend/src/pipelines/handlers/ffmpeg.handler.ts`
- Modify: `apps/backend/src/pipelines/types.ts` (add `| 'ffmpeg_handler'` after `'delay'` in the union at lines 59-87)
- Modify: `apps/backend/src/pipelines/execution/step-handler.interface.ts` (config interface; place near `ImageConvertHandlerConfig` at ~line 647)
- Modify: `apps/backend/src/pipelines/handlers/index.ts` (add `export * from './ffmpeg.handler';`)
- Modify: `apps/backend/src/pipelines/pipelines.module.ts` (import `FfmpegHandler` in the handlers import block at lines 25-54; add `FfmpegHandler` under `// Step handlers (auto-register on construction)` at lines 133-160; ALSO add `FfmpegCapabilityService`, `FfmpegRunnerService`, `FfmpegScratchService` as plain providers)
- Test: `apps/backend/src/pipelines/handlers/ffmpeg.handler.spec.ts`

**Interfaces:**
- Produces (the config type the MCP prose, frontend, and Studio plan mirror):

```ts
// step-handler.interface.ts — this TSDoc is the authoritative handler reference
// (CE has no per-handler doc pages; agents and humans read this).
export type FfmpegOperation = 'probe' | 'extract_audio' | 'slice' | 'concat';

/** One kept span of source footage, in source seconds. Values may be literals or expressions. */
export interface FfmpegSpan {
  start: number | string;
  end: number | string;
}

/**
 * Server-side video operations on storage objects via a strictly-guarded native
 * ffmpeg child process. Curated operations only — never raw ffmpeg args.
 * Inputs/outputs are storage paths (bytes never enter a request body); place
 * heavy ops in postSteps and poll a job row (the fire-and-poll pattern).
 *
 * Operations:
 * - `probe` — no `input`: capability self-test, never fails; returns
 *   `{ server, ops, version }`. With `input`: ffprobe essentials
 *   `{ duration, format, streams }`.
 * - `extract_audio` — `input` → `output`: 16 kHz mono WAV (`-vn -ac 1 -ar 16000`).
 * - `slice` — cut the kept `spans` out of `input`, concat into one clip
 *   (libx264 ultrafast/yuv420p/aac/+faststart, A/V-sync-safe trim graph).
 *   Optional `audioOutput` also emits the clip's 16 kHz WAV; `audioFades`
 *   adds ~10 ms edge fades (use for scene assembly).
 * - `concat` — stitch `inputs` (uniformly-encoded clips) into `output`;
 *   stream-copy first, automatic re-encode fallback on stream mismatch.
 *
 * Path forms: inputs accept `{owner}/{repo}/uploads/...`, an uploads-relative
 * path, or an `/api/uploads/...` URL; outputs are uploads-relative. All resolve
 * inside the project's uploads root — traversal is rejected.
 */
export interface FfmpegHandlerConfig extends BaseHandlerConfig {
  operation: FfmpegOperation;
  /** Source object (probe / extract_audio / slice). Template-resolved. */
  input?: string;
  /** Source clips for concat, in order: an array or an expression resolving to one. */
  inputs?: string[] | string;
  /** Kept spans for slice: an array (values may be expressions) or an expression resolving to one. */
  spans?: FfmpegSpan[] | string;
  /** Destination path, uploads-relative. Template-resolved. Required except for probe. */
  output?: string;
  /** slice only: also emit the clip's 16 kHz mono WAV to this uploads-relative path. */
  audioOutput?: string;
  /** slice only: ~10 ms audio edge fades per span (assemble parity). Default false. */
  audioFades?: boolean;
}
```

- Consumes: `FfmpegCapabilityService` (Task 2), `FfmpegRunnerService`+errors (Task 5), `FfmpegScratchService` (Task 4), `buildProbeArgs` (Task 3), `ExpressionEvaluator`, `UploadRecordService.resolveOwnerRepo(context, stepName)` (existing, `pipelines/upload-record.service.ts:100`), `STORAGE_ADAPTER`.

- [ ] **Step 1: Write the failing tests**

```ts
// ffmpeg.handler.spec.ts
/**
 * ffmpeg_handler — probe op + registration + guards. Storage-op tests live in
 * this file too from Task 7 on. Pattern per replicate.handler.spec.ts: direct
 * construction, literal collaborators cast `as never`, REAL ExpressionEvaluator.
 */
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import type { PipelineContext, PipelineStep } from '../execution/pipeline-context.interface';
import { FfmpegHandler } from './ffmpeg.handler';

function createHandler(overrides: {
  capability?: Partial<{ isEnabled: () => boolean; isAvailable: () => boolean; getVersion: () => string | null; getOps: () => string[] }>;
  runner?: { run: jest.Mock };
} = {}) {
  const registry = { register: jest.fn() };
  const capability = {
    isEnabled: () => true,
    isAvailable: () => true,
    getVersion: () => 'ffmpeg version 6.1.1',
    getOps: () => ['probe', 'extract_audio', 'slice', 'concat'],
    ...overrides.capability,
  };
  const runner = overrides.runner ?? { run: jest.fn().mockResolvedValue({ stdout: '', stderrTail: '' }) };
  const scratch = {
    createJobDir: jest.fn().mockResolvedValue('/scratch/job-x'),
    cleanup: jest.fn().mockResolvedValue(undefined),
    assertFreeSpace: jest.fn().mockResolvedValue(undefined),
  };
  const uploadRecord = {
    resolveOwnerRepo: jest.fn().mockResolvedValue({ owner: 'o', repo: 'r' }),
  };
  const storageAdapter = {
    download: jest.fn(), upload: jest.fn(),
    getMetadata: jest.fn().mockResolvedValue({ size: 1000 }),
  };
  const handler = new FfmpegHandler(
    registry as never,
    new ExpressionEvaluator(),
    capability as never,
    runner as never,
    scratch as never,
    uploadRecord as never,
    storageAdapter as never,
  );
  return { handler, registry, runner, scratch, storageAdapter };
}

const context = () => ({ stepOutputs: {}, metadata: { body: {}, headers: {} }, projectId: 'p1' }) as unknown as PipelineContext;
const step = (config: Record<string, unknown>): PipelineStep =>
  ({ id: 's1', name: 'video', handlerType: 'ffmpeg_handler', config, isEnabled: true }) as unknown as PipelineStep;

describe('FfmpegHandler registration & validation', () => {
  it('self-registers with type ffmpeg_handler', () => {
    const { handler, registry } = createHandler();
    expect(handler.type).toBe('ffmpeg_handler');
    expect(registry.register).toHaveBeenCalledWith(handler);
  });

  it('validateConfig rejects unknown operations and missing per-op fields', () => {
    const { handler } = createHandler();
    expect(() => handler.validateConfig({ operation: 'transcode' } as never)).toThrow(/operation/);
    expect(() => handler.validateConfig({ operation: 'extract_audio' } as never)).toThrow(/input/);
    expect(() => handler.validateConfig({ operation: 'slice', input: 'a', output: 'b' } as never)).toThrow(/spans/);
    expect(() => handler.validateConfig({ operation: 'concat', output: 'b' } as never)).toThrow(/inputs/);
    // probe without input is valid (capability self-test)
    expect(() => handler.validateConfig({ operation: 'probe' } as never)).not.toThrow();
  });
});

describe('probe without input — the capability payload', () => {
  it('reports server=true with ops and version when enabled', async () => {
    const { handler } = createHandler();
    const result = await handler.execute(context(), step({ operation: 'probe' }));
    expect(result.success).toBe(true);
    expect(result.output).toEqual({
      server: true,
      ops: ['probe', 'extract_audio', 'slice', 'concat'],
      version: 'ffmpeg version 6.1.1',
    });
  });

  it('reports server=false and SUCCEEDS when the capability is off (never fails)', async () => {
    const { handler } = createHandler({
      capability: { isEnabled: () => false, getOps: () => [], getVersion: () => null },
    });
    const result = await handler.execute(context(), step({ operation: 'probe' }));
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ server: false, ops: [], version: null });
  });
});

describe('capability gating for real ops', () => {
  it('returns FFMPEG_UNAVAILABLE without touching the runner', async () => {
    const { handler, runner } = createHandler({ capability: { isEnabled: () => false } });
    const result = await handler.execute(
      context(),
      step({ operation: 'extract_audio', input: 'media/a.mp4', output: 'media/a.wav' }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FFMPEG_UNAVAILABLE');
    expect(runner.run).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && pnpm test -- 'handlers/ffmpeg'`
Expected: FAIL.

- [ ] **Step 3: Implement the handler skeleton + probe**

```ts
// apps/backend/src/pipelines/handlers/ffmpeg.handler.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { IStorageAdapter, STORAGE_ADAPTER } from '../../storage/storage.interface';
import { ConfigurationError } from '../errors/configuration.error';
import { ExpressionEvaluator } from '../execution/expression-evaluator';
import type { PipelineContext, StepResult } from '../execution/pipeline-context.interface';
import type { PipelineStep } from '../types';
import type { FfmpegHandlerConfig, StepHandler } from '../execution/step-handler.interface';
import { StepHandlerRegistry } from '../execution/step-handler.registry';
import { buildProbeArgs } from '../ffmpeg/ffmpeg-args';
import { FfmpegCapabilityService } from '../ffmpeg/ffmpeg-capability.service';
import { FfmpegRunnerService } from '../ffmpeg/ffmpeg-runner.service';
import { FfmpegScratchService } from '../ffmpeg/ffmpeg-scratch.service';
import { UploadRecordService } from '../upload-record.service';

const OPERATIONS = ['probe', 'extract_audio', 'slice', 'concat'] as const;

@Injectable()
export class FfmpegHandler implements StepHandler<FfmpegHandlerConfig> {
  readonly type = 'ffmpeg_handler' as const;
  private readonly logger = new Logger(FfmpegHandler.name);

  constructor(
    private readonly registry: StepHandlerRegistry,
    private readonly expressionEvaluator: ExpressionEvaluator,
    private readonly capability: FfmpegCapabilityService,
    private readonly runner: FfmpegRunnerService,
    private readonly scratch: FfmpegScratchService,
    private readonly uploadRecord: UploadRecordService,
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
  ) {
    this.registry.register(this);
  }

  validateConfig(config: FfmpegHandlerConfig): void {
    if (!config || !OPERATIONS.includes(config.operation)) {
      throw new ConfigurationError(
        `ffmpeg_handler requires operation: one of ${OPERATIONS.join(', ')}`,
        'ffmpeg_handler',
      );
    }
    const need = (field: keyof FfmpegHandlerConfig, ops: string[]) => {
      if (ops.includes(config.operation) && !config[field]) {
        throw new ConfigurationError(
          `ffmpeg_handler ${config.operation} requires ${String(field)}`,
          'ffmpeg_handler',
        );
      }
    };
    need('input', ['extract_audio', 'slice']);
    need('spans', ['slice']);
    need('inputs', ['concat']);
    need('output', ['extract_audio', 'slice', 'concat']);
  }

  async execute(context: PipelineContext, step: PipelineStep): Promise<StepResult> {
    const config = step.config as FfmpegHandlerConfig;
    const stepName = step.name || 'ffmpeg_handler';

    if (config.operation === 'probe' && !config.input) {
      // Capability self-test — the /api/video/capabilities payload. Never fails.
      return {
        success: true,
        output: {
          server: this.capability.isEnabled(),
          ops: this.capability.getOps(),
          version: this.capability.getVersion(),
        },
      };
    }

    if (!this.capability.isEnabled()) {
      return {
        success: false,
        error: {
          code: 'FFMPEG_UNAVAILABLE',
          message: 'server video ops are unavailable on this instance (ffmpeg missing or FFMPEG_HANDLER_ENABLED=false)',
        },
      };
    }

    try {
      switch (config.operation) {
        case 'probe':
          return await this.runProbe(config, context, stepName);
        case 'extract_audio':
          return await this.runExtractAudio(config, context, stepName); // Task 7
        case 'slice':
          return await this.runSlice(config, context, stepName); // Task 8
        case 'concat':
          return await this.runConcat(config, context, stepName); // Task 8
      }
    } catch (error) {
      return this.toErrorResult(error, stepName);
    }
  }

  /** Map typed runner/scratch errors onto the stable error-code contract. */
  private toErrorResult(error: unknown, stepName: string): StepResult {
    const code = (error as { code?: string }).code;
    const known = [
      'FFMPEG_BUSY', 'FFMPEG_INSUFFICIENT_MEMORY', 'FFMPEG_INSUFFICIENT_DISK',
      'FFMPEG_TIMEOUT', 'FFMPEG_FAILED',
    ];
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn({ event: 'ffmpeg_step_failed', step: stepName, code, message });
    return {
      success: false,
      error: { code: known.includes(code ?? '') ? code! : 'FFMPEG_FAILED', message },
    };
  }

  private async runProbe(
    config: FfmpegHandlerConfig,
    context: PipelineContext,
    stepName: string,
  ): Promise<StepResult> {
    // Implemented in Task 7 alongside the shared storage plumbing (needs downloadToFile).
    throw new Error('probe with input: implemented in Task 7');
  }

  private async runExtractAudio(
    config: FfmpegHandlerConfig,
    context: PipelineContext,
    stepName: string,
  ): Promise<StepResult> {
    throw new Error('implemented in Task 7');
  }

  private async runSlice(
    config: FfmpegHandlerConfig,
    context: PipelineContext,
    stepName: string,
  ): Promise<StepResult> {
    throw new Error('implemented in Task 8');
  }

  private async runConcat(
    config: FfmpegHandlerConfig,
    context: PipelineContext,
    stepName: string,
  ): Promise<StepResult> {
    throw new Error('implemented in Task 8');
  }
}
```

(Adjust the `PipelineStep` import to wherever the exemplar handlers import it from — copy `image-convert.handler.ts`'s import block verbatim as the base.)

Wiring in the same commit: `types.ts` union member, config interface + TSDoc in `step-handler.interface.ts`, barrel export, module import + provider entries (`FfmpegHandler`, `FfmpegCapabilityService`, `FfmpegRunnerService`, `FfmpegScratchService`).

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/backend && pnpm test -- 'handlers/ffmpeg'` then `pnpm exec tsc --noEmit`
Expected: PASS; typecheck clean (the frontend `Record<HandlerType, string>` maps are a separate package — backend tsc won't fail on them).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/pipelines
git commit -m "feat(pipelines): register ffmpeg_handler with capability probe operation"
```

---

### Task 7: storage plumbing + `extract_audio`

The streaming loop every real op uses: resolve+guard paths → scratch dir → stream download to temp → run → stat → stream upload → cleanup in `finally`.

**Files:**
- Modify: `apps/backend/src/pipelines/handlers/ffmpeg.handler.ts`
- Test: extend `apps/backend/src/pipelines/handlers/ffmpeg.handler.spec.ts`

**Interfaces:**
- Produces (private helpers Tasks 8 reuses; signatures matter because Task 8's implementer sees only their task):
  ```ts
  private async resolveInputKey(expr: string, context: PipelineContext, stepName: string): Promise<string>;
  private async resolveOutputKey(expr: string, context: PipelineContext, stepName: string): Promise<string>;
  private async downloadToFile(key: string, destPath: string): Promise<void>;
  private async uploadFromFile(srcPath: string, key: string, mimeType: string): Promise<{ size: number }>;
  private async inputSizeBytes(keys: string[]): Promise<number>;  // sum of getMetadata().size, 0 on failure
  ```
- Consumes: Task 6 skeleton; `UploadRecordService.resolveOwnerRepo`; `buildExtractAudioArgs`, `buildProbeArgs` (Task 3).

- [ ] **Step 1: Write the failing tests** (append to the spec file)

```ts
import * as fsp from 'fs/promises';

describe('extract_audio', () => {
  function extractSetup() {
    const created = createHandler();
    // The runner "produces" the output by writing the temp file the handler expects.
    created.runner.run.mockImplementation(async ({ args, cwd }: { args: string[]; cwd: string }) => {
      await fsp.writeFile(`${cwd}/${args[args.length - 1].split('/').pop()}`, 'wav-bytes');
      return { stdout: '', stderrTail: '' };
    });
    return created;
  }

  it('streams in, runs the 16k mono wav argv, streams out, returns the contract shape', async () => {
    const { handler, runner, storageAdapter } = extractSetup();
    // downloadToFile falls back to download() when downloadStream is absent on the literal mock
    storageAdapter.download.mockResolvedValue(Buffer.from('mp4-bytes'));
    storageAdapter.upload.mockResolvedValue('o/r/uploads/studio/a.wav');
    const result = await handler.execute(
      context(),
      step({ operation: 'extract_audio', input: 'studio/a.mp4', output: 'studio/a.wav' }),
    );
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      storage_path: 'o/r/uploads/studio/a.wav',
      content_type: 'audio/wav',
      size: expect.any(Number),
    });
    const req = runner.run.mock.calls[0][0];
    expect(req.binary).toBe('ffmpeg');
    expect(req.args).toEqual(expect.arrayContaining(['-vn', '-ac', '1', '-ar', '16000', '-f', 'wav']));
  });

  it('accepts /api/uploads/... input form and full storage keys', async () => {
    const { handler, storageAdapter } = extractSetup();
    storageAdapter.download.mockResolvedValue(Buffer.from('x'));
    const r1 = await handler.execute(
      context(),
      step({ operation: 'extract_audio', input: '/api/uploads/studio/a.mp4', output: 'studio/a.wav' }),
    );
    expect(r1.success).toBe(true);
    expect(storageAdapter.download).toHaveBeenCalledWith('o/r/uploads/studio/a.mp4');
  });

  it('rejects traversal in input and output with typed errors', async () => {
    const { handler, runner } = createHandler();
    const bad1 = await handler.execute(
      context(),
      step({ operation: 'extract_audio', input: '../../etc/passwd', output: 'a.wav' }),
    );
    expect(bad1.error?.code).toBe('INVALID_INPUT_PATH');
    const bad2 = await handler.execute(
      context(),
      step({ operation: 'extract_audio', input: 'a.mp4', output: '../escape.wav' }),
    );
    expect(bad2.error?.code).toBe('INVALID_OUTPUT_PATH');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('missing input object → FILE_NOT_FOUND', async () => {
    const { handler, storageAdapter } = createHandler();
    storageAdapter.download.mockRejectedValue(new Error('File not found: o/r/uploads/a.mp4'));
    const result = await handler.execute(
      context(),
      step({ operation: 'extract_audio', input: 'a.mp4', output: 'a.wav' }),
    );
    expect(result.error?.code).toBe('FILE_NOT_FOUND');
  });

  it('always cleans up the scratch dir, even on runner failure', async () => {
    const { handler, runner, scratch, storageAdapter } = createHandler();
    storageAdapter.download.mockResolvedValue(Buffer.from('x'));
    runner.run.mockRejectedValue(Object.assign(new Error('boom'), { code: 'FFMPEG_FAILED' }));
    await handler.execute(context(), step({ operation: 'extract_audio', input: 'a.mp4', output: 'a.wav' }));
    expect(scratch.cleanup).toHaveBeenCalledWith('/scratch/job-x');
  });
});

describe('probe with input', () => {
  it('parses ffprobe json into duration/format/streams', async () => {
    const { handler, runner, storageAdapter } = createHandler();
    storageAdapter.download.mockResolvedValue(Buffer.from('x'));
    runner.run.mockResolvedValue({
      stdout: JSON.stringify({
        format: { duration: '232.5', format_name: 'mov,mp4' },
        streams: [{ codec_type: 'video' }, { codec_type: 'audio' }],
      }),
      stderrTail: '',
    });
    const result = await handler.execute(context(), step({ operation: 'probe', input: 'a.mp4' }));
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({ duration: 232.5, streams: [{ codec_type: 'video' }, { codec_type: 'audio' }] });
    expect(runner.run.mock.calls[0][0].binary).toBe('ffprobe');
  });
});
```

**Note:** the scratch mock returns a fixed `/scratch/job-x`; make it a real temp dir instead where the runner mock writes files — in `createHandler`, change `createJobDir` to `jest.fn().mockImplementation(() => fsp.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-hspec-')))` and capture the value from `runner.run`'s `cwd` argument (the handler passes the job dir as `cwd`). Keep assertions on `scratch.cleanup` call-count rather than the exact path where that's simpler.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && pnpm test -- 'handlers/ffmpeg'`
Expected: new tests FAIL (`implemented in Task 7`).

- [ ] **Step 3: Implement**

Add to `ffmpeg.handler.ts` (imports: `createReadStream, createWriteStream` from `fs`, `pipeline` from `stream/promises`, `fs from 'fs/promises'`, `path`, plus Task 3 builders and `readFfmpegEnv`):

```ts
  /** ~64MB slack demanded beyond the 2× input estimate in the disk pre-flight. */
  private static readonly DISK_MARGIN_BYTES = 64 * 1024 * 1024;

  private pathError(code: 'INVALID_INPUT_PATH' | 'INVALID_OUTPUT_PATH', message: string): never {
    throw Object.assign(new Error(message), { code });
  }

  /**
   * Resolve a template to a storage key confined to the project's uploads root.
   * Accepts `/api/uploads/<rel>`, `{owner}/{repo}/uploads/<rel>`, or `<rel>`.
   * Guards per file-delete.handler.ts: reject blank, `..`, `//`, and any
   * normalized escape from the uploads root.
   */
  private async resolveKey(
    expr: string,
    context: PipelineContext,
    stepName: string,
    kind: 'input' | 'output',
  ): Promise<string> {
    const code = kind === 'input' ? ('INVALID_INPUT_PATH' as const) : ('INVALID_OUTPUT_PATH' as const);
    const resolved = String(
      this.expressionEvaluator.evaluateTemplate(expr, context, stepName) ?? '',
    ).trim();
    if (!resolved) this.pathError(code, `ffmpeg_handler ${kind} resolved to an empty path`);
    if (resolved.includes('..') || resolved.includes('//')) {
      this.pathError(code, `ffmpeg_handler ${kind} contains path traversal: ${resolved}`);
    }
    const { owner, repo } = await this.uploadRecord.resolveOwnerRepo(context, stepName);
    const uploadsRoot = `${owner}/${repo}/uploads/`;
    let relative: string;
    if (resolved.startsWith('/api/uploads/')) {
      relative = resolved.slice('/api/uploads/'.length);
    } else if (resolved.startsWith(uploadsRoot)) {
      relative = resolved.slice(uploadsRoot.length);
    } else {
      relative = resolved.replace(/^\/+/, '');
    }
    const key = `${uploadsRoot}${relative}`;
    // Defense-in-depth backstop (confineToRoot semantics, file-delete.handler.ts:205)
    const normalized = path.posix.normalize(key);
    if (!normalized.startsWith(uploadsRoot)) {
      this.pathError(code, `ffmpeg_handler ${kind} escapes the uploads root: ${resolved}`);
    }
    return normalized;
  }

  private async downloadToFile(key: string, destPath: string): Promise<void> {
    try {
      if (this.storageAdapter.downloadStream) {
        const { stream } = await this.storageAdapter.downloadStream(key);
        await pipeline(stream, createWriteStream(destPath));
      } else {
        // Non-streaming backend: buffered fallback (small instances only).
        const buffer = await this.storageAdapter.download(key);
        await fs.writeFile(destPath, buffer);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('not found') || message.includes('ENOENT')) {
        throw Object.assign(new Error(`input not found in storage: ${key}`), { code: 'FILE_NOT_FOUND' });
      }
      throw error;
    }
  }

  private async uploadFromFile(srcPath: string, key: string, mimeType: string): Promise<{ size: number }> {
    const { size } = await fs.stat(srcPath);
    if (this.storageAdapter.uploadStream) {
      await this.storageAdapter.uploadStream(createReadStream(srcPath), key, size, { mimeType });
    } else {
      await this.storageAdapter.upload(await fs.readFile(srcPath), key, { mimeType });
    }
    return { size };
  }

  /** Sum of input object sizes for the disk pre-flight; unknown sizes count 0. */
  private async inputSizeBytes(keys: string[]): Promise<number> {
    let total = 0;
    for (const key of keys) {
      try {
        total += (await this.storageAdapter.getMetadata(key)).size ?? 0;
      } catch {
        /* pre-flight is best-effort; the FILE_NOT_FOUND surfaces at download */
      }
    }
    return total;
  }
```

Then the two ops:

```ts
  private async runProbe(config, context, stepName): Promise<StepResult> {
    const inputKey = await this.resolveKey(config.input!, context, stepName, 'input');
    const jobDir = await this.scratch.createJobDir();
    try {
      const localIn = path.join(jobDir, `in${path.posix.extname(inputKey) || '.bin'}`);
      await this.downloadToFile(inputKey, localIn);
      const { stdout } = await this.runner.run({
        binary: 'ffprobe',
        args: buildProbeArgs(localIn),
        cwd: jobDir,
        timeoutSeconds: 60, // probe is cheap; never let it hold the queue long
      });
      const parsed = JSON.parse(stdout) as { format?: { duration?: string }; streams?: unknown[] };
      return {
        success: true,
        output: {
          duration: Number(parsed.format?.duration ?? 0),
          format: parsed.format ?? {},
          streams: parsed.streams ?? [],
        },
      };
    } finally {
      await this.scratch.cleanup(jobDir);
    }
  }

  private async runExtractAudio(config, context, stepName): Promise<StepResult> {
    const inputKey = await this.resolveKey(config.input!, context, stepName, 'input');
    const outputKey = await this.resolveKey(config.output!, context, stepName, 'output');
    await this.scratch.assertFreeSpace(
      2 * (await this.inputSizeBytes([inputKey])) + FfmpegHandler.DISK_MARGIN_BYTES,
    );
    const jobDir = await this.scratch.createJobDir();
    try {
      const localIn = path.join(jobDir, `in${path.posix.extname(inputKey) || '.bin'}`);
      const localOut = path.join(jobDir, 'out.wav');
      await this.downloadToFile(inputKey, localIn);
      await this.runner.run({
        binary: 'ffmpeg',
        args: buildExtractAudioArgs(localIn, localOut),
        cwd: jobDir,
      });
      const { size } = await this.uploadFromFile(localOut, outputKey, 'audio/wav');
      return {
        success: true,
        output: { storage_path: outputKey, content_type: 'audio/wav', size },
      };
    } finally {
      await this.scratch.cleanup(jobDir);
    }
  }
```

Extend `toErrorResult`'s `known` list with `'INVALID_INPUT_PATH', 'INVALID_OUTPUT_PATH', 'INVALID_SPANS', 'FILE_NOT_FOUND'`.

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/backend && pnpm test -- 'handlers/ffmpeg'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/pipelines
git commit -m "feat(pipelines): ffmpeg_handler extract_audio and probe-with-input via streaming storage IO"
```

---

### Task 8: `slice` and `concat`

**Files:**
- Modify: `apps/backend/src/pipelines/handlers/ffmpeg.handler.ts`
- Test: extend `apps/backend/src/pipelines/handlers/ffmpeg.handler.spec.ts`

**Interfaces:**
- Consumes: Task 7 helpers (`resolveKey`, `downloadToFile`, `uploadFromFile`, `inputSizeBytes`), Task 3 builders (`buildSliceArgs`, `buildConcatArgs`, `buildConcatListContent`), `readFfmpegEnv().threads`.
- Produces: the `slice`/`concat` output shapes from the Contract section (consumed by the Studio plan).

- [ ] **Step 1: Write the failing tests** (append; reuse the `extractSetup` runner-writes-output pattern)

```ts
describe('slice', () => {
  it('resolves span expressions, runs the trim graph, returns clip + optional wav', async () => {
    const { handler, runner, storageAdapter } = extractSetup();
    storageAdapter.download.mockResolvedValue(Buffer.from('mp4'));
    const ctx = context();
    (ctx.metadata.body as Record<string, unknown>) = { start: 104, end: 228 };
    const result = await handler.execute(
      ctx,
      step({
        operation: 'slice',
        input: 'studio/src.mp4',
        spans: [{ start: 'request.body.start', end: 'request.body.end' }],
        output: 'studio/clip.mp4',
        audioOutput: 'studio/clip.wav',
      }),
    );
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      storage_path: 'o/r/uploads/studio/clip.mp4',
      content_type: 'video/mp4',
      duration: 124,
      audio: { storage_path: 'o/r/uploads/studio/clip.wav', content_type: 'audio/wav' },
    });
    // First run: the slice; second run: extract_audio ON THE CLIP (small, cheap).
    expect(runner.run).toHaveBeenCalledTimes(2);
    const sliceArgs = runner.run.mock.calls[0][0].args as string[];
    expect(sliceArgs).toEqual(expect.arrayContaining(['-filter_complex', '-copyts']));
    const wavArgs = runner.run.mock.calls[1][0].args as string[];
    expect(wavArgs).toEqual(expect.arrayContaining(['-ar', '16000']));
  });

  it('rejects malformed spans with INVALID_SPANS before any work', async () => {
    const { handler, runner } = createHandler();
    for (const spans of [[{ start: 5, end: 2 }], [{ start: 'nope', end: 3 }], [], 'request.body.missing']) {
      const result = await handler.execute(
        context(),
        step({ operation: 'slice', input: 'a.mp4', spans, output: 'b.mp4' }),
      );
      expect(result.error?.code).toBe('INVALID_SPANS');
    }
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('accepts spans as an expression resolving to an array', async () => {
    const { handler, runner, storageAdapter } = extractSetup();
    storageAdapter.download.mockResolvedValue(Buffer.from('mp4'));
    const ctx = context();
    ctx.stepOutputs['job'] = { spans: [{ start: 0, end: 2 }, { start: 5, end: 8 }] };
    const result = await handler.execute(
      ctx,
      step({ operation: 'slice', input: 'a.mp4', spans: 'steps.job.spans', output: 'b.mp4', audioFades: true }),
    );
    expect(result.success).toBe(true);
    const args = runner.run.mock.calls[0][0].args as string[];
    expect(args.join(' ')).toContain('concat=n=2');
    expect(args.join(' ')).toContain('afade');
  });
});

describe('concat', () => {
  it('stream-copies, writing a concat list into the job dir', async () => {
    const { handler, runner, storageAdapter } = extractSetup();
    storageAdapter.download.mockResolvedValue(Buffer.from('mp4'));
    const result = await handler.execute(
      context(),
      step({ operation: 'concat', inputs: ['studio/s1.mp4', 'studio/s2.mp4'], output: 'studio/final.mp4' }),
    );
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      storage_path: 'o/r/uploads/studio/final.mp4',
      content_type: 'video/mp4',
      reencoded: false,
    });
    const args = runner.run.mock.calls[0][0].args as string[];
    expect(args).toEqual(expect.arrayContaining(['-f', 'concat', '-c', 'copy']));
  });

  it('falls back to re-encode when stream-copy fails, and reports reencoded: true', async () => {
    const { handler, runner, storageAdapter } = extractSetup();
    storageAdapter.download.mockResolvedValue(Buffer.from('mp4'));
    runner.run
      .mockRejectedValueOnce(Object.assign(new Error('stream mismatch'), { code: 'FFMPEG_FAILED' }))
      .mockImplementationOnce(async ({ args, cwd }: { args: string[]; cwd: string }) => {
        await fsp.writeFile(`${cwd}/${args[args.length - 1].split('/').pop()}`, 'mp4');
        return { stdout: '', stderrTail: '' };
      });
    const result = await handler.execute(
      context(),
      step({ operation: 'concat', inputs: ['a.mp4', 'b.mp4'], output: 'final.mp4' }),
    );
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({ reencoded: true });
    expect(runner.run).toHaveBeenCalledTimes(2);
  });

  it('busy/timeout errors from the second (re-encode) attempt are NOT retried', async () => {
    const { handler, runner, storageAdapter } = createHandler();
    storageAdapter.download.mockResolvedValue(Buffer.from('mp4'));
    runner.run.mockRejectedValue(Object.assign(new Error('busy'), { code: 'FFMPEG_BUSY' }));
    const result = await handler.execute(
      context(),
      step({ operation: 'concat', inputs: ['a.mp4', 'b.mp4'], output: 'f.mp4' }),
    );
    expect(result.error?.code).toBe('FFMPEG_BUSY');
    expect(runner.run).toHaveBeenCalledTimes(1); // only FFMPEG_FAILED triggers the fallback
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && pnpm test -- 'handlers/ffmpeg'`
Expected: FAIL (`implemented in Task 8`).

- [ ] **Step 3: Implement**

```ts
  /** Resolve config.spans (array of literal/expression values, or an expression yielding an array). */
  private resolveSpans(
    raw: FfmpegHandlerConfig['spans'],
    context: PipelineContext,
    stepName: string,
  ): Array<{ start: number; end: number }> {
    const fail = (msg: string): never => {
      throw Object.assign(new Error(`ffmpeg_handler spans invalid: ${msg}`), { code: 'INVALID_SPANS' });
    };
    let list: unknown = raw;
    if (typeof raw === 'string') {
      list = this.expressionEvaluator.evaluateExpression(raw, context, stepName);
    }
    if (!Array.isArray(list) || list.length === 0) fail('expected a non-empty array');
    return (list as Array<{ start: unknown; end: unknown }>).map((s, i) => {
      const resolve = (v: unknown): number => {
        const value = typeof v === 'string' ? this.expressionEvaluator.evaluateExpression(v, context, stepName) : v;
        const n = Number(value);
        if (!Number.isFinite(n)) fail(`span ${i} has a non-numeric bound`);
        return n;
      };
      const start = resolve(s.start);
      const end = resolve(s.end);
      if (start < 0 || end <= start) fail(`span ${i} must satisfy 0 <= start < end (got ${start}..${end})`);
      return { start, end };
    });
  }

  private async runSlice(config, context, stepName): Promise<StepResult> {
    const spans = this.resolveSpans(config.spans, context, stepName);
    const inputKey = await this.resolveKey(config.input!, context, stepName, 'input');
    const outputKey = await this.resolveKey(config.output!, context, stepName, 'output');
    const audioKey = config.audioOutput
      ? await this.resolveKey(config.audioOutput, context, stepName, 'output')
      : null;
    await this.scratch.assertFreeSpace(
      2 * (await this.inputSizeBytes([inputKey])) + FfmpegHandler.DISK_MARGIN_BYTES,
    );
    const jobDir = await this.scratch.createJobDir();
    try {
      const localIn = path.join(jobDir, `in${path.posix.extname(inputKey) || '.mp4'}`);
      const localOut = path.join(jobDir, 'clip.mp4');
      await this.downloadToFile(inputKey, localIn);
      await this.runner.run({
        binary: 'ffmpeg',
        args: buildSliceArgs({
          input: localIn,
          output: localOut,
          spans,
          threads: readFfmpegEnv().threads,
          audioFades: config.audioFades === true,
        }),
        cwd: jobDir,
      });
      const { size } = await this.uploadFromFile(localOut, outputKey, 'video/mp4');
      const duration = spans.reduce((n, s) => n + (s.end - s.start), 0);
      let audio: { storage_path: string; content_type: string; size: number } | undefined;
      if (audioKey) {
        // Second pass on the (small) clip — keeps the slice graph simple; cost is negligible.
        const localWav = path.join(jobDir, 'clip.wav');
        await this.runner.run({
          binary: 'ffmpeg',
          args: buildExtractAudioArgs(localOut, localWav),
          cwd: jobDir,
        });
        const wav = await this.uploadFromFile(localWav, audioKey, 'audio/wav');
        audio = { storage_path: audioKey, content_type: 'audio/wav', size: wav.size };
      }
      return {
        success: true,
        output: {
          storage_path: outputKey, content_type: 'video/mp4', size,
          duration: Number(duration.toFixed(3)),
          ...(audio ? { audio } : {}),
        },
      };
    } finally {
      await this.scratch.cleanup(jobDir);
    }
  }

  private async runConcat(config, context, stepName): Promise<StepResult> {
    let inputsRaw: unknown = config.inputs;
    if (typeof inputsRaw === 'string') {
      inputsRaw = this.expressionEvaluator.evaluateExpression(inputsRaw, context, stepName);
    }
    if (!Array.isArray(inputsRaw) || inputsRaw.length === 0) {
      this.pathError('INVALID_INPUT_PATH', 'ffmpeg_handler concat requires a non-empty inputs array');
    }
    const inputKeys: string[] = [];
    for (const raw of inputsRaw as unknown[]) {
      inputKeys.push(await this.resolveKey(String(raw), context, stepName, 'input'));
    }
    const outputKey = await this.resolveKey(config.output!, context, stepName, 'output');
    await this.scratch.assertFreeSpace(
      2 * (await this.inputSizeBytes(inputKeys)) + FfmpegHandler.DISK_MARGIN_BYTES,
    );
    const jobDir = await this.scratch.createJobDir();
    try {
      const parts: string[] = [];
      for (let i = 0; i < inputKeys.length; i++) {
        const local = path.join(jobDir, `part-${i}${path.posix.extname(inputKeys[i]) || '.mp4'}`);
        await this.downloadToFile(inputKeys[i], local);
        parts.push(local);
      }
      const listPath = path.join(jobDir, 'concat.txt');
      await fs.writeFile(listPath, buildConcatListContent(parts));
      const localOut = path.join(jobDir, 'final.mp4');
      let reencoded = false;
      try {
        await this.runner.run({
          binary: 'ffmpeg',
          args: buildConcatArgs(listPath, localOut, { reencode: false, threads: readFfmpegEnv().threads }),
          cwd: jobDir,
        });
      } catch (error) {
        // Only a process failure (stream mismatch) triggers the re-encode
        // fallback; busy/timeout/memory bubble up untouched.
        if ((error as { code?: string }).code !== 'FFMPEG_FAILED') throw error;
        reencoded = true;
        this.logger.warn({ event: 'ffmpeg_concat_reencode_fallback', step: stepName });
        await this.runner.run({
          binary: 'ffmpeg',
          args: buildConcatArgs(listPath, localOut, { reencode: true, threads: readFfmpegEnv().threads }),
          cwd: jobDir,
        });
      }
      const { size } = await this.uploadFromFile(localOut, outputKey, 'video/mp4');
      return {
        success: true,
        output: { storage_path: outputKey, content_type: 'video/mp4', size, reencoded },
      };
    } finally {
      await this.scratch.cleanup(jobDir);
    }
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/backend && pnpm test -- 'handlers/ffmpeg'` and `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/pipelines
git commit -m "feat(pipelines): ffmpeg_handler slice and concat with stream-copy-first stitch"
```

---

### Task 9: MCP tool surface

Without this, agents cannot author `ffmpeg_handler` rules — the MCP zod enum is a hard gate (`proxy-rules.tools.ts:15-44`), and its `config` description is the de facto handler documentation agents read.

**Files:**
- Modify: `apps/backend/src/mcp/tools/proxy-rules.tools.ts` (enum + `.describe()` prose)
- Test: `apps/backend/src/mcp/tools/` — if a spec exists for the tools schema, extend it; otherwise verify via typecheck + the zod enum unit-parse below in a small new spec `proxy-rules.tools.ffmpeg.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/src/mcp/tools/proxy-rules.tools.ffmpeg.spec.ts
import { pipelineStepSchema } from './proxy-rules.tools'; // export it if it isn't already

describe('MCP pipelineStepSchema accepts ffmpeg_handler', () => {
  it('parses an ffmpeg_handler step', () => {
    const step = {
      name: 'slice',
      handlerType: 'ffmpeg_handler',
      config: { operation: 'slice', input: 'a.mp4', spans: [{ start: 0, end: 2 }], output: 'b.mp4' },
    };
    expect(() => pipelineStepSchema.parse(step)).not.toThrow();
  });
});
```

(If `pipelineStepSchema` is module-private, export it — it's a pure schema; check nothing else shadows the name.)

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && pnpm test -- proxy-rules.tools.ffmpeg`
Expected: FAIL — enum rejects `ffmpeg_handler`.

- [ ] **Step 3: Implement**

Add `'ffmpeg_handler'` to the `z.enum([...])` (alphabetical/grouped placement matching the list style) and append to the config `.describe()` block, matching the established prose format of its neighbors:

```
ffmpeg_handler: {operation: 'probe'|'extract_audio'|'slice'|'concat', input?, inputs?: string[], spans?: [{start,end}], output?, audioOutput?, audioFades?} — server-side video ops on storage objects via guarded native ffmpeg. probe with no input returns {server,ops,version} (capability check, never fails). extract_audio → 16kHz mono WAV. slice cuts kept spans into one clip (+optional WAV). concat stitches uniform clips (stream-copy, auto re-encode fallback). Paths are uploads-relative or /api/uploads/... URLs. Heavy ops belong in postSteps with a job row (fire-and-poll); outputs are {storage_path, content_type, size}. Errors: FFMPEG_UNAVAILABLE|FFMPEG_BUSY|FFMPEG_TIMEOUT|FFMPEG_FAILED|... Fall back to client-side processing when probe reports server:false.
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/backend && pnpm test -- proxy-rules.tools.ffmpeg`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/mcp
git commit -m "feat(mcp): expose ffmpeg_handler in the proxy-rules step schema"
```

---

### Task 10: frontend — type, grouping, config UI

Without these the admin UI shows "Unknown handler type" for agent-authored ffmpeg rules, and the frontend build FAILS on the `Record<HandlerType, string>` display-name/description maps once the type union grows — so this task is not optional polish.

**Files:**
- Modify: `apps/frontend/src/services/pipelinesApi.ts` (add `| 'ffmpeg_handler'` to the `HandlerType` union at lines 32-61)
- Modify: `apps/frontend/src/components/pipelines/PipelineConfig.tsx` (add `'ffmpeg_handler'` to the `Files` group in `HANDLER_GROUPS`, after `'image_convert_handler'`)
- Modify: `apps/frontend/src/components/pipelines/handlers/types.ts` (add the config interface)
- Modify: `apps/frontend/src/components/pipelines/handlers/HandlerConfigWrapper.tsx` (switch case ~line 241 + `getHandlerDisplayName` map ~line 450 + `getHandlerDescription` map ~line 488)
- Create: `apps/frontend/src/components/pipelines/handlers/FfmpegHandlerConfig.tsx`

**Interfaces:**
- Consumes: the `FfmpegHandlerConfig` shape from Task 6 (frontend `types.ts` mirrors backend config interfaces by convention).

- [ ] **Step 1: Add the type + config interface**

`handlers/types.ts` (mirror the backend interface):

```ts
export type FfmpegOperation = 'probe' | 'extract_audio' | 'slice' | 'concat';

export interface FfmpegHandlerConfig extends BaseHandlerConfig {
  operation: FfmpegOperation;
  /** Source object (probe/extract_audio/slice). Expression or path. */
  input?: string;
  /** Concat sources, in order (expression resolving to an array also accepted). */
  inputs?: string[] | string;
  /** Kept spans for slice, or an expression resolving to them. */
  spans?: Array<{ start: number | string; end: number | string }> | string;
  /** Destination, uploads-relative. Required except for probe. */
  output?: string;
  /** slice only: also emit the clip's 16 kHz WAV here. */
  audioOutput?: string;
  /** slice only: ~10 ms audio edge fades per span. */
  audioFades?: boolean;
}
```

- [ ] **Step 2: Build the config component** (modeled on `DelayHandlerConfig.tsx` — same `Props` shape, `ExpressionInput` for expression-capable fields, muted "Step output" info box)

```tsx
// FfmpegHandlerConfig.tsx
import { Label } from '@/components/ui/label';
import { ExpressionInput } from './ExpressionInput';
import type { FfmpegHandlerConfig as Config, FfmpegOperation } from './types';
import type { PreviousStep } from './AvailableVariables';

interface Props {
  config: Record<string, unknown>;
  onChange: (config: Config) => void;
  previousSteps?: PreviousStep[];
}

const OPERATIONS: { value: FfmpegOperation; label: string; hint: string }[] = [
  { value: 'probe', label: 'Probe / capability check', hint: 'No input: returns {server, ops, version}. With input: duration + streams.' },
  { value: 'extract_audio', label: 'Extract audio (16 kHz WAV)', hint: 'The transcription contract: mono, 16 kHz.' },
  { value: 'slice', label: 'Slice (cut kept spans into one clip)', hint: 'Heavy — run in postSteps with a job row.' },
  { value: 'concat', label: 'Concat (stitch clips)', hint: 'Stream-copy first; re-encodes automatically on mismatch.' },
];

export function FfmpegHandlerConfig({ config, onChange, previousSteps = [] }: Props) {
  const typed = config as unknown as Partial<Config>;
  const operation = (typed.operation as FfmpegOperation) ?? 'probe';
  const set = (patch: Partial<Config>) => onChange({ ...typed, operation, ...patch } as Config);

  const spansText =
    typeof typed.spans === 'string' ? typed.spans : typed.spans ? JSON.stringify(typed.spans) : '';
  const inputsText =
    typeof typed.inputs === 'string' ? typed.inputs : typed.inputs ? JSON.stringify(typed.inputs) : '';

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Operation</Label>
        <select
          value={operation}
          onChange={(e) => onChange({ ...typed, operation: e.target.value as FfmpegOperation } as Config)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {OPERATIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">{OPERATIONS.find((o) => o.value === operation)?.hint}</p>
      </div>

      {operation !== 'concat' && (
        <div className="space-y-2">
          <Label>Input {operation === 'probe' ? '(optional — omit for a capability check)' : ''}</Label>
          <ExpressionInput
            value={typed.input ?? ''}
            onChange={(v) => set({ input: v || undefined })}
            placeholder="steps.upload.storage_path or studio/source.mp4"
            previousSteps={previousSteps}
          />
        </div>
      )}

      {operation === 'concat' && (
        <div className="space-y-2">
          <Label>Inputs (JSON array or expression)</Label>
          <ExpressionInput
            value={inputsText}
            onChange={(v) => set({ inputs: v || undefined })}
            placeholder='["studio/s1.mp4", "studio/s2.mp4"] or request.body.parts'
            previousSteps={previousSteps}
          />
        </div>
      )}

      {operation === 'slice' && (
        <div className="space-y-2">
          <Label>Spans (JSON array or expression)</Label>
          <ExpressionInput
            value={spansText}
            onChange={(v) => set({ spans: v || undefined })}
            placeholder='[{"start": 0, "end": 12.5}] or request.body.spans'
            previousSteps={previousSteps}
          />
        </div>
      )}

      {operation !== 'probe' && (
        <div className="space-y-2">
          <Label>Output path (uploads-relative)</Label>
          <ExpressionInput
            value={typed.output ?? ''}
            onChange={(v) => set({ output: v || undefined })}
            placeholder="studio/clips/{{request.body.jobId}}.mp4"
            previousSteps={previousSteps}
          />
        </div>
      )}

      {operation === 'slice' && (
        <>
          <div className="space-y-2">
            <Label>Audio output (optional WAV alongside the clip)</Label>
            <ExpressionInput
              value={typed.audioOutput ?? ''}
              onChange={(v) => set({ audioOutput: v || undefined })}
              placeholder="studio/clips/{{request.body.jobId}}.wav"
              previousSteps={previousSteps}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={typed.audioFades === true}
              onChange={(e) => set({ audioFades: e.target.checked || undefined })}
            />
            Audio edge fades (~10 ms per span — use for scene assembly)
          </label>
        </>
      )}

      <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Step output (available to subsequent steps)</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">storage_path</code>
          <span className="text-muted-foreground">Where the result was written</span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">content_type</code>
          <span className="text-muted-foreground">video/mp4 or audio/wav</span>
          <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">size</code>
          <span className="text-muted-foreground">Result bytes</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Long encodes belong in postSteps with a job row the client polls; this step has no
          response-time budget there.
        </p>
      </div>
    </div>
  );
}
```

Wire `HandlerConfigWrapper.tsx`: `case 'ffmpeg_handler': return <FfmpegHandlerConfig ... />` (copy the delay case's exact props — if the wrapper passes more props than `config/onChange/previousSteps`, mirror them); display name `'FFmpeg Video Ops'`; description `'Run server-side video operations (slice, concat, audio extract, probe) on files in storage'`.

- [ ] **Step 3: Verify**

Run: `cd apps/frontend && pnpm exec tsc --noEmit && pnpm build`
Expected: clean. (The `Record<HandlerType, string>` maps make TS enforce completeness — a miss fails here, which is the test.) Note: frontend lint fails on main already (58 pre-existing problems) — don't chase those; `pnpm test` for the frontend only if existing pipeline component specs exist and break.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src
git commit -m "feat(frontend): ffmpeg_handler pipeline step config UI"
```

---

### Task 11: packaging — Dockerfiles, compose passthrough, .env.example

**Files:**
- Modify: `docker/backend.Dockerfile` (production-stage `RUN` at lines 44-46; do NOT touch the `apk del python3 make g++` shrink line at ~63)
- Modify: `docker/backend.umbrel.Dockerfile` (same `RUN` at lines 43-45)
- Modify: `docker-compose.yml` (backend `environment:` block at lines 276+; note the backend `mem_limit: 384M` at lines 270-275 stays — the pre-flight check + docs are the guard, per spec "below that the capability should stay off")
- Modify: `.env.example` (new optional block in section 13 "OPTIONAL SERVICES", modeled on the presigned-uploads block at lines 313-336)

- [ ] **Step 1: Dockerfiles** — in BOTH files, extend the existing `RUN` (keep the why-comment convention of the block above it):

```dockerfile
# ffmpeg + ffprobe power the ffmpeg_handler pipeline step (server video ops);
# util-linux-misc provides prlimit, which caps ffmpeg's address space so a
# runaway encode kills ffmpeg, never the backend. Absence of either is fine —
# the capability probe degrades to off and apps fall back to client-side wasm.
RUN npm install -g pnpm && \
    apk add --no-cache netcat-openbsd nginx python3 make g++ ffmpeg util-linux-misc && \
    ln -sf python3 /usr/bin/python
```

- [ ] **Step 2: docker-compose.yml** — add to the backend `environment:` block (pattern per its neighbors):

```yaml
      # Server video ops (ffmpeg_handler) — see .env.example section 13
      FFMPEG_HANDLER_ENABLED: ${FFMPEG_HANDLER_ENABLED:-}
      FFMPEG_MEMORY_MB: ${FFMPEG_MEMORY_MB:-}
      FFMPEG_THREADS: ${FFMPEG_THREADS:-}
      FFMPEG_QUEUE_MAX: ${FFMPEG_QUEUE_MAX:-}
      FFMPEG_MAX_SECONDS: ${FFMPEG_MAX_SECONDS:-}
      FFMPEG_SCRATCH_DIR: ${FFMPEG_SCRATCH_DIR:-}
```

(Empty-string defaults are safe: `readFfmpegEnv` treats `''` as unset — that's why Task 2 tests it.) Check `docker-compose.build.yml` and `docker-compose.dev.yml` for their own backend `environment:` blocks and mirror there if present.

- [ ] **Step 3: .env.example** — append to section 13, matching the house format (banner comment, `[OPTIONAL]`, commented-out defaults):

```bash
# --- Server video ops (ffmpeg) [OPTIONAL] -------------------------------
# The ffmpeg_handler pipeline step runs video operations (slice, concat,
# audio extract, probe) server-side. It is ON automatically when the ffmpeg
# binary exists in the image (it does, from CE vX.Y). Sizing rule: server
# video ops want the backend container at >= 1.5-2 GB memory (or a
# swap-backed droplet); below that the pre-flight check refuses jobs with
# "insufficient memory" and apps fall back to client-side processing.
# The stock docker-compose mem_limit (384M) is below the threshold on
# purpose - raise it to enable the capability.
#
# Master switch. Set to false to force the capability off.
# FFMPEG_HANDLER_ENABLED=true
# Address-space cap for the ffmpeg child process, in MB. ffmpeg - not the
# backend - dies on breach. You don't need to set this.
# FFMPEG_MEMORY_MB=1024
# Encoder threads. Defaults to max(1, cores - 1) to keep the API responsive.
# FFMPEG_THREADS=1
# Max queued jobs beyond the one running (global concurrency is 1). Excess
# enqueues fail fast with a "server busy" error clients back off on.
# FFMPEG_QUEUE_MAX=8
# Watchdog: SIGKILL any ffmpeg run exceeding this many seconds.
# FFMPEG_MAX_SECONDS=1800
# Scratch directory for temp transcodes (swept on boot + hourly).
# FFMPEG_SCRATCH_DIR=/tmp/bffless-ffmpeg
```

- [ ] **Step 4: Verify** — build the backend image if the environment allows (`docker build -f docker/backend.Dockerfile .` — slow on the VPS; acceptable to defer to CI) or at minimum `docker compose config` to validate the YAML. Run: `docker compose config >/dev/null && echo OK`.

- [ ] **Step 5: Commit**

```bash
git add docker/backend.Dockerfile docker/backend.umbrel.Dockerfile docker-compose.yml .env.example
git commit -m "feat(docker): ship ffmpeg + prlimit in backend images with FFMPEG_* env passthrough"
```

---

### Task 12: binary-gated integration test

End-to-end against real ffmpeg + `LocalStorageAdapter`, self-generating its fixture (no binary blobs in the repo). Runs only where ffmpeg exists (the VPS has it via CI/dev; CI runners have it via apt — if CI lacks it, the suite self-skips, which is the designed behavior).

**Files:**
- Create: `apps/backend/src/pipelines/__tests__/integration/ffmpeg.handler.spec.ts` (picked up by `jest.integration.config.js` — serial, 30 s timeout; bump per-test timeouts as below)

- [ ] **Step 1: Write the test**

```ts
/**
 * ffmpeg_handler end-to-end: real ffmpeg, real LocalStorageAdapter, fixture
 * generated by ffmpeg itself (lavfi testsrc + sine). Gated on binary presence
 * per the repo convention (ternary describe, cf. storage-integration.spec.ts).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { LocalStorageAdapter } from '../../../storage/local.adapter';
import { ExpressionEvaluator } from '../../execution/expression-evaluator';
import { FfmpegCapabilityService } from '../../ffmpeg/ffmpeg-capability.service';
import { FfmpegRunnerService } from '../../ffmpeg/ffmpeg-runner.service';
import { FfmpegScratchService } from '../../ffmpeg/ffmpeg-scratch.service';
import { FfmpegHandler } from '../../handlers/ffmpeg.handler';
import type { PipelineContext, PipelineStep } from '../../execution/pipeline-context.interface';

const hasFfmpeg =
  spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;

(hasFfmpeg ? describe : describe.skip)('ffmpeg_handler (integration)', () => {
  let baseDir: string;
  let scratchRoot: string;
  let adapter: LocalStorageAdapter;
  let handler: FfmpegHandler;
  const SRC_KEY = 'o/r/uploads/it/source.mp4';

  const context = () => ({ stepOutputs: {}, metadata: { body: {}, headers: {} }, projectId: 'p1' }) as unknown as PipelineContext;
  const step = (config: Record<string, unknown>): PipelineStep =>
    ({ id: 's', name: 'it', handlerType: 'ffmpeg_handler', config, isEnabled: true }) as unknown as PipelineStep;

  beforeAll(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-it-storage-'));
    scratchRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-it-scratch-'));
    process.env.FFMPEG_SCRATCH_DIR = scratchRoot;

    // 4s 320x240 30fps test video with a 440Hz tone, same encode profile as the ops.
    const fixture = path.join(baseDir, 'fixture.mp4');
    const gen = spawnSync('ffmpeg', [
      '-nostdin', '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=4:size=320x240:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest', fixture,
    ]);
    expect(gen.status).toBe(0);

    adapter = new LocalStorageAdapter({ basePath: baseDir });
    await adapter.upload(await fs.readFile(fixture), SRC_KEY);

    const capability = new FfmpegCapabilityService();
    await capability.probe();
    handler = new FfmpegHandler(
      { register: () => undefined } as never,
      new ExpressionEvaluator(),
      capability as never,
      new FfmpegRunnerService() as never,
      new FfmpegScratchService() as never,
      { resolveOwnerRepo: async () => ({ owner: 'o', repo: 'r' }) } as never,
      adapter as never,
    );
  }, 60000);

  afterAll(async () => {
    delete process.env.FFMPEG_SCRATCH_DIR;
    await fs.rm(baseDir, { recursive: true, force: true });
    await fs.rm(scratchRoot, { recursive: true, force: true });
  });

  it('probe reports the fixture duration', async () => {
    const r = await handler.execute(context(), step({ operation: 'probe', input: 'it/source.mp4' }));
    expect(r.success).toBe(true);
    expect((r.output as { duration: number }).duration).toBeCloseTo(4, 0);
  }, 30000);

  it('extract_audio writes a real 16kHz mono wav', async () => {
    const r = await handler.execute(
      context(),
      step({ operation: 'extract_audio', input: 'it/source.mp4', output: 'it/audio.wav' }),
    );
    expect(r.success).toBe(true);
    const wav = await adapter.download('o/r/uploads/it/audio.wav');
    // RIFF header + fmt: mono (ch=1 @22), 16000 Hz (@24)
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(16000);
  }, 30000);

  it('slice cuts spans whose total duration probes back correctly (seam check)', async () => {
    const r = await handler.execute(
      context(),
      step({
        operation: 'slice', input: 'it/source.mp4',
        spans: [{ start: 0.5, end: 1.5 }, { start: 2.5, end: 3.5 }],
        output: 'it/clip.mp4', audioFades: true,
      }),
    );
    expect(r.success).toBe(true);
    const probe = await handler.execute(context(), step({ operation: 'probe', input: 'it/clip.mp4' }));
    expect((probe.output as { duration: number }).duration).toBeCloseTo(2, 0);
  }, 60000);

  it('concat stream-copies two slices into one clip of summed duration', async () => {
    for (const [i, span] of [{ start: 0, end: 1 }, { start: 2, end: 3 }].entries()) {
      const r = await handler.execute(
        context(),
        step({ operation: 'slice', input: 'it/source.mp4', spans: [span], output: `it/part${i}.mp4` }),
      );
      expect(r.success).toBe(true);
    }
    const r = await handler.execute(
      context(),
      step({ operation: 'concat', inputs: ['it/part0.mp4', 'it/part1.mp4'], output: 'it/final.mp4' }),
    );
    expect(r.success).toBe(true);
    expect((r.output as { reencoded: boolean }).reencoded).toBe(false);
    const probe = await handler.execute(context(), step({ operation: 'probe', input: 'it/final.mp4' }));
    expect((probe.output as { duration: number }).duration).toBeCloseTo(2, 0);
  }, 60000);
});
```

(Adjust the `LocalStorageAdapter` constructor to its real config shape, as in Task 1. `FfmpegCapabilityService.probe()` is called explicitly because `NODE_ENV=test` skips `onModuleInit`.)

- [ ] **Step 2: Run**

Run: `cd apps/backend && pnpm test:integration -- ffmpeg`
Expected: PASS on this VPS (ffmpeg present — verify with `ffmpeg -version` first; if absent, `apk`/`apt` install it locally or accept the skip and rely on a CI runner that has it).

- [ ] **Step 3: Full suite + typecheck**

Run from repo root: `NODE_OPTIONS=--max-old-space-size=4096 pnpm test` and both `pnpm --filter backend exec tsc --noEmit` / `pnpm --filter frontend exec tsc --noEmit`.
Expected: green (baseline was green before this branch).

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/pipelines/__tests__
git commit -m "test(pipelines): binary-gated ffmpeg_handler integration suite with self-generated fixture"
```

---

## Out of scope / follow-ups (do NOT do in this PR)

- **Studio adoption** (rules under `.bffless/proxy-rules/studio/`, `lib/export` server backend, MSW mocks, capability probe wiring, stale-`running` job sweep) — separate plan in `repos/apps`, consuming the Contract section above.
- **Public docs** (docs.bffless.dev): handler reference page + the sizing rule ("server video ops want ≥1.5–2 GB backend memory"). Lives in the separate `bffless/docs` repo.
- **Platform k8s chart**: set `FFMPEG_HANDLER_ENABLED=false` in multi-tenant workspace values until the sidecar evolution (spec risk table).
- **Release**: release-please minor. PR title must be a conventional commit (`feat: ...`) — the squash title becomes the release commit.
- **Wasm-reference seam-alignment verification** (spec risk "variable-fps recordings encode differently"): the integration test checks durations; frame-exact comparison against a wasm-produced reference happens in the Studio PR's live verify on j5s.dev.

## Self-review notes (spec → plan coverage)

- Curated ops (`extract_audio`, `slice`+`audioOutput`, `concat` w/ re-encode fallback, `probe`) → Tasks 3, 7, 8. Validation (numeric spans, adapter-resolved paths, config-declared outputs, template resolution) → Tasks 6–8.
- Fire-and-poll: no CE job framework added (per locked decision); handler is synchronous; capability payload for the authored `/api/video/capabilities` rule → probe-no-input (Task 6).
- Storage flow stream→temp→ffmpeg→temp→stream + cleanup → Tasks 1, 7 (uploadStream was a real gap, found in research).
- OOM guard (`prlimit --as`, pre-flight cgroup check + exact refusal message, sizing docs) → Tasks 5, 11. CPU (nice, threads, concurrency 1, bounded queue) → Tasks 3, 5. Disk (`statfs` 2× pre-flight, bounded scratch, finally-cleanup, boot sweep) → Tasks 4, 7, 8. Watchdog + master switch → Tasks 2, 5.
- Capability discovery (boot probe, env, wasm fallback) → Task 2; packaging (Alpine apk — the spec said "apt", corrected; umbrel image; compose passthrough; 384M note) → Task 11.
- postSteps ceiling risk → verified none exists (research); redeploy-mid-encode risk → delegated to Studio plan via the Contract section (CE cannot see app job tables); stream-mismatch risk → Task 8 fallback; variable-fps risk → Task 3 ports the exact flag sets + docstrings.
