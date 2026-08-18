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
import { RemoteConnectionsService } from '../../remote-connections/remote-connections.service';
import type { ResolvedConnection } from '../../remote-connections/remote-connections.types';
import { resolveLocalAdapter } from '../../storage/local.adapter';
import { IStorageAdapter, STORAGE_ADAPTER } from '../../storage/storage.interface';
import { FfmpegCapabilityService } from './ffmpeg-capability.service';
import { RemoteFfmpegExecutor } from './executor/remote/remote-ffmpeg.executor';
import { readFfmpegEnv, type FfmpegEnvConfig, type FfmpegExecutorSetting } from './ffmpeg-env';

export interface FfmpegExecutorEnvManaged {
  defaultExecutor: boolean;
  /** FFMPEG_REMOTE_CONNECTION, or the legacy FFMPEG_REMOTE_URL that implies the `ffmpeg` connection. */
  remoteConnection: boolean;
}

/** One row of the connection dropdown. */
export interface FfmpegExecutorConnectionOption {
  /** null for an env-only connection: there is no row to point the FK at. */
  id: string | null;
  name: string;
  auth: string;
  envOnly: boolean;
}

/** What the admin UI renders. The connection's credential itself is NEVER part of this. */
export interface FfmpegExecutorStatus {
  localAvailable: boolean;
  localVersion: string | null;
  localEnabled: boolean;
  remoteEnabled: boolean;
  /** The connection the Remote executor calls, or null when none is selected/resolvable. */
  remoteConnection: {
    id: string | null;
    name: string;
    url: string;
    auth: string;
    hasCredential: boolean;
    credentialSource: 'db' | 'env' | null;
    envOnly: boolean;
  } | null;
  connections: FfmpegExecutorConnectionOption[];
  defaultExecutor: FfmpegExecutorSetting;
  /** false on the local-FS adapter: a Worker cannot fetch CE-relative URLs (D3), so Remote cannot be enabled. */
  storagePresignable: boolean;
  envManaged: FfmpegExecutorEnvManaged;
}

export interface UpdateFfmpegExecutorInput {
  localEnabled?: boolean;
  remoteEnabled?: boolean;
  /** A remote connection NAME (undefined = keep, null = clear). Must be a DB-backed connection. */
  remoteConnection?: string | null;
  defaultExecutor?: FfmpegExecutorSetting;
}

/** The unsaved admin form a "Test connection" is run against. */
export interface FfmpegExecutorTestDraft {
  remoteConnection?: string;
}

/** What the admin UI shows after a "Test connection". The credential is never part of it. */
export interface FfmpegExecutorTestResult {
  ok: boolean;
  latencyMs: number | null;
  worker?: { version: string; ffmpeg: string | null; ops: string[]; uptimeS: number };
  error?: string;
  readiness: { ok: boolean; reason?: string };
  credential: 'sa_key' | 'adc' | 'none';
}

/** The in-memory shape of the DB row. */
interface CachedSettings {
  localEnabled: boolean;
  remoteEnabled: boolean;
  /** FK into remote_connections (Plan 4). The URL/auth/credential live there. */
  remoteConnectionId: string | null;
  defaultExecutor: FfmpegExecutorSetting;
}

/** '' counts as unset — compose passthrough materialises unconfigured vars as ''. */
function envSet(env: NodeJS.ProcessEnv, key: string): boolean {
  return (env[key] ?? '').trim() !== '';
}

/**
 * Admin-editable executor configuration (spec §1.5). One DB row, read into memory
 * at boot and after every save so the executors can read it SYNCHRONOUSLY through
 * `resolved()` — the same `FfmpegEnvConfig` shape `readFfmpegEnv()` returns.
 *
 * Since Plan 4 the row no longer holds a URL/auth/key: it points at a
 * `remote_connections` row, and `resolved()` DERIVES `remoteUrl` / `remoteAuth` /
 * `remoteSaKeyJson` / `remoteMaxInflight` from the connection
 * `RemoteConnectionsService` resolves (which applies its own
 * `REMOTE_CONNECTION_<NAME>_*` env pins on top). Env still wins here for WHICH
 * connection is used (FFMPEG_REMOTE_CONNECTION, or the legacy FFMPEG_REMOTE_URL
 * that implies the connection named `ffmpeg`) and for the default executor
 * (FFMPEG_EXECUTOR). CE runs one backend process per instance, so an in-process
 * cache refreshed on write is sufficient.
 */
@Injectable()
export class FfmpegExecutorSettingsService implements OnModuleInit {
  private readonly logger = new Logger(FfmpegExecutorSettingsService.name);
  private cached: CachedSettings | null = null;
  /**
   * Why this exists: a failed load also leaves `cached === null`, which is
   * indistinguishable from "no row yet". Merging a partial update onto the
   * DEFAULTS in that state would silently overwrite a real row's connection/
   * default with defaults, so `update()` refuses while the state is 'error'.
   */
  private loadState: 'ok' | 'empty' | 'error' = 'empty';
  private warnedMissing = false;

  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
    private readonly capability: FfmpegCapabilityService,
    /**
     * Injected directly (not through a lazy token): RemoteConnectionsModule
     * depends on nothing in pipelines/, so this edge closes no cycle. The
     * EXECUTORS still read their config through the lazy FFMPEG_CONFIG tokens.
     */
    private readonly connections: RemoteConnectionsService,
    /** Test seam: the process env to read. */
    @Optional() private readonly processEnv: () => NodeJS.ProcessEnv = () => process.env,
    /** @Optional() so a hand-built service (and Plan 1's specs) need not supply one. */
    @Optional() private readonly remote?: RemoteFfmpegExecutor,
  ) {}

  async onModuleInit(): Promise<void> {
    // Before the test-env bail-out: the connections admin UI must be able to say
    // "in use by the ffmpeg Remote executor" even on an instance that never loads.
    this.registerUsage();
    if (process.env.NODE_ENV === 'test') return;
    await this.reload();
  }

  /**
   * Tell RemoteConnectionsService which connection the Remote executor is on, so
   * a delete can be refused. Registered rather than imported — the connections
   * service must not depend on pipelines/ (module cycle).
   */
  registerUsage(): void {
    this.connections.registerUsageProbe(
      'ffmpegExecutor',
      (name) => this.resolved().remoteConnection === name,
    );
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
    return {
      localEnabled: row.localEnabled,
      remoteEnabled: row.remoteEnabled,
      remoteConnectionId: row.remoteConnectionId ?? null,
      defaultExecutor: row.defaultExecutor === 'remote' ? 'remote' : 'local',
    };
  }

  envManaged(): FfmpegExecutorEnvManaged {
    const env = this.processEnv();
    return {
      defaultExecutor: envSet(env, 'FFMPEG_EXECUTOR'),
      // The legacy var is an alias for "the connection named ffmpeg" (ffmpeg-env.ts).
      remoteConnection: envSet(env, 'FFMPEG_REMOTE_CONNECTION') || envSet(env, 'FFMPEG_REMOTE_URL'),
    };
  }

  /** The effective config: the selected connection over env. Synchronous by design (executors call it per job). */
  resolved(): FfmpegEnvConfig {
    return this.resolveWith(this.cached);
  }

  /**
   * The connection `row` would use: the env-pinned name when one is set, else the
   * row's FK resolved back to a name. null = nothing selected, or the selection
   * no longer resolves (deleted connection, unknown env name).
   */
  private connectionFor(row: CachedSettings | null): ResolvedConnection | null {
    const managed = this.envManaged();
    const name = managed.remoteConnection
      ? readFfmpegEnv(this.processEnv()).remoteConnection
      : row?.remoteConnectionId
        ? (this.connections.byId(row.remoteConnectionId)?.name ?? null)
        : null;
    return name ? this.connections.resolve(name) : null;
  }

  /** env + connection over `row` — the cached row for `resolved()`, a candidate row when validating a save. */
  private resolveWith(row: CachedSettings | null): FfmpegEnvConfig {
    const env = readFfmpegEnv(this.processEnv());
    const managed = this.envManaged();
    const conn = this.connectionFor(row);
    return {
      ...env,
      localEnabled: row?.localEnabled ?? true,
      executor: managed.defaultExecutor ? env.executor : (row?.defaultExecutor ?? env.executor),
      remoteConnection: conn?.name ?? null,
      // No connection = nothing to call, whatever the row or the env says.
      remoteEnabled:
        conn !== null && (managed.remoteConnection ? true : (row?.remoteEnabled ?? false)),
      remoteUrl: conn?.url ?? null,
      remoteAuth: conn?.auth === 'none' ? 'none' : 'google_id_token',
      remoteSaKeyJson: conn?.credential ?? null,
      remoteMaxInflight: conn?.maxInflight ?? env.remoteMaxInflight,
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
    const conn = this.connectionFor(this.cached);
    return {
      localAvailable: this.capability.isAvailable(),
      localVersion: this.capability.getVersion(),
      localEnabled: cfg.localEnabled,
      remoteEnabled: cfg.remoteEnabled,
      remoteConnection: conn
        ? {
            id: conn.id,
            name: conn.name,
            url: conn.url,
            auth: conn.auth,
            hasCredential: conn.credential !== null,
            credentialSource: conn.source.credential,
            envOnly: conn.source.envOnly,
          }
        : null,
      connections: this.connections.list().map((c) => ({
        id: c.id,
        name: c.name,
        auth: c.auth,
        envOnly: c.source.envOnly,
      })),
      defaultExecutor: cfg.executor,
      storagePresignable: this.storagePresignable(),
      envManaged: managed,
    };
  }

  /**
   * Validate → upsert → reload → status. Partial: only the provided fields change.
   * `remoteConnection` is a connection NAME (undefined keeps the selection, null clears it).
   */
  async update(input: UpdateFfmpegExecutorInput, userId?: string): Promise<FfmpegExecutorStatus> {
    if (this.loadState === 'error') {
      await this.reload();
      if (this.loadState === 'error') {
        throw new ServiceUnavailableException('Executor settings could not be loaded; try again');
      }
    }

    const managed = this.envManaged();
    if (input.remoteConnection !== undefined && managed.remoteConnection) {
      throw new BadRequestException(
        'The remote connection is managed by FFMPEG_REMOTE_CONNECTION / FFMPEG_REMOTE_URL on this instance.',
      );
    }
    if (input.defaultExecutor !== undefined && managed.defaultExecutor) {
      throw new BadRequestException(
        'The default executor is managed by FFMPEG_EXECUTOR on this instance.',
      );
    }
    if (
      input.defaultExecutor !== undefined &&
      input.defaultExecutor !== 'local' &&
      input.defaultExecutor !== 'remote'
    ) {
      throw new BadRequestException("Default executor must be 'local' or 'remote'.");
    }

    // A NAME is what the UI sends; the FK is what we store. An env-only
    // connection has no row to point at, so it can only be selected from env.
    let remoteConnectionId: string | null | undefined;
    if (input.remoteConnection !== undefined) {
      if (input.remoteConnection === null) {
        remoteConnectionId = null;
      } else {
        const picked = this.connections.resolve(input.remoteConnection);
        if (!picked) {
          throw new BadRequestException(`Unknown remote connection '${input.remoteConnection}'.`);
        }
        if (picked.id === null) {
          throw new BadRequestException(
            `'${picked.name}' is defined by environment variables only and has no saved connection to select — select it with FFMPEG_REMOTE_CONNECTION instead.`,
          );
        }
        remoteConnectionId = picked.id;
      }
    }

    const current: CachedSettings = this.cached ?? {
      localEnabled: true,
      remoteEnabled: false,
      remoteConnectionId: null,
      defaultExecutor: 'local',
    };
    const next: CachedSettings = {
      localEnabled: input.localEnabled ?? current.localEnabled,
      remoteEnabled: input.remoteEnabled ?? current.remoteEnabled,
      remoteConnectionId:
        remoteConnectionId === undefined ? current.remoteConnectionId : remoteConnectionId,
      defaultExecutor: input.defaultExecutor ?? current.defaultExecutor,
    };

    const conn = this.connectionFor(next);
    if (!managed.remoteConnection && next.remoteEnabled && conn === null) {
      // A save that ASKS for Remote gets a refusal it can act on; a save that
      // merely inherited a stale selection (the connection was deleted under it)
      // heals instead of blocking every unrelated edit.
      if (input.remoteEnabled === true || input.remoteConnection !== undefined) {
        throw new BadRequestException(
          'Remote executor needs a connection — create one under Admin Settings → Remote connections and select it here.',
        );
      }
      next.remoteEnabled = false;
    }

    // Validate the EFFECTIVE config (env pins applied) so a save can never leave the
    // instance in a state the selector would refuse.
    const effective = this.resolveWith(next);
    if (effective.remoteEnabled) {
      // Only when THIS save turns Remote on: an env-pinned connection on
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
    if (effective.remoteEnabled) enabled.push('remote');
    if (!enabled.includes(effective.executor)) {
      throw new BadRequestException(
        enabled.length === 0
          ? 'At least one executor must be enabled (Local needs ffmpeg installed on this server; Remote needs a remote connection).'
          : `Default executor '${effective.executor}' is not enabled — pick one of: ${enabled.join(', ')}.`,
      );
    }

    await this.persist(next, userId);
    await this.reload();
    return this.getStatus();
  }

  /**
   * Uncached "Test connection" for the admin UI. `draft.remoteConnection` is the
   * connection the unsaved form has picked; an env-pinned selection ignores it
   * (env wins). Reports both the raw /health answer and what the selector's
   * readiness check says about the same config, so the UI can show "reachable
   * but not usable" (e.g. version too old, storage not presignable).
   */
  async testConnection(draft: FfmpegExecutorTestDraft = {}): Promise<FfmpegExecutorTestResult> {
    if (!this.remote) throw new InternalServerErrorException('Remote executor is not wired.');
    const managed = this.envManaged();
    const overrides: Partial<
      Pick<FfmpegEnvConfig, 'remoteUrl' | 'remoteAuth' | 'remoteSaKeyJson'>
    > = {};
    if (draft.remoteConnection !== undefined && !managed.remoteConnection) {
      const picked = this.connections.resolve(draft.remoteConnection);
      if (!picked) {
        throw new BadRequestException(`Unknown remote connection '${draft.remoteConnection}'.`);
      }
      overrides.remoteUrl = picked.url;
      overrides.remoteAuth = picked.auth === 'none' ? 'none' : 'google_id_token';
      overrides.remoteSaKeyJson = picked.credential;
    }

    const effective: FfmpegEnvConfig = { ...this.resolved(), ...overrides };
    const credential: FfmpegExecutorTestResult['credential'] =
      effective.remoteAuth === 'none' ? 'none' : effective.remoteSaKeyJson ? 'sa_key' : 'adc';

    // Validate the EFFECTIVE credential before the executor is ever called.
    // Deeper down it is JSON.parse'd inside the token minter, and V8's
    // SyntaxError quotes the offending input, which would put service-account
    // bytes into the response. Caught here instead, through the button's one
    // error channel.
    if (effective.remoteAuth === 'google_id_token' && effective.remoteSaKeyJson) {
      try {
        JSON.parse(effective.remoteSaKeyJson);
      } catch {
        const reason = 'The connection credential must be valid JSON.';
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

  private async persist(next: CachedSettings, userId?: string): Promise<void> {
    const base = {
      localEnabled: next.localEnabled,
      remoteEnabled: next.remoteEnabled,
      remoteConnectionId: next.remoteConnectionId,
      defaultExecutor: next.defaultExecutor,
      updatedAt: new Date(),
      updatedByUserId: userId ?? null,
    };
    try {
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
          .set(base)
          .where(eq(ffmpegExecutorSettings.id, existing.id));
      } else {
        await db.insert(ffmpegExecutorSettings).values(base);
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
