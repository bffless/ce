import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { remoteConnections, type RemoteConnectionRow } from '../db/schema';
import { decryptString, encryptString } from '../common/crypto/aes-gcm';
import { InflightFuse } from './fuse';
import { RemoteClient, authProviderFor } from './remote-client';
import { readRemoteConnectionsEnv, type EnvConnectionFields } from './remote-connections-env';
import {
  envNameFor,
  isValidConnectionName,
  type FieldSource,
  type ResolvedConnection,
} from './remote-connections.types';

/** What the admin UI gets for one connection. The credential itself is NEVER part of it. */
export interface RemoteConnectionStatus {
  /** null for an env-only connection (no DB row → nothing to edit or delete). */
  id: string | null;
  name: string;
  url: string;
  auth: string;
  hasCredential: boolean;
  maxInflight: number;
  healthPath: string | null;
  source: ResolvedConnection['source'];
  envOnly: boolean;
  usedBy: { ffmpegExecutor: boolean; rules: number };
}

export interface UpsertRemoteConnectionInput {
  name?: string;
  url?: string;
  auth?: string;
  /** undefined = keep the stored credential; null (or a blanked field) = clear it; string = replace it. */
  credential?: string | null;
  maxInflight?: number;
  healthPath?: string | null;
}

/** The unsaved admin form a "Test connection" runs against. */
export interface RemoteConnectionTestDraft {
  /** Fall back to this stored connection for anything the draft omits (esp. the credential). */
  id?: string;
  name?: string;
  url?: string;
  auth?: string;
  credential?: string | null;
  healthPath?: string | null;
}

export interface RemoteConnectionTestResult {
  ok: boolean;
  status: number | null;
  latencyMs: number | null;
  version?: string;
  error?: string;
  credential: 'sa_key' | 'adc' | 'none';
}

/** "Does anything still point at this connection?" — registered by the owner (avoids a module cycle). */
export type UsageProbe = (connectionName: string) => boolean;

/** The decrypted, in-memory shape of a DB row. */
interface DecodedRow {
  id: string;
  name: string;
  url: string;
  auth: string;
  credential: string | null;
  maxInflight: number;
  healthPath: string | null;
}

const DEFAULT_AUTH = 'google_id_token';
const DEFAULT_MAX_INFLIGHT = 8;
const DEFAULT_HEALTH_PATH = '/health';
const MAX_INFLIGHT_CEILING = 64;
/** Auth modes this release can actually sign a request with (spec D6). */
const SUPPORTED_AUTH = new Set(['google_id_token', 'none']);

/** Trim + strip a trailing slash — the same normalisation the env reader applies. */
function normaliseUrl(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

/** '' / whitespace = "no path", i.e. no probe. Anything else is rooted at '/'. */
function normaliseHealthPath(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/** Which env var pins a field, for the "managed by …" refusal. */
const ENV_SUFFIX: Record<keyof EnvConnectionFields, string> = {
  url: 'URL',
  auth: 'AUTH',
  credential: 'CREDENTIAL_JSON',
  maxInflight: 'MAX_INFLIGHT',
  healthPath: 'HEALTH_PATH',
};
const FIELD_LABEL: Record<keyof EnvConnectionFields, string> = {
  url: 'The URL',
  auth: 'The auth mode',
  credential: 'The credential',
  maxInflight: 'The in-flight cap',
  healthPath: 'The health path',
};
/** Plan-1/2 aliases, named in the refusal so an admin can find the var actually set. */
const LEGACY_FFMPEG_VAR: Partial<Record<keyof EnvConnectionFields, string>> = {
  url: 'FFMPEG_REMOTE_URL',
  auth: 'FFMPEG_REMOTE_AUTH',
  credential: 'FFMPEG_REMOTE_SA_KEY_JSON',
  maxInflight: 'FFMPEG_REMOTE_MAX_INFLIGHT',
};

/**
 * Instance-level remote connections (spec §2.1): the DB rows decrypted into an
 * in-memory cache at boot and after every write, with
 * `REMOTE_CONNECTION_<NAME>_*` env vars applied per field on top, so callers can
 * `resolve(name)` SYNCHRONOUSLY on every request. CE runs one backend process
 * per instance, so an in-process cache refreshed on write is sufficient.
 *
 * The credential is write-only: it lives decrypted in this cache and in the
 * `RemoteClient`s built from it, and never appears in a status, a test result,
 * a log line or an error message.
 *
 * This service must not import anything from `pipelines/` — the ffmpeg executor
 * settings depend on it, not the reverse.
 */
@Injectable()
export class RemoteConnectionsService implements OnModuleInit {
  private readonly logger = new Logger(RemoteConnectionsService.name);
  /** One shared in-flight counter per connection name (spec D5). */
  readonly fuse = new InflightFuse();
  private rows: DecodedRow[] = [];
  /**
   * Why this exists: a failed load also leaves `rows` empty, which is
   * indistinguishable from "no connections yet". Writing in that state would
   * insert duplicates (the uniqueness check would see nothing) or update a row
   * merged onto defaults, so `create()`/`update()` refuse while it is 'error'.
   */
  private loadState: 'ok' | 'empty' | 'error' = 'empty';
  private warnedMissing = false;
  private readonly clients = new Map<string, { fingerprint: string; client: RemoteClient }>();
  private readonly usageProbes = new Map<string, UsageProbe>();

  constructor(
    /** Test seam: the process env to read. */
    @Optional() private readonly processEnv: () => NodeJS.ProcessEnv = () => process.env,
    /** Test seam: how a resolved connection becomes a transport. */
    @Optional()
    private readonly clientFactory: (conn: ResolvedConnection) => RemoteClient = (conn) =>
      new RemoteClient(conn.url, authProviderFor(conn.auth, conn.credential)),
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.reload();
  }

  /** DB → cache. A missing table (instance not yet migrated) or a DB error leaves env-only connections working. */
  async reload(): Promise<void> {
    let rows: RemoteConnectionRow[];
    try {
      rows = await db.select().from(remoteConnections).orderBy(remoteConnections.name);
    } catch (error) {
      if (!this.warnedMissing) {
        this.warnedMissing = true;
        this.logger.warn({
          event: 'remote_connections_unavailable',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.rows = [];
      this.loadState = 'error';
      return;
    }
    this.rows = rows.map((row) => this.decode(row));
    this.loadState = rows.length > 0 ? 'ok' : 'empty';
  }

  private decode(row: RemoteConnectionRow): DecodedRow {
    let credential: string | null = null;
    if (row.credentialEncrypted) {
      try {
        credential = decryptString(row.credentialEncrypted);
      } catch (error) {
        // A wrong/rotated ENCRYPTION_KEY must not take the whole list down: the
        // connection stays visible (and ADC may still work), just without a key.
        this.logger.error({
          event: 'remote_connection_credential_undecryptable',
          connection: row.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      auth: row.auth,
      credential,
      maxInflight: row.maxInflight,
      healthPath: row.healthPath,
    };
  }

  private envFields(): Map<string, EnvConnectionFields> {
    return readRemoteConnectionsEnv(this.processEnv());
  }

  /** env over DB, field by field, recording where each value came from. */
  private merge(
    row: DecodedRow | null,
    name: string,
    env: EnvConnectionFields | undefined,
  ): ResolvedConnection | null {
    // An env-only connection needs at least a URL — there is nothing to call otherwise.
    if (!row && (!env || env.url === undefined)) return null;
    // `auth` is a free string in the DB but a narrow union in the env reader, so
    // the field key and the value type are independent here.
    const pick = <T>(
      field: keyof EnvConnectionFields,
      dbValue: T | null,
      fallback: T | null,
    ): { value: T | null; source: FieldSource } =>
      env && env[field] !== undefined
        ? { value: env[field] as T, source: 'env' }
        : { value: row ? dbValue : fallback, source: 'db' };

    const url = pick('url', row?.url ?? null, null);
    const auth = pick('auth', row?.auth ?? null, DEFAULT_AUTH);
    const credential = pick('credential', row?.credential ?? null, null);
    const maxInflight = pick('maxInflight', row?.maxInflight ?? null, DEFAULT_MAX_INFLIGHT);
    const healthPath = pick('healthPath', row?.healthPath ?? null, DEFAULT_HEALTH_PATH);

    return {
      id: row?.id ?? null,
      name,
      url: url.value ?? '',
      auth: auth.value ?? DEFAULT_AUTH,
      credential: credential.value ?? null,
      maxInflight: maxInflight.value ?? DEFAULT_MAX_INFLIGHT,
      healthPath: healthPath.value,
      source: {
        url: url.source,
        auth: auth.source,
        // No credential = no source to report.
        credential: credential.value === null ? null : credential.source,
        maxInflight: maxInflight.source,
        healthPath: healthPath.source,
        envOnly: !row,
      },
    };
  }

  /** DB rows (env applied) ∪ env-only names, by name. Synchronous by design. */
  list(): ResolvedConnection[] {
    const env = this.envFields();
    const out = new Map<string, ResolvedConnection>();
    for (const row of this.rows) {
      const conn = this.merge(row, row.name, env.get(row.name));
      if (conn) out.set(row.name, conn);
    }
    for (const [name, fields] of env) {
      if (out.has(name)) continue;
      const conn = this.merge(null, name, fields);
      if (conn) out.set(name, conn);
    }
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  resolve(name: string): ResolvedConnection | null {
    return this.list().find((conn) => conn.name === name) ?? null;
  }

  byId(id: string): ResolvedConnection | null {
    return this.list().find((conn) => conn.id === id) ?? null;
  }

  /**
   * The transport for a connection, memoised per name AND config fingerprint so
   * an admin edit (new URL, rotated key) invalidates the cached token minter
   * without a restart.
   */
  client(conn: ResolvedConnection): RemoteClient {
    const fingerprint = [conn.url, conn.auth, conn.credential ?? ''].join('|');
    const hit = this.clients.get(conn.name);
    if (hit && hit.fingerprint === fingerprint) return hit.client;
    const client = this.clientFactory(conn);
    this.clients.set(conn.name, { fingerprint, client });
    return client;
  }

  /** The ffmpeg settings service registers itself here rather than being imported (no module cycle). */
  registerUsageProbe(kind: 'ffmpegExecutor', probe: UsageProbe): void {
    this.usageProbes.set(kind, probe);
  }

  async status(): Promise<RemoteConnectionStatus[]> {
    return Promise.all(this.list().map((conn) => this.toStatus(conn)));
  }

  private async toStatus(conn: ResolvedConnection): Promise<RemoteConnectionStatus> {
    return {
      id: conn.id,
      name: conn.name,
      url: conn.url,
      auth: conn.auth,
      hasCredential: conn.credential !== null,
      maxInflight: conn.maxInflight,
      healthPath: conn.healthPath,
      source: conn.source,
      envOnly: conn.source.envOnly,
      usedBy: {
        ffmpegExecutor: this.usageProbes.get('ffmpegExecutor')?.(conn.name) ?? false,
        rules: await this.rulesUsing(conn.name),
      },
    };
  }

  /**
   * Best-effort "how many rules name this connection". A text LIKE over the
   * pipeline configs is deliberate: it is a UI warning, not a delete block, and
   * must never fail a listing — any error (unmigrated table, bad plan) counts 0.
   */
  private async rulesUsing(name: string): Promise<number> {
    try {
      const needle = `%"connection":"${name}"%`;
      const result = await db.execute(
        sql`select count(*)::int as n from proxy_rules where pipeline_config::text like ${needle}`,
      );
      const first = Array.from(result as Iterable<{ n?: number | string }>)[0];
      const n = Number(first?.n ?? 0);
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }

  async create(
    input: UpsertRemoteConnectionInput,
    userId?: string,
  ): Promise<RemoteConnectionStatus> {
    await this.assertLoaded();
    const name = (input.name ?? '').trim();
    if (!isValidConnectionName(name)) {
      throw new BadRequestException(
        'Connection name must be lower-case letters, numbers and dashes, starting with a letter or number (max 64 characters).',
      );
    }
    if (this.rows.some((row) => row.name === name)) {
      throw new BadRequestException(`A connection named '${name}' already exists.`);
    }
    const next: DecodedRow = {
      id: '',
      name,
      url: normaliseUrl(input.url ?? ''),
      auth: input.auth ?? DEFAULT_AUTH,
      credential: this.normaliseCredential(input.credential ?? null),
      maxInflight: input.maxInflight ?? DEFAULT_MAX_INFLIGHT,
      healthPath:
        input.healthPath === undefined
          ? DEFAULT_HEALTH_PATH
          : normaliseHealthPath(input.healthPath),
    };
    this.validate(next);

    try {
      await db
        .insert(remoteConnections)
        .values({
          name: next.name,
          url: next.url,
          auth: next.auth,
          credentialEncrypted: next.credential === null ? null : encryptString(next.credential),
          maxInflight: next.maxInflight,
          healthPath: next.healthPath,
          updatedAt: new Date(),
          updatedByUserId: userId ?? null,
        })
        .returning();
    } catch (error) {
      this.persistFailed(error);
    }
    await this.reload();
    return this.statusOf(next.name);
  }

  async update(
    id: string,
    input: UpsertRemoteConnectionInput,
    userId?: string,
  ): Promise<RemoteConnectionStatus> {
    await this.assertLoaded();
    const current = this.rows.find((row) => row.id === id);
    if (!current) throw new NotFoundException('Remote connection not found.');
    this.assertNotEnvManaged(current.name, input);

    const name = input.name === undefined ? current.name : input.name.trim();
    if (name !== current.name) {
      if (!isValidConnectionName(name)) {
        throw new BadRequestException(
          'Connection name must be lower-case letters, numbers and dashes, starting with a letter or number (max 64 characters).',
        );
      }
      if (this.rows.some((row) => row.name === name)) {
        throw new BadRequestException(`A connection named '${name}' already exists.`);
      }
      // The env vars are keyed BY NAME: renaming a pinned connection would leave
      // them behind as a second, env-only connection under the old name, and
      // silently unpin every field on this row.
      if (this.envFields().has(current.name)) {
        throw new BadRequestException(
          `'${current.name}' has fields managed by REMOTE_CONNECTION_${envNameFor(current.name)}_* on this instance and cannot be renamed.`,
        );
      }
    }
    const credentialChanged = input.credential !== undefined;
    const next: DecodedRow = {
      id: current.id,
      name,
      url: input.url === undefined ? current.url : normaliseUrl(input.url),
      auth: input.auth ?? current.auth,
      credential: credentialChanged
        ? this.normaliseCredential(input.credential ?? null)
        : current.credential,
      maxInflight: input.maxInflight ?? current.maxInflight,
      healthPath:
        input.healthPath === undefined ? current.healthPath : normaliseHealthPath(input.healthPath),
    };
    this.validate(next);

    try {
      await db
        .update(remoteConnections)
        .set({
          name: next.name,
          url: next.url,
          auth: next.auth,
          // Absent when the credential was not part of this save, so the stored one survives.
          ...(credentialChanged
            ? {
                credentialEncrypted:
                  next.credential === null ? null : encryptString(next.credential),
              }
            : {}),
          maxInflight: next.maxInflight,
          healthPath: next.healthPath,
          updatedAt: new Date(),
          updatedByUserId: userId ?? null,
        })
        .where(eq(remoteConnections.id, id))
        .returning();
    } catch (error) {
      this.persistFailed(error);
    }
    await this.reload();
    return this.statusOf(next.name);
  }

  async remove(id: string): Promise<void> {
    await this.assertLoaded();
    const current = this.rows.find((row) => row.id === id);
    if (!current) throw new NotFoundException('Remote connection not found.');
    if (this.usageProbes.get('ffmpegExecutor')?.(current.name)) {
      throw new ConflictException(
        'in use by the ffmpeg Remote executor — pick another connection there first',
      );
    }
    try {
      await db.delete(remoteConnections).where(eq(remoteConnections.id, id));
    } catch (error) {
      this.persistFailed(error);
    }
    this.clients.delete(current.name);
    await this.reload();
  }

  /**
   * Uncached "Test connection" for the admin UI. The draft is the unsaved form;
   * anything it omits falls back to the stored connection (`id`/`name`) — above
   * all the credential, which the UI can never send back.
   */
  async test(draft: RemoteConnectionTestDraft = {}): Promise<RemoteConnectionTestResult> {
    const base = draft.id ? this.byId(draft.id) : draft.name ? this.resolve(draft.name) : null;
    const url = normaliseUrl(draft.url ?? base?.url ?? '');
    const auth = draft.auth ?? base?.auth ?? DEFAULT_AUTH;
    const credential =
      draft.credential === undefined
        ? (base?.credential ?? null)
        : this.normaliseCredential(draft.credential);
    const healthPath =
      draft.healthPath === undefined
        ? (base?.healthPath ?? DEFAULT_HEALTH_PATH)
        : normaliseHealthPath(draft.healthPath);
    const credentialKind: RemoteConnectionTestResult['credential'] =
      auth === 'none' ? 'none' : credential ? 'sa_key' : 'adc';
    const fail = (error: string): RemoteConnectionTestResult => ({
      ok: false,
      status: null,
      latencyMs: null,
      error,
      credential: credentialKind,
    });

    if (!url) return fail('no URL configured');
    // Deeper down the credential is JSON.parse'd inside the token minter, and
    // V8's SyntaxError quotes the offending input — which would put private-key
    // bytes into the response. Caught here, through the button's one error channel.
    if (auth === 'google_id_token' && credential) {
      try {
        JSON.parse(credential);
      } catch {
        return fail('Credential must be valid JSON.');
      }
    }
    if (healthPath === null) return fail('no health path configured');

    const conn: ResolvedConnection = {
      id: base?.id ?? null,
      name: draft.name ?? base?.name ?? 'draft',
      url,
      auth,
      credential,
      maxInflight: base?.maxInflight ?? DEFAULT_MAX_INFLIGHT,
      healthPath,
      source: base?.source ?? {
        url: 'db',
        auth: 'db',
        credential: credential === null ? null : 'db',
        maxInflight: 'db',
        healthPath: 'db',
        envOnly: false,
      },
    };

    try {
      // A throwaway client: a draft's config must never displace the memoised
      // one the running pipelines are using.
      const result = await this.clientFactory(conn).probe({ path: healthPath });
      const body = result.body as { version?: unknown } | null;
      const version = typeof body?.version === 'string' ? body.version : undefined;
      return {
        ok: result.ok,
        status: result.status,
        latencyMs: result.latencyMs,
        ...(version ? { version } : {}),
        ...(result.ok ? {} : { error: `remote responded ${result.status}` }),
        credential: credentialKind,
      };
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  }

  /** A failed load must never let a write insert a duplicate or merge onto defaults. */
  private async assertLoaded(): Promise<void> {
    if (this.loadState !== 'error') return;
    await this.reload();
    if (this.loadState === 'error') {
      throw new ServiceUnavailableException('Remote connections could not be loaded; try again');
    }
  }

  /** A blanked-out UI field means "remove the credential", not "here is invalid JSON". */
  private normaliseCredential(raw: string | null): string | null {
    if (raw === null) return null;
    const trimmed = raw.trim();
    return trimmed === '' ? null : trimmed;
  }

  private validate(next: DecodedRow): void {
    if (!isValidConnectionName(next.name)) {
      throw new BadRequestException(
        'Connection name must be lower-case letters, numbers and dashes, starting with a letter or number (max 64 characters).',
      );
    }
    if (!SUPPORTED_AUTH.has(next.auth)) {
      throw new BadRequestException("Auth mode must be 'google_id_token' or 'none'.");
    }
    if (!next.url) throw new BadRequestException('A connection needs a URL.');
    let url: URL;
    try {
      url = new URL(next.url);
    } catch {
      throw new BadRequestException(`URL is not a valid URL: ${next.url}`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new BadRequestException('URL must be http:// or https://.');
    }
    if (next.auth !== 'none' && url.protocol !== 'https:') {
      throw new BadRequestException(
        'URL must be https:// unless auth is "none" (use "none" only on a private network).',
      );
    }
    if (next.auth === 'google_id_token' && next.credential !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(next.credential);
      } catch {
        throw new BadRequestException('Credential must be valid JSON.');
      }
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        (parsed as { type?: unknown }).type !== 'service_account'
      ) {
        throw new BadRequestException(
          'Credential must be a Google service-account JSON key ("type": "service_account").',
        );
      }
    }
    if (
      !Number.isInteger(next.maxInflight) ||
      next.maxInflight < 1 ||
      next.maxInflight > MAX_INFLIGHT_CEILING
    ) {
      throw new BadRequestException(`Max in-flight must be between 1 and ${MAX_INFLIGHT_CEILING}.`);
    }
  }

  /** An env-pinned field is not editable here: the save would be silently overridden on the next read. */
  private assertNotEnvManaged(name: string, input: UpsertRemoteConnectionInput): void {
    const pinned = this.envFields().get(name);
    if (!pinned) return;
    const env = this.processEnv();
    const fields: (keyof EnvConnectionFields)[] = [
      'url',
      'auth',
      'credential',
      'maxInflight',
      'healthPath',
    ];
    for (const field of fields) {
      if (input[field] === undefined || pinned[field] === undefined) continue;
      const explicit = `REMOTE_CONNECTION_${envNameFor(name)}_${ENV_SUFFIX[field]}`;
      // On an older instance the legacy alias is what is actually set — name the
      // variable the admin has to go and change, not both.
      const legacy = name === 'ffmpeg' ? LEGACY_FFMPEG_VAR[field] : undefined;
      const actuallySet = [explicit, legacy].filter(
        (key): key is string => key !== undefined && (env[key] ?? '').trim() !== '',
      );
      const vars = actuallySet.length > 0 ? actuallySet : [explicit];
      throw new BadRequestException(
        `${FIELD_LABEL[field]} is managed by ${vars.join(' / ')} on this instance.`,
      );
    }
  }

  /** The status of one connection by name, after a write refreshed the cache. */
  private async statusOf(name: string): Promise<RemoteConnectionStatus> {
    const conn = this.resolve(name);
    if (!conn) {
      // The row was written but is not readable back — a torn cache, not a client error.
      throw new InternalServerErrorException('Failed to save remote connection.');
    }
    return this.toStatus(conn);
  }

  private persistFailed(error: unknown): never {
    this.logger.error({
      event: 'remote_connection_persist_failed',
      error: error instanceof Error ? error.message : String(error),
    });
    throw new InternalServerErrorException('Failed to save remote connection.');
  }
}
