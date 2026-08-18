# Remote connections + `remote_request` handler — Design Spec

- **Date:** 2026-08-18
- **Status:** proposed (decisions D1–D14 locked with the user 2026-08-18; not yet built)
- **Repos:** `bffless/ce` (resource, handler, settings UI, migration), `bffless/skills` (pipelines skill table), `bffless/docs` (new page + Server video ops update), `bffless/apps` (small Studio follow-up)
- **Predecessor:** `2026-08-17-ffmpeg-remote-executor-design.md` — Plans 1–3 of the ffmpeg Remote executor (CE #684/#685/#686, apps#347). This is **Plan 4** of epic bffless/apps#346.

## Why

Plan 2 gave the ffmpeg Remote executor a Cloud Run connection — URL, auth mode
(`google_id_token | none`), a write-only AES-GCM service-account key, an in-flight fuse,
a health probe and a hold-open HTTP client with retry-once — but buried all of it inside
`ffmpeg_executor_settings` and `RemoteFfmpegExecutor`. That connection is not
ffmpeg-specific: it is "how this CE instance calls a private service it owns, with the
platform's identity, and waits as long as the job takes". The next worker (Whisper
transcription, a PDF renderer, anything an org runs on Cloud Run / Lambda) would have to
re-implement the token minting, the fuse and the transport, and every rule author would
otherwise hand-build `Authorization` headers in `http_request` from copied secrets.

This spec lifts the connection into a first-class **instance-level resource**
(`remote_connections`), points the ffmpeg executor at one row of it, and adds a generic
**`remote_request`** pipeline handler that calls any connection from any pipeline. Cloud
Run stays the reference deployment, not the name (D10 of the predecessor spec).

## Locked decisions

| # | Decision | Choice |
| --- | --- | --- |
| D1 | Scope of a connection | **Instance-level, admin-only.** One list per instance under Admin Settings → Infrastructure → *Remote connections*; any project's rules may name any connection. Project-level connections are a possible later layer (project → instance resolution), not v1. |
| D2 | Handler | **New `remote_request` handler**, not a `connection:` field on `http_request`. `http_request` keeps its 120 s cap, global-fetch transport and legacy dual output shape; `remote_request` has its own contract (long hold-open, fuse, retry-once, own error codes). |
| D3 | Reference by | **`name`** (unique slug), never UUID — rules-as-code stays portable across instances and env-defined connections have no UUID. |
| D4 | What a connection is | Generic: `{ name, url, auth, credential (write-only), max_inflight, health_path? }`. **`FFMPEG_WORKER_MIN_VERSION` stays an ffmpeg-only check**; the connection's Test/probe reports status + latency and a `version` only if the health JSON carries one. |
| D5 | Fuse | **Per connection, one shared in-flight counter** — the ffmpeg executor and every `remote_request` step naming the same connection draw from it. `FFMPEG_REMOTE_MAX_INFLIGHT` becomes the `ffmpeg` connection's `max_inflight` (env alias kept). No per-step fuse. |
| D6 | Auth modes v1 | `google_id_token` (Cloud Run IAM; SA key or ADC) and `none` (private network; red banner). The column is a free string so `aws_sigv4` / `bearer_secret` can be added without a migration; they are **out of scope** here. |
| D7 | Env-defined connections | `REMOTE_CONNECTION_<NAME>_{URL,AUTH,CREDENTIAL_JSON,MAX_INFLIGHT,HEALTH_PATH}`; env wins **per field** over a DB row with the same name (Plan 2's env-over-DB rule). Legacy `FFMPEG_REMOTE_URL/_AUTH/_SA_KEY_JSON/_MAX_INFLIGHT` are aliases of `REMOTE_CONNECTION_FFMPEG_*` and keep working unchanged. |
| D8 | ffmpeg re-pointing | `ffmpeg_executor_settings.remote_connection_id` FK (nullable, `ON DELETE SET NULL`). Executor panel picks a connection from a dropdown; URL/auth/key editing lives **only** in the Connections card. |
| D9 | Migration sequencing | **Release N (this work): migration 0044** = `CREATE remote_connections` + `ADD COLUMN remote_connection_id` + hand-appended SQL backfill (one connection named `ffmpeg` from the existing url/auth/key). Old columns stay (rollback-safe). **Release N+1 (separate issue/PR): migration 0045** drops `remote_url`, `remote_auth`, `sa_key_encrypted` — only after N is verified on bffless.dev. |
| D10 | Execution model | Synchronous only: one held-open HTTP request per step, bounded by `timeoutSeconds`. No Cloud Run Jobs / polling. |
| D11 | Retry | Unchanged from predecessor D9: **retry once, only when the service demonstrably never took the request** — fetch threw before any response byte, or 429/503 (front door). Never on a body, never after abort. |
| D12 | Output shape | `remote_request` **always** outputs `{ ok, status, body, latencyMs, connection, attempts }` — one shape, no `failOnError`-dependent dual shape. `failOnError` (default `true`) only decides whether a non-2xx halts the pipeline. |
| D13 | Wire compatibility | No change to the Worker image or the ffmpeg job envelope. `RemoteFfmpegExecutor` keeps its behaviour; only where it gets URL/auth/fuse/client from changes. |
| D14 | Studio follow-up | Probe `remote` gains `maxInflight` so Studio can drop the hard-coded `REMOTE_FFMPEG_MAX = 8` (`apps/studio/src/lib/autoBuild.ts`) — a small apps issue, not part of the CE PR. |

## Glossary

- **Remote connection** — an admin-configured, named, credential-bearing base URL of a
  service this instance calls with its own identity. Instance-level.
- **Connection source** — where each field of a resolved connection came from: `db` or `env`.
  Env-only connections exist without a DB row and are read-only in the UI.
- **Fuse** — the per-connection in-flight ceiling (`max_inflight`); breach → `REMOTE_BUSY`
  (`FFMPEG_BUSY` on the ffmpeg path) immediately, no queueing.
- **RemoteClient** — the generalised transport (today `WorkerClient`): auth header
  provider + undici no-timeout Agent + retry-once + health probe.

## Part 1 — Data model + migration (CE)

### 1.1 Schema (`apps/backend/src/db/schema/remote-connections.schema.ts`)

```ts
export const remoteConnections = pgTable('remote_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Slug rules name it by: ^[a-z0-9][a-z0-9_-]{0,63}$. Unique. */
  name: varchar('name', { length: 64 }).notNull().unique(),
  /** Base URL, trimmed, trailing slash stripped. https unless auth = 'none'. */
  url: text('url').notNull(),
  /** 'google_id_token' | 'none' (free string: later 'aws_sigv4', 'bearer_secret'). */
  auth: varchar('auth', { length: 32 }).default('google_id_token').notNull(),
  /** encryptString(<credential>) — for google_id_token: the SA JSON key; null = ADC / none. WRITE-ONLY. */
  credentialEncrypted: text('credential_encrypted'),
  /** Fuse: max concurrent in-flight requests from this instance to this connection. */
  maxInflight: integer('max_inflight').default(8).notNull(),
  /** GET <url><healthPath> for Test / readiness; null = no probe. */
  healthPath: varchar('health_path', { length: 255 }).default('/health'),
  createdAt, updatedAt, updatedByUserId
});
```

`ffmpeg-executor-settings.schema.ts` gains

```ts
remoteConnectionId: uuid('remote_connection_id').references(() => remoteConnections.id, { onDelete: 'set null' }),
```

and its TSDoc marks `remoteUrl`, `remoteAuth`, `saKeyEncrypted` **deprecated — dropped in
the next release (follow-up issue filed with this PR)**; no code reads them after this change.

### 1.2 Migration 0044 (user runs `pnpm db:generate`; the backfill block is appended by hand)

```sql
-- generated: CREATE TABLE remote_connections (...); ALTER TABLE ffmpeg_executor_settings ADD COLUMN remote_connection_id uuid; + FK
-- hand-appended backfill: lift the existing single row into a connection named 'ffmpeg'
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

- The encrypted key copies byte-for-byte (same `ENCRYPTION_KEY`, same
  `common/crypto/aes-gcm.ts` format) — no decrypt in SQL.
- `max_inflight` takes the column default 8 (= today's `FFMPEG_REMOTE_MAX_INFLIGHT` default).
- Env-only instances (`FFMPEG_REMOTE_URL` set, no row) insert nothing; the env alias
  synthesises the `ffmpeg` connection at runtime (D7).
- Idempotent (`ON CONFLICT DO NOTHING`, `IS NULL` guard) so a re-run is harmless.

### 1.3 Migration 0045 (release N+1, separate PR)

`ALTER TABLE ffmpeg_executor_settings DROP COLUMN remote_url, DROP COLUMN remote_auth, DROP COLUMN sa_key_encrypted;`
Filed as a follow-up issue in the epic status comment; merge gate = the backfilled
`ffmpeg` connection observed working on bffless.dev.

## Part 2 — Backend runtime (CE)

New module `apps/backend/src/remote-connections/` (imported by `PipelinesModule`; the
ffmpeg code depends on it, never the reverse):

```
remote-connections/
  remote-connections.module.ts
  remote-connections.schema-types.ts      // ResolvedConnection, ConnectionSource
  remote-connections-env.ts               // REMOTE_CONNECTION_<NAME>_* + FFMPEG_REMOTE_* aliases → env connections
  remote-connections.service.ts           // DB CRUD + decrypt-into-cache + env merge → resolve(name) (sync)
  remote-connections.controller.ts        // /api/settings/remote-connections (admin) + /api/remote-connections (names)
  remote-client.ts                        // moved+generalised from pipelines/ffmpeg/executor/remote/worker-client.ts
  auth/id-token.ts, auth/no-auth.ts       // moved from pipelines/ffmpeg/executor/remote/id-token.ts
  fuse.ts                                 // InflightFuse: acquire(name, max) → release | throws RemoteBusyError
  remote-connections.tokens.ts            // REMOTE_CONNECTIONS (lazy resolver token, see 2.4)
```

### 2.1 Resolution (`RemoteConnectionsService`)

```ts
interface ResolvedConnection {
  name: string; url: string; auth: 'google_id_token' | 'none' | string;
  credential: string | null;         // decrypted, in memory only
  maxInflight: number; healthPath: string | null;
  source: { url: 'db'|'env'; auth: 'db'|'env'; credential: 'db'|'env'|null; maxInflight: 'db'|'env'; healthPath: 'db'|'env'; envOnly: boolean };
}
resolve(name): ResolvedConnection | null   // sync — executors/handlers call it per request
list(): ResolvedConnection[]               // db rows ∪ env-only names, env fields applied
```

- Same shape as Plan 2's `FfmpegExecutorSettingsService`: load DB rows at boot and after
  every write into an in-memory cache (one backend process per instance), decrypt once,
  `loadState: ok|empty|error` guard so a failed load never lets an update clobber a row.
- Env merge per D7: the env reader scans `REMOTE_CONNECTION_<NAME>_<FIELD>`; `<NAME>` is
  the connection name upper-cased with `-` replaced by `_` (so `pdf-renderer` ⇔
  `REMOTE_CONNECTION_PDF_RENDERER_URL`; a name containing `_` maps identically, which is
  why the DB validation rejects names that differ only by `-`/`_`). Env fields override
  the DB row's field-by-field; a name with env fields and no row is `envOnly`.
  Legacy `FFMPEG_REMOTE_URL/_AUTH/_SA_KEY_JSON/_MAX_INFLIGHT` map to name `ffmpeg`;
  if both legacy and explicit `REMOTE_CONNECTION_FFMPEG_*` are set, the explicit form wins.
- Validation on write (mirrors Plan 2): name slug + unique; URL parses; `https:` unless
  `auth = 'none'`; credential for `google_id_token` must be JSON with `type:
  "service_account"`; `maxInflight` 1..64; env-managed fields refuse edits with the same
  "managed by … on this instance" `BadRequestException` wording.
- `credential` semantics on update: `undefined` keep, `null`/`''` clear, string replace.

### 2.2 Transport (`RemoteClient`, ex-`WorkerClient`)

```ts
class RemoteClient {
  constructor(conn: ResolvedConnection, fetchImpl = jobFetch(), sleep?)
  request(opts: { path: string; method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'; headers?: Record<string,string>; body?: string; signal: AbortSignal; maxResponseBytes: number }): Promise<{ status: number; headers: Headers; body: unknown /* parsed JSON or text */; attempts: 1|2 }>
  health(opts?): Promise<{ status: number; latencyMs: number; body: unknown }>   // GET url+healthPath, 5 s bound, never retried
}
```

- The undici no-timeout `Agent` (`JOB_AGENT_OPTIONS`) and `jobFetch()` singleton move
  here unchanged. Retry-once per D11 lives here, once, for both callers.
- Auth header provider chosen by `conn.auth`: `IdTokenMinter(conn.credential)` (audience
  = URL origin, client cached per audience, unchanged) or `NoAuth`. Unknown `auth` →
  `RemoteUnavailableError('unsupported auth mode …')`.
- Clients are memoised per connection **and config fingerprint** (url+auth+credential
  hash) so an admin edit invalidates the cached minter without a restart. Owned by the
  service: `client(name): RemoteClient`.
- The ffmpeg-specific pieces (`WorkerEnvelope`, `isWorkerResponse`, `WorkerHealth`
  version check) stay in `pipelines/ffmpeg/executor/remote/`; `RemoteFfmpegExecutor`
  calls `client.request({path:'/jobs', method:'POST', body: JSON.stringify(envelope)})`
  and validates the body with `isWorkerResponse` as today. `worker-client.ts` is deleted;
  its spec becomes `remote-client.spec.ts` + a thin envelope-validation spec.

### 2.3 Fuse (`InflightFuse`)

One `Map<name, count>` in the service. `acquire(conn)` throws `RemoteBusyError` when
`count >= conn.maxInflight`, else increments and returns `release()`. `RemoteFfmpegExecutor`
replaces its private `inflight` counter with `acquire`; `FfmpegBusyError` wraps
`RemoteBusyError` there so the ffmpeg error code stays `FFMPEG_BUSY`.

### 2.4 DI wiring

Same lazy pattern Plan 2 needed: `REMOTE_CONNECTIONS` token = `{ resolve: (name) => ref.get(RemoteConnectionsService).resolve(name), client: (name) => …, acquire: … }` resolved through `ModuleRef` on first use. `FFMPEG_REMOTE_DEPS` gains
`connection?: () => ResolvedConnection | null` (the ffmpeg settings' pick) and drops the
URL/auth/key fields from `FfmpegEnvConfig` (`remoteUrl`, `remoteAuth`, `remoteSaKeyJson`,
`remoteMaxInflight` → replaced by `remoteConnection: string | null` = the connection
*name*). `ffmpeg-executor-wiring.spec.ts` extends to assert the new token resolves lazily.

### 2.5 ffmpeg settings service changes

- `resolved()` returns `remoteConnection` (name) — from env `FFMPEG_REMOTE_CONNECTION=<name>`
  (new; env-managed) → else legacy `FFMPEG_REMOTE_URL` set ⇒ `'ffmpeg'` → else the DB
  FK's row name → else `null`. `remoteEnabled` requires a resolvable connection.
- Status: `remoteConnection: { id: string | null, name, url, auth, hasCredential, source, envOnly } | null`,
  `envManaged.remoteConnection`; the fields `remoteUrl`, `remoteAuth`, `hasSaKey`,
  `saKeySource` are removed (frontend ships in the same PR). Update DTO:
  `remoteConnectionId?: string | null` (id, since the UI holds rows; env-only connections
  have no id and can only be selected via env). Refuses enabling Remote with no connection.
- `testConnection(draft)` → tests the picked/draft connection **plus** ffmpeg readiness
  (storage presignable, min version) — same result shape as today.
- `RemoteFfmpegExecutor.ready()` reads the connection through `deps.connection()`;
  reason strings change from "FFMPEG_REMOTE_URL" wording to "no remote connection selected
  (Admin Settings → Server video ops → Executor, or FFMPEG_REMOTE_CONNECTION)".
- Deleting a connection the ffmpeg settings reference: `409 Conflict` ("in use by the
  ffmpeg Remote executor — pick another connection first"). Rules that name it are
  counted best-effort (`usedByRules: n`, JSON scan of pipeline configs) and shown as a
  warning, not a block.

### 2.6 `remote_request` handler (`apps/backend/src/pipelines/handlers/remote-request.handler.ts`)

```ts
interface RemoteRequestHandlerConfig extends BaseHandlerConfig {
  /** Connection name (static). Required. */
  connection: string;
  /** Path appended to the connection URL (expression). Default '/'. Must start with '/'. */
  path?: string;
  /** Default 'POST'. */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Expression → object/string, or { field: expression }. JSON-encoded. Non-GET only. */
  body?: string | Record<string, string>;
  /** Extra headers (expression values). Cannot set Authorization (the connection owns it). */
  headers?: Record<string, string>;
  /** Hold-open ceiling. Default 300; max REMOTE_REQUEST_MAX_SECONDS (default 3600). */
  timeoutSeconds?: number;
  /** Default true: non-2xx halts with REMOTE_REQUEST_ERROR. false: returned in output. */
  failOnError?: boolean;
  condition?: string;
}
```

Output (D12): `{ ok, status, body, latencyMs, connection, attempts }`.

Errors: `REMOTE_CONNECTION_UNKNOWN` (no such connection on this instance — a runtime step
error, not `validateConfig`, so rules-as-code can sync before the admin creates it),
`REMOTE_UNAVAILABLE` (transport failure after the retry, auth minting failure, unsupported
auth mode, 429/503 after retry — `details.status` when there is one), `REMOTE_BUSY`
(fuse), `REMOTE_TIMEOUT` (`timeoutSeconds` breached — request aborted, Worker-style
services treat disconnect as cancel), `REMOTE_REQUEST_ERROR` (non-2xx with
`details.{status,body}` when `failOnError`), `REMOTE_RESPONSE_TOO_LARGE`
(`REMOTE_REQUEST_MAX_RESPONSE_BYTES`, default 16 MiB).

`validateConfig`: `connection` required + slug-shaped; `method` in set; `path` starts
with `/` when static; `timeoutSeconds` 1..max; `headers` must not contain `authorization`
(case-insensitive). One structured log event `remote_request` `{connection, path, method,
status, latencyMs, attempts, code?}` mirroring `ffmpeg_remote_job`.

### 2.7 4-place rule (+2)

1. Handler + TSDoc (above); `pipelines/types.ts` handler-type union.
2. `mcp/tools/proxy-rules.tools.ts` — handler list + one doc line (config, output shape,
   error codes, "connection is configured by an admin under Settings → Infrastructure").
3. Frontend: `components/pipelines/handlers/RemoteRequestConfig.tsx` (connection Select
   fed by `GET /api/remote-connections`, path, method, body, headers, timeout,
   failOnError), `types.ts`, `HandlerConfigWrapper.tsx` (case + label "Remote request" +
   description), `PipelineConfig.tsx` group `Other`.
4. Spec files for each of the above.
5. `bffless/skills` → `plugins/bffless/skills/pipelines/SKILL.md` table row + a short
   "Remote connections" section.
6. `bffless/docs` → new page `docs/features/remote-connections.md`; `server-video-ops.md`
   Executor section re-pointed at connections; env-var reference updated.

### 2.8 Probe (`FfmpegExecutorSelector.probe`)

`remote` gains `maxInflight` (the connection's) next to `version`; TSDoc + MCP doc line
updated. Studio follow-up (D14) reads it.

## Part 3 — API + Admin UI (CE)

### 3.1 Endpoints

| Route | Guard | Purpose |
| --- | --- | --- |
| `GET /api/settings/remote-connections` | admin | list: `{ id?, name, url, auth, hasCredential, maxInflight, healthPath, source, envOnly, usedBy: { ffmpegExecutor: boolean, rules: number } }[]` — never the credential |
| `POST /api/settings/remote-connections` | admin | create `{ name, url, auth, credential?, maxInflight?, healthPath? }` |
| `PUT /api/settings/remote-connections/:id` | admin | partial update; `credential` undefined/null/string semantics; name change allowed with a warning that rules reference names |
| `DELETE /api/settings/remote-connections/:id` | admin | 409 when the ffmpeg executor references it |
| `POST /api/settings/remote-connections/test` | admin | test an unsaved draft `{ url, auth, credential?, healthPath?, id? }` (id = fall back to the stored credential when the draft omits it) → `{ ok, status?, latencyMs?, version?, error?, credential: 'sa_key'|'adc'|'none' }` |
| `GET /api/remote-connections` | authenticated | `{ name, auth }[]` for the rule editor's connection picker (no URLs, no ids) |

Guards imported by file path, not the `../../auth` barrel (Plan 2 gotcha).

### 3.2 Admin Settings → Infrastructure → *Remote connections* card

`components/settings/remote-connections/RemoteConnectionsSettings.tsx` in
`InfrastructureTab` after Storage: a table (name, URL host, auth badge, credential
badge `key | ADC | none`, in-flight cap, source `env` chip, used-by chips) with
**Add** / row **Edit** / **Delete** and per-row **Test**. The edit dialog is the form:
name (locked once referenced; slug hint), URL, auth radio with the red "unauthenticated —
private networks only" banner for `none`, write-only credential textarea with
**Replace / Remove** (extracted from today's panel into `WriteOnlySecretField`),
max in-flight, health path, **Test connection** (status · latency · version if any ·
credential source). Env-managed fields render disabled with the "managed by
REMOTE_CONNECTION_…" hint.

### 3.3 Executor panel (`FfmpegExecutorSettings.tsx`) after the split

Remote section becomes: on/off · **Connection** `Select` (DB rows + env-only names, the
env-pinned one shown locked) · summary line (URL host · auth · credential badge · last
health) · **Test connection** (connection + ffmpeg readiness, as today) · link
"Manage connections →" (Infrastructure tab). URL/auth/key inputs and their tests are
removed from this component; the shared pieces move to
`components/settings/remote-connections/`. `settingsApi.ts` gains the five endpoints
above; the ffmpeg DTO/status types change per 2.5.

## Part 4 — Tests

- **Unit (backend):** env parsing (explicit + legacy aliases, precedence, name mapping),
  service resolve/list/env-merge/validation/credential semantics/loadState guard, fuse
  (shared counter across two callers, release on throw), `RemoteClient` (moved specs +
  generic request: JSON/text bodies, size cap, retry-once matrix, abort passthrough,
  health bound), handler (config validation, output shape, every error code, header
  blocklist, fuse + timeout paths), ffmpeg settings (FK selection, env pins, refuse
  enabling without connection, 409 delete), controller specs, wiring spec (lazy tokens),
  `RemoteFfmpegExecutor` specs re-seated on `deps.connection` (behaviour unchanged).
- **Migration:** a spec that runs the 0044 backfill SQL against a Postgres test DB seeded
  with a Plan-2 row and asserts one `ffmpeg` connection + FK set + idempotent re-run
  (skipped when no test DB, like other DB-gated suites).
- **Frontend (Vitest):** Connections card list/add/edit/delete/test flows, env-managed
  disabled state, Executor panel connection picker + test, `RemoteRequestConfig` picker.
- **Integration (env-gated like `ffmpeg.remote.spec.ts`):** existing remote ffmpeg suite
  green through a `ffmpeg` connection; new `remote_request` round trip against the
  compose Worker (`GET /health` via `auth: none`, and a `POST /jobs` with a bad envelope
  → `REMOTE_REQUEST_ERROR` with the Worker's 400 body).
- **Rules-level smoke:** one rule `remote_request{connection:'ffmpeg', path:'/health', method:'GET'}` executed in CI against the compose profile.

## Part 5 — Docs, skill, rollout

1. **CE PR (this spec):** everything in Parts 1–4 except migration 0045. Conventional
   title `feat(pipelines): remote connections + remote_request handler …`. Migration 0044
   generated by the user in the worktree; backfill appended; user reviews the SQL.
2. **Release N**, deploy on bffless.dev (preview channel first as with Plan 2): verify the
   backfilled `ffmpeg` connection appears, the Executor panel shows it selected,
   `probe → remote.ready:true`, a Studio remote cut succeeds, and a scratch rule with
   `remote_request` → `/health` returns 200. Then j5s.dev.
3. **Follow-ups filed in the epic status comment:** (a) CE issue "migration 0045: drop
   `ffmpeg_executor_settings.remote_*`/`sa_key_encrypted`" — release N+1; (b) apps issue
   "Studio: replace `REMOTE_FFMPEG_MAX` with probe `remote.maxInflight`"; (c) skills PR
   (table row); (d) docs PR (new page + Server video ops update).

## Non-goals

- Project-level connections; per-project quotas.
- `aws_sigv4`, `bearer_secret`, OAuth client-credentials auth modes (schema allows them;
  no code).
- Async / job-ID / polling execution (Cloud Run Jobs), streaming responses, non-JSON
  request bodies (multipart, binary).
- Any change to the ffmpeg Worker image, envelope or `ffmpeg_handler` config.
- A connections usage/cost dashboard.

## Risks / open points

- **Settings-panel split** is the largest UI change; mitigated by extracting the shared
  pieces first (pure move, snapshot tests green) before re-shaping the Executor panel.
- **Backfill on live bffless.dev**: 0044 must run before the new image serves requests
  (it does — migrations run in the release path). Rollback to N-1 keeps working because
  the old columns are untouched until 0045.
- **Env-name mapping** (`-` vs `_`) is the one place D7 can surprise; the env reader
  logs the mapped name at boot (`remote_connection_env_loaded {name, fields}`).
- **`ON DELETE SET NULL` vs 409**: the FK is `SET NULL` for safety at the DB layer, but
  the service refuses the delete while referenced — belt and braces.
- **Response size cap** may bite a service that returns big JSON; 16 MiB default,
  env-tunable, documented.

## As-built notes (2026-08-18)

Deltas between this spec and what actually shipped, recorded here rather than edited
into the plan above so the design intent stays legible.

- (a) Connection names forbid `_`: `CONNECTION_NAME_RE = ^[a-z0-9][a-z0-9-]{0,63}$` — the
  env-name mapping (`-` ⇄ `_`) would otherwise be ambiguous for a name containing both.
- (b) `FfmpegEnvConfig` **keeps** `remoteUrl`/`remoteAuth`/`remoteSaKeyJson`/
  `remoteMaxInflight` as fields, now *derived* from the resolved connection (plus a new
  `remoteConnection: string | null` naming it) rather than being dropped in favour of a
  bare connection object — smaller executor churn, same shape the executor already reads.
- (c) `WorkerClient extends RemoteClient`: the transport (fetch, retry, abort handling)
  lives in the shared base; ffmpeg's envelope-shaped `postJob`/`health` stay on the
  subclass. ID-token minters are per-client, never shared between the ffmpeg executor's
  `WorkerClient` and a `remote_request` step's `RemoteClient` for the same connection —
  each holds its own token cache.
- (d) `RemoteClient.request` resolves (does not throw) for **every** HTTP status the
  remote answers with, 2xx or not — the caller (`remote_request`'s `failOnError`) decides
  what a status means. It only throws for a genuine transport fault or an exhausted
  429/503 retry.
- (e) `REMOTE_INVALID_PATH` error code added: a `path` that evaluates (expression or
  `{{template}}`) to something not starting with `/` fails the step with this code,
  distinct from a static bad path caught at `validateConfig` time.
- (f) `usedBy.rules` (the connections list's "in use by N rules" count) is a best-effort
  `LIKE '%"connection":"<name>"%'` scan over `proxy_rules.pipeline_config`, not a parsed
  reference count — any query error (unmigrated table, bad plan) returns 0 rather than
  failing the listing.
- (g) `FFMPEG_REMOTE_CONNECTION` env var added: names a Remote connection directly,
  ahead of the legacy `FFMPEG_REMOTE_URL`/`FFMPEG_REMOTE_AUTH`/`FFMPEG_REMOTE_SA_KEY_JSON`
  trio in precedence.
- (h) `WorkerClient.health()` keeps its existing name (ffmpeg-specific: worker version +
  `ffmpeg`/`ops`/`uptimeS`). The generalised, connection-agnostic liveness probe on the
  shared base is `RemoteClient.probe()`, used by the connections "Test connection" button.
- (i) `remote_request`'s `path` supports `{{ }}` template interpolation
  (`ExpressionEvaluator.evaluateTemplate`) as well as a bare expression — there is no
  separate string-concatenation expression syntax; a dynamic path is either a template or
  a single expression resolving directly to a path string.
- (j) A `PipelineError`/`ExpressionError` thrown while resolving the path, headers or body
  (a bad expression, a bad `condition`) is **rethrown**, not caught and mapped to
  `REMOTE_UNAVAILABLE` — it is the pipeline's own configuration fault, not a remote-side
  failure, so it surfaces like any other handler's configuration error.
- (k) `RemoteConnectionsService.update()` refuses renaming an env-pinned connection (its
  fields are keyed by name; a rename would strand the env vars as a second, phantom
  env-only connection under the old name). An unknown `id` on `update()`/`remove()` is a
  404. The "managed by …" refusal on a pinned field names only the env var(s) actually
  set on the instance (checking the legacy ffmpeg alias too), not every var that could
  theoretically pin it.
- (l) `RemoteFfmpegExecutor` reads `deps.fuse` **per job**, through a lazy getter
  (`sharedFuse: () => deps.fuse`), never resolved once in the constructor — resolving it
  eagerly would race Nest's provider instantiation order and could silently fall back to
  a private, unshared `InflightFuse` instead of the connection's real one.
- (m) Frontend `services/pipelinesApi.ts`'s `HandlerType` union gained `'remote_request'`
  alongside the existing handler types, so the step editor recognises it.
- (n) `RemoteRequestConfig` preserves `condition` across a re-save; `HttpRequestConfig`
  does **not** (pre-existing behaviour, unrelated to this feature — noted here only
  because the two configs are easy to assume are symmetric and are not).
