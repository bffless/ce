import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { STORAGE_ADAPTER, type IStorageAdapter } from '../../../../storage/storage.interface';
import { readFfmpegEnv, type FfmpegEnvConfig } from '../../ffmpeg-env';
import {
  FfmpegBusyError,
  FfmpegExecutorUnavailableError,
  FfmpegProcessError,
  FfmpegStepTimeoutError,
} from '../../ffmpeg-errors';
import type {
  FfmpegExecutor,
  FfmpegExecutorReadiness,
  FfmpegJob,
  FfmpegJobResult,
} from '../ffmpeg-executor.interface';
import { buildEnvelope, type WorkerHealth, type WorkerResponse } from './envelope';
import { NoAuth, IdTokenMinter } from './id-token';
import { mapWorkerResponse } from './result-mapping';
import { WorkerClient, WorkerTransportError } from './worker-client';

/** How long a readiness answer (storage probe + healthz) is reused. */
const READINESS_CACHE_MS = 60_000;
/** Key the storage probe writes nothing to — it only signs a URL, it never uploads. */
const PROBE_KEY = '__ffmpeg_remote_probe__';
const PROBE_TTL_SECONDS = 60;

/**
 * Numeric semver "less than", pre-release suffixes ignored (`0.4.31-rc.1` counts as `0.4.31`).
 * Deliberately tiny: this only gates "is the Worker new enough", where a lexical
 * compare would call 0.10.0 older than 0.9.0.
 */
export function semverLt(a: string, b: string): boolean {
  const parts = (v: string) =>
    v
      .split('-')[0]
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff < 0;
  }
  return false;
}

interface Deps {
  env?: () => FfmpegEnvConfig;
  clientFactory?: (env: FfmpegEnvConfig) => WorkerClient;
  now?: () => number;
}

interface CacheEntry {
  key: string;
  at: number;
  /** Rules (3)+(4): can this storage adapter hand a Worker a reachable URL? */
  storage?: FfmpegExecutorReadiness;
  /** Rule (6): the Worker's own answer, or why we couldn't get one. */
  health?: { ok: true; health: WorkerHealth } | { ok: false; reason: string };
}

/**
 * "Remote server": CE signs a URL per input/output, POSTs an argv-only envelope to a
 * stateless Worker and confirms the results in storage. No bytes flow through CE — which
 * is also why `ready()` refuses any storage adapter whose URLs a Worker cannot fetch.
 *
 * See docs/superpowers/specs/2026-08-17-ffmpeg-remote-executor-design.md and
 * docs/adr/0004-remote-ffmpeg-worker-is-a-dumb-argv-runner-fed-by-signed-urls.md.
 */
@Injectable()
export class RemoteFfmpegExecutor implements FfmpegExecutor {
  readonly name = 'remote' as const;
  private readonly logger = new Logger(RemoteFfmpegExecutor.name);

  private readonly env: () => FfmpegEnvConfig;
  private readonly clientFactory: (env: FfmpegEnvConfig) => WorkerClient;
  private readonly now: () => number;

  /** Jobs this CE instance has posted and not yet settled — the fuse `remoteMaxInflight` blows. */
  private inflight = 0;
  private cache?: CacheEntry;
  private client?: { key: string; client: WorkerClient };

  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
    // Test seams only — @Optional() so Nest never tries to resolve a provider for it.
    @Optional() deps: Deps = {},
  ) {
    this.env = deps.env ?? (() => readFfmpegEnv());
    this.clientFactory = deps.clientFactory ?? ((env) => this.buildClient(env));
    this.now = deps.now ?? (() => Date.now());
  }

  /** 0 = let ffmpeg pick, sized to the Worker's cores — CE's own FFMPEG_THREADS says nothing about them. */
  argvThreads(): number {
    return 0;
  }

  async ready(): Promise<FfmpegExecutorReadiness> {
    const env = this.env();
    if (!env.remoteUrl) return { ok: false, reason: 'FFMPEG_REMOTE_URL is not set' };
    let url: URL;
    try {
      url = new URL(env.remoteUrl);
    } catch {
      return { ok: false, reason: `FFMPEG_REMOTE_URL is not a valid URL: ${env.remoteUrl}` };
    }
    if (env.remoteAuth !== 'none' && url.protocol !== 'https:') {
      return { ok: false, reason: 'remote auth google_id_token requires an https worker URL' };
    }

    const entry = this.cacheEntry(env);
    entry.storage ??= await this.probeStorage();
    if (!entry.storage.ok) return entry.storage;

    if (env.remoteAuth === 'google_id_token' && env.remoteSaKeyJson) {
      try {
        JSON.parse(env.remoteSaKeyJson);
      } catch {
        return { ok: false, reason: 'FFMPEG_REMOTE_SA_KEY_JSON is not valid JSON' };
      }
    }

    entry.health ??= await this.probeHealth(env);
    if (!entry.health.ok) return { ok: false, reason: entry.health.reason };
    const health = entry.health.health;
    if (!health.ok) return { ok: false, reason: 'worker reports not ok' };
    if (env.workerMinVersion && semverLt(health.version, env.workerMinVersion)) {
      return {
        ok: false,
        reason: `worker ${health.version} is older than FFMPEG_WORKER_MIN_VERSION ${env.workerMinVersion}`,
      };
    }
    return { ok: true, version: health.version };
  }

  /** Uncached liveness check for the settings "Test connection" button. */
  async testConnection(): Promise<WorkerHealth> {
    const env = this.env();
    if (!env.remoteUrl) throw new FfmpegExecutorUnavailableError('FFMPEG_REMOTE_URL is not set');
    return this.clientFor(env).health();
  }

  async run(job: FfmpegJob, opts: { signal: AbortSignal }): Promise<FfmpegJobResult> {
    const env = this.env();
    if (!env.remoteUrl) throw new FfmpegExecutorUnavailableError('FFMPEG_REMOTE_URL is not set');
    // ready() normally catches this; guard here too so a caller that skipped it
    // gets the typed error instead of a TypeError on an absent optional method.
    if (typeof this.storageAdapter.getPresignedUploadUrl !== 'function') {
      throw new FfmpegExecutorUnavailableError(
        'storage adapter cannot presign (remote executor needs bucket storage: S3/GCS/MinIO/Azure)',
      );
    }
    // Fail fast rather than queue: a remote job holds no local resource worth
    // waiting for, and the handler would rather retry than sit on a slot.
    if (this.inflight >= env.remoteMaxInflight) {
      throw new FfmpegBusyError('remote executor at capacity (FFMPEG_REMOTE_MAX_INFLIGHT)');
    }
    this.inflight++;
    const t0 = this.now();
    try {
      const envelope = await buildEnvelope(
        job,
        {
          getUrl: (key, ttl) => this.storageAdapter.getUrl(key, ttl),
          putUrl: (key, ttl, maxBytes) =>
            this.storageAdapter.getPresignedUploadUrl!(key, ttl, maxBytes),
        },
        env,
      );

      let response: WorkerResponse;
      try {
        response = await this.clientFor(env).postJob(envelope, { signal: opts.signal });
      } catch (error) {
        if (error instanceof WorkerTransportError) {
          throw new FfmpegExecutorUnavailableError(`worker request failed: ${error.message}`);
        }
        if ((error as { name?: string })?.name === 'AbortError' || opts.signal.aborted) {
          throw new FfmpegStepTimeoutError(
            `remote ffmpeg job ${job.id} was aborted after ${this.now() - t0}ms`,
          );
        }
        throw error;
      }

      let mapped: FfmpegJobResult;
      try {
        mapped = mapWorkerResponse(response, job);
      } catch (error) {
        // isWorkerResponse only guards the top-level shape, so a nested field of
        // the wrong type surfaces here as a TypeError — a broken worker, not a job failure.
        if (error instanceof TypeError) {
          throw new FfmpegExecutorUnavailableError(
            `worker returned a malformed response: ${error.message}`,
          );
        }
        throw error;
      }

      // The Worker uploaded straight to storage, so its "ok" is a claim about
      // someone else's system: confirm every object exists and take storage's
      // size as authoritative.
      const outputs: FfmpegJobResult['outputs'] = [];
      for (const output of mapped.outputs) {
        let bytes: number;
        try {
          bytes = (await this.storageAdapter.getMetadata(output.key)).size ?? output.bytes;
        } catch {
          throw new FfmpegProcessError(
            `worker reported success but ${output.key} is not in storage`,
            0,
            response.stderrTail,
          );
        }
        outputs.push({ ...output, bytes });
      }

      const result: FfmpegJobResult = {
        ...mapped,
        outputs,
        // Phase timings are the Worker's; totalMs is CE's wall clock, so it also
        // covers URL signing and the output confirmation the Worker cannot see.
        timings: { ...mapped.timings, totalMs: this.now() - t0 },
      };
      this.logger.log({
        event: 'ffmpeg_remote_job',
        job: job.id,
        ok: true,
        worker: response.worker,
        timings: result.timings,
        bytesIn: result.bytesIn,
        bytesOut: result.bytesOut,
        commands: result.commands.map((c) => `${c.id}:${c.exitCode}`),
      });
      return result;
    } catch (error) {
      this.logger.warn({
        event: 'ffmpeg_remote_job',
        job: job.id,
        ok: false,
        code: (error as { code?: string })?.code,
        message: error instanceof Error ? error.message : String(error),
        durationMs: this.now() - t0,
      });
      throw error;
    } finally {
      this.inflight--;
    }
  }

  // ---- readiness helpers ----

  /**
   * Rules (3) and (4): the Worker fetches and uploads on its own, so the adapter
   * must be able to presign, and the URL it presigns must be absolute. A relative
   * URL (`/api/storage/presigned/local?…`) is the local-filesystem adapter — nothing
   * a Worker on another host can resolve. Probed rather than sniffed by class name,
   * so a wrapping adapter (Dynamic/Caching) is judged on what it actually returns.
   */
  private async probeStorage(): Promise<FfmpegExecutorReadiness> {
    const cannotPresign: FfmpegExecutorReadiness = {
      ok: false,
      reason:
        'storage adapter cannot presign (remote executor needs bucket storage: S3/GCS/MinIO/Azure)',
    };
    if (
      this.storageAdapter.supportsPresignedUrls?.() !== true ||
      typeof this.storageAdapter.getPresignedUploadUrl !== 'function'
    ) {
      return cannotPresign;
    }
    let probe: string;
    try {
      probe = await this.storageAdapter.getPresignedUploadUrl(PROBE_KEY, PROBE_TTL_SECONDS);
    } catch {
      return cannotPresign;
    }
    if (probe.startsWith('/')) {
      return { ok: false, reason: 'local filesystem storage cannot be reached by a worker' };
    }
    return { ok: true };
  }

  private async probeHealth(env: FfmpegEnvConfig): Promise<NonNullable<CacheEntry['health']>> {
    try {
      return { ok: true, health: await this.clientFor(env).health() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: `worker unreachable: ${message}` };
    }
  }

  /** One cache entry per worker identity; a config change invalidates it immediately. */
  private cacheEntry(env: FfmpegEnvConfig): CacheEntry {
    const key = this.identity(env);
    if (!this.cache || this.cache.key !== key || this.now() - this.cache.at >= READINESS_CACHE_MS) {
      this.cache = { key, at: this.now() };
    }
    return this.cache;
  }

  private identity(env: FfmpegEnvConfig): string {
    return [env.remoteUrl, env.remoteAuth, env.remoteSaKeyJson ?? ''].join('|');
  }

  /** Memoised so the ID-token client (and its refresh timer) survives across jobs. */
  private clientFor(env: FfmpegEnvConfig): WorkerClient {
    const key = this.identity(env);
    if (this.client?.key !== key) this.client = { key, client: this.clientFactory(env) };
    return this.client.client;
  }

  private buildClient(env: FfmpegEnvConfig): WorkerClient {
    return new WorkerClient(
      env.remoteUrl!,
      env.remoteAuth === 'none' ? new NoAuth() : new IdTokenMinter(env.remoteSaKeyJson),
    );
  }
}
