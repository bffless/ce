import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { ffmpegExecutorSettings, type FfmpegExecutorSettingsRow } from '../../db/schema';
import { decryptString, encryptString } from '../../common/crypto/aes-gcm';
import { resolveLocalAdapter } from '../../storage/local.adapter';
import { IStorageAdapter, STORAGE_ADAPTER } from '../../storage/storage.interface';
import { FfmpegCapabilityService } from './ffmpeg-capability.service';
import { RemoteFfmpegExecutor } from './executor/remote/remote-ffmpeg.executor';
import {
  readFfmpegEnv,
  type FfmpegEnvConfig,
  type FfmpegExecutorSetting,
  type FfmpegRemoteAuth,
} from './ffmpeg-env';

export interface FfmpegExecutorEnvManaged {
  defaultExecutor: boolean;
  remoteUrl: boolean;
  remoteAuth: boolean;
  saKey: boolean;
}

/** What the admin UI renders. The service-account key itself is NEVER part of this. */
export interface FfmpegExecutorStatus {
  localAvailable: boolean;
  localVersion: string | null;
  localEnabled: boolean;
  remoteEnabled: boolean;
  remoteUrl: string | null;
  remoteAuth: FfmpegRemoteAuth;
  hasSaKey: boolean;
  saKeySource: 'db' | 'env' | null;
  defaultExecutor: FfmpegExecutorSetting;
  /** false on the local-FS adapter: a Worker cannot fetch CE-relative URLs (D3), so Remote cannot be enabled. */
  storagePresignable: boolean;
  envManaged: FfmpegExecutorEnvManaged;
}

export interface UpdateFfmpegExecutorInput {
  localEnabled?: boolean;
  remoteEnabled?: boolean;
  remoteUrl?: string | null;
  remoteAuth?: FfmpegRemoteAuth;
  defaultExecutor?: FfmpegExecutorSetting;
  /** undefined = keep the stored key; null (or '', a blanked UI field) = clear it; string = replace it. */
  saKeyJson?: string | null;
}

/** The unsaved admin form a "Test connection" is run against. */
export interface FfmpegExecutorTestDraft {
  remoteUrl?: string | null;
  remoteAuth?: FfmpegRemoteAuth;
  saKeyJson?: string | null;
}

/** What the admin UI shows after a "Test connection". The SA key is never part of it. */
export interface FfmpegExecutorTestResult {
  ok: boolean;
  latencyMs: number | null;
  worker?: { version: string; ffmpeg: string | null; ops: string[]; uptimeS: number };
  error?: string;
  readiness: { ok: boolean; reason?: string };
  credential: 'sa_key' | 'adc' | 'none';
}

/** The decrypted, in-memory shape of the DB row. */
interface CachedSettings {
  localEnabled: boolean;
  remoteEnabled: boolean;
  remoteUrl: string | null;
  remoteAuth: FfmpegRemoteAuth;
  saKeyJson: string | null;
  defaultExecutor: FfmpegExecutorSetting;
}

/** '' counts as unset — compose passthrough materialises unconfigured vars as ''. */
function envSet(env: NodeJS.ProcessEnv, key: string): boolean {
  return (env[key] ?? '').trim() !== '';
}

/** Same normalisation `ffmpeg-env.ts` applies to FFMPEG_REMOTE_URL. */
function normaliseUrl(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

/**
 * Admin-editable executor configuration (spec §1.5). One DB row, decrypted into
 * memory at boot and after every save so the executors can read it SYNCHRONOUSLY
 * through `resolved()` — the same `FfmpegEnvConfig` shape `readFfmpegEnv()` returns,
 * with env winning over the DB per field (FFMPEG_EXECUTOR, FFMPEG_REMOTE_URL,
 * FFMPEG_REMOTE_AUTH, FFMPEG_REMOTE_SA_KEY_JSON). CE runs one backend process per
 * instance, so an in-process cache refreshed on write is sufficient.
 */
@Injectable()
export class FfmpegExecutorSettingsService implements OnModuleInit {
  private readonly logger = new Logger(FfmpegExecutorSettingsService.name);
  private cached: CachedSettings | null = null;
  /**
   * Why this exists: a failed load also leaves `cached === null`, which is
   * indistinguishable from "no row yet". Merging a partial update onto the
   * DEFAULTS in that state would silently overwrite a real row's URL/auth/
   * default with defaults, so `update()` refuses while the state is 'error'.
   */
  private loadState: 'ok' | 'empty' | 'error' = 'empty';
  private warnedMissing = false;

  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
    private readonly capability: FfmpegCapabilityService,
    /** Test seam: the process env to read. */
    @Optional() private readonly processEnv: () => NodeJS.ProcessEnv = () => process.env,
    /** @Optional() so a hand-built service (and Plan 1's specs) need not supply one. */
    @Optional() private readonly remote?: RemoteFfmpegExecutor,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.reload();
  }

  /** DB → cache. A missing table (instance not yet migrated) or a DB error leaves the cache empty = env-only. */
  async reload(): Promise<void> {
    let row: FfmpegExecutorSettingsRow | undefined;
    try {
      // .orderBy(createdAt): with exactly one row this is a no-op, but it makes
      // "the first row" deterministic instead of whatever order Postgres happens
      // to return — matters if a stray second row ever exists (e.g. a race on
      // first insert) so reload() and persist() always agree on the same row.
      const rows = await db
        .select()
        .from(ffmpegExecutorSettings)
        .orderBy(ffmpegExecutorSettings.createdAt)
        .limit(1);
      row = rows[0];
    } catch (error) {
      if (!this.warnedMissing) {
        this.warnedMissing = true;
        this.logger.warn({
          event: 'ffmpeg_executor_settings_unavailable',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.cached = null;
      this.loadState = 'error';
      return;
    }
    this.cached = row ? this.decode(row) : null;
    this.loadState = row ? 'ok' : 'empty';
  }

  private decode(row: FfmpegExecutorSettingsRow): CachedSettings {
    let saKeyJson: string | null = null;
    if (row.saKeyEncrypted) {
      try {
        saKeyJson = decryptString(row.saKeyEncrypted);
      } catch (error) {
        this.logger.error({
          event: 'ffmpeg_executor_sa_key_undecryptable',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    // Invariant: remoteEnabled ⇒ a URL. A row without one cannot run remote work.
    const remoteUrl = normaliseUrl(row.remoteUrl);
    return {
      localEnabled: row.localEnabled,
      remoteEnabled: row.remoteEnabled && remoteUrl !== null,
      remoteUrl,
      remoteAuth: row.remoteAuth === 'none' ? 'none' : 'google_id_token',
      saKeyJson,
      defaultExecutor: row.defaultExecutor === 'remote' ? 'remote' : 'local',
    };
  }

  envManaged(): FfmpegExecutorEnvManaged {
    const env = this.processEnv();
    return {
      defaultExecutor: envSet(env, 'FFMPEG_EXECUTOR'),
      remoteUrl: envSet(env, 'FFMPEG_REMOTE_URL'),
      remoteAuth: envSet(env, 'FFMPEG_REMOTE_AUTH'),
      saKey: envSet(env, 'FFMPEG_REMOTE_SA_KEY_JSON'),
    };
  }

  /** The effective config: env over the cached DB row. Synchronous by design (executors call it per job). */
  resolved(): FfmpegEnvConfig {
    return this.resolveWith(this.cached);
  }

  /** env over `row` — the cached row for `resolved()`, a candidate row when validating a save. */
  private resolveWith(row: CachedSettings | null): FfmpegEnvConfig {
    const env = readFfmpegEnv(this.processEnv());
    if (!row) return env;
    const managed = this.envManaged();
    const remoteUrl = managed.remoteUrl ? env.remoteUrl : row.remoteUrl;
    return {
      ...env,
      localEnabled: row.localEnabled,
      remoteEnabled: managed.remoteUrl ? true : row.remoteEnabled,
      remoteUrl,
      remoteAuth: managed.remoteAuth ? env.remoteAuth : row.remoteAuth,
      remoteSaKeyJson: managed.saKey ? env.remoteSaKeyJson : row.saKeyJson,
      executor: managed.defaultExecutor ? env.executor : row.defaultExecutor,
    };
  }

  /**
   * Can a Worker fetch inputs / PUT outputs straight from storage?
   *
   * `supportsPresignedUrls()` alone is NOT enough: the local-filesystem adapter
   * also signs, but its URLs point at CE's own `/api/storage/presigned/local`
   * route (relative, and served only on the app's own domains), which a remote
   * Worker cannot use. So local is excluded explicitly — the same call
   * `deployments.controller.ts` makes for the same reason.
   */
  private storagePresignable(): boolean {
    return (
      resolveLocalAdapter(this.storageAdapter) === null &&
      this.storageAdapter.supportsPresignedUrls?.() === true &&
      typeof this.storageAdapter.getPresignedUploadUrl === 'function'
    );
  }

  async getStatus(): Promise<FfmpegExecutorStatus> {
    const cfg = this.resolved();
    const managed = this.envManaged();
    return {
      localAvailable: this.capability.isAvailable(),
      localVersion: this.capability.getVersion(),
      localEnabled: cfg.localEnabled,
      remoteEnabled: cfg.remoteEnabled,
      remoteUrl: cfg.remoteUrl,
      remoteAuth: cfg.remoteAuth,
      hasSaKey: cfg.remoteSaKeyJson !== null,
      saKeySource: cfg.remoteSaKeyJson === null ? null : managed.saKey ? 'env' : 'db',
      defaultExecutor: cfg.executor,
      storagePresignable: this.storagePresignable(),
      envManaged: managed,
    };
  }

  /**
   * Validate → upsert → reload → status. Partial: only the provided fields change.
   * `saKeyJson`: undefined keeps the stored key, null clears it, a string replaces it.
   */
  async update(input: UpdateFfmpegExecutorInput, userId?: string): Promise<FfmpegExecutorStatus> {
    if (this.loadState === 'error') {
      await this.reload();
      if (this.loadState === 'error') {
        throw new ServiceUnavailableException('Executor settings could not be loaded; try again');
      }
    }

    const managed = this.envManaged();
    if (input.remoteUrl !== undefined && managed.remoteUrl) {
      throw new BadRequestException('Worker URL is managed by FFMPEG_REMOTE_URL on this instance.');
    }
    if (input.remoteAuth !== undefined && managed.remoteAuth) {
      throw new BadRequestException('Auth mode is managed by FFMPEG_REMOTE_AUTH on this instance.');
    }
    if (input.saKeyJson !== undefined && managed.saKey) {
      throw new BadRequestException(
        'The service-account key is managed by FFMPEG_REMOTE_SA_KEY_JSON on this instance.',
      );
    }
    if (input.defaultExecutor !== undefined && managed.defaultExecutor) {
      throw new BadRequestException(
        'The default executor is managed by FFMPEG_EXECUTOR on this instance.',
      );
    }

    const current: CachedSettings = this.cached ?? {
      localEnabled: true,
      remoteEnabled: false,
      remoteUrl: null,
      remoteAuth: 'google_id_token',
      saKeyJson: null,
      defaultExecutor: 'local',
    };
    const next: CachedSettings = {
      localEnabled: input.localEnabled ?? current.localEnabled,
      remoteEnabled: input.remoteEnabled ?? current.remoteEnabled,
      remoteUrl: input.remoteUrl === undefined ? current.remoteUrl : normaliseUrl(input.remoteUrl),
      remoteAuth: input.remoteAuth ?? current.remoteAuth,
      saKeyJson: input.saKeyJson === undefined ? current.saKeyJson : input.saKeyJson,
      defaultExecutor: input.defaultExecutor ?? current.defaultExecutor,
    };

    if (
      input.remoteAuth !== undefined &&
      input.remoteAuth !== 'google_id_token' &&
      input.remoteAuth !== 'none'
    ) {
      throw new BadRequestException("Auth mode must be 'google_id_token' or 'none'.");
    }
    if (
      input.defaultExecutor !== undefined &&
      input.defaultExecutor !== 'local' &&
      input.defaultExecutor !== 'remote'
    ) {
      throw new BadRequestException("Default executor must be 'local' or 'remote'.");
    }
    if (typeof next.saKeyJson === 'string') {
      next.saKeyJson = next.saKeyJson.trim();
    }
    // A blanked-out UI field means "remove the key", not "here is invalid JSON".
    if (next.saKeyJson === '') next.saKeyJson = null;
    if (typeof next.saKeyJson === 'string') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(next.saKeyJson);
      } catch {
        throw new BadRequestException('Service-account key must be valid JSON.');
      }
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        (parsed as { type?: unknown }).type !== 'service_account'
      ) {
        throw new BadRequestException(
          'Service-account key must be a Google service-account JSON key ("type": "service_account").',
        );
      }
    }

    // Validate the EFFECTIVE config (env pins applied) so a save can never leave the
    // instance in a state the selector would refuse.
    const effective = this.resolveWith(next);
    if (effective.remoteEnabled) {
      if (!effective.remoteUrl)
        throw new BadRequestException('Remote executor needs a Worker URL.');
      let url: URL;
      try {
        url = new URL(effective.remoteUrl);
      } catch {
        throw new BadRequestException(`Worker URL is not a valid URL: ${effective.remoteUrl}`);
      }
      if (effective.remoteAuth !== 'none' && url.protocol !== 'https:') {
        throw new BadRequestException(
          'Worker URL must be https:// when auth is Google ID token (use auth "none" only on a private network).',
        );
      }
      // Only when THIS save turns Remote on: an env-pinned FFMPEG_REMOTE_URL on
      // local-FS storage must not make every unrelated save (e.g. toggling
      // localEnabled) fail. `storagePresignable` is reported in status either way.
      const turningRemoteOn =
        input.remoteEnabled === true || (next.remoteEnabled && !current.remoteEnabled);
      if (turningRemoteOn && !this.storagePresignable()) {
        throw new BadRequestException(
          'Remote executor needs bucket storage (S3, GCS, MinIO or Azure) — the Worker fetches inputs and uploads outputs via signed URLs, which local filesystem storage cannot provide.',
        );
      }
    }
    const enabled: FfmpegExecutorSetting[] = [];
    if (this.capability.isAvailable() && effective.localEnabled) enabled.push('local');
    if (effective.remoteEnabled && effective.remoteUrl) enabled.push('remote');
    if (!enabled.includes(effective.executor)) {
      throw new BadRequestException(
        enabled.length === 0
          ? 'At least one executor must be enabled (Local needs ffmpeg installed on this server; Remote needs a Worker URL).'
          : `Default executor '${effective.executor}' is not enabled — pick one of: ${enabled.join(', ')}.`,
      );
    }

    await this.persist(next, input.saKeyJson !== undefined, userId);
    await this.reload();
    return this.getStatus();
  }

  /**
   * Uncached "Test connection" for the admin UI. `draft` is the unsaved form; env-managed
   * fields are ignored (env wins). Reports both the raw /healthz answer and what the
   * selector's readiness check says about the same config, so the UI can show
   * "reachable but not usable" (e.g. version too old, storage not presignable).
   */
  async testConnection(draft: FfmpegExecutorTestDraft = {}): Promise<FfmpegExecutorTestResult> {
    if (!this.remote) throw new InternalServerErrorException('Remote executor is not wired.');
    const managed = this.envManaged();
    const overrides: Partial<
      Pick<FfmpegEnvConfig, 'remoteUrl' | 'remoteAuth' | 'remoteSaKeyJson'>
    > = {};
    if (draft.remoteUrl !== undefined && !managed.remoteUrl)
      overrides.remoteUrl = normaliseUrl(draft.remoteUrl);
    if (draft.remoteAuth !== undefined && !managed.remoteAuth)
      overrides.remoteAuth = draft.remoteAuth;
    if (draft.saKeyJson !== undefined && !managed.saKey)
      overrides.remoteSaKeyJson = draft.saKeyJson === null ? null : draft.saKeyJson.trim();

    const effective: FfmpegEnvConfig = { ...this.resolved(), ...overrides };
    const credential: FfmpegExecutorTestResult['credential'] =
      effective.remoteAuth === 'none' ? 'none' : effective.remoteSaKeyJson ? 'sa_key' : 'adc';

    // Validate the EFFECTIVE key — a pasted draft key OR an env-pinned
    // FFMPEG_REMOTE_SA_KEY_JSON, whichever `effective` ends up with — not just
    // the draft's. Deeper down the key is JSON.parse'd inside the token minter,
    // and V8's SyntaxError quotes the offending input, which would put
    // service-account bytes (draft- or env-sourced) into the response. Caught
    // here instead, through the button's one error channel, with `update()`'s
    // wording, before the executor is ever called.
    if (effective.remoteAuth === 'google_id_token' && effective.remoteSaKeyJson) {
      try {
        JSON.parse(effective.remoteSaKeyJson);
      } catch {
        const reason = 'Service-account key must be valid JSON.';
        return {
          ok: false,
          latencyMs: null,
          error: reason,
          readiness: { ok: false, reason },
          credential,
        };
      }
    }

    let worker: FfmpegExecutorTestResult['worker'];
    let error: string | undefined;
    let latencyMs: number | null = null;
    const t0 = Date.now();
    try {
      const health = await this.remote.testConnection(overrides);
      latencyMs = Date.now() - t0;
      worker = {
        version: health.version,
        ffmpeg: health.ffmpeg,
        ops: health.ops,
        uptimeS: health.uptimeS,
      };
      if (!health.ok) error = 'worker reports not ok (no ffmpeg binary?)';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const readiness = await this.remote.ready({ fresh: true, env: effective });
    return {
      ok: !error && readiness.ok,
      latencyMs,
      ...(worker ? { worker } : {}),
      ...(error ? { error } : {}),
      readiness: { ok: readiness.ok, ...(readiness.reason ? { reason: readiness.reason } : {}) },
      credential,
    };
  }

  private async persist(next: CachedSettings, keyChanged: boolean, userId?: string): Promise<void> {
    const base = {
      localEnabled: next.localEnabled,
      remoteEnabled: next.remoteEnabled,
      remoteUrl: next.remoteUrl,
      remoteAuth: next.remoteAuth,
      defaultExecutor: next.defaultExecutor,
      updatedAt: new Date(),
      updatedByUserId: userId ?? null,
    };
    try {
      // undefined = the key was not part of this save, so the stored one is
      // preserved. Computed INSIDE the try: encryptString() throws on a bad/
      // missing ENCRYPTION_KEY, and that failure must surface through the same
      // shaped InternalServerErrorException as every other persist failure,
      // not as a raw crypto error.
      const encrypted = keyChanged
        ? next.saKeyJson === null
          ? null
          : encryptString(next.saKeyJson)
        : undefined;
      const existing = (
        await db
          .select()
          .from(ffmpegExecutorSettings)
          .orderBy(ffmpegExecutorSettings.createdAt)
          .limit(1)
      )[0];
      if (existing) {
        await db
          .update(ffmpegExecutorSettings)
          .set({ ...base, ...(encrypted !== undefined ? { saKeyEncrypted: encrypted } : {}) })
          .where(eq(ffmpegExecutorSettings.id, existing.id));
      } else {
        // Insert: there is no stored key to preserve, so "not provided" = none.
        await db
          .insert(ffmpegExecutorSettings)
          .values({ ...base, saKeyEncrypted: encrypted ?? null });
      }
    } catch (error) {
      this.logger.error({
        event: 'ffmpeg_executor_settings_persist_failed',
        error: error instanceof Error ? error.message : String(error),
      });
      throw new InternalServerErrorException('Failed to save executor settings.');
    }
  }
}
