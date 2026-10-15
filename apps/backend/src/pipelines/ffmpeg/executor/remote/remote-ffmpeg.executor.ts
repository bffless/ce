import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { LOCAL_PRESIGN_PATH } from '../../../../storage/local.adapter';
import { STORAGE_ADAPTER, type IStorageAdapter } from '../../../../storage/storage.interface';
import { readFfmpegEnv, type FfmpegEnvConfig } from '../../ffmpeg-env';
import { FFMPEG_REMOTE_DEPS } from '../ffmpeg-config.tokens';
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
import {
  buildEnvelope,
  workerSupportsStreamInputs,
  type WorkerHealth,
  type WorkerResponse,
} from './envelope';
import type { AuthHeaderProvider } from '../../../../remote-connections/auth/id-token';
import { authProviderFor } from '../../../../remote-connections/remote-client';
import { InflightFuse } from '../../../../remote-connections/fuse';
import {
  RemoteBusyError,
  RemoteResponseTooLargeError,
  RemoteUnavailableError,
} from '../../../../remote-connections/remote-errors';
import { mapWorkerResponse } from './result-mapping';
import { WorkerClient, WorkerTransportError } from './worker-client';

/** CE's own presign route, whether the adapter returned it relative or absolute. */
function isLocalPresignUrl(probe: string): boolean {
  try {
    return new URL(probe, 'http://ce.invalid').pathname.startsWith(LOCAL_PRESIGN_PATH);
  } catch {
    return false;
  }
}

/** How long a readiness answer (storage probe + healthz) is reused. */
const READINESS_CACHE_MS = 60_000;
/**
 * How long `ready()` waits for a Worker that is not answering before calling it
 * unreachable, and how often it asks again. A scale-to-zero Worker (Cloud Run)
 * takes about 30 s to start, and its front door answers the requests that arrive
 * meanwhile with a 500 "no available instance" — not a 503 the transport would
 * retry. Seen 2026-10-13: the first piece of a drive woke the worker, and every
 * piece that followed within the minute failed on the cached "unreachable".
 */
const WAKE_WAIT_MS = 45_000;
const WAKE_POLL_MS = 5_000;
/**
 * How long a FAILED health probe is kept. A Worker that is genuinely down (bad
 * URL, decommissioned, firewalled) fails in exactly the shape of one still waking,
 * so the wake wait cannot tell them apart; keeping the failure this long means a
 * dead Worker costs one wake wait and then fails fast, while a Worker that was only
 * cold is asked again well inside the minute the readiness cache lives.
 */
const HEALTH_FAILURE_CACHE_MS = 20_000;

/**
 * A health failure that may just be a Worker still waking: no answer at all
 * (refused, reset, timed out), a 5xx from a front door with no instance behind
 * it, or a 429. A 4xx below that is the Worker (or its auth) saying no, and
 * waiting will not change it.
 */
function mayBeWaking(error: unknown): boolean {
  if (!(error instanceof WorkerTransportError)) return false;
  return error.status === undefined || error.status === 429 || error.status >= 500;
}
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

/**
 * D4: `none` is only for a Worker on a trusted network — everything else mints a
 * Google ID token for the Worker's URL. A thin alias over the shared
 * `authProviderFor` (the ffmpeg config's auth field is the same narrow union),
 * kept module-level so the choice is testable without reaching into a WorkerClient.
 */
export function authFor(env: FfmpegEnvConfig): AuthHeaderProvider {
  return authProviderFor(env.remoteAuth, env.remoteSaKeyJson);
}

/** The default `clientFactory`: a client for this env's worker URL and auth mode. */
export function buildWorkerClient(env: FfmpegEnvConfig): WorkerClient {
  return new WorkerClient(env.remoteUrl!, authFor(env));
}

interface Deps {
  env?: () => FfmpegEnvConfig;
  clientFactory?: (env: FfmpegEnvConfig) => WorkerClient;
  now?: () => number;
  /** The pause between health polls while a Worker wakes (a test seam). */
  sleep?: (ms: number) => Promise<void>;
  /** The shared per-connection in-flight counter; a private one when nothing supplies it. */
  fuse?: InflightFuse;
}

type HealthProbe = { ok: true; health: WorkerHealth } | { ok: false; reason: string };

interface CacheEntry {
  key: string;
  at: number;
  /** Rules (3)+(4): can this storage adapter hand a Worker a reachable URL? */
  storage?: FfmpegExecutorReadiness;
  /** Rule (6): the Worker's own answer for the entry's life, or why we couldn't get one, kept until `until`. */
  health?: { ok: true; health: WorkerHealth } | { ok: false; reason: string; until: number };
  /** The probe in flight, so callers that arrive while the Worker wakes share one wait. */
  healthInflight?: Promise<HealthProbe>;
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
  private readonly sleep: (ms: number) => Promise<void>;

  /**
   * Jobs in flight against the CONNECTION, not against this object: the same
   * counter every other consumer of that connection draws from (spec D5), so a
   * remote_request step and an ffmpeg job share one ceiling.
   */
  private readonly sharedFuse: () => InflightFuse | undefined;
  private ownFuse?: InflightFuse;
  private cache?: CacheEntry;
  private client?: { key: string; client: WorkerClient };

  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
    // The effective config (+ test seams). @Optional() so a hand-built executor
    // and any wiring without the token keep the plain readFfmpegEnv() default.
    @Optional() @Inject(FFMPEG_REMOTE_DEPS) deps: Deps = {},
  ) {
    this.env = deps.env ?? (() => readFfmpegEnv());
    this.clientFactory = deps.clientFactory ?? buildWorkerClient;
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    // Read per job, never here: FFMPEG_REMOTE_DEPS exposes the shared fuse
    // through a lazy getter, and resolving it in this constructor would race
    // Nest's provider instantiation order — silently falling back to a private
    // counter, which is exactly the bug the shared fuse exists to prevent.
    this.sharedFuse = () => deps.fuse;
  }

  /** 0 = let ffmpeg pick, sized to the Worker's cores — CE's own FFMPEG_THREADS says nothing about them. */
  argvThreads(): number {
    return 0;
  }

  /**
   * `fresh` skips (and does not poison) the shared 60 s cache and `env` judges a
   * CANDIDATE config — both are what the settings "Test connection" button needs
   * to report on an unsaved draft without disturbing the live readiness answer.
   */
  async ready(
    opts: { fresh?: boolean; env?: FfmpegEnvConfig } = {},
  ): Promise<FfmpegExecutorReadiness> {
    const env = opts.env ?? this.env();
    if (!env.remoteUrl)
      return {
        ok: false,
        reason:
          'no remote connection selected (Admin Settings → Server video ops → Executor, or FFMPEG_REMOTE_CONNECTION / FFMPEG_REMOTE_URL)',
      };
    let url: URL;
    try {
      url = new URL(env.remoteUrl);
    } catch {
      return { ok: false, reason: `remote connection URL is not valid: ${env.remoteUrl}` };
    }
    if (env.remoteAuth !== 'none' && url.protocol !== 'https:') {
      return { ok: false, reason: 'remote auth google_id_token requires an https worker URL' };
    }

    const entry = opts.fresh || opts.env ? this.freshEntry(env) : this.cacheEntry(env);
    entry.storage ??= await this.probeStorage();
    if (!entry.storage.ok) return entry.storage;

    if (env.remoteAuth === 'google_id_token' && env.remoteSaKeyJson) {
      try {
        JSON.parse(env.remoteSaKeyJson);
      } catch {
        return { ok: false, reason: 'FFMPEG_REMOTE_SA_KEY_JSON is not valid JSON' };
      }
    }

    const probed = await this.cachedHealth(env, entry, {
      throwaway: Boolean(opts.fresh || opts.env),
      wait: !(opts.fresh || opts.env),
    });
    if (!probed.ok) return { ok: false, reason: probed.reason };
    const health = probed.health;
    if (!health.ok) return { ok: false, reason: 'worker reports not ok' };
    if (env.workerMinVersion && semverLt(health.version, env.workerMinVersion)) {
      return {
        ok: false,
        reason: `worker ${health.version} is older than FFMPEG_WORKER_MIN_VERSION ${env.workerMinVersion}`,
      };
    }
    return { ok: true, version: health.version };
  }

  /** Uncached liveness check for the settings "Test connection" button; `overrides` = the unsaved form draft. */
  async testConnection(
    overrides: Partial<Pick<FfmpegEnvConfig, 'remoteUrl' | 'remoteAuth' | 'remoteSaKeyJson'>> = {},
  ): Promise<WorkerHealth> {
    const env: FfmpegEnvConfig = { ...this.env(), ...overrides };
    if (!env.remoteUrl) throw new FfmpegExecutorUnavailableError('no remote connection selected');
    // Never memoise a draft's client over the live one — a draft may carry a different key.
    const client = Object.keys(overrides).length ? this.clientFactory(env) : this.clientFor(env);
    return client.health();
  }

  async run(job: FfmpegJob, opts: { signal: AbortSignal }): Promise<FfmpegJobResult> {
    const env = this.env();
    if (!env.remoteUrl) throw new FfmpegExecutorUnavailableError('no remote connection selected');
    // ready() normally catches this; guard here too so a caller that skipped it
    // gets the typed error instead of a TypeError on an absent optional method.
    if (typeof this.storageAdapter.getPresignedUploadUrl !== 'function') {
      throw new FfmpegExecutorUnavailableError(
        'storage adapter cannot presign (remote executor needs bucket storage: S3/GCS/MinIO/Azure)',
      );
    }
    const t0 = this.now();
    // Fail fast rather than queue: a remote job holds no local resource worth
    // waiting for, and the handler would rather retry than sit on a slot. Logged
    // like any other failed job so the fuse is visible in the same log line.
    let release: () => void;
    try {
      release = this.fuse().acquire(env.remoteConnection ?? 'ffmpeg', env.remoteMaxInflight);
    } catch (error) {
      if (error instanceof RemoteBusyError) {
        const busy = new FfmpegBusyError(
          'remote executor at capacity (connection max_inflight / FFMPEG_REMOTE_MAX_INFLIGHT)',
        );
        this.logFailure(job, busy, t0);
        throw busy;
      }
      throw error;
    }
    try {
      // #796: stream-hinted inputs are only streamed by a Worker that says it can —
      // an older one would download them and then choke on -reconnect against a
      // local path. The answer rides the same 60 s health cache ready() fills.
      const streamInputs =
        job.inputs.some((input) => input.stream === true) &&
        workerSupportsStreamInputs(await this.workerHealth(env));
      const envelope = await buildEnvelope(
        job,
        {
          getUrl: (key, ttl) => this.storageAdapter.getUrl(key, ttl),
          putUrl: (key, ttl, maxBytes) =>
            this.storageAdapter.getPresignedUploadUrl!(key, ttl, maxBytes),
        },
        env,
        { streamInputs },
      );

      let response: WorkerResponse;
      try {
        response = await this.clientFor(env).postJob(envelope, { signal: opts.signal });
      } catch (error) {
        // The shared transport refuses to buffer an oversized body, so the job has
        // no result to map — same class of "the Worker is not usable" as a 500.
        if (error instanceof RemoteResponseTooLargeError) {
          throw new FfmpegExecutorUnavailableError(`worker response too large: ${error.message}`);
        }
        // Auth-minting failure (e.g. a malformed connection credential) — never a
        // transport fault, so it never went through WorkerTransportError; the
        // message is already safe (no key text), just re-typed for this executor.
        if (error instanceof RemoteUnavailableError) {
          throw new FfmpegExecutorUnavailableError(error.message);
        }
        if (error instanceof WorkerTransportError) {
          // A status-carrying retryable answer is the Worker's own 503 BUSY or
          // Cloud Run's front-door 429/503 — after our one retry it means "still
          // busy", which callers already know how to back off from. A retryable
          // error with no status is a thrown fetch (connection refused, DNS):
          // a real transport fault, not capacity.
          if (error.retryable && error.status !== undefined) {
            throw new FfmpegBusyError(`remote worker busy: ${error.message}`);
          }
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
        bytesStreamed: response.bytesStreamed ?? 0,
        bytesOut: result.bytesOut,
        commands: result.commands.map((c) => `${c.id}:${c.exitCode}`),
      });
      return result;
    } catch (error) {
      this.logFailure(job, error, t0);
      throw error;
    } finally {
      release();
    }
  }

  /** The shared per-connection counter, or a private one when nothing supplies it (hand-built executors, unit tests). */
  private fuse(): InflightFuse {
    return this.sharedFuse() ?? (this.ownFuse ??= new InflightFuse());
  }

  /** One structured line per failed job, whatever failed it (fuse included). */
  private logFailure(job: FfmpegJob, error: unknown, t0: number): void {
    this.logger.warn({
      event: 'ffmpeg_remote_job',
      job: job.id,
      ok: false,
      code: (error as { code?: string })?.code,
      message: error instanceof Error ? error.message : String(error),
      durationMs: this.now() - t0,
    });
  }

  // ---- readiness helpers ----

  /**
   * Rules (3) and (4): the Worker fetches and uploads on its own, so the adapter
   * must be able to presign, and the URL it presigns must point at a bucket. The
   * local-filesystem adapter presigns CE's own route instead — relative by
   * default, but ABSOLUTE (`https://<PUBLIC_ORIGIN>/api/storage/presigned/local?…`)
   * once a public origin is configured, so relativity alone does not catch it and
   * every byte would transit CE. Probed rather than sniffed by class name, so a
   * wrapping adapter (Dynamic/Caching) is judged on what it actually returns.
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
    if (probe.startsWith('/') || isLocalPresignUrl(probe)) {
      return { ok: false, reason: 'local filesystem storage cannot be reached by a worker' };
    }
    return { ok: true };
  }

  /**
   * `throwaway` = a Test-connection / candidate check: build a one-off client so a
   * draft config cannot evict the live memoised WorkerClient (and the ID token it
   * has already minted) out from under running jobs. `wait` = keep asking for up
   * to WAKE_WAIT_MS while the answer looks like a Worker still starting; off for
   * the settings button, which wants the answer now.
   */
  private async probeHealth(
    env: FfmpegEnvConfig,
    opts: { throwaway?: boolean; wait?: boolean } = {},
  ): Promise<HealthProbe> {
    const client = opts.throwaway ? this.clientFactory(env) : this.clientFor(env);
    const started = this.now();
    let waited = false;
    for (;;) {
      try {
        return { ok: true, health: await client.health() };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const elapsed = this.now() - started;
        if (opts.wait && mayBeWaking(error) && elapsed + WAKE_POLL_MS <= WAKE_WAIT_MS) {
          if (!waited) {
            waited = true;
            this.logger.warn(
              `ffmpeg worker not answering (${message}); waiting up to ${WAKE_WAIT_MS / 1000} s for it to wake`,
            );
          }
          await this.sleep(WAKE_POLL_MS);
          continue;
        }
        return {
          ok: false,
          reason: waited
            ? `worker unreachable after waiting ${Math.round(elapsed / 1000)} s for it to wake: ${message}`
            : `worker unreachable: ${message}`,
        };
      }
    }
  }

  /**
   * The entry's health answer. A good answer lives as long as the entry; a failed
   * one only HEALTH_FAILURE_CACHE_MS, so a Worker that was only waking is asked
   * again soon and a dead one is not asked on every call. Callers that find no
   * answer ride the probe already in flight rather than each polling the Worker
   * while it starts.
   */
  private cachedHealth(
    env: FfmpegEnvConfig,
    entry: CacheEntry,
    opts: { throwaway?: boolean; wait?: boolean },
  ): Promise<HealthProbe> {
    const cached = entry.health;
    if (cached && (cached.ok || this.now() < cached.until)) return Promise.resolve(cached);
    if (!entry.healthInflight) {
      entry.healthInflight = this.probeHealth(env, opts)
        .then((probed) => {
          entry.health = probed.ok
            ? probed
            : { ...probed, until: this.now() + HEALTH_FAILURE_CACHE_MS };
          return probed;
        })
        .finally(() => {
          entry.healthInflight = undefined;
        });
    }
    return entry.healthInflight;
  }

  /**
   * The live Worker's /health answer for a job, from (or into) the shared readiness
   * cache. Unreachable → undefined, which callers must treat as "no new features":
   * the job POST that follows reports the real transport fault. No wake wait here:
   * a job only gets this far after `ready()` has waited, and the job POST is what
   * carries the step's deadline.
   */
  private async workerHealth(env: FfmpegEnvConfig): Promise<WorkerHealth | undefined> {
    const probed = await this.cachedHealth(env, this.cacheEntry(env), {});
    return probed.ok ? probed.health : undefined;
  }

  /** An entry nobody else sees — for Test connection and candidate configs. */
  private freshEntry(env: FfmpegEnvConfig): CacheEntry {
    return { key: this.identity(env), at: this.now() };
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
}
