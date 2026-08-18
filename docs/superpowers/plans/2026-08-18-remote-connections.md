# Remote connections + `remote_request` handler — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the ffmpeg Remote executor's Cloud Run connection into a reusable instance-level `remote_connections` resource with an admin UI, point the ffmpeg executor at it, and add a generic `remote_request` pipeline handler that calls any connection.

**Architecture:** A new backend module `remote-connections/` owns the DB rows, env-defined connections (`REMOTE_CONNECTION_<NAME>_*`, with `FFMPEG_REMOTE_*` as aliases of the `ffmpeg` connection), a decrypted in-memory cache resolved synchronously by name, a per-connection in-flight fuse, and the generalised hold-open transport (`RemoteClient`, ex-`WorkerClient`). `FfmpegExecutorSettingsService` resolves its `remote_connection_id` FK through that module and keeps returning the same `FfmpegEnvConfig` shape (`remoteUrl/remoteAuth/remoteSaKeyJson/remoteMaxInflight` are now *derived* from the connection), so `RemoteFfmpegExecutor` changes only where it counts in-flight jobs. The `remote_request` handler and the admin UI sit on top.

**Tech Stack:** NestJS + Drizzle (Postgres) + undici + google-auth-library (backend), React + RTK Query + shadcn/ui + Vitest/RTL (frontend), Jest (backend).

**Spec:** `docs/superpowers/specs/2026-08-18-remote-connections-design.md` (read it first; decisions D1–D14).

## Global Constraints

- Work only in the worktree `repos/ce/.claude/worktrees/remote-connections` (branch `feat/remote-connections`, from `origin/main` 305246f). The `repos/ce` main checkout is shared — never edit it.
- Backend tests: `cd apps/backend && npx jest --testPathPattern '<pattern>'` — the worktree path contains no "ffmpeg", but always pass `--testPathPattern` anyway. Backend lint: `npx eslint <files>` (NOT `pnpm lint`, which has `--fix` baked in and reformats ~300 files). Frontend tests: `cd apps/frontend && npx vitest run <file>`.
- Import auth guards by file (`../../auth/api-key.guard`, `../../auth/roles.guard`, decorators from `../../auth/decorators/*`), never from the `../../auth` barrel (require cycle).
- Nest DI: anything the ffmpeg executors need from a settings service goes through a LAZY `ModuleRef` factory token (see `pipelines/ffmpeg/executor/ffmpeg-config.providers.ts`); eager `inject: [Service]` factories deadlock. `ffmpeg-executor-wiring.spec.ts` fences this.
- `pnpm db:generate` is interactive → the USER runs it (Task 7). Never hand-create a migration file; appending the backfill SQL to the generated 0044 file is the one allowed edit.
- Credentials are write-only: no API response, log line, or error message may contain a decrypted credential. Env `''` counts as unset everywhere.
- Connection names: `^[a-z0-9][a-z0-9-]{0,63}$` (lower-case, digits, `-`; NO `_` — env `REMOTE_CONNECTION_<NAME>_*` maps `_`↔`-`, so `_` in a name would be ambiguous). This tightens the spec's regex; note it in the as-built section.
- Commit after every task with a conventional message; do NOT push (the user decides).

---

## File map

**Backend — new** (`apps/backend/src/remote-connections/`):
- `remote-connections.types.ts` — `ResolvedConnection`, `RemoteConnectionAuth`, `CONNECTION_NAME_RE`, `FieldSource`
- `remote-connections-env.ts` — `readRemoteConnectionsEnv()` (+ legacy aliases)
- `remote-errors.ts` — `RemoteBusyError`, `RemoteUnavailableError`, `RemoteTimeoutError`, `RemoteResponseTooLargeError`
- `fuse.ts` — `InflightFuse`
- `auth/id-token.ts` — moved from `pipelines/ffmpeg/executor/remote/id-token.ts` (+ spec)
- `remote-client.ts` — generic transport (`RemoteClient`, `createJobFetch`, `jobFetch`, `JOB_AGENT_OPTIONS`, `RemoteTransportError`)
- `remote-connections.service.ts` — CRUD + cache + env merge + `resolve()` + client memo + test draft
- `remote-connections.controller.ts` — admin CRUD/test + authenticated names list
- `remote-connections.module.ts`
- `remote-connections.tokens.ts` — `REMOTE_CONNECTIONS` lazy token + `RemoteConnectionsPort`
- `apps/backend/src/db/schema/remote-connections.schema.ts`
- `apps/backend/src/pipelines/handlers/remote-request.handler.ts` (+ spec)

**Backend — modified:** `db/schema/index.ts`, `db/schema/ffmpeg-executor-settings.schema.ts`, `pipelines/ffmpeg/ffmpeg-env.ts`, `pipelines/ffmpeg/ffmpeg-executor-settings.service.ts` (+ spec, controller), `pipelines/ffmpeg/executor/remote/worker-client.ts` (now extends `RemoteClient`), `pipelines/ffmpeg/executor/remote/remote-ffmpeg.executor.ts` (fuse), `pipelines/ffmpeg/executor/ffmpeg-config.tokens.ts` + `ffmpeg-config.providers.ts`, `pipelines/ffmpeg/executor/ffmpeg-executor.selector.ts` (probe `maxInflight`), `pipelines/types.ts`, `pipelines/pipelines.module.ts`, `app.module.ts`, `mcp/tools/proxy-rules.tools.ts`, `.env.example`.

**Frontend — new** (`apps/frontend/src/components/settings/remote-connections/`): `WriteOnlySecretField.tsx`, `RemoteConnectionForm.tsx`, `RemoteConnectionsSettings.tsx` (+ test); `components/pipelines/handlers/RemoteRequestConfig.tsx`.
**Frontend — modified:** `services/settingsApi.ts`, `pages/admin-settings/InfrastructureTab.tsx`, `components/settings/FfmpegExecutorSettings.tsx` (+ test), `components/pipelines/handlers/{types.ts,HandlerConfigWrapper.tsx}`, `components/pipelines/PipelineConfig.tsx`.

**Other repos:** `bffless/skills` `plugins/bffless/skills/pipelines/SKILL.md`; `bffless/docs` `docs/features/remote-connections.md` + `docs/features/server-video-ops.md`.

---

### Task 1: Schema + types + env reader

**Files:**
- Create: `apps/backend/src/db/schema/remote-connections.schema.ts`
- Create: `apps/backend/src/remote-connections/remote-connections.types.ts`
- Create: `apps/backend/src/remote-connections/remote-connections-env.ts`
- Test: `apps/backend/src/remote-connections/remote-connections-env.spec.ts`
- Modify: `apps/backend/src/db/schema/index.ts` (add export), `apps/backend/src/db/schema/ffmpeg-executor-settings.schema.ts` (FK column + deprecation TSDoc)

**Interfaces:**
- Produces: `remoteConnections` table, `RemoteConnectionRow`; `ResolvedConnection`, `RemoteConnectionAuth`, `FieldSource`, `CONNECTION_NAME_RE`, `isValidConnectionName(name)`, `envNameFor(name)`; `readRemoteConnectionsEnv(env): Map<string, EnvConnectionFields>`; `ffmpegExecutorSettings.remoteConnectionId`.

- [ ] **Step 1: Write the schema file**

```ts
// apps/backend/src/db/schema/remote-connections.schema.ts
import { integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * Instance-level, admin-owned "remote connections": a named, credential-bearing
 * base URL of a service this CE instance calls with its own identity (Cloud Run
 * is the reference deployment). Referenced BY NAME from pipeline steps
 * (`remote_request.connection`) and by id from ffmpeg_executor_settings.
 * Env vars REMOTE_CONNECTION_<NAME>_{URL,AUTH,CREDENTIAL_JSON,MAX_INFLIGHT,HEALTH_PATH}
 * override individual fields (see remote-connections/remote-connections-env.ts).
 *
 * The credential is AES-256-GCM encrypted (common/crypto/aes-gcm.ts) and WRITE-ONLY.
 * Spec: docs/superpowers/specs/2026-08-18-remote-connections-design.md §1.1.
 */
export const remoteConnections = pgTable('remote_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** ^[a-z0-9][a-z0-9-]{0,63}$ — rules name it by this. */
  name: varchar('name', { length: 64 }).notNull().unique(),
  /** Base URL, trimmed, trailing slash stripped; https unless auth = 'none'. */
  url: text('url').notNull(),
  /** 'google_id_token' | 'none' (free string so aws_sigv4/bearer_secret can be added later). */
  auth: varchar('auth', { length: 32 }).default('google_id_token').notNull(),
  /** encryptString(<credential>) — for google_id_token the SA JSON key; null = ADC / none. */
  credentialEncrypted: text('credential_encrypted'),
  /** Fuse: max concurrent in-flight requests from this instance to this connection. */
  maxInflight: integer('max_inflight').default(8).notNull(),
  /** GET <url><healthPath> for Test / readiness; null = no probe. */
  healthPath: varchar('health_path', { length: 255 }).default('/health'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  updatedByUserId: uuid('updated_by_user_id'),
});

export type RemoteConnectionRow = typeof remoteConnections.$inferSelect;
export type NewRemoteConnectionRow = typeof remoteConnections.$inferInsert;
```

Add `export * from './remote-connections.schema';` to `apps/backend/src/db/schema/index.ts` next to the ffmpeg export. In `ffmpeg-executor-settings.schema.ts` add (import `remoteConnections` from `./remote-connections.schema`):

```ts
  // Which remote connection the Remote executor uses (Plan 4). Env
  // FFMPEG_REMOTE_CONNECTION / legacy FFMPEG_REMOTE_URL win over this.
  remoteConnectionId: uuid('remote_connection_id').references(() => remoteConnections.id, {
    onDelete: 'set null',
  }),
```

and change the TSDoc of `remoteUrl`, `remoteAuth`, `saKeyEncrypted` to:
`/** @deprecated Plan 4 moved this to remote_connections (backfilled by migration 0044); dropped in the next release. Not read by code. */`

- [ ] **Step 2: Write the types file**

```ts
// apps/backend/src/remote-connections/remote-connections.types.ts
export type RemoteConnectionAuth = 'google_id_token' | 'none';
export type FieldSource = 'db' | 'env';

/** Lower-case slug; `-` only (env names map `_`→`-`, so `_` would be ambiguous). */
export const CONNECTION_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export function isValidConnectionName(name: unknown): name is string {
  return typeof name === 'string' && CONNECTION_NAME_RE.test(name);
}
/** `pdf-renderer` → `PDF_RENDERER` (the <NAME> segment of REMOTE_CONNECTION_<NAME>_URL). */
export function envNameFor(name: string): string {
  return name.toUpperCase().replace(/-/g, '_');
}
/** `PDF_RENDERER` → `pdf-renderer`. */
export function nameFromEnv(envName: string): string {
  return envName.toLowerCase().replace(/_/g, '-');
}

/** The effective connection: DB row with env fields applied, credential decrypted (in memory only). */
export interface ResolvedConnection {
  /** null for an env-only connection (no DB row). */
  id: string | null;
  name: string;
  url: string;
  auth: RemoteConnectionAuth | string;
  credential: string | null;
  maxInflight: number;
  healthPath: string | null;
  source: {
    url: FieldSource;
    auth: FieldSource;
    credential: FieldSource | null;
    maxInflight: FieldSource;
    healthPath: FieldSource;
    envOnly: boolean;
  };
}
```

- [ ] **Step 3: Write the failing env-reader spec**

```ts
// apps/backend/src/remote-connections/remote-connections-env.spec.ts
import { readRemoteConnectionsEnv } from './remote-connections-env';

describe('readRemoteConnectionsEnv', () => {
  it('reads REMOTE_CONNECTION_<NAME>_* into a lower-case dashed name', () => {
    const m = readRemoteConnectionsEnv({
      REMOTE_CONNECTION_PDF_RENDERER_URL: 'https://pdf.run.app/',
      REMOTE_CONNECTION_PDF_RENDERER_AUTH: 'none',
      REMOTE_CONNECTION_PDF_RENDERER_MAX_INFLIGHT: '3',
      REMOTE_CONNECTION_PDF_RENDERER_HEALTH_PATH: '/healthz',
    });
    expect(m.get('pdf-renderer')).toEqual({
      url: 'https://pdf.run.app',
      auth: 'none',
      maxInflight: 3,
      healthPath: '/healthz',
    });
  });

  it('maps legacy FFMPEG_REMOTE_* onto the ffmpeg connection', () => {
    const m = readRemoteConnectionsEnv({
      FFMPEG_REMOTE_URL: 'https://w.run.app',
      FFMPEG_REMOTE_AUTH: 'none',
      FFMPEG_REMOTE_SA_KEY_JSON: '{"type":"service_account"}',
      FFMPEG_REMOTE_MAX_INFLIGHT: '4',
    });
    expect(m.get('ffmpeg')).toEqual({
      url: 'https://w.run.app',
      auth: 'none',
      credential: '{"type":"service_account"}',
      maxInflight: 4,
    });
  });

  it('explicit REMOTE_CONNECTION_FFMPEG_* wins over the legacy alias per field', () => {
    const m = readRemoteConnectionsEnv({
      FFMPEG_REMOTE_URL: 'https://old.run.app',
      REMOTE_CONNECTION_FFMPEG_URL: 'https://new.run.app',
      FFMPEG_REMOTE_AUTH: 'none',
    });
    expect(m.get('ffmpeg')).toEqual({ url: 'https://new.run.app', auth: 'none' });
  });

  it("treats '' as unset, ignores bad numbers and unknown auth values", () => {
    const m = readRemoteConnectionsEnv({
      REMOTE_CONNECTION_A_URL: '',
      REMOTE_CONNECTION_B_URL: 'https://b',
      REMOTE_CONNECTION_B_MAX_INFLIGHT: 'lots',
      REMOTE_CONNECTION_B_AUTH: 'magic',
    });
    expect(m.has('a')).toBe(false);
    expect(m.get('b')).toEqual({ url: 'https://b' });
  });

  it("HEALTH_PATH 'none' disables the probe", () => {
    const m = readRemoteConnectionsEnv({ REMOTE_CONNECTION_X_URL: 'https://x', REMOTE_CONNECTION_X_HEALTH_PATH: 'none' });
    expect(m.get('x')).toEqual({ url: 'https://x', healthPath: null });
  });
});
```

- [ ] **Step 4: Run it — expect FAIL (module not found)**

`cd apps/backend && npx jest --testPathPattern 'remote-connections/remote-connections-env'`

- [ ] **Step 5: Implement the env reader**

```ts
// apps/backend/src/remote-connections/remote-connections-env.ts
import { nameFromEnv, type RemoteConnectionAuth } from './remote-connections.types';

/** Fields an env var can pin. `credential: null` / `healthPath: null` are explicit "none". */
export interface EnvConnectionFields {
  url?: string;
  auth?: RemoteConnectionAuth;
  credential?: string | null;
  maxInflight?: number;
  healthPath?: string | null;
}

const FIELD_RE = /^REMOTE_CONNECTION_(.+)_(URL|AUTH|CREDENTIAL_JSON|MAX_INFLIGHT|HEALTH_PATH)$/;
/** Legacy Plan-1/2 names → (connection, field). Explicit REMOTE_CONNECTION_FFMPEG_* wins. */
const LEGACY: Record<string, keyof EnvConnectionFields> = {
  FFMPEG_REMOTE_URL: 'url',
  FFMPEG_REMOTE_AUTH: 'auth',
  FFMPEG_REMOTE_SA_KEY_JSON: 'credential',
  FFMPEG_REMOTE_MAX_INFLIGHT: 'maxInflight',
};

function str(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const t = raw.trim();
  return t === '' ? null : t;
}
function url(raw: string | undefined): string | null {
  const s = str(raw);
  return s === null ? null : s.endsWith('/') ? s.slice(0, -1) : s;
}

function apply(target: EnvConnectionFields, field: keyof EnvConnectionFields, raw: string | undefined) {
  switch (field) {
    case 'url': {
      const v = url(raw);
      if (v) target.url = v;
      break;
    }
    case 'auth': {
      const v = str(raw);
      if (v === 'google_id_token' || v === 'none') target.auth = v;
      break;
    }
    case 'credential': {
      const v = str(raw);
      if (v) target.credential = v;
      break;
    }
    case 'maxInflight': {
      const v = str(raw);
      const n = v === null ? NaN : Number(v);
      if (Number.isFinite(n) && n > 0) target.maxInflight = Math.floor(n);
      break;
    }
    case 'healthPath': {
      const v = str(raw);
      if (v === 'none') target.healthPath = null;
      else if (v) target.healthPath = v.startsWith('/') ? v : `/${v}`;
      break;
    }
  }
}

const FIELD_BY_SUFFIX: Record<string, keyof EnvConnectionFields> = {
  URL: 'url', AUTH: 'auth', CREDENTIAL_JSON: 'credential', MAX_INFLIGHT: 'maxInflight', HEALTH_PATH: 'healthPath',
};

/** Every env-pinned connection field, keyed by connection name. Legacy aliases first so explicit vars overwrite. */
export function readRemoteConnectionsEnv(env: NodeJS.ProcessEnv = process.env): Map<string, EnvConnectionFields> {
  const out = new Map<string, EnvConnectionFields>();
  const get = (name: string) => {
    let f = out.get(name);
    if (!f) { f = {}; out.set(name, f); }
    return f;
  };
  for (const [key, field] of Object.entries(LEGACY)) apply(get('ffmpeg'), field, env[key]);
  for (const key of Object.keys(env)) {
    const m = FIELD_RE.exec(key);
    if (!m) continue;
    apply(get(nameFromEnv(m[1])), FIELD_BY_SUFFIX[m[2]], env[key]);
  }
  for (const [name, f] of out) if (Object.keys(f).length === 0) out.delete(name);
  return out;
}
```

- [ ] **Step 6: Run the spec — expect PASS; typecheck**

`npx jest --testPathPattern 'remote-connections/remote-connections-env'` then `npx tsc --noEmit -p tsconfig.json` (from `apps/backend`).

- [ ] **Step 7: Commit**

`git add apps/backend/src/db/schema apps/backend/src/remote-connections && git commit -m "feat(remote-connections): schema, types and env reader (REMOTE_CONNECTION_<NAME>_* + FFMPEG_REMOTE_* aliases)"`

---

### Task 2: Errors + in-flight fuse

**Files:**
- Create: `apps/backend/src/remote-connections/remote-errors.ts`, `apps/backend/src/remote-connections/fuse.ts`
- Test: `apps/backend/src/remote-connections/fuse.spec.ts`

**Interfaces:**
- Produces: `RemoteBusyError` (`code='REMOTE_BUSY'`), `RemoteUnavailableError` (`code='REMOTE_UNAVAILABLE'`, `status?`), `RemoteTimeoutError` (`code='REMOTE_TIMEOUT'`), `RemoteResponseTooLargeError` (`code='REMOTE_RESPONSE_TOO_LARGE'`); `class InflightFuse { acquire(name: string, max: number): () => void; inflight(name): number }`.

- [ ] **Step 1: Failing spec**

```ts
// apps/backend/src/remote-connections/fuse.spec.ts
import { InflightFuse } from './fuse';
import { RemoteBusyError } from './remote-errors';

describe('InflightFuse', () => {
  it('counts per name and blows at max', () => {
    const fuse = new InflightFuse();
    const r1 = fuse.acquire('a', 2);
    fuse.acquire('a', 2);
    expect(() => fuse.acquire('a', 2)).toThrow(RemoteBusyError);
    expect(fuse.inflight('a')).toBe(2);
    r1();
    expect(fuse.inflight('a')).toBe(1);
    expect(() => fuse.acquire('a', 2)).not.toThrow();
  });
  it('is independent per name and release is idempotent', () => {
    const fuse = new InflightFuse();
    const r = fuse.acquire('a', 1);
    expect(() => fuse.acquire('b', 1)).not.toThrow();
    r(); r();
    expect(fuse.inflight('a')).toBe(0);
  });
});
```

- [ ] **Step 2: Run — FAIL.** `npx jest --testPathPattern 'remote-connections/fuse'`

- [ ] **Step 3: Implement**

```ts
// apps/backend/src/remote-connections/remote-errors.ts
/** Typed failures shared by the remote_request handler and (wrapped) the ffmpeg remote executor. */
export class RemoteBusyError extends Error { readonly code = 'REMOTE_BUSY'; }
export class RemoteUnavailableError extends Error {
  readonly code = 'REMOTE_UNAVAILABLE';
  constructor(message: string, readonly status?: number) { super(message); }
}
export class RemoteTimeoutError extends Error { readonly code = 'REMOTE_TIMEOUT'; }
export class RemoteResponseTooLargeError extends Error { readonly code = 'REMOTE_RESPONSE_TOO_LARGE'; }
```

```ts
// apps/backend/src/remote-connections/fuse.ts
import { RemoteBusyError } from './remote-errors';

/**
 * Per-connection in-flight ceiling (spec D5). One shared instance per process:
 * the ffmpeg remote executor and every remote_request step naming the same
 * connection draw from the same counter. Fail-fast, no queueing — the remote
 * service scales; the fuse only protects this process's sockets.
 */
export class InflightFuse {
  private readonly counts = new Map<string, number>();

  inflight(name: string): number { return this.counts.get(name) ?? 0; }

  /** Throws RemoteBusyError at capacity; otherwise returns an idempotent release(). */
  acquire(name: string, max: number): () => void {
    const current = this.inflight(name);
    if (current >= max) {
      throw new RemoteBusyError(`connection '${name}' at capacity (${max} in flight)`);
    }
    this.counts.set(name, current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.counts.set(name, Math.max(0, this.inflight(name) - 1));
    };
  }
}
```

- [ ] **Step 4: Run — PASS. Commit** `git commit -am "feat(remote-connections): shared per-connection in-flight fuse + REMOTE_* error types"` (add the new files first).

---

### Task 3: Generic `RemoteClient` transport (WorkerClient becomes a subclass); move id-token

**Files:**
- Move: `apps/backend/src/pipelines/ffmpeg/executor/remote/id-token.ts` → `apps/backend/src/remote-connections/auth/id-token.ts` (and its spec `id-token.spec.ts`), fix imports (`remote-ffmpeg.executor.ts`, `worker-client.ts`, any spec).
- Create: `apps/backend/src/remote-connections/remote-client.ts`, test `remote-client.spec.ts`
- Modify: `apps/backend/src/pipelines/ffmpeg/executor/remote/worker-client.ts` (keep the class; it extends `RemoteClient`), its spec keeps passing.

**Interfaces:**
- Produces:
```ts
export class RemoteTransportError extends Error { constructor(message, readonly status?: number, readonly retryable = false) }
export const JOB_AGENT_OPTIONS; export function createJobFetch(...); export function jobFetch(): typeof fetch;
export interface RemoteRequestOpts { path: string; method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'; headers?: Record<string,string>; body?: string; signal: AbortSignal; maxResponseBytes?: number; retry?: boolean /* default true */ }
export interface RemoteResponse { status: number; ok: boolean; headers: Headers; body: unknown; attempts: 1|2 }
export class RemoteClient {
  constructor(baseUrl: string, auth: AuthHeaderProvider, fetchImpl = jobFetch(), sleep = …)
  request(opts: RemoteRequestOpts): Promise<RemoteResponse>   // resolves for ANY status; throws RemoteTransportError on transport failure / non-retryable-after-retry, caller's AbortError untouched, RemoteResponseTooLargeError
  health(opts?: { path?: string; signal?: AbortSignal; timeoutMs?: number }): Promise<{ status: number; ok: boolean; body: unknown; latencyMs: number }>  // never retried, 5 s bound
}
export function authProviderFor(auth: string, credential: string | null): AuthHeaderProvider  // 'none' → NoAuth, 'google_id_token' → IdTokenMinter(credential), else throws RemoteUnavailableError
```
- `WorkerClient extends RemoteClient` keeps `postJob(envelope, {signal}): Promise<WorkerResponse>` and `health(): Promise<WorkerHealth>` with EXACTLY today's semantics (built on `request`/`super.health`), so `worker-client.spec.ts` and the executor spec stay green. `WorkerTransportError` becomes `export { RemoteTransportError as WorkerTransportError }` re-export.

- [ ] **Step 1: `git mv` the id-token files, update imports, run the moved spec + executor spec** — `npx jest --testPathPattern 'remote-connections/auth|executor/remote'` PASS. Commit `refactor(remote-connections): move ID-token minter under remote-connections/auth`.

- [ ] **Step 2: Failing `remote-client.spec.ts`** (mirror `worker-client.spec.ts` style: `fetchImpl` = jest.fn, `noSleep`):

```ts
import { RemoteClient, RemoteTransportError } from './remote-client';
import { NoAuth } from './auth/id-token';
import { RemoteResponseTooLargeError } from './remote-errors';

const noSleep = async () => {};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const sig = () => new AbortController().signal;

describe('RemoteClient.request', () => {
  it('POSTs to baseUrl+path with auth headers and returns parsed JSON for any status', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(json(422, { error: 'bad' }));
    const res = await new RemoteClient('https://svc', { headers: async () => ({ authorization: 'Bearer t' }) }, fetchImpl as never, noSleep)
      .request({ path: '/jobs', method: 'POST', body: '{"a":1}', signal: sig() });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://svc/jobs');
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({ authorization: 'Bearer t', 'content-type': 'application/json' });
    expect(res).toMatchObject({ status: 422, ok: false, body: { error: 'bad' }, attempts: 1 });
  });
  it('returns text bodies for non-JSON content types', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(new Response('pong', { status: 200 }));
    const res = await new RemoteClient('https://svc', new NoAuth(), fetchImpl as never, noSleep).request({ path: '/ping', method: 'GET', signal: sig() });
    expect(res.body).toBe('pong');
  });
  it('retries once on a thrown fetch and on 429/503, then reports attempts', async () => {
    const fetchImpl = jest.fn().mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(json(200, { ok: 1 }));
    const res = await new RemoteClient('https://svc', new NoAuth(), fetchImpl as never, noSleep).request({ path: '/', method: 'POST', signal: sig() });
    expect(res.attempts).toBe(2);
    const f2 = jest.fn().mockResolvedValueOnce(json(503, {})).mockResolvedValueOnce(json(503, {}));
    await expect(new RemoteClient('https://svc', new NoAuth(), f2 as never, noSleep).request({ path: '/', method: 'POST', signal: sig() }))
      .rejects.toMatchObject({ name: 'RemoteTransportError', status: 503, retryable: true });
  });
  it('does not retry when retry:false or after abort; rethrows AbortError', async () => {
    const f = jest.fn().mockRejectedValueOnce(new Error('boom'));
    await expect(new RemoteClient('https://svc', new NoAuth(), f as never, noSleep).request({ path: '/', method: 'POST', signal: sig(), retry: false }))
      .rejects.toBeInstanceOf(RemoteTransportError);
    expect(f).toHaveBeenCalledTimes(1);
    const c = new AbortController(); c.abort();
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const f3 = jest.fn().mockRejectedValueOnce(abort);
    await expect(new RemoteClient('https://svc', new NoAuth(), f3 as never, noSleep).request({ path: '/', method: 'POST', signal: c.signal })).rejects.toBe(abort);
  });
  it('rejects bodies over maxResponseBytes', async () => {
    const big = new Response('x'.repeat(2000), { status: 200, headers: { 'content-length': '2000' } });
    await expect(new RemoteClient('https://svc', new NoAuth(), jest.fn().mockResolvedValueOnce(big) as never, noSleep)
      .request({ path: '/', method: 'GET', signal: sig(), maxResponseBytes: 1000 })).rejects.toBeInstanceOf(RemoteResponseTooLargeError);
  });
});

describe('RemoteClient.health', () => {
  it('GETs the given path with a 5 s bound and reports latency, never retries', async () => {
    const f = jest.fn().mockResolvedValueOnce(json(200, { ok: true, version: '1.2.3' }));
    const res = await new RemoteClient('https://svc', new NoAuth(), f as never, noSleep).health({ path: '/healthz' });
    expect(f.mock.calls[0][0]).toBe('https://svc/healthz');
    expect(res).toMatchObject({ status: 200, ok: true, body: { version: '1.2.3' } });
    expect(typeof res.latencyMs).toBe('number');
  });
});
```

- [ ] **Step 3: Run — FAIL. Implement `remote-client.ts`** by moving the transport code out of `worker-client.ts`: `RETRY_DELAY_MS`, `JOB_AGENT_OPTIONS`, `HEALTH_TIMEOUT_MS`, `RETRYABLE_STATUSES`, `isAbort`, `errorBody`, `createJobFetch`, `jobFetch`, the error class (renamed `RemoteTransportError`, same fields). `request()` = today's `postJob` loop, generalised: URL = `${baseUrl}${path}`; headers = `{ ...(body !== undefined ? {'content-type':'application/json'} : {}), ...opts.headers, ...(await this.auth.headers(url)) }` (auth wins — the caller can never override Authorization); `canRetry = opts.retry !== false && attempt === 0 && !signal.aborted`; on `!res.ok` with a retryable status and `canRetry` → sleep + continue; **otherwise do NOT throw on non-2xx** — parse and return `{status, ok: res.ok, headers, body, attempts}` (the callers decide). Size cap: if `content-length` header > `maxResponseBytes` (default `16 * 1024 * 1024`) throw `RemoteResponseTooLargeError` before reading; else read `await res.text()`, check `Buffer.byteLength(text) > max` → throw; parse JSON when `content-type` includes `application/json` (JSON parse failure → return the raw text as body). After a retried 429/503 pair, throw `RemoteTransportError('… responded 503 …', 503, true)` (keeps the ffmpeg BUSY mapping). `health({path='/health', timeoutMs=5000, signal})` = today's `health()` with `path` param, returning `{status, ok, body, latencyMs}` and NOT validating the body shape (WorkerClient does that). Add `authProviderFor(auth, credential)`.

- [ ] **Step 4: Rewrite `worker-client.ts` as a thin subclass** — keep the module docblock; `export { RemoteTransportError as WorkerTransportError, JOB_AGENT_OPTIONS, createJobFetch, jobFetch } from '../../../../remote-connections/remote-client'`; then:

```ts
export class WorkerClient extends RemoteClient {
  /** Runs the job on the Worker. Non-2xx → WorkerTransportError (status), 2xx non-WorkerResponse → WorkerTransportError. */
  async postJob(envelope: WorkerEnvelope, opts: { signal: AbortSignal }): Promise<WorkerResponse> {
    const res = await this.request({ path: '/jobs', method: 'POST', body: JSON.stringify(envelope), signal: opts.signal });
    if (!res.ok) {
      throw new WorkerTransportError(`worker responded ${res.status}: ${typeof res.body === 'string' ? res.body.slice(0, 500) : JSON.stringify(res.body).slice(0, 500)}`, res.status, RETRYABLE_STATUSES.has(res.status));
    }
    if (!isWorkerResponse(res.body)) throw new WorkerTransportError('worker response was not a WorkerResponse', res.status);
    return res.body;
  }
  /** Liveness + version. */
  async health(opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<WorkerHealth> {
    const res = await super.health({ path: '/health', ...opts });
    if (!res.ok) throw new WorkerTransportError(`worker health responded ${res.status}`, res.status, RETRYABLE_STATUSES.has(res.status));
    const body = res.body as WorkerHealth;
    if (typeof body?.ok !== 'boolean' || typeof body?.version !== 'string') throw new WorkerTransportError('worker health response was not a WorkerHealth', res.status);
    return body;
  }
}
```
(export `RETRYABLE_STATUSES` from remote-client.) Note the TS override signature: `RemoteClient.health` returns a different type — declare `WorkerClient.health` with `// eslint-disable-next-line @typescript-eslint/ban-ts-comment` + `// @ts-expect-error` if needed, or better: name the generic one `probe()` in RemoteClient and keep `WorkerClient.health()` calling `this.probe()`. **Do the latter** (`RemoteClient.probe(opts)`; the spec above uses `.health(` — rename to `.probe(` in the spec).

- [ ] **Step 5: Run all three specs — PASS:** `npx jest --testPathPattern 'remote-connections/|executor/remote'`. Existing `worker-client.spec.ts` must pass unchanged except import paths; if an assertion depended on `postJob` throwing on a non-JSON 2xx ("worker response was not JSON"), it now throws "was not a WorkerResponse" — update that one message expectation only.

- [ ] **Step 6: Commit** `refactor(remote-connections): generic RemoteClient transport; WorkerClient becomes a subclass`

---

### Task 4: `RemoteConnectionsService` (cache, env merge, CRUD, resolve, client memo, test)

**Files:**
- Create: `apps/backend/src/remote-connections/remote-connections.service.ts`
- Test: `apps/backend/src/remote-connections/remote-connections.service.spec.ts` (mock `../db/client` exactly like `ffmpeg-executor-settings.service.spec.ts` does; use `__resetKeyForTests` + a 32-byte base64 `ENCRYPTION_KEY`).

**Interfaces:**
```ts
export interface RemoteConnectionStatus {   // what the admin UI gets — never the credential
  id: string | null; name: string; url: string; auth: string; hasCredential: boolean;
  maxInflight: number; healthPath: string | null;
  source: ResolvedConnection['source']; envOnly: boolean;
  usedBy: { ffmpegExecutor: boolean; rules: number };
}
export interface UpsertRemoteConnectionInput { name?: string; url?: string; auth?: string; credential?: string | null; maxInflight?: number; healthPath?: string | null }
export interface RemoteConnectionTestDraft { id?: string; name?: string; url?: string; auth?: string; credential?: string | null; healthPath?: string | null }
export interface RemoteConnectionTestResult { ok: boolean; status: number | null; latencyMs: number | null; version?: string; error?: string; credential: 'sa_key' | 'adc' | 'none' }
export type UsageProbe = (connectionName: string) => boolean;

@Injectable() export class RemoteConnectionsService implements OnModuleInit {
  constructor(@Optional() processEnv: () => NodeJS.ProcessEnv = () => process.env, @Optional() clientFactory?: (c: ResolvedConnection) => RemoteClient)
  reload(): Promise<void>
  list(): ResolvedConnection[]                       // sync, from cache: DB rows (env applied) ∪ env-only
  resolve(name: string): ResolvedConnection | null   // sync
  byId(id: string): ResolvedConnection | null
  client(conn: ResolvedConnection): RemoteClient     // memoised per name + fingerprint(url|auth|credential)
  readonly fuse: InflightFuse
  registerUsageProbe(kind: 'ffmpegExecutor', probe: UsageProbe): void   // ffmpeg settings registers itself (avoids a module cycle)
  status(): Promise<RemoteConnectionStatus[]>
  create(input, userId?): Promise<RemoteConnectionStatus>
  update(id, input, userId?): Promise<RemoteConnectionStatus>
  remove(id): Promise<void>                          // 409 ConflictException when usedBy.ffmpegExecutor
  test(draft): Promise<RemoteConnectionTestResult>
}
```

- [ ] **Step 1: Failing spec** — cover: (a) `reload` decrypts and `resolve('x')` returns the row with `source` all `db`; (b) env fields override per field and `source` says `env`; env-only name appears in `list()` with `id:null, envOnly:true`; (c) legacy `FFMPEG_REMOTE_URL` yields `resolve('ffmpeg')`; (d) `create` validation: bad name (`Bad_Name`, `-x`) → 400; http URL with `google_id_token` → 400 (`none` allowed); credential not JSON / not `type: service_account` → 400; `maxInflight` outside 1..64 → 400; duplicate name → 400 with "already exists"; (e) `update` credential semantics: undefined keeps, `null` clears, string replaces (assert what `db.update().set()` received: `credentialEncrypted` absent / null / decryptable to the new value); env-managed field edit → 400 "managed by REMOTE_CONNECTION_X_URL on this instance"; (f) `remove` → `ConflictException` when the registered probe returns true; (g) `status()` never contains `credential`/`credentialEncrypted` (`JSON.stringify(status)` does not include the SA key text) and reports `hasCredential`; (h) `test(draft)` uses `clientFactory` and returns `{ok:true, status:200, latencyMs, version:'1.0.0'}` when the fake client's `probe()` resolves `{status:200, ok:true, body:{version:'1.0.0'}, latencyMs:5}`; with `draft.id` and no `credential` it falls back to the stored decrypted credential (assert the factory got it); reports `credential:'adc'|'sa_key'|'none'`; a thrown probe → `{ok:false, error}`; `healthPath:null` → `{ok:false, error:'no health path configured'}`; (i) `client()` returns the same instance for the same fingerprint and a new one after `url` changes; (j) `loadState==='error'` → `update` throws `ServiceUnavailableException` after a failed retry (mirror the ffmpeg spec).

Row helper for the spec:
```ts
function row(over: Partial<Record<string, unknown>> = {}) {
  return { id: 'c1', name: 'ffmpeg', url: 'https://w.run.app', auth: 'google_id_token', credentialEncrypted: null, maxInflight: 8, healthPath: '/health', createdAt: new Date(), updatedAt: new Date(), updatedByUserId: null, ...over };
}
```
Mock `db.select().from().orderBy()` (no limit — list all rows): `db.select.mockReturnValue({ from: jest.fn().mockReturnValue({ orderBy: jest.fn().mockImplementation(async () => table) }) })`. For `create`/`update`/`remove` mock `db.insert().values().returning()`, `db.update().set().where().returning()`, `db.delete().where()`.

- [ ] **Step 2: Run — FAIL.** `npx jest --testPathPattern 'remote-connections/remote-connections.service'`

- [ ] **Step 3: Implement the service.** Structure to follow (`ffmpeg-executor-settings.service.ts` is the model — same `loadState`, `warnedMissing`, decrypt-on-load, `envSet` helpers):

```ts
@Injectable()
export class RemoteConnectionsService implements OnModuleInit {
  private readonly logger = new Logger(RemoteConnectionsService.name);
  readonly fuse = new InflightFuse();
  private rows: DecodedRow[] = [];            // {id,name,url,auth,credential,maxInflight,healthPath}
  private loadState: 'ok' | 'empty' | 'error' = 'empty';
  private warnedMissing = false;
  private readonly clients = new Map<string, { fingerprint: string; client: RemoteClient }>();
  private readonly usageProbes = new Map<string, UsageProbe>();
  constructor(
    @Optional() private readonly processEnv: () => NodeJS.ProcessEnv = () => process.env,
    @Optional() private readonly clientFactory: (c: ResolvedConnection) => RemoteClient =
      (c) => new RemoteClient(c.url, authProviderFor(c.auth, c.credential)),
  ) {}
  async onModuleInit() { if (process.env.NODE_ENV === 'test') return; await this.reload(); }
  async reload() { /* select all rows orderBy name; decrypt each credential (log + null on failure); loadState */ }
  private envFields(): Map<string, EnvConnectionFields> { return readRemoteConnectionsEnv(this.processEnv()); }
  private merge(row: DecodedRow | null, name: string, env: EnvConnectionFields | undefined): ResolvedConnection | null {
    if (!row && (!env || !env.url)) return null;         // env-only needs at least a URL
    const pick = <T>(field: keyof EnvConnectionFields, dbVal: T, dflt: T): { value: T; source: FieldSource } => env && env[field] !== undefined ? { value: env[field] as unknown as T, source: 'env' } : { value: row ? dbVal : dflt, source: 'db' };
    const url = pick('url', row?.url ?? '', ''); const auth = pick('auth', row?.auth ?? 'google_id_token', 'google_id_token');
    const credential = pick('credential', row?.credential ?? null, null); const maxInflight = pick('maxInflight', row?.maxInflight ?? 8, 8);
    const healthPath = pick('healthPath', row?.healthPath ?? '/health', '/health');
    return { id: row?.id ?? null, name, url: url.value, auth: auth.value, credential: credential.value, maxInflight: maxInflight.value, healthPath: healthPath.value,
      source: { url: url.source, auth: auth.source, credential: credential.value === null ? null : credential.source, maxInflight: maxInflight.source, healthPath: healthPath.source, envOnly: !row } };
  }
  list(): ResolvedConnection[] { const env = this.envFields(); const out = new Map<string, ResolvedConnection>();
    for (const r of this.rows) { const c = this.merge(r, r.name, env.get(r.name)); if (c) out.set(r.name, c); }
    for (const [name, f] of env) if (!out.has(name)) { const c = this.merge(null, name, f); if (c) out.set(name, c); }
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name)); }
  resolve(name: string) { return this.list().find((c) => c.name === name) ?? null; }
  byId(id: string) { return this.list().find((c) => c.id === id) ?? null; }
  client(conn: ResolvedConnection): RemoteClient { const fingerprint = [conn.url, conn.auth, conn.credential ?? ''].join('|'); const hit = this.clients.get(conn.name);
    if (hit && hit.fingerprint === fingerprint) return hit.client; const client = this.clientFactory(conn); this.clients.set(conn.name, { fingerprint, client }); return client; }
  …
}
```
Validation goes in a private `validate(next: DecodedRow, isCreate: boolean)`; env-pinned-field refusal in `assertNotEnvManaged(name, input)` (message: `` `${label} is managed by REMOTE_CONNECTION_${envNameFor(name)}_${SUFFIX} on this instance.` ``, and for the `ffmpeg` name mention the legacy var too: `FFMPEG_REMOTE_URL`). `status()` maps `list()` → `RemoteConnectionStatus` with `usedBy.ffmpegExecutor = this.usageProbes.get('ffmpegExecutor')?.(name) ?? false` and `usedBy.rules` = a best-effort count: `db.execute(sql\`select count(*)::int as n from proxy_rules where pipeline_config::text like ${'%"connection":"' + name + '"%'}\`)` wrapped in try/catch → 0. `remove()` throws `ConflictException('in use by the ffmpeg Remote executor — pick another connection there first')` when the probe says so. `test(draft)`: build a `ResolvedConnection` from draft (fall back to `byId(draft.id)`/`resolve(draft.name)` for omitted fields, esp. the credential); if `google_id_token` and credential present, `JSON.parse` guard → `{ok:false, error:'Credential must be valid JSON.'}` (never let V8's SyntaxError text out — it quotes the input); if `healthPath === null` → `{ok:false, status:null, latencyMs:null, error:'no health path configured', credential}`; else `const client = this.clientFactory(conn)` (a throwaway, never memoised for drafts), `probe({path: healthPath})`, `version = typeof body?.version === 'string' ? body.version : undefined`, `ok = res.ok`; errors → `{ok:false, error: message}`. All persistence errors → `InternalServerErrorException('Failed to save remote connection.')` (log the real error).

- [ ] **Step 4: Run — PASS; `npx tsc --noEmit`; `npx eslint src/remote-connections`.**

- [ ] **Step 5: Commit** `feat(remote-connections): RemoteConnectionsService — cache, env-over-DB merge, CRUD, resolve by name, test connection`

---

### Task 5: Controller, module, tokens, app wiring

**Files:**
- Create: `apps/backend/src/remote-connections/remote-connections.controller.ts` (+ `remote-connections.controller.spec.ts`), `remote-connections.module.ts`, `remote-connections.tokens.ts`
- Modify: `apps/backend/src/app.module.ts` (import `RemoteConnectionsModule` before `PipelinesModule`), `apps/backend/src/pipelines/pipelines.module.ts` (import `RemoteConnectionsModule`)

**Interfaces:**
```ts
// remote-connections.tokens.ts
export const REMOTE_CONNECTIONS = Symbol('REMOTE_CONNECTIONS');
/** The narrow, LAZY view handlers/executors get (resolved through ModuleRef on first use). */
export interface RemoteConnectionsPort {
  resolve(name: string): ResolvedConnection | null;
  client(conn: ResolvedConnection): RemoteClient;
  acquire(conn: ResolvedConnection): () => void;   // fuse.acquire(conn.name, conn.maxInflight)
}
export const REMOTE_CONNECTIONS_PROVIDER: Provider = {
  provide: REMOTE_CONNECTIONS,
  useFactory: (ref: ModuleRef): RemoteConnectionsPort => ({
    resolve: (n) => ref.get(RemoteConnectionsService, { strict: false }).resolve(n),
    client: (c) => ref.get(RemoteConnectionsService, { strict: false }).client(c),
    acquire: (c) => { const s = ref.get(RemoteConnectionsService, { strict: false }); return s.fuse.acquire(c.name, c.maxInflight); },
  }),
  inject: [ModuleRef],
};
```
Module: `@Module({ providers: [RemoteConnectionsService, REMOTE_CONNECTIONS_PROVIDER], controllers: [RemoteConnectionsController], exports: [RemoteConnectionsService, REMOTE_CONNECTIONS] })`. It imports nothing from pipelines/settings (no cycle). Guards: `ApiKeyGuard` + `RolesGuard` by file path, as in `ffmpeg-executor-settings.controller.ts`.

Routes (spec §3.1):
```ts
@Controller('api/settings/remote-connections') @UseGuards(ApiKeyGuard, RolesGuard)
  @Get()            @Roles('admin') list()                → service.status()
  @Post()           @Roles('admin') create(@Body, @CurrentUser)
  @Put(':id')       @Roles('admin') update(@Param('id'), @Body, @CurrentUser)
  @Delete(':id')    @Roles('admin') remove(@Param('id'))   → 204
  @Post('test')     @Roles('admin') test(@Body draft = {})
@Controller('api/remote-connections') @UseGuards(ApiKeyGuard)
  @Get()  names()  → service.list().map(c => ({ name: c.name, auth: c.auth }))
```
(Two controller classes in one file is fine; export both and register both.)

- [ ] **Step 1: Failing controller spec** — instantiate the controllers with a jest-mocked service; assert `list` calls `status()`, `remove` returns nothing, `names` strips url/id/credential (`{name, auth}` only), `test` defaults `{}`.
- [ ] **Step 2: Implement controllers + module + tokens; wire into `AppModule` (before `PipelinesModule`) and `PipelinesModule.imports`.**
- [ ] **Step 3: Boot check:** `cd apps/backend && npx jest --testPathPattern 'remote-connections/'` PASS; `npx tsc --noEmit`; then a wiring assertion: extend `pipelines/ffmpeg/ffmpeg-executor-wiring.spec.ts` in Task 6 (don't do it here).
- [ ] **Step 4: Commit** `feat(remote-connections): admin CRUD/test endpoints, names endpoint, module + lazy REMOTE_CONNECTIONS token`

---

### Task 6: Re-point the ffmpeg executor at connections (settings service, env, executor fuse, probe maxInflight)

**Files:**
- Modify: `apps/backend/src/pipelines/ffmpeg/ffmpeg-env.ts` (+ spec), `ffmpeg-executor-settings.service.ts` (+ spec), `ffmpeg-executor-settings.controller.ts` (summary strings only), `executor/ffmpeg-config.tokens.ts`, `executor/ffmpeg-config.providers.ts`, `executor/remote/remote-ffmpeg.executor.ts` (+ spec), `executor/ffmpeg-executor.selector.ts` (+ spec), `ffmpeg-executor-wiring.spec.ts`, `handlers/ffmpeg.handler.ts` (probe TSDoc), `pipelines.module.ts`.

**Interfaces:**
- `FfmpegEnvConfig` gains `remoteConnection: string | null` (connection NAME). `readFfmpegEnv`: `remoteConnection: str(env.FFMPEG_REMOTE_CONNECTION) ?? (remoteUrl ? 'ffmpeg' : null)`. All other remote fields keep their meaning; from env alone they still come from `FFMPEG_REMOTE_*`.
- `FfmpegExecutorStatus` (backend + frontend mirror): REMOVE `remoteUrl`, `remoteAuth`, `hasSaKey`, `saKeySource`; ADD
  ```ts
  remoteConnection: { id: string | null; name: string; url: string; auth: string; hasCredential: boolean; credentialSource: 'db'|'env'|null; envOnly: boolean } | null;
  connections: { id: string | null; name: string; auth: string; envOnly: boolean }[];   // for the dropdown
  envManaged: { defaultExecutor: boolean; remoteConnection: boolean };
  ```
- `UpdateFfmpegExecutorInput`: REMOVE `remoteUrl/remoteAuth/saKeyJson`; ADD `remoteConnection?: string | null` (NAME; must resolve to a DB-backed connection — env-only names → 400 "select it with FFMPEG_REMOTE_CONNECTION"). `FfmpegExecutorTestDraft` = `{ remoteConnection?: string }`.
- `FfmpegRemoteDeps` gains `fuse?: InflightFuse`; `RemoteFfmpegExecutor` uses `deps.fuse ?? new InflightFuse()` and `acquire(env.remoteConnection ?? 'ffmpeg', env.remoteMaxInflight)` in place of `this.inflight` (`RemoteBusyError` → rethrown as `FfmpegBusyError` with the same message); `FFMPEG_CONFIG_PROVIDERS` supplies `fuse: ref.get(RemoteConnectionsService, {strict:false}).fuse` lazily (build the object with a getter: `get fuse() { return ref.get(...).fuse; }`).
- `FfmpegCapabilityProbe.remote` gains `maxInflight: number`.

- [ ] **Step 1: `ffmpeg-env.spec.ts`** — add: `readFfmpegEnv({FFMPEG_REMOTE_URL:'https://w'}).remoteConnection === 'ffmpeg'`; `FFMPEG_REMOTE_CONNECTION:'pdf'` → `'pdf'`; neither → `null`. Run FAIL → implement → PASS.

- [ ] **Step 2: Settings service spec rewrite (the big one).** Replace URL/auth/key cases with connection cases. Construct with a fake connections service: `make({ connections: [{ id:'c1', name:'ffmpeg', url:'https://w.run.app', auth:'google_id_token', credential: SA_KEY, maxInflight: 8, healthPath:'/health', source:{…all 'db', envOnly:false} }] })` → the `make` helper builds `{ resolve: (n) => list.find(...) ?? null, byId: …, list: () => list, registerUsageProbe: jest.fn(), fuse: new InflightFuse() }` and passes it as the new constructor arg. Cases:
  - row `{ remoteEnabled:true, remoteConnectionId:'c1' }` → `resolved()` has `remoteUrl:'https://w.run.app', remoteAuth, remoteSaKeyJson: SA_KEY, remoteMaxInflight: 8, remoteConnection:'ffmpeg', remoteEnabled:true`.
  - row with a dangling id (connection deleted) → `remoteEnabled:false`, status `remoteConnection:null`.
  - env `FFMPEG_REMOTE_URL` set → `remoteConnection:'ffmpeg'` regardless of the row, `envManaged.remoteConnection:true`, `remoteEnabled:true`; `update({remoteConnection:'x'})` → 400 "managed by FFMPEG_REMOTE_CONNECTION / FFMPEG_REMOTE_URL".
  - `update({remoteConnection:'nope'})` → 400 "Unknown remote connection 'nope'"; env-only name → 400 mentioning `FFMPEG_REMOTE_CONNECTION`; `update({remoteEnabled:true})` with no connection → 400 "Remote executor needs a connection".
  - persisted set includes `remoteConnectionId:'c1'` and never `remoteUrl`/`saKeyEncrypted`.
  - `getStatus()` → `remoteConnection:{id:'c1', name:'ffmpeg', hasCredential:true, credentialSource:'db', envOnly:false, …}`, `connections:[{id:'c1', name:'ffmpeg', …}]`, and `JSON.stringify(status)` does not contain the SA key.
  - `testConnection({remoteConnection:'ffmpeg'})` builds overrides `{remoteUrl, remoteAuth, remoteSaKeyJson}` from that connection and calls `remote.testConnection(overrides)` + `remote.ready({fresh:true, env})` — same result shape as today.
  - `onModuleInit` (in a non-test env path — call `registerUsage()` directly) registers `'ffmpegExecutor'` probe that returns true when the resolved connection name matches.
  Run → FAIL.

- [ ] **Step 3: Implement the settings service changes.** Constructor adds `private readonly connections: RemoteConnectionsService` (direct injection is safe: RemoteConnectionsModule depends on nothing here). `CachedSettings` keeps `localEnabled, remoteEnabled, remoteConnectionId, defaultExecutor` (drop url/auth/key). `decode(row)`: `remoteConnectionId: row.remoteConnectionId ?? null`. `envManaged()` → `{ defaultExecutor, remoteConnection: envSet('FFMPEG_REMOTE_CONNECTION') || envSet('FFMPEG_REMOTE_URL') }`. `resolveWith(row)`:
```ts
const env = readFfmpegEnv(this.processEnv()); const managed = this.envManaged();
const name = managed.remoteConnection ? env.remoteConnection : row?.remoteConnectionId ? (this.connections.byId(row.remoteConnectionId)?.name ?? null) : null;
const conn = name ? this.connections.resolve(name) : null;
return { ...env, localEnabled: row?.localEnabled ?? true, executor: managed.defaultExecutor ? env.executor : (row?.defaultExecutor ?? env.executor),
  remoteConnection: conn?.name ?? null, remoteEnabled: conn !== null && (managed.remoteConnection ? true : (row?.remoteEnabled ?? false)),
  remoteUrl: conn?.url ?? null, remoteAuth: (conn?.auth === 'none' ? 'none' : 'google_id_token'), remoteSaKeyJson: conn?.credential ?? null, remoteMaxInflight: conn?.maxInflight ?? env.remoteMaxInflight };
```
`update()`: replace the URL/auth/key validation with the connection checks above; keep the local-FS `storagePresignable` rule and the "default must be enabled" rule verbatim. `persist()` writes `remoteConnectionId`. `getStatus()` builds `remoteConnection` from `conn` and `connections` from `this.connections.list()`. Add `onModuleInit`: `this.connections.registerUsageProbe('ffmpegExecutor', (n) => this.resolved().remoteConnection === n)` BEFORE the test-env early return. Update the controller `@ApiOperation` summaries ("the credential is never returned"; test draft = `{ remoteConnection }`).

- [ ] **Step 4: Executor + selector.** `remote-ffmpeg.executor.ts`: import `InflightFuse`/`RemoteBusyError`; replace `private inflight = 0` with `private readonly fuse: InflightFuse` from deps; in `run()`:
```ts
let release: () => void;
try { release = this.fuse.acquire(env.remoteConnection ?? 'ffmpeg', env.remoteMaxInflight); }
catch (e) { if (e instanceof RemoteBusyError) { const busy = new FfmpegBusyError('remote executor at capacity (connection max_inflight / FFMPEG_REMOTE_MAX_INFLIGHT)'); this.logFailure(job, busy, t0); throw busy; } throw e; }
try { … } finally { release(); }
```
Reason strings: `'no Worker URL configured (…FFMPEG_REMOTE_URL)'` → `'no remote connection selected (Admin Settings → Server video ops → Executor, or FFMPEG_REMOTE_CONNECTION / FFMPEG_REMOTE_URL)'`. Executor spec: add "shares the fuse: a second executor built with the same InflightFuse sees the first's in-flight job" and update the reason-string expectation. Selector `probe()`: `remote = { ready, maxInflight: this.config().remoteMaxInflight, …version, …reason }` (the selector already holds the config resolver — check its constructor; if it doesn't, add `@Optional() @Inject(FFMPEG_CONFIG) config: FfmpegConfigResolver = readFfmpegEnv`). Selector spec: assert `remote.maxInflight`. `ffmpeg.handler.ts` probe TSDoc + the MCP doc line for `ffmpeg_handler` (`remote?: {ready, version?, maxInflight, reason?}`).

- [ ] **Step 5: Wiring spec.** `ffmpeg-executor-wiring.spec.ts`: add `RemoteConnectionsService` (with `NODE_ENV=test` so it doesn't hit the DB) + `REMOTE_CONNECTIONS_PROVIDER` to the testing module; assert `app.get(RemoteFfmpegExecutor)` resolves and `app.get(REMOTE_CONNECTIONS).acquire` is a function; assert the module compiles within the existing timeout (this is the deadlock fence).

- [ ] **Step 6: Run everything ffmpeg + remote-connections:** `npx jest --testPathPattern 'src/(pipelines/ffmpeg|pipelines/handlers/ffmpeg|remote-connections)'` PASS; `npx tsc --noEmit`; `npx eslint <changed files>`.

- [ ] **Step 7: Commit** `feat(ffmpeg): remote executor reads its connection from remote_connections (FK + env FFMPEG_REMOTE_CONNECTION), shared fuse, probe reports maxInflight`

---

### Task 7: Migration 0044 (USER runs `db:generate`), backfill SQL, `.env.example`

**Files:**
- Generated: `apps/backend/drizzle/0044_<name>.sql` + `meta/` (by drizzle-kit)
- Modify: that SQL file (append backfill), `apps/backend/.env.example` (or wherever `FFMPEG_REMOTE_URL` is documented — `grep -rn FFMPEG_REMOTE_URL apps/backend/.env.example .env.example docker-compose*.yml`).

- [ ] **Step 1: Hand off to the user (STOP and ask):**
> Please run, in the worktree: `cd /home/rico/bffless/repos/ce/.claude/worktrees/remote-connections/apps/backend && pnpm db:generate` — expect drizzle to show `+ remote_connections` (8 columns, unique on name) and `+ ffmpeg_executor_settings.remote_connection_id` (FK, on delete set null). Name it `remote_connections`. Paste the generated file name.

- [ ] **Step 2: Append the backfill** to the generated file (after the last generated statement, each statement followed by `--> statement-breakpoint`):

```sql
--> statement-breakpoint
INSERT INTO "remote_connections" ("name","url","auth","credential_encrypted","health_path")
SELECT 'ffmpeg', "remote_url", "remote_auth", "sa_key_encrypted", '/health'
FROM "ffmpeg_executor_settings"
WHERE "remote_url" IS NOT NULL
ORDER BY "created_at" LIMIT 1
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
UPDATE "ffmpeg_executor_settings" s
SET "remote_connection_id" = c."id"
FROM "remote_connections" c
WHERE c."name" = 'ffmpeg' AND s."remote_url" IS NOT NULL AND s."remote_connection_id" IS NULL;
```

- [ ] **Step 3: Verify against a scratch Postgres** (the local dev stack has one — `pnpm dev:full` from `repos/ce`, or `docker run -d --name rc-pg -e POSTGRES_PASSWORD=pg -p 55432:5432 postgres:16`): with `DATABASE_URL=postgresql://postgres:pg@localhost:55432/postgres` run `pnpm db:migrate` up to 0043, insert a Plan-2 row (`INSERT INTO ffmpeg_executor_settings (remote_enabled, remote_url, remote_auth, sa_key_encrypted) VALUES (true,'https://w.run.app','google_id_token','v1:abc')`), migrate 0044, then `SELECT name,url,auth,credential_encrypted FROM remote_connections; SELECT remote_connection_id FROM ffmpeg_executor_settings;` → one `ffmpeg` row, FK set. Re-running the two backfill statements is a no-op. Record the psql output in the commit message body. Remove the scratch container.

- [ ] **Step 4: `.env.example`:** document `REMOTE_CONNECTION_<NAME>_URL / _AUTH / _CREDENTIAL_JSON / _MAX_INFLIGHT / _HEALTH_PATH`, `FFMPEG_REMOTE_CONNECTION`, and mark `FFMPEG_REMOTE_*` as aliases of `REMOTE_CONNECTION_FFMPEG_*`; add `REMOTE_REQUEST_MAX_SECONDS` (3600) and `REMOTE_REQUEST_MAX_RESPONSE_BYTES` (16777216).

- [ ] **Step 5: Commit** `feat(db): migration 0044 — remote_connections table, ffmpeg_executor_settings.remote_connection_id, backfill the ffmpeg connection`

---

### Task 8: `remote_request` handler (+ types, module, MCP doc line)

**Files:**
- Create: `apps/backend/src/pipelines/handlers/remote-request.handler.ts`, `remote-request.handler.spec.ts`
- Modify: `apps/backend/src/pipelines/types.ts` (add `'remote_request'` to `HandlerType`), `pipelines/handlers/index.ts` (export), `pipelines.module.ts` (provider), `mcp/tools/proxy-rules.tools.ts` (list + doc line; there is an `mcp/tools/proxy-rules.tools.ffmpeg.spec.ts` pattern — add the same kind of assertion for `remote_request`).

**Interfaces (spec §2.6):**
```ts
export interface RemoteRequestHandlerConfig extends BaseHandlerConfig {
  connection: string; path?: string; method?: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE';
  body?: string | Record<string, string>; headers?: Record<string, string>;
  timeoutSeconds?: number; failOnError?: boolean; condition?: string;
}
export interface RemoteRequestOutput { ok: boolean; status: number; body: unknown; latencyMs: number; connection: string; attempts: number }
export const REMOTE_REQUEST_DEFAULT_TIMEOUT_S = 300;
export function remoteRequestMaxSeconds(env = process.env): number  // REMOTE_REQUEST_MAX_SECONDS, default 3600
export function remoteRequestMaxResponseBytes(env = process.env): number // default 16 MiB
```
Constructor: `(registry: StepHandlerRegistry, expressionEvaluator: ExpressionEvaluator, @Inject(REMOTE_CONNECTIONS) connections: RemoteConnectionsPort)`; `readonly type = 'remote_request' as const`.

- [ ] **Step 1: Failing spec.** Build the handler with `registry = {register: jest.fn()}`, a real `ExpressionEvaluator`, and a fake port `{ resolve, client, acquire }` where `client()` returns `{ request: jest.fn() }`. Context: `{ request: { body: {...}, headers: {}, query: {} }, steps: {} } as PipelineContext` (copy the minimal context shape from `http-request.handler.spec.ts` if one exists, else from `delay.handler.spec.ts`). Cases:
  1. `validateConfig`: missing/invalid `connection` → `ConfigurationError`; bad method; `path` not starting with `/`; `timeoutSeconds` 0 or > max; `headers` containing `Authorization` (any case) → ConfigurationError.
  2. happy path: config `{connection:'svc', path:'/jobs', body:'request.body'}` → port `resolve('svc')` called; `client.request` called with `{ path:'/jobs', method:'POST', body: JSON.stringify(ctx.request.body), signal: expect.any(AbortSignal), maxResponseBytes: 16777216 }`; output `{ ok:true, status:200, body:{id:1}, latencyMs: number, connection:'svc', attempts:1 }`.
  3. `path` is an expression: `"'/jobs/' + request.query.id"` style — use whatever expression syntax the evaluator supports (`{{...}}` templates work per `evaluateExpression`; check the evaluator's template branch at `expression-evaluator.ts:226`) — assert the resolved path.
  4. `body` as `{ field: expression }` map → JSON of resolved fields; GET sends no body.
  5. `headers: { 'X-Job': 'steps.prev.id' }` resolved and lower-cased.
  6. unknown connection → `{ success:false, error:{ code:'REMOTE_CONNECTION_UNKNOWN' } }`.
  7. `acquire` throws `RemoteBusyError` → `REMOTE_BUSY`; release called after success AND after failure.
  8. `client.request` throws `RemoteTransportError` → `REMOTE_UNAVAILABLE` with `details.status` when present.
  9. request rejects with AbortError after the timeout (use jest fake timers, `timeoutSeconds:1`) → `REMOTE_TIMEOUT`.
  10. non-2xx: `failOnError` default → `REMOTE_REQUEST_ERROR` with `details:{status, body}`; `failOnError:false` → success with `ok:false`.
  11. `RemoteResponseTooLargeError` → `REMOTE_RESPONSE_TOO_LARGE`.

- [ ] **Step 2: Run — FAIL.** `npx jest --testPathPattern 'handlers/remote-request'`

- [ ] **Step 3: Implement.** Body/headers evaluation copied from `http-request.handler.ts` (same `evaluateExpression` calls; skip `forwardAuth`/`forwardHeaders`). Flow:
```ts
const conn = this.connections.resolve(config.connection);
if (!conn) return fail('REMOTE_CONNECTION_UNKNOWN', `No remote connection named '${config.connection}' on this instance (Admin Settings → Infrastructure → Remote connections).`);
let release: () => void;
try { release = this.connections.acquire(conn); } catch (e) { if (e instanceof RemoteBusyError) return fail('REMOTE_BUSY', e.message); throw e; }
const timeoutMs = Math.min(config.timeoutSeconds ?? REMOTE_REQUEST_DEFAULT_TIMEOUT_S, remoteRequestMaxSeconds()) * 1000;
const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
const t0 = Date.now();
try {
  const res = await this.connections.client(conn).request({ path, method, headers, body: bodyStr, signal: controller.signal, maxResponseBytes: remoteRequestMaxResponseBytes() });
  const output: RemoteRequestOutput = { ok: res.ok, status: res.status, body: res.body, latencyMs: Date.now() - t0, connection: conn.name, attempts: res.attempts };
  this.logger.log({ event: 'remote_request', connection: conn.name, path, method, status: res.status, latencyMs: output.latencyMs, attempts: res.attempts });
  if (!res.ok && config.failOnError !== false) return { success: false, error: { code: 'REMOTE_REQUEST_ERROR', message: `${conn.name} responded ${res.status}`, details: { status: res.status, body: res.body } } };
  return { success: true, output };
} catch (error) {
  if (error instanceof RemoteResponseTooLargeError) return fail('REMOTE_RESPONSE_TOO_LARGE', error.message);
  if ((error as {name?:string}).name === 'AbortError' || controller.signal.aborted) return fail('REMOTE_TIMEOUT', `remote request to ${conn.name} timed out after ${timeoutMs} ms`);
  if (error instanceof RemoteTransportError) return { success: false, error: { code: 'REMOTE_UNAVAILABLE', message: `remote connection '${conn.name}' unavailable: ${error.message}`, details: error.status !== undefined ? { status: error.status } : undefined } };
  return fail('REMOTE_UNAVAILABLE', error instanceof Error ? error.message : String(error));
} finally { clearTimeout(timer); release(); }
```
(`fail(code, message)` returns `{success:false, error:{code,message}}` and logs a warn line with the same event.) `path` default `'/'`; after evaluation must start with `/` else `REMOTE_UNAVAILABLE`? No — return `REMOTE_REQUEST_ERROR`? Use `ConfigurationError`-style runtime failure: `fail('REMOTE_INVALID_PATH', …)`. Add that code to the spec list (case 3b).

- [ ] **Step 4: Register:** `types.ts` union, `handlers/index.ts`, `pipelines.module.ts` providers (next to `HttpRequestHandler`). MCP `proxy-rules.tools.ts`: add `'remote_request'` to the handler list (line ~34) and a doc line right after `http_request`'s:
> `- remote_request: { connection: "<name of an admin-configured Remote connection (Settings → Infrastructure → Remote connections)>", path?: "/jobs" (expression, default '/'), method?: 'POST'(default)|'GET'|'PUT'|'PATCH'|'DELETE', body?: "expression" or { field: "expression" }, headers?: { "X-Header": "expression" } (never Authorization — the connection supplies it), timeoutSeconds?: number (default 300, max REMOTE_REQUEST_MAX_SECONDS=3600 — the request is HELD OPEN, use it for long jobs), failOnError?: boolean (default true) }. Calls a service this instance owns (Cloud Run reference; Google ID token minted per request or 'none' on a private network) with a per-connection in-flight fuse and one retry only when the service never received the request. OUTPUT is always { ok, status, body, latencyMs, connection, attempts } (read steps.name.body.<field>). Errors: REMOTE_CONNECTION_UNKNOWN | REMOTE_BUSY (fuse — retry later) | REMOTE_UNAVAILABLE (transport/auth, details.status when any) | REMOTE_TIMEOUT | REMOTE_REQUEST_ERROR (non-2xx when failOnError, details {status, body}) | REMOTE_RESPONSE_TOO_LARGE. Prefer http_request for public third-party APIs; remote_request for your own private services.`
  Add a `proxy-rules.tools.remote-request.spec.ts` asserting the tool description mentions `remote_request` and `REMOTE_BUSY` (mirror the ffmpeg one).

- [ ] **Step 5: Run — PASS:** `npx jest --testPathPattern 'handlers/remote-request|proxy-rules.tools'`; `npx tsc --noEmit`; eslint the new files.

- [ ] **Step 6: Commit** `feat(pipelines): remote_request handler — call a named remote connection with the platform identity, hold-open, fuse, retry-once`

---

### Task 9: Frontend API slice + types

**Files:**
- Modify: `apps/frontend/src/services/settingsApi.ts` — types near line 190 (ffmpeg block) and endpoints near line 540; add tag `'RemoteConnection'` to `tagTypes`.

**Interfaces (mirror Tasks 4/6 exactly):**
```ts
export type RemoteConnectionAuth = 'google_id_token' | 'none';
export interface RemoteConnectionStatus { id: string | null; name: string; url: string; auth: RemoteConnectionAuth | string; hasCredential: boolean; maxInflight: number; healthPath: string | null;
  source: { url: 'db'|'env'; auth: 'db'|'env'; credential: 'db'|'env'|null; maxInflight: 'db'|'env'; healthPath: 'db'|'env'; envOnly: boolean }; envOnly: boolean; usedBy: { ffmpegExecutor: boolean; rules: number } }
export interface UpsertRemoteConnectionDto { name?: string; url?: string; auth?: RemoteConnectionAuth; credential?: string | null; maxInflight?: number; healthPath?: string | null }
export interface RemoteConnectionTestDraft { id?: string; name?: string; url?: string; auth?: RemoteConnectionAuth; credential?: string | null; healthPath?: string | null }
export interface RemoteConnectionTestResult { ok: boolean; status: number | null; latencyMs: number | null; version?: string; error?: string; credential: 'sa_key' | 'adc' | 'none' }
export interface RemoteConnectionName { name: string; auth: string }
// ffmpeg (replace the old fields):
export interface FfmpegExecutorStatus { localAvailable; localVersion; localEnabled; remoteEnabled;
  remoteConnection: { id: string | null; name: string; url: string; auth: string; hasCredential: boolean; credentialSource: 'db'|'env'|null; envOnly: boolean } | null;
  connections: { id: string | null; name: string; auth: string; envOnly: boolean }[];
  defaultExecutor: FfmpegExecutorName; storagePresignable: boolean; envManaged: { defaultExecutor: boolean; remoteConnection: boolean } }
export interface UpdateFfmpegExecutorDto { localEnabled?; remoteEnabled?; remoteConnection?: string | null; defaultExecutor? }
export interface FfmpegExecutorTestDraft { remoteConnection?: string }
```
Endpoints: `listRemoteConnections` (GET `/api/settings/remote-connections`, provides `RemoteConnection`), `createRemoteConnection` (POST), `updateRemoteConnection` (PUT `/:id`, `{id, body}`), `deleteRemoteConnection` (DELETE `/:id`), `testRemoteConnection` (POST `/test`, no tags), `listRemoteConnectionNames` (GET `/api/remote-connections`, provides `RemoteConnection`). Mutations invalidate `['RemoteConnection', 'FfmpegExecutor']` (the executor status embeds connection data).

- [ ] **Step 1: Edit types + endpoints; export the hooks (`useListRemoteConnectionsQuery`, `useCreateRemoteConnectionMutation`, `useUpdateRemoteConnectionMutation`, `useDeleteRemoteConnectionMutation`, `useTestRemoteConnectionMutation`, `useListRemoteConnectionNamesQuery`).**
- [ ] **Step 2: `cd apps/frontend && npx tsc --noEmit`** — EXPECT errors in `FfmpegExecutorSettings.tsx` (+ its test) only; they are fixed in Task 11. Do not commit broken types alone — **fold this task's commit into Task 11's** unless the typecheck is clean.

---

### Task 10: Remote connections admin card (Infrastructure tab)

**Files:**
- Create: `apps/frontend/src/components/settings/remote-connections/WriteOnlySecretField.tsx`, `RemoteConnectionForm.tsx`, `RemoteConnectionsSettings.tsx`, `RemoteConnectionsSettings.test.tsx`
- Modify: `apps/frontend/src/pages/admin-settings/InfrastructureTab.tsx` (add `<RemoteConnectionsSettings />` after `<StorageSettings />`)

**Interfaces:**
```tsx
// WriteOnlySecretField — the Replace/Remove/textarea block lifted from FfmpegExecutorSettings (lines ~285–345)
export interface WriteOnlySecretFieldProps { id: string; label: string; stored: boolean; envManagedBy?: string | null; value: string; remove: boolean;
  onChange: (patch: { value?: string; remove?: boolean }) => void; placeholder?: string; help?: string; rows?: number }
// RemoteConnectionForm — controlled form used by the Add/Edit dialog
export interface ConnectionDraft { name: string; url: string; auth: RemoteConnectionAuth; credential: string; removeCredential: boolean; maxInflight: number; healthPath: string /* '' = none */ }
export function toConnectionDraft(c?: RemoteConnectionStatus): ConnectionDraft
export function toUpsertDto(existing: RemoteConnectionStatus | undefined, d: ConnectionDraft): UpsertRemoteConnectionDto  // partial diff for edit, full for create
export function RemoteConnectionForm(props: { draft: ConnectionDraft; existing?: RemoteConnectionStatus; onChange: (d: ConnectionDraft) => void; onTest: () => void; testing: boolean; testResult: RemoteConnectionTestResult | null })
// RemoteConnectionsSettings — Card with table + Add button + Dialog(RemoteConnectionForm) + per-row Edit/Test/Delete
```

- [ ] **Step 1: Failing test `RemoteConnectionsSettings.test.tsx`** (mock `@/services/settingsApi` hooks like `FfmpegExecutorSettings.test.tsx`; mock `@/hooks/use-toast`):
  1. renders one row per connection with name, URL host, auth badge ("Google ID token"/"None"), credential badge (`Key stored` / `ADC` / `—`), `Env` chip when `source.envOnly`, and "used by ffmpeg executor" chip.
  2. "Add connection" opens the dialog; typing name `My_Bad` shows the slug hint and disables Save; valid `pdf-renderer` + URL + Save calls `create` with `{ name:'pdf-renderer', url:'https://pdf.run.app', auth:'google_id_token', maxInflight: 8, healthPath: '/health' }` (no `credential` key when the textarea is empty).
  3. Edit on a row with `hasCredential:true`: the secret field shows Replace/Remove; clicking Remove then Save sends `credential: null`; typing a key sends the string; touching nothing sends no `credential` key.
  4. auth `none` shows the red destructive alert text "No authentication".
  5. Env-managed field (`source.url === 'env'`) renders the URL input disabled with a "Managed by REMOTE_CONNECTION_PDF_RENDERER_URL" badge; an env-only row has no Edit/Delete buttons (only Test).
  6. Delete asks for confirmation (`window.confirm` mocked → true) and calls `remove({id})`; a row with `usedBy.ffmpegExecutor` shows the Delete button disabled with title "In use by the ffmpeg Remote executor".
  7. Test in the dialog calls `test` with the draft `{ id?, url, auth, credential?, healthPath }` and renders `200 · 42 ms · v1.2.3` on success, the error string on failure.

- [ ] **Step 2: Run — FAIL.** `npx vitest run src/components/settings/remote-connections`

- [ ] **Step 3: Implement.** `WriteOnlySecretField`: exact behaviour of today's key editor (stored → Replace/Remove buttons + "will be removed on save" hint; not stored or replacing → Textarea + optional Cancel; envManagedBy → "Provided by the environment; not editable here." + `EnvBadge`). `RemoteConnectionForm`: fields Name (`Input`, disabled when editing an existing row that is `usedBy.ffmpegExecutor || usedBy.rules > 0`, hint "lower-case letters, digits and dashes; rules reference this name"), URL (`Input`, placeholder `https://my-service-xxxx-uc.a.run.app`), Auth (`RadioGroup` Google ID token / None + destructive `Alert` for none — copy the text from `FfmpegExecutorSettings`), credential (`WriteOnlySecretField`, only when auth = google_id_token; help "Optional. Leave empty to use Application Default Credentials…"), Max in-flight (`Input type=number` 1–64), Health path (`Input`, placeholder `/health`, help "empty = no probe"), Test connection button + result line (`CheckCircle2`/`XCircle`, `status · latencyMs ms · vX` or error, credential line as today). Env-managed fields: disabled + `EnvBadge` (`Managed by REMOTE_CONNECTION_${envName}_URL`, where `envName = name.toUpperCase().replace(/-/g,'_')`; for `ffmpeg` also mention `FFMPEG_REMOTE_URL`). `RemoteConnectionsSettings`: `Card` titled "Remote connections" with description "Named services this instance calls with its own identity (Cloud Run reference). Used by the ffmpeg Remote executor and `remote_request` pipeline steps."; `Table` (shadcn `@/components/ui/table`) columns Name / URL / Auth / Credential / In-flight / Used by / actions; `Dialog` (`@/components/ui/dialog`) hosting the form with Cancel/Save; toasts on save/delete errors via `errorMessage()` (copy the helper). Save = `create` for new, `update({id, body: toUpsertDto(existing, draft)})` for edit; disable Save when nothing changed or the name is invalid.

- [ ] **Step 4: Wire into `InfrastructureTab.tsx`; run tests PASS; `npx tsc --noEmit` (still expect only the FfmpegExecutorSettings errors until Task 11); `npx eslint src/components/settings/remote-connections`.**

- [ ] **Step 5: Visual check (optional but cheap):** `cd apps/frontend && pnpm dev` then `node /home/rico/bffless/localdev-tools/shot.mjs http://localhost:5173/admin/settings --out /tmp/claude-1000/-home-rico-bffless/*/scratchpad/rc.png --full` — the tab needs a session, so a "couldn't reach server" fallback is expected; skip if it blocks.

- [ ] **Step 6: Commit** (with Task 9's slice changes) `feat(settings): Remote connections admin card (Infrastructure tab) + RTK endpoints`

---

### Task 11: Re-shape the ffmpeg Executor panel around a connection picker

**Files:**
- Modify: `apps/frontend/src/components/settings/FfmpegExecutorSettings.tsx`, `FfmpegExecutorSettings.test.tsx`

**Behaviour:** `Draft` becomes `{ localEnabled, remoteEnabled, remoteConnection: string /* '' = none */, defaultExecutor }`; `diff()` emits `remoteConnection: d.remoteConnection || null` when changed. Remote section (when `draft.remoteEnabled`): a `Select` (`@/components/ui/select`) labelled "Connection" listing `status.connections` (`envOnly` entries rendered disabled with " (env — select with FFMPEG_REMOTE_CONNECTION)"), disabled + `EnvBadge name="FFMPEG_REMOTE_CONNECTION / FFMPEG_REMOTE_URL"` when `status.envManaged.remoteConnection`; below it a summary line for the selected connection (`url` host · auth label · `Key stored`/`ADC`/`No auth` badge); **Test connection** button (disabled without a selection) → `testConnection({ remoteConnection: draft.remoteConnection })`, result rendering unchanged (worker version/ffmpeg/ops/latency, readiness, credential); a muted link "Manage connections in Infrastructure →" (`<a href="/admin/settings?tab=infrastructure">` — check how tabs are addressed in `AdminSettingsPage.tsx` and use the same param; if none, plain text "Manage connections under Admin Settings → Infrastructure"). `remoteSelectable = draft.remoteEnabled && draft.remoteConnection !== ''`. Empty `connections` → helper text "No remote connections yet — add one under Infrastructure → Remote connections." and the Remote switch stays enabled (turning it on just shows that text). Remove: URL input, auth radio, key editor, `replacingKey` state.

- [ ] **Step 1: Rewrite the test file** to the new status shape (`remoteConnection: null, connections: [{id:'c1', name:'ffmpeg', auth:'google_id_token', envOnly:false}], envManaged: {defaultExecutor:false, remoteConnection:false}`): (a) shows local version and the remote radio disabled until a connection is picked; (b) picking `ffmpeg` in the Select + Save calls `update({ remoteEnabled: true, remoteConnection: 'ffmpeg' })` (adapt to what the flow produces — enabling first then picking); (c) env-managed → Select disabled + badge; (d) Test button calls `testConnection({ remoteConnection:'ffmpeg' })` and renders `Worker 0.4.31`; (e) empty connections → helper text. Keep any existing default-executor auto-move test, adjusted.
- [ ] **Step 2: Run — FAIL. Implement. Run — PASS.** `npx vitest run src/components/settings/FfmpegExecutorSettings.test.tsx`; `npx tsc --noEmit` clean for the whole frontend now; eslint the file.
- [ ] **Step 3: Commit** `feat(settings): ffmpeg Executor panel picks a remote connection (URL/auth/key editing moved to Remote connections)`

---

### Task 12: `remote_request` step editor in the pipeline builder

**Files:**
- Create: `apps/frontend/src/components/pipelines/handlers/RemoteRequestConfig.tsx`, `RemoteRequestConfig.test.tsx`
- Modify: `apps/frontend/src/components/pipelines/handlers/types.ts` (add `RemoteRequestHandlerConfig` mirroring the backend interface + union member), `HandlerConfigWrapper.tsx` (import, `case 'remote_request'` rendering `{renderVariablesPanel()}<RemoteRequestConfig config onChange previousSteps />`, label `remote_request: 'Remote Request'`, description `remote_request: 'Call an admin-configured remote connection (Cloud Run etc.) with the platform identity'`), `PipelineConfig.tsx` (add `'remote_request'` to the `Other` group after `http_request`).

- [ ] **Step 1: Failing test:** mock `useListRemoteConnectionNamesQuery` → `{data:[{name:'ffmpeg',auth:'google_id_token'},{name:'pdf',auth:'none'}]}`; (a) renders a Select with both names and a "None" badge next to `pdf`; (b) choosing `pdf`, typing path `/render`, method POST, body expression `request.body` → `onChange` last call equals `{ connection:'pdf', path:'/render', method:'POST', body:'request.body', failOnError:true, timeoutSeconds: 300 }` (omit undefined keys); (c) empty list → helper text "No remote connections configured — an admin adds them under Settings → Infrastructure"; (d) `timeoutSeconds` input clamps to 1..3600 (write the max as a constant `REMOTE_REQUEST_MAX_SECONDS_UI = 3600` with a comment that the server enforces `REMOTE_REQUEST_MAX_SECONDS`).
- [ ] **Step 2: Implement** modelled on `HttpRequestConfig.tsx` (same `useState` + `useEffect → onChange` pattern; reuse its body-mode (expression | fields) and headers editors; drop forwardAuth/forwardHeaders; add the connection `Select`, `path` `ExpressionInput` (`./ExpressionInput` — check its props), `timeoutSeconds` number input, `failOnError` switch with the copy: "Halt the pipeline on non-2xx (off: the step outputs {ok:false, status, body} and the next step can branch)"). Show a one-line note: "Output is always `{ ok, status, body, latencyMs, connection, attempts }` — read fields as `steps.<name>.body.<field>`."
- [ ] **Step 3: Run PASS; `npx tsc --noEmit`; eslint. Commit** `feat(pipelines-ui): remote_request step editor with connection picker`

---

### Task 13: Integration coverage (env-gated) + CONTEXT.md glossary + spec as-built notes

**Files:**
- Modify: `apps/backend/src/pipelines/__tests__/integration/ffmpeg.remote.spec.ts` (env-gated on `FFMPEG_IT_MINIO_ENDPOINT` — read its `beforeAll` env setup at lines ~100–120 and ~160–190)
- Create: `apps/backend/src/pipelines/__tests__/integration/remote-request.spec.ts` (same gate)
- Modify: `CONTEXT.md` (glossary), `docs/superpowers/specs/2026-08-18-remote-connections-design.md` (as-built section)

- [ ] **Step 1: `ffmpeg.remote.spec.ts`:** where it sets `FFMPEG_REMOTE_URL`/`FFMPEG_REMOTE_AUTH=none` env for the executor, nothing changes functionally (aliases) — but assert the new plumbing once: build the `RemoteFfmpegExecutor` with `deps.fuse = new InflightFuse()` and after a job assert `fuse.inflight('ffmpeg') === 0`. Keep the rest untouched.
- [ ] **Step 2: `remote-request.spec.ts`:** gated identically (`RUN ? describe : describe.skip`); spins up (or expects) the compose Worker exactly as the ffmpeg suite does (`WORKER_URL` from `FFMPEG_IT_WORKER_URL` — check the ffmpeg suite's variable name and reuse it). Build `RemoteConnectionsService` with `processEnv = () => ({ REMOTE_CONNECTION_WORKER_URL: workerUrl, REMOTE_CONNECTION_WORKER_AUTH: 'none' })` (NODE_ENV=test so no DB), then a `RemoteRequestHandler` with a port `{ resolve: (n) => svc.resolve(n), client: (c) => svc.client(c), acquire: (c) => svc.fuse.acquire(c.name, c.maxInflight) }`. Cases: `{connection:'worker', path:'/health', method:'GET'}` → `success:true, output.status:200, output.body.ok:true`; `{connection:'worker', path:'/jobs', method:'POST', body:'{"v":1}'}` (bad envelope) → `REMOTE_REQUEST_ERROR` with `details.status` 400; same with `failOnError:false` → success, `output.ok:false`.
- [ ] **Step 3: Run the gated suites locally if MinIO + Worker are available** (`docker compose --profile ffmpeg-worker up -d` + `FFMPEG_IT_MINIO_ENDPOINT=http://localhost:9000 npx jest --testPathPattern 'integration/(ffmpeg.remote|remote-request)'`); otherwise run un-gated to confirm they skip cleanly and note "not run locally" in the commit body.
- [ ] **Step 4: `CONTEXT.md`** — under *Server video ops* (or a new *Remote connections* entry next to it) add: **Remote connection** (instance-level, admin-owned named service URL + auth the instance calls with its own identity; referenced by name from `remote_request` steps and by the ffmpeg Remote executor), **Fuse** (per-connection in-flight ceiling), **`remote_request`** (the handler). Follow the file's existing entry format.
- [ ] **Step 5: Spec as-built section** appended to the design spec: (a) connection names forbid `_` (regex `^[a-z0-9][a-z0-9-]{0,63}$`); (b) `FfmpegEnvConfig` KEEPS `remoteUrl/remoteAuth/remoteSaKeyJson/remoteMaxInflight` as fields *derived* from the connection (plus `remoteConnection` name) instead of dropping them — smaller executor churn; (c) `WorkerClient extends RemoteClient` (transport generalised, ffmpeg validation kept in the subclass; ID-token minters are per client, not shared between the executor and the handler); (d) `RemoteClient.request` resolves for every status (callers decide); (e) `REMOTE_INVALID_PATH` error code added; (f) `usedBy.rules` is a best-effort `LIKE` scan; (g) `FFMPEG_REMOTE_CONNECTION` env added.
- [ ] **Step 6: Commit** `test(remote-connections): env-gated integration coverage; docs: CONTEXT glossary + spec as-built notes`

---

### Task 14: PR-readiness pass (full suites, review checklist, PR body draft) — then STOP for the user

- [ ] **Step 1: Full backend + frontend suites:** `cd apps/backend && pnpm test` (all, with coverage) and `cd apps/frontend && pnpm test`; `pnpm --filter backend exec tsc --noEmit`; `pnpm --filter frontend exec tsc --noEmit`; `pnpm build:backend`. Fix anything red.
- [ ] **Step 2: Read `.claude/ce-pr-review-checklist.md` and walk it (backwards-compat first):** every Plan-2 install keeps working with FFMPEG_REMOTE_* env only (env-only `ffmpeg` connection); a DB-configured install is backfilled; the ffmpeg settings API shape changed (`remoteUrl` etc. removed) — frontend ships in the same image, and no other consumer reads `/api/settings/ffmpeg-executor` (grep `repos/apps`, `repos/skills` for it to be sure; note the result).
- [ ] **Step 3: Draft the PR body** into `.superpowers/sdd/2026-08-18-remote-connections/pr-body.md`: title `feat(pipelines): remote connections + remote_request handler — lift the Cloud Run connection out of ffmpeg settings (Plan 4)`; sections What / Why (link spec) / Migration 0044 + backfill (paste the psql verification) / Follow-ups (0045 column drop, apps `remote.maxInflight`, skills row, docs page) / How to test on bffless.dev (preview channel: Connections card shows `ffmpeg`, Executor panel has it selected, probe `remote.ready`, a Studio remote cut, a scratch `remote_request → /health` rule).
- [ ] **Step 4: STOP. Report to the user:** branch, commit list (`git log --oneline origin/main..HEAD`), test results, the PR body path — and ask for approval to push + open the PR. Do not push.

---

### Task 15: Skills table row + docs page (separate repos; after the user approves the CE PR)

**Files:**
- `repos/skills` (worktree `.claude/worktrees/remote-connections`, branch `feat/remote-connections`): `plugins/bffless/skills/pipelines/SKILL.md` — add the row `| **Remote Request** | \`remote_request\` | Call an admin-configured remote connection (Cloud Run etc.) with the platform identity; long hold-open, per-connection fuse |` after the HTTP Request row, and a short section "Remote connections" (what they are, where admins create them, config example, output shape, error codes — copy from the MCP doc line in Task 8).
- `repos/docs-public` (worktree `.claude/worktrees/remote-connections`, branch `docs/remote-connections`): new `docs/features/remote-connections.md` (Concept · Create a connection (UI + env vars table incl. legacy aliases) · Auth modes (Google ID token / SA key vs ADC / none) · Test connection · `remote_request` step reference (config, output, errors) · Sizing the fuse (`max_inflight` ≈ Cloud Run `--max-instances`) · Troubleshooting (REMOTE_UNAVAILABLE decision tree, 403 = missing `run.invoker`)); update `docs/features/server-video-ops.md` Executor section: "Remote uses a *remote connection* — configure it under Infrastructure → Remote connections, then pick it here"; env var reference: `FFMPEG_REMOTE_CONNECTION` + aliases. Add both pages to the sidebar if the site uses an explicit `sidebars.*` file.
- [ ] Each repo: worktree from `origin/main`, edit, `pnpm build` (docs) to verify, commit locally, STOP and ask before push/PR.

---

### Task 16: Epic bookkeeping (after the user approves)

- [ ] File the CE epic issue `bffless/ce`: "Remote connections + remote_request handler (ffmpeg Remote executor Plan 4)" — body = spec summary + task checklist + follow-ups (0045 column drop as its own issue; link apps#346). File the 0045 follow-up issue. File the apps issue "Studio: read probe `remote.maxInflight` instead of `REMOTE_FFMPEG_MAX`" in `bffless/apps` (reference `apps/studio/src/lib/autoBuild.ts:108`).
- [ ] Post a status comment on `bffless/apps#346` linking the CE PR, the issues, and the docs/skills PRs.
- [ ] Update memory `ffmpeg-remote-executor-design.md` (Plan 4 status) — the session's own bookkeeping, not part of the repo.

---

## Self-review (done while writing)

- **Spec coverage:** D1 (instance-level) → Task 5 routes are admin-only; D2 → Task 8; D3 (by name) → Tasks 4/8/12; D4 (`healthPath`, version optional; min_version stays ffmpeg) → Tasks 1/4/6; D5 (shared fuse) → Tasks 2/5/6/8; D6 → Task 1 types + Task 4 validation; D7 (env, aliases) → Tasks 1/4/6/7; D8 (FK, dropdown-only) → Tasks 1/6/11; D9 (0044 backfill, 0045 later) → Tasks 7/16; D10/D11 → Task 3; D12 → Task 8; D13 → Task 3 (WorkerClient semantics preserved); D14 → Tasks 6/16. Spec §3.1 endpoints → Task 5; §3.2 card → Task 10; §3.3 panel → Task 11; §4 tests → each task + Task 13; §5 docs/skill → Task 15.
- **Type consistency:** `ResolvedConnection`/`RemoteConnectionStatus`/`RemoteConnectionTestResult` are defined once (Tasks 1/4) and mirrored verbatim in Task 9; `RemoteConnectionsPort { resolve, client, acquire }` (Task 5) is what Task 8's handler and Task 13's integration spec use; `FfmpegEnvConfig.remoteConnection` (Task 6) is what Task 11's DTO `remoteConnection` maps to; `RemoteClient.probe()` (not `health()`) is the generic probe (Task 3) — Task 4's `test()` calls `probe`.
- **Deviation from spec, deliberate:** connection names forbid `_`; `FfmpegEnvConfig` keeps derived URL/auth/key fields; recorded in Task 13's as-built notes.
