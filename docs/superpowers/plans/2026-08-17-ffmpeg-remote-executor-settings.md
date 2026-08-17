# ffmpeg Remote Executor — Settings UI + DB config + Docs (Plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin configure the ffmpeg executors (Local on/off, Remote on/off + Worker URL + auth + write-only encrypted SA key + default) from Admin Settings → Features → Server video ops, test the Worker connection, and read how to deploy/operate the Remote executor in the public docs.

**Architecture:** A new single-row table `ffmpeg_executor_settings` (SA key AES-GCM-encrypted via `common/crypto/aes-gcm.ts`) is loaded and decrypted into memory by `FfmpegExecutorSettingsService` at boot and on every save; its `resolved()` merges the DB row *under* env (env wins per field) into the existing `FfmpegEnvConfig` shape. `FfmpegExecutorSelector` and `RemoteFfmpegExecutor` receive that resolver through two Nest injection tokens (`FFMPEG_CONFIG`, `FFMPEG_REMOTE_DEPS`) with `readFfmpegEnv` fallback, so every Plan 1 test seam and semantics stay intact. A small admin-only controller in `PipelinesModule` exposes `GET/PUT /api/settings/ffmpeg-executor` and `POST …/test`; the frontend adds an `FfmpegExecutorSettings` panel under the existing Server video ops toggle row.

**Tech Stack:** NestJS 10 + Drizzle (Postgres) + Jest (backend); React 18 + RTK Query + shadcn/ui + Vitest (frontend); Docusaurus markdown (docs-public).

**Spec:** `docs/superpowers/specs/2026-08-17-ffmpeg-remote-executor-design.md` §1.5 (Settings + capability) and §1.7 (Docs). Plan 1 (already merged, PR #684): `docs/superpowers/plans/2026-08-17-ffmpeg-remote-executor-core.md` — this plan is epic tasks **T5** and **T9** of bffless/apps#346.

**Worktrees:** CE work in `repos/ce/.claude/worktrees/ffmpeg-remote-settings` (branch `feat/ffmpeg-remote-settings`, from origin/main c658c02). Docs work in `repos/docs-public/.claude/worktrees/ffmpeg-remote-executor` (branch `docs/ffmpeg-remote-executor`, from origin/main 48eac3d). **Always confirm `git rev-parse --show-toplevel` before editing** — the main checkouts are shared.

## Global Constraints

- **Env wins over DB, per field** (spec §1.5, restated by the user). Env-managed fields: `FFMPEG_EXECUTOR` → default executor; `FFMPEG_REMOTE_URL` → Worker URL *and* forces Remote enabled; `FFMPEG_REMOTE_AUTH` → auth mode; `FFMPEG_REMOTE_SA_KEY_JSON` → SA key. `''` counts as unset (compose passthrough), exactly like `ffmpeg-env.ts`. `FFMPEG_REMOTE_MAX_INFLIGHT`, `FFMPEG_WORKER_MIN_VERSION`, `FFMPEG_MAX_OUTPUT_BYTES` stay **env-only** (not in the DB, not in the UI). Note: this is deliberately the *opposite* of the `FFMPEG_HANDLER_ENABLED` feature flag (FeatureFlagsService resolves DB > env) — the spec sentence "matches FFMPEG_HANDLER_ENABLED" is inaccurate; do not "fix" the flag.
- **The SA key is write-only.** It is stored encrypted (`encryptString` from `common/crypto/aes-gcm.ts`, requires `ENCRYPTION_KEY`), decrypted only into the in-process cache, and never appears in any HTTP response, log line, or error message. Status exposes only `hasSaKey` + `saKeySource: 'db' | 'env' | null`.
- **Plan 1 behaviour unchanged.** With no DB row and no new env, `readFfmpegEnv()` semantics are identical: local enabled iff binaries present; remote enabled iff `FFMPEG_REMOTE_URL` set. All existing suites (`pipelines/ffmpeg/**/*.spec.ts`, `handlers/ffmpeg.handler.spec.ts`, `mcp/tools/proxy-rules.tools.ffmpeg.spec.ts`) must stay green; existing spec files may only be *added to*, never weakened.
- **New `FfmpegEnvConfig` fields:** `localEnabled: boolean` (env reader: always `true`) and `remoteEnabled: boolean` (env reader: `remoteUrl !== null`). Selector: local iff `capability.isAvailable() && cfg.localEnabled`; remote iff `cfg.remoteEnabled && cfg.remoteUrl`.
- **Validation is server-side (400 `BadRequestException`) and repeated in the UI copy:** Remote on ⇒ URL required and parseable; URL must be `https:` unless auth is `none`; SA key (when provided) must be JSON with `"type": "service_account"`; default executor must be one of the enabled ones; enabling Remote when the storage adapter cannot presign (local-FS) is refused (D3 settings-time error).
- **Migration is a USER step.** Per CLAUDE.md, never run `drizzle-kit generate` or hand-write files under `apps/backend/drizzle/`. Task 1 ends by asking the user to run `cd repos/ce/apps/backend && pnpm db:generate` (a new table needs no interactive answers) — the plan proceeds without it; the service tolerates a missing table (warn once, env-only behaviour).
- **Test-running gotchas (from Plan 1):** the worktree path contains "ffmpeg", so `pnpm jest ffmpeg` runs every suite — use `pnpm jest --testPathPattern 'src/.*ffmpeg'` (or the exact file). Backend `pnpm lint` has `--fix` baked in and rewrites ~300 unrelated files — lint with `npx eslint <files>` only. Frontend: `pnpm test:run <file>` (vitest); frontend `pnpm lint` already fails on main (58 pre-existing problems) — only check that *your* files are clean with `npx eslint <files>`.
- **Backend test style:** Jest, `jest.mock('../db/client', …)` for Drizzle (pattern in `settings/google-integration-credentials.service.spec.ts`), `process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')` + `__resetKeyForTests()` around crypto. Loggers are `new Logger(<Class>.name)` logging object literals with an `event` key.
- **Copy rules:** UI and docs say **Worker**, **Remote executor**, **Local server**, **Browser**; the auth mode is `google_id_token` / `none`; the image is `ghcr.io/bffless/ce-ffmpeg-worker:<ce-version>` (spec said `ffmpeg-worker` — as-built deviation, keep `ce-`). CE version for docs examples: `0.4.31`.
- **Commits:** local commits only, conventional-commit messages; **never push or open a PR without asking** the user.

---

## File Structure

**Backend (create):**
- `apps/backend/src/db/schema/ffmpeg-executor-settings.schema.ts` — Drizzle table `ffmpeg_executor_settings` + row types.
- `apps/backend/src/pipelines/ffmpeg/ffmpeg-executor-settings.service.ts` — load/decrypt/cache the row; `resolved()`; `getStatus()`; `update()`; `testConnection()`; validation.
- `apps/backend/src/pipelines/ffmpeg/ffmpeg-executor-settings.service.spec.ts`
- `apps/backend/src/pipelines/ffmpeg/ffmpeg-executor-settings.controller.ts` — `GET/PUT /api/settings/ffmpeg-executor`, `POST /api/settings/ffmpeg-executor/test` (admin).
- `apps/backend/src/pipelines/ffmpeg/ffmpeg-executor-settings.controller.spec.ts`
- `apps/backend/src/pipelines/ffmpeg/executor/ffmpeg-config.tokens.ts` — the two injection tokens.

**Backend (modify):**
- `apps/backend/src/db/schema/index.ts` — export the new schema.
- `apps/backend/src/pipelines/ffmpeg/ffmpeg-env.ts` — `localEnabled`, `remoteEnabled` fields.
- `apps/backend/src/pipelines/ffmpeg/executor/ffmpeg-executor.selector.ts` — `enabled()` uses the new bits; env resolver injected via `FFMPEG_CONFIG`; error text no longer says "set FFMPEG_REMOTE_URL" only.
- `apps/backend/src/pipelines/ffmpeg/executor/remote/remote-ffmpeg.executor.ts` — `deps` injected via `FFMPEG_REMOTE_DEPS`; `ready({fresh, env})` + `testConnection(overrides)`.
- `apps/backend/src/pipelines/pipelines.module.ts` — providers (service, tokens), controller.
- Existing specs (add cases only): `ffmpeg-env.spec.ts`, `ffmpeg-executor.selector.spec.ts`, `remote-ffmpeg.executor.spec.ts`.

**Frontend (create):**
- `apps/frontend/src/components/settings/FfmpegExecutorSettings.tsx` — the Executor panel.
- `apps/frontend/src/components/settings/FfmpegExecutorSettings.test.tsx`

**Frontend (modify):**
- `apps/frontend/src/services/settingsApi.ts` — types + 3 endpoints, tag `FfmpegExecutor`.
- `apps/frontend/src/services/api.ts` — add `'FfmpegExecutor'` to `tagTypes`.
- `apps/frontend/src/components/settings/FeatureToggles.tsx` — registry entry gains optional `Panel`; renders it under the row.

**Docs (modify, docs-public worktree):**
- `docs/features/server-video-ops.md` — new *Remote executor* section (+ intro/mode table tweak).

---

### Task 1: Schema + env fields (`localEnabled` / `remoteEnabled`)

**Files:**
- Create: `apps/backend/src/db/schema/ffmpeg-executor-settings.schema.ts`
- Modify: `apps/backend/src/db/schema/index.ts`
- Modify: `apps/backend/src/pipelines/ffmpeg/ffmpeg-env.ts`
- Test (add cases): `apps/backend/src/pipelines/ffmpeg/ffmpeg-env.spec.ts`

**Interfaces:**
- Produces: table `ffmpegExecutorSettings` with row type `FfmpegExecutorSettingsRow` (`id, localEnabled, remoteEnabled, remoteUrl, remoteAuth, saKeyEncrypted, defaultExecutor, createdAt, updatedAt, updatedByUserId`); `FfmpegEnvConfig.localEnabled: boolean`, `FfmpegEnvConfig.remoteEnabled: boolean`.

- [ ] **Step 1: Write the failing env test**

Append to `apps/backend/src/pipelines/ffmpeg/ffmpeg-env.spec.ts` (inside the top-level `describe`, matching the file's existing style — read the file first):

```ts
it('localEnabled is always true from env; remoteEnabled mirrors whether FFMPEG_REMOTE_URL is set', () => {
  const off = readFfmpegEnv({});
  expect(off.localEnabled).toBe(true);
  expect(off.remoteEnabled).toBe(false);
  const on = readFfmpegEnv({ FFMPEG_REMOTE_URL: 'https://w.example.com/' });
  expect(on.remoteEnabled).toBe(true);
  expect(on.remoteUrl).toBe('https://w.example.com');
  expect(readFfmpegEnv({ FFMPEG_REMOTE_URL: '' }).remoteEnabled).toBe(false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/backend && pnpm jest src/pipelines/ffmpeg/ffmpeg-env.spec.ts`
Expected: FAIL — `localEnabled` is `undefined`.

- [ ] **Step 3: Add the two fields to `ffmpeg-env.ts`**

In the `FfmpegEnvConfig` interface, before `executor`:

```ts
  /** Operator switch for the Local executor (DB-backed; env has no knob → always true here). */
  localEnabled: boolean;
  /** Operator switch for the Remote executor. From env alone: on iff FFMPEG_REMOTE_URL is set. */
  remoteEnabled: boolean;
```

In `readFfmpegEnv`, compute `const remoteUrl = str(env.FFMPEG_REMOTE_URL);` before the returned object, then in the object replace `remoteUrl: str(env.FFMPEG_REMOTE_URL),` with:

```ts
    localEnabled: true,
    remoteEnabled: remoteUrl !== null,
    remoteUrl,
```

- [ ] **Step 4: Run env test → PASS; run the whole ffmpeg tree to check nothing else broke**

Run: `cd apps/backend && pnpm jest --testPathPattern 'src/.*ffmpeg'`
Expected: all PASS (type errors would show here since ts-jest compiles).

- [ ] **Step 5: Create the schema file**

`apps/backend/src/db/schema/ffmpeg-executor-settings.schema.ts`:

```ts
import { pgTable, uuid, boolean, varchar, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Instance-level configuration of the ffmpeg executors (Local server / Remote
 * Worker) edited in Admin Settings → Features → Server video ops → Executor.
 * Exactly one row (the service upserts; there is no natural key beyond "the
 * instance"). Env vars override individual fields — FFMPEG_EXECUTOR,
 * FFMPEG_REMOTE_URL, FFMPEG_REMOTE_AUTH, FFMPEG_REMOTE_SA_KEY_JSON — see
 * `pipelines/ffmpeg/ffmpeg-executor-settings.service.ts` (`resolved()`).
 *
 * The service-account key is AES-256-GCM encrypted with common/crypto/aes-gcm.ts
 * (same wire format as oidc_providers.config_encrypted) and is WRITE-ONLY: the
 * API reports only whether one is stored.
 *
 * Spec: docs/superpowers/specs/2026-08-17-ffmpeg-remote-executor-design.md §1.5.
 */
export const ffmpegExecutorSettings = pgTable('ffmpeg_executor_settings', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Local executor: ffmpeg spawned by this backend. Only meaningful when the
  // binaries are present; off lets an admin force Remote on a box that has ffmpeg.
  localEnabled: boolean('local_enabled').default(true).notNull(),

  // Remote executor: a Worker CE calls over HTTPS (Cloud Run is the reference).
  remoteEnabled: boolean('remote_enabled').default(false).notNull(),
  remoteUrl: text('remote_url'),
  // 'google_id_token' | 'none'
  remoteAuth: varchar('remote_auth', { length: 32 }).default('google_id_token').notNull(),
  // encryptString(<service-account JSON>) or null (= use ADC / no key)
  saKeyEncrypted: text('sa_key_encrypted'),

  // 'local' | 'remote' — which executor a step runs on unless it names one.
  defaultExecutor: varchar('default_executor', { length: 16 }).default('local').notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  updatedByUserId: uuid('updated_by_user_id'),
});

export type FfmpegExecutorSettingsRow = typeof ffmpegExecutorSettings.$inferSelect;
export type NewFfmpegExecutorSettingsRow = typeof ffmpegExecutorSettings.$inferInsert;
```

Add to `apps/backend/src/db/schema/index.ts` (alphabetical-ish, next to the other feature tables):

```ts
export * from './ffmpeg-executor-settings.schema';
```

- [ ] **Step 6: Type-check the backend**

Run: `cd apps/backend && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/db/schema/ffmpeg-executor-settings.schema.ts apps/backend/src/db/schema/index.ts apps/backend/src/pipelines/ffmpeg/ffmpeg-env.ts apps/backend/src/pipelines/ffmpeg/ffmpeg-env.spec.ts
git commit -m "feat(ffmpeg): ffmpeg_executor_settings table + localEnabled/remoteEnabled config bits"
```

- [ ] **Step 8: Hand the migration to the user (do NOT generate it yourself)**

Report to the user (in the final summary is fine): *"Run `cd repos/ce/.claude/worktrees/ffmpeg-remote-settings/apps/backend && pnpm db:generate` — it will create `drizzle/0043_<name>.sql` for the new `ffmpeg_executor_settings` table; a new table needs no interactive answers. Then commit that file on the branch."* Everything below works without it (unit tests mock the DB; the service tolerates a missing table).

---

### Task 2: `FfmpegExecutorSettingsService` — load, resolve, status, update

**Files:**
- Create: `apps/backend/src/pipelines/ffmpeg/ffmpeg-executor-settings.service.ts`
- Create: `apps/backend/src/pipelines/ffmpeg/ffmpeg-executor-settings.service.spec.ts`

**Interfaces:**
- Consumes: `readFfmpegEnv`, `FfmpegEnvConfig` (Task 1 fields), `encryptString`/`decryptString` from `../../common/crypto/aes-gcm`, `db` from `../../db/client`, `ffmpegExecutorSettings` schema, `IStorageAdapter`/`STORAGE_ADAPTER` from `../../storage/storage.interface`, `FfmpegCapabilityService`.
- Produces:
  ```ts
  class FfmpegExecutorSettingsService implements OnModuleInit {
    reload(): Promise<void>;                       // DB → cache (tolerates missing table)
    resolved(): FfmpegEnvConfig;                   // env over cached DB row — SYNC
    envManaged(): FfmpegExecutorEnvManaged;        // which fields env pins
    getStatus(): Promise<FfmpegExecutorStatus>;    // never includes the key
    update(input: UpdateFfmpegExecutorInput, userId?: string): Promise<FfmpegExecutorStatus>;
  }
  interface FfmpegExecutorEnvManaged { defaultExecutor: boolean; remoteUrl: boolean; remoteAuth: boolean; saKey: boolean }
  interface FfmpegExecutorStatus {
    localAvailable: boolean; localVersion: string | null; localEnabled: boolean;
    remoteEnabled: boolean; remoteUrl: string | null; remoteAuth: 'google_id_token' | 'none';
    hasSaKey: boolean; saKeySource: 'db' | 'env' | null;
    defaultExecutor: 'local' | 'remote';
    storagePresignable: boolean;      // false on local-FS storage → Remote cannot be enabled
    envManaged: FfmpegExecutorEnvManaged;
  }
  interface UpdateFfmpegExecutorInput {
    localEnabled?: boolean; remoteEnabled?: boolean; remoteUrl?: string | null;
    remoteAuth?: 'google_id_token' | 'none'; defaultExecutor?: 'local' | 'remote';
    /** undefined = keep stored key; null = clear it; string = replace it */
    saKeyJson?: string | null;
  }
  ```
  (Task 4 adds `testConnection()` to this same service; Task 5's controller consumes all of it.)

- [ ] **Step 1: Write the failing service tests**

`apps/backend/src/pipelines/ffmpeg/ffmpeg-executor-settings.service.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';

jest.mock('../../db/client', () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
  },
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { db } = require('../../db/client');

import { FfmpegExecutorSettingsService } from './ffmpeg-executor-settings.service';
import { encryptString, __resetKeyForTests } from '../../common/crypto/aes-gcm';

const TEST_KEY = Buffer.alloc(32, 7).toString('base64');
const SA_KEY = JSON.stringify({ type: 'service_account', client_email: 'x@p.iam.gserviceaccount.com' });

/** A row as Drizzle would return it. */
function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'row-1',
    localEnabled: true,
    remoteEnabled: false,
    remoteUrl: null,
    remoteAuth: 'google_id_token',
    saKeyEncrypted: null,
    defaultExecutor: 'local',
    createdAt: new Date(),
    updatedAt: new Date(),
    updatedByUserId: null,
    ...over,
  };
}

function mockSelect(rows: unknown[]) {
  db.select.mockReturnValue({
    from: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(rows) }),
  });
}
function mockSelectThrows(err: Error) {
  db.select.mockReturnValue({
    from: jest.fn().mockReturnValue({ limit: jest.fn().mockRejectedValue(err) }),
  });
}

function make(o: {
  env?: NodeJS.ProcessEnv;
  presign?: boolean;
  localAvailable?: boolean;
} = {}) {
  const storage = {
    getUrl: async () => 'https://bucket.example.com/x?sig=1',
    ...(o.presign === false ? {} : { supportsPresignedUrls: () => true, getPresignedUploadUrl: async () => 'https://bucket.example.com/x?put=1' }),
  };
  const capability = {
    isAvailable: () => o.localAvailable ?? true,
    getVersion: () => (o.localAvailable ?? true ? 'ffmpeg version 6.1.1' : null),
  };
  const service = new FfmpegExecutorSettingsService(storage as never, capability as never, () => o.env ?? {});
  return { service, storage, capability };
}

describe('FfmpegExecutorSettingsService', () => {
  let originalKey: string | undefined;
  beforeEach(() => {
    originalKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = TEST_KEY;
    __resetKeyForTests();
    jest.clearAllMocks();
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
    __resetKeyForTests();
  });

  describe('resolved()', () => {
    it('with no row behaves exactly like readFfmpegEnv (Plan 1 semantics)', async () => {
      mockSelect([]);
      const { service } = make({ env: { FFMPEG_REMOTE_URL: 'https://w.example.com' } });
      await service.reload();
      const cfg = service.resolved();
      expect(cfg.localEnabled).toBe(true);
      expect(cfg.remoteEnabled).toBe(true);
      expect(cfg.remoteUrl).toBe('https://w.example.com');
      expect(cfg.executor).toBe('local');
    });

    it('DB row fills fields env leaves unset; the SA key is decrypted into memory', async () => {
      mockSelect([
        row({
          localEnabled: false,
          remoteEnabled: true,
          remoteUrl: 'https://db.example.com/',
          remoteAuth: 'none',
          saKeyEncrypted: encryptString(SA_KEY),
          defaultExecutor: 'remote',
        }),
      ]);
      const { service } = make();
      await service.reload();
      const cfg = service.resolved();
      expect(cfg.localEnabled).toBe(false);
      expect(cfg.remoteEnabled).toBe(true);
      expect(cfg.remoteUrl).toBe('https://db.example.com'); // trailing slash stripped like env
      expect(cfg.remoteAuth).toBe('none');
      expect(cfg.remoteSaKeyJson).toBe(SA_KEY);
      expect(cfg.executor).toBe('remote');
    });

    it('env wins per field, and FFMPEG_REMOTE_URL forces remoteEnabled', async () => {
      mockSelect([
        row({ remoteEnabled: false, remoteUrl: 'https://db.example.com', remoteAuth: 'none', defaultExecutor: 'remote', saKeyEncrypted: encryptString(SA_KEY) }),
      ]);
      const { service } = make({
        env: {
          FFMPEG_EXECUTOR: 'local',
          FFMPEG_REMOTE_URL: 'https://env.example.com',
          FFMPEG_REMOTE_AUTH: 'google_id_token',
          FFMPEG_REMOTE_SA_KEY_JSON: '{"type":"service_account","env":true}',
        },
      });
      await service.reload();
      const cfg = service.resolved();
      expect(cfg.executor).toBe('local');
      expect(cfg.remoteEnabled).toBe(true);
      expect(cfg.remoteUrl).toBe('https://env.example.com');
      expect(cfg.remoteAuth).toBe('google_id_token');
      expect(cfg.remoteSaKeyJson).toBe('{"type":"service_account","env":true}');
      expect(service.envManaged()).toEqual({ defaultExecutor: true, remoteUrl: true, remoteAuth: true, saKey: true });
    });

    it("'' env values count as unset (compose passthrough)", async () => {
      mockSelect([row({ remoteEnabled: true, remoteUrl: 'https://db.example.com', defaultExecutor: 'remote' })]);
      const { service } = make({ env: { FFMPEG_EXECUTOR: '', FFMPEG_REMOTE_URL: '', FFMPEG_REMOTE_AUTH: '', FFMPEG_REMOTE_SA_KEY_JSON: '' } });
      await service.reload();
      expect(service.resolved().remoteUrl).toBe('https://db.example.com');
      expect(service.envManaged()).toEqual({ defaultExecutor: false, remoteUrl: false, remoteAuth: false, saKey: false });
    });

    it('a missing table (pre-migration boot) is tolerated: env-only, no throw', async () => {
      mockSelectThrows(new Error('relation "ffmpeg_executor_settings" does not exist'));
      const { service } = make();
      await expect(service.reload()).resolves.toBeUndefined();
      expect(service.resolved().localEnabled).toBe(true);
    });

    it('an undecryptable key is treated as absent (does not poison the config)', async () => {
      mockSelect([row({ saKeyEncrypted: 'not-a-ciphertext' })]);
      const { service } = make();
      await service.reload();
      expect(service.resolved().remoteSaKeyJson).toBeNull();
    });
  });

  describe('getStatus()', () => {
    it('never includes the key; reports source + envManaged + storagePresignable', async () => {
      mockSelect([row({ remoteEnabled: true, remoteUrl: 'https://db.example.com', saKeyEncrypted: encryptString(SA_KEY) })]);
      const { service } = make();
      await service.reload();
      const status = await service.getStatus();
      expect(JSON.stringify(status)).not.toContain('service_account');
      expect(status).toEqual({
        localAvailable: true,
        localVersion: 'ffmpeg version 6.1.1',
        localEnabled: true,
        remoteEnabled: true,
        remoteUrl: 'https://db.example.com',
        remoteAuth: 'google_id_token',
        hasSaKey: true,
        saKeySource: 'db',
        defaultExecutor: 'local',
        storagePresignable: true,
        envManaged: { defaultExecutor: false, remoteUrl: false, remoteAuth: false, saKey: false },
      });
    });

    it("saKeySource is 'env' when FFMPEG_REMOTE_SA_KEY_JSON is set, storagePresignable false on local-FS", async () => {
      mockSelect([]);
      const { service } = make({ env: { FFMPEG_REMOTE_SA_KEY_JSON: SA_KEY }, presign: false });
      await service.reload();
      const status = await service.getStatus();
      expect(status.hasSaKey).toBe(true);
      expect(status.saKeySource).toBe('env');
      expect(status.storagePresignable).toBe(false);
    });
  });

  describe('update()', () => {
    function mockWrite() {
      const set = jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });
      db.update.mockReturnValue({ set });
      const values = jest.fn().mockResolvedValue(undefined);
      db.insert.mockReturnValue({ values });
      return { set, values };
    }

    it('inserts when no row exists, encrypts the key, refreshes the cache and returns status', async () => {
      mockSelect([]);
      const { values } = mockWrite();
      const { service } = make();
      await service.reload();
      // After the write, reload() re-reads: return the row the write produced.
      const status = await service.update(
        { remoteEnabled: true, remoteUrl: 'https://w.example.com/', remoteAuth: 'google_id_token', defaultExecutor: 'remote', saKeyJson: SA_KEY },
        'user-1',
      ).catch((e) => { throw e; });
      expect(values).toHaveBeenCalledTimes(1);
      const inserted = values.mock.calls[0][0];
      expect(inserted.remoteUrl).toBe('https://w.example.com');
      expect(inserted.saKeyEncrypted).not.toContain('service_account');
      expect(inserted.updatedByUserId).toBe('user-1');
      expect(status.hasSaKey).toBe(true);
      expect(status.defaultExecutor).toBe('remote');
      expect(service.resolved().remoteSaKeyJson).toBe(SA_KEY);
    });

    it('updates the existing row; saKeyJson undefined keeps the stored key, null clears it', async () => {
      const stored = encryptString(SA_KEY);
      mockSelect([row({ remoteEnabled: true, remoteUrl: 'https://w.example.com', saKeyEncrypted: stored })]);
      const { set } = mockWrite();
      const { service } = make();
      await service.reload();

      await service.update({ remoteAuth: 'none' });
      expect(set.mock.calls[0][0]).not.toHaveProperty('saKeyEncrypted');
      expect(service.resolved().remoteSaKeyJson).toBe(SA_KEY);

      await service.update({ saKeyJson: null });
      expect(set.mock.calls[1][0].saKeyEncrypted).toBeNull();
      expect(service.resolved().remoteSaKeyJson).toBeNull();
    });

    it('rejects: remote on without URL / bad URL / http with google_id_token / non-service-account key / default not enabled', async () => {
      mockSelect([]);
      mockWrite();
      const { service } = make();
      await service.reload();
      await expect(service.update({ remoteEnabled: true, remoteUrl: null })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.update({ remoteEnabled: true, remoteUrl: 'not a url' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.update({ remoteEnabled: true, remoteUrl: 'http://w.example.com', remoteAuth: 'google_id_token' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.update({ saKeyJson: '{"type":"authorized_user"}' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.update({ saKeyJson: '{not json' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.update({ defaultExecutor: 'remote' })).rejects.toBeInstanceOf(BadRequestException); // remote not enabled
      await expect(service.update({ localEnabled: false })).rejects.toBeInstanceOf(BadRequestException); // default 'local' would not be enabled
    });

    it('http URL is fine with auth none; refuses Remote on non-presignable storage; refuses editing env-managed fields', async () => {
      mockSelect([]);
      mockWrite();
      const ok = make();
      await ok.service.reload();
      await expect(ok.service.update({ remoteEnabled: true, remoteUrl: 'http://ffmpeg-worker:8080', remoteAuth: 'none' })).resolves.toBeDefined();

      const localFs = make({ presign: false });
      await localFs.service.reload();
      await expect(localFs.service.update({ remoteEnabled: true, remoteUrl: 'https://w.example.com' })).rejects.toBeInstanceOf(BadRequestException);

      const pinned = make({ env: { FFMPEG_REMOTE_URL: 'https://env.example.com' } });
      await pinned.service.reload();
      await expect(pinned.service.update({ remoteUrl: 'https://other.example.com' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/backend && pnpm jest src/pipelines/ffmpeg/ffmpeg-executor-settings.service.spec.ts`
Expected: FAIL — cannot find module `./ffmpeg-executor-settings.service`.

- [ ] **Step 3: Implement the service**

`apps/backend/src/pipelines/ffmpeg/ffmpeg-executor-settings.service.ts`:

```ts
import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { ffmpegExecutorSettings, type FfmpegExecutorSettingsRow } from '../../db/schema';
import { decryptString, encryptString } from '../../common/crypto/aes-gcm';
import { IStorageAdapter, STORAGE_ADAPTER } from '../../storage/storage.interface';
import { FfmpegCapabilityService } from './ffmpeg-capability.service';
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
  /** undefined = keep the stored key; null = clear it; string = replace it. */
  saKeyJson?: string | null;
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
  private warnedMissing = false;

  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storageAdapter: IStorageAdapter,
    private readonly capability: FfmpegCapabilityService,
    /** Test seam: the process env to read. */
    @Optional() private readonly processEnv: () => NodeJS.ProcessEnv = () => process.env,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.reload();
  }

  /** DB → cache. A missing table (instance not yet migrated) or a DB error leaves the cache empty = env-only. */
  async reload(): Promise<void> {
    let row: FfmpegExecutorSettingsRow | undefined;
    try {
      const rows = await db.select().from(ffmpegExecutorSettings).limit(1);
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
      return;
    }
    this.cached = row ? this.decode(row) : null;
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
    return {
      localEnabled: row.localEnabled,
      remoteEnabled: row.remoteEnabled,
      remoteUrl: normaliseUrl(row.remoteUrl),
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
    const env = readFfmpegEnv(this.processEnv());
    const row = this.cached;
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

  private storagePresignable(): boolean {
    return typeof this.storageAdapter.getPresignedUploadUrl === 'function' && this.storageAdapter.supportsPresignedUrls?.() === true;
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
    const managed = this.envManaged();
    if (input.remoteUrl !== undefined && managed.remoteUrl) {
      throw new BadRequestException('Worker URL is managed by FFMPEG_REMOTE_URL on this instance.');
    }
    if (input.remoteAuth !== undefined && managed.remoteAuth) {
      throw new BadRequestException('Auth mode is managed by FFMPEG_REMOTE_AUTH on this instance.');
    }
    if (input.saKeyJson !== undefined && managed.saKey) {
      throw new BadRequestException('The service-account key is managed by FFMPEG_REMOTE_SA_KEY_JSON on this instance.');
    }
    if (input.defaultExecutor !== undefined && managed.defaultExecutor) {
      throw new BadRequestException('The default executor is managed by FFMPEG_EXECUTOR on this instance.');
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

    if (input.remoteAuth !== undefined && input.remoteAuth !== 'google_id_token' && input.remoteAuth !== 'none') {
      throw new BadRequestException("Auth mode must be 'google_id_token' or 'none'.");
    }
    if (input.defaultExecutor !== undefined && input.defaultExecutor !== 'local' && input.defaultExecutor !== 'remote') {
      throw new BadRequestException("Default executor must be 'local' or 'remote'.");
    }
    if (typeof next.saKeyJson === 'string') {
      next.saKeyJson = next.saKeyJson.trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(next.saKeyJson);
      } catch {
        throw new BadRequestException('Service-account key must be valid JSON.');
      }
      if (!parsed || typeof parsed !== 'object' || (parsed as { type?: unknown }).type !== 'service_account') {
        throw new BadRequestException('Service-account key must be a Google service-account JSON key ("type": "service_account").');
      }
    }

    // Validate the EFFECTIVE config (env pins applied) so a save can never leave the
    // instance in a state the selector would refuse.
    const effective = this.effectiveOf(next);
    if (effective.remoteEnabled) {
      if (!effective.remoteUrl) throw new BadRequestException('Remote executor needs a Worker URL.');
      let url: URL;
      try {
        url = new URL(effective.remoteUrl);
      } catch {
        throw new BadRequestException(`Worker URL is not a valid URL: ${effective.remoteUrl}`);
      }
      if (effective.remoteAuth !== 'none' && url.protocol !== 'https:') {
        throw new BadRequestException('Worker URL must be https:// when auth is Google ID token (use auth "none" only on a private network).');
      }
      if (!this.storagePresignable()) {
        throw new BadRequestException('Remote executor needs bucket storage (S3, GCS, MinIO or Azure) — the Worker fetches inputs and uploads outputs via signed URLs, which local filesystem storage cannot provide.');
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

  /** `resolved()` for a candidate row instead of the cached one. */
  private effectiveOf(row: CachedSettings): FfmpegEnvConfig {
    const saved = this.cached;
    this.cached = row;
    try {
      return this.resolved();
    } finally {
      this.cached = saved;
    }
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
    const keyPatch = keyChanged
      ? { saKeyEncrypted: next.saKeyJson === null ? null : encryptString(next.saKeyJson) }
      : {};
    try {
      const existing = (await db.select().from(ffmpegExecutorSettings).limit(1))[0];
      if (existing) {
        await db
          .update(ffmpegExecutorSettings)
          .set({ ...base, ...keyPatch })
          .where(eq(ffmpegExecutorSettings.id, existing.id));
      } else {
        await db.insert(ffmpegExecutorSettings).values({
          ...base,
          saKeyEncrypted: next.saKeyJson === null ? null : encryptString(next.saKeyJson),
        });
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
```

Note for the implementer: `IStorageAdapter.supportsPresignedUrls` and `getPresignedUploadUrl` are optional members — check `apps/backend/src/storage/storage.interface.ts` for the exact names before relying on them (the RemoteFfmpegExecutor uses `getPresignedUploadUrl` and `supportsPresignedUrls?.()` already; mirror it).

- [ ] **Step 4: Run the spec until green; then the whole ffmpeg tree**

Run: `cd apps/backend && pnpm jest src/pipelines/ffmpeg/ffmpeg-executor-settings.service.spec.ts`
Expected: PASS. If the `update` "inserts when no row exists" test fails on `reload()` after write (the mocked select still returns `[]`), that is expected — extend the test's `mockSelect` so the second `select` returns the inserted row: use `db.select.mockReturnValueOnce(...)` for the initial `[]`, then a `mockReturnValue` with the persisted row (`row({remoteEnabled:true, remoteUrl:'https://w.example.com', defaultExecutor:'remote', saKeyEncrypted: encryptString(SA_KEY)})`). Keep the assertions.

Then: `pnpm jest --testPathPattern 'src/.*ffmpeg'` → all PASS.

- [ ] **Step 5: Lint the two files and commit**

```bash
cd apps/backend && npx eslint src/pipelines/ffmpeg/ffmpeg-executor-settings.service.ts src/pipelines/ffmpeg/ffmpeg-executor-settings.service.spec.ts
git add src/pipelines/ffmpeg/ffmpeg-executor-settings.service.ts src/pipelines/ffmpeg/ffmpeg-executor-settings.service.spec.ts
git commit -m "feat(ffmpeg): FfmpegExecutorSettingsService — DB-backed executor config, env wins per field, write-only encrypted SA key"
```

---

### Task 3: Wire the resolved config into the selector + remote executor (Nest tokens)

**Files:**
- Create: `apps/backend/src/pipelines/ffmpeg/executor/ffmpeg-config.tokens.ts`
- Modify: `apps/backend/src/pipelines/ffmpeg/executor/ffmpeg-executor.selector.ts`
- Modify: `apps/backend/src/pipelines/ffmpeg/executor/remote/remote-ffmpeg.executor.ts` (constructor only in this task)
- Modify: `apps/backend/src/pipelines/pipelines.module.ts`
- Test (add cases): `apps/backend/src/pipelines/ffmpeg/executor/ffmpeg-executor.selector.spec.ts`

**Interfaces:**
- Consumes: `FfmpegExecutorSettingsService.resolved()` (Task 2), `FfmpegEnvConfig.localEnabled/remoteEnabled` (Task 1).
- Produces: tokens `FFMPEG_CONFIG` (provides `() => FfmpegEnvConfig`) and `FFMPEG_REMOTE_DEPS` (provides `{ env: () => FfmpegEnvConfig }`); selector `enabled()` honours the two bits.

- [ ] **Step 1: Add failing selector tests**

Append to `apps/backend/src/pipelines/ffmpeg/executor/ffmpeg-executor.selector.spec.ts` (the file's `make()` helper builds the selector from `readFfmpegEnv(envOver)`; add a variant that overrides the config object — read the helper first and add an optional `cfg?: Partial<FfmpegEnvConfig>` merged over `env`, i.e. `const env = { ...readFfmpegEnv(envOver), ...(o.cfg ?? {}) }`):

```ts
it('enabled(): localEnabled=false hides local even with binaries; remoteEnabled=false hides remote even with a URL', () => {
  expect(make({ cfg: { localEnabled: false } }).selector.enabled()).toEqual([]);
  expect(
    make({ cfg: { remoteEnabled: false, remoteUrl: 'https://w.example.com' } }).selector.enabled(),
  ).toEqual(['local']);
  expect(
    make({ cfg: { localEnabled: false, remoteEnabled: true, remoteUrl: 'https://w.example.com' } }).selector.enabled(),
  ).toEqual(['remote']);
});

it("pick('remote') when remote is switched off says so without pointing only at the env var", async () => {
  const { selector } = make({ cfg: { remoteEnabled: false } });
  await expect(selector.pick('remote')).rejects.toThrow(/not enabled on this instance/);
});
```

- [ ] **Step 2: Run to verify the first fails**

Run: `cd apps/backend && pnpm jest src/pipelines/ffmpeg/executor/ffmpeg-executor.selector.spec.ts`
Expected: the `localEnabled=false` assertion FAILS (`['local']` returned).

- [ ] **Step 3: Tokens file**

`apps/backend/src/pipelines/ffmpeg/executor/ffmpeg-config.tokens.ts`:

```ts
import type { FfmpegEnvConfig } from '../ffmpeg-env';

/**
 * DI tokens through which the executors receive the EFFECTIVE ffmpeg config —
 * env merged over the admin-saved DB row (FfmpegExecutorSettingsService.resolved()).
 * Both are @Optional() at the injection sites and default to plain readFfmpegEnv(),
 * so unit tests and older wiring keep working unchanged.
 */
export const FFMPEG_CONFIG = Symbol('FFMPEG_CONFIG');
export type FfmpegConfigResolver = () => FfmpegEnvConfig;

export const FFMPEG_REMOTE_DEPS = Symbol('FFMPEG_REMOTE_DEPS');
export interface FfmpegRemoteDeps {
  env?: FfmpegConfigResolver;
}
```

- [ ] **Step 4: Selector changes**

In `ffmpeg-executor.selector.ts`:
- imports: add `Inject` to the `@nestjs/common` import; `import { FFMPEG_CONFIG, type FfmpegConfigResolver } from './ffmpeg-config.tokens';`
- constructor last param becomes: `@Optional() @Inject(FFMPEG_CONFIG) private readonly env: FfmpegConfigResolver = readFfmpegEnv,`
- `enabled()`:

```ts
  /** Executors an operator has enabled: local iff binaries present AND localEnabled; remote iff remoteEnabled AND a Worker URL. */
  enabled(): FfmpegExecutorName[] {
    const cfg = this.env();
    const names: FfmpegExecutorName[] = [];
    if (this.capability.isAvailable() && cfg.localEnabled) names.push('local');
    if (cfg.remoteEnabled && cfg.remoteUrl) names.push('remote');
    return names;
  }
```

- in `pick()`, replace the remote message string with: `"ffmpeg_handler: executor 'remote' is not enabled on this instance (enable it in Admin Settings → Features → Server video ops, or set FFMPEG_REMOTE_URL)"`. Keep the local one.

- [ ] **Step 5: RemoteFfmpegExecutor constructor**

In `remote-ffmpeg.executor.ts`: import `FFMPEG_REMOTE_DEPS` from `'../ffmpeg-config.tokens'`; change the constructor's second parameter to `@Optional() @Inject(FFMPEG_REMOTE_DEPS) deps: Deps = {},` (keep the `Deps` interface as is — it is a superset of `FfmpegRemoteDeps`). Nothing else changes in this task.

- [ ] **Step 6: Module wiring**

In `apps/backend/src/pipelines/pipelines.module.ts`: import `FfmpegExecutorSettingsService` from `'./ffmpeg/ffmpeg-executor-settings.service'` and `FFMPEG_CONFIG, FFMPEG_REMOTE_DEPS` from `'./ffmpeg/executor/ffmpeg-config.tokens'`. In `providers`, next to `RemoteFfmpegExecutor, FfmpegExecutorSelector,` add:

```ts
    FfmpegExecutorSettingsService,
    {
      provide: FFMPEG_CONFIG,
      useFactory: (settings: FfmpegExecutorSettingsService) => () => settings.resolved(),
      inject: [FfmpegExecutorSettingsService],
    },
    {
      provide: FFMPEG_REMOTE_DEPS,
      useFactory: (settings: FfmpegExecutorSettingsService) => ({ env: () => settings.resolved() }),
      inject: [FfmpegExecutorSettingsService],
    },
```

Add `FfmpegExecutorSettingsService` to `exports` too (harmless, lets a future module reuse it).

- [ ] **Step 7: Tests green + type-check + boot smoke**

Run: `cd apps/backend && pnpm jest --testPathPattern 'src/.*ffmpeg' && npx tsc --noEmit -p tsconfig.json`
Expected: PASS / no errors. Also confirm Nest can build the module graph: `pnpm jest src/pipelines/handlers/ffmpeg.handler.spec.ts` PASS (it constructs the handler by hand, so additionally run `pnpm build` (`nest build`) to make sure the DI decorators compile).

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/pipelines/ffmpeg/executor/ffmpeg-config.tokens.ts apps/backend/src/pipelines/ffmpeg/executor/ffmpeg-executor.selector.ts apps/backend/src/pipelines/ffmpeg/executor/ffmpeg-executor.selector.spec.ts apps/backend/src/pipelines/ffmpeg/executor/remote/remote-ffmpeg.executor.ts apps/backend/src/pipelines/pipelines.module.ts
git commit -m "feat(ffmpeg): selector + remote executor read the admin-resolved config (FFMPEG_CONFIG / FFMPEG_REMOTE_DEPS)"
```

---

### Task 4: Test connection — fresh readiness + draft overrides

**Files:**
- Modify: `apps/backend/src/pipelines/ffmpeg/executor/remote/remote-ffmpeg.executor.ts` (`ready`, `testConnection`)
- Modify: `apps/backend/src/pipelines/ffmpeg/ffmpeg-executor-settings.service.ts` (add `testConnection`)
- Test (add cases): `apps/backend/src/pipelines/ffmpeg/executor/remote/remote-ffmpeg.executor.spec.ts`, `apps/backend/src/pipelines/ffmpeg/ffmpeg-executor-settings.service.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  // RemoteFfmpegExecutor
  ready(opts?: { fresh?: boolean; env?: FfmpegEnvConfig }): Promise<FfmpegExecutorReadiness>;
  testConnection(overrides?: Partial<Pick<FfmpegEnvConfig, 'remoteUrl' | 'remoteAuth' | 'remoteSaKeyJson'>>): Promise<WorkerHealth>;
  // FfmpegExecutorSettingsService
  testConnection(draft?: { remoteUrl?: string | null; remoteAuth?: 'google_id_token'|'none'; saKeyJson?: string | null }): Promise<FfmpegExecutorTestResult>;
  interface FfmpegExecutorTestResult {
    ok: boolean;                                   // health ok && readiness ok
    latencyMs: number | null;                      // healthz round trip; null when unreachable
    worker?: { version: string; ffmpeg: string | null; ops: string[]; uptimeS: number };
    error?: string;                                // why /healthz failed
    readiness: { ok: boolean; reason?: string };   // the selector's remote.reason for the same config
    credential: 'sa_key' | 'adc' | 'none';         // 'adc' = google_id_token with no key stored
  }
  ```

- [ ] **Step 1: Failing executor tests**

Append to `remote-ffmpeg.executor.spec.ts` (its helper builds `new RemoteFfmpegExecutor(storage as never, { env, clientFactory, now })` — reuse it; look at how it fakes `WorkerClient.health()`):

```ts
it('ready({fresh:true}) bypasses the readiness cache and ready({env}) evaluates a candidate config', async () => {
  const health = jest.fn(async () => ({ ok: true, version: '0.4.31', ffmpeg: 'ffmpeg version 6.1.1', ops: ['probe'], uptimeS: 1 }));
  const { executor } = makeExecutor({ health }); // adapt to the file's helper name/shape
  await executor.ready();
  await executor.ready();
  expect(health).toHaveBeenCalledTimes(1); // cached
  await executor.ready({ fresh: true });
  expect(health).toHaveBeenCalledTimes(2);
  const candidate = { ...readFfmpegEnv({ FFMPEG_REMOTE_URL: 'https://other.example.com' }) };
  const r = await executor.ready({ env: candidate });
  expect(r.ok).toBe(true);
});

it('testConnection(overrides) hits the Worker at the override URL, uncached', async () => {
  const seen: string[] = [];
  const { executor } = makeExecutor({
    clientFactory: (env) => { seen.push(env.remoteUrl!); return fakeClient(); }, // adapt to helper
  });
  await executor.testConnection({ remoteUrl: 'https://draft.example.com' });
  expect(seen).toContain('https://draft.example.com');
});
```

(If the file's helpers don't expose a `health` spy / `clientFactory` hook, add the smallest option to the helper — do not rewrite existing tests.)

- [ ] **Step 2: Run → FAIL** (`ready` ignores the argument; `testConnection` ignores overrides).

- [ ] **Step 3: Implement in `remote-ffmpeg.executor.ts`**

Replace the `ready()` signature/head with:

```ts
  async ready(opts: { fresh?: boolean; env?: FfmpegEnvConfig } = {}): Promise<FfmpegExecutorReadiness> {
    const env = opts.env ?? this.env();
    if (!env.remoteUrl) return { ok: false, reason: 'no Worker URL configured (Admin Settings → Server video ops → Executor, or FFMPEG_REMOTE_URL)' };
    ...
    const entry = opts.fresh || opts.env ? this.freshEntry(env) : this.cacheEntry(env);
```

and add next to `cacheEntry`:

```ts
  /** An entry nobody else sees — for Test connection and candidate configs. */
  private freshEntry(env: FfmpegEnvConfig): CacheEntry {
    return { key: this.identity(env), at: this.now() };
  }
```

Note: `entry.storage ??= …` / `entry.health ??= …` in the existing body keep working against the fresh entry. Also update the existing spec assertion that matched `'FFMPEG_REMOTE_URL is not set'` if there is one (only its expected string; search the spec for it).

Replace `testConnection`:

```ts
  /** Uncached liveness check for the settings "Test connection" button; `overrides` = the unsaved form draft. */
  async testConnection(
    overrides: Partial<Pick<FfmpegEnvConfig, 'remoteUrl' | 'remoteAuth' | 'remoteSaKeyJson'>> = {},
  ): Promise<WorkerHealth> {
    const env: FfmpegEnvConfig = { ...this.env(), ...overrides };
    if (!env.remoteUrl) throw new FfmpegExecutorUnavailableError('no Worker URL configured');
    // Never memoise a draft's client over the live one — a draft may carry a different key.
    const client = Object.keys(overrides).length ? this.clientFactory(env) : this.clientFor(env);
    return client.health();
  }
```

- [ ] **Step 4: Failing settings-service test**

Append to `ffmpeg-executor-settings.service.spec.ts` a `describe('testConnection()')`. The service needs the `RemoteFfmpegExecutor` — add it as a 4th constructor param (`@Optional()` so Task 2's tests that pass 3 args keep compiling; update `make()` in the spec to pass a fake `remote`):

```ts
  describe('testConnection()', () => {
    function makeWithRemote(o: { health?: () => Promise<any>; readiness?: { ok: boolean; reason?: string }; env?: NodeJS.ProcessEnv } = {}) {
      const remote = {
        testConnection: jest.fn(o.health ?? (async () => ({ ok: true, version: '0.4.31', ffmpeg: 'ffmpeg version 6.1.1', ops: ['probe', 'extract_audio', 'slice', 'concat'], uptimeS: 12 }))),
        ready: jest.fn(async () => o.readiness ?? { ok: true, version: '0.4.31' }),
      };
      const { service } = make({ env: o.env });
      (service as any).remote = remote; // or pass via constructor — match the implementation
      return { service, remote };
    }

    it('returns worker health + latency + readiness; credential=adc when no key stored', async () => {
      mockSelect([row({ remoteEnabled: true, remoteUrl: 'https://w.example.com' })]);
      const { service, remote } = makeWithRemote();
      await service.reload();
      const res = await service.testConnection();
      expect(res.ok).toBe(true);
      expect(res.worker?.version).toBe('0.4.31');
      expect(res.worker?.ops).toContain('slice');
      expect(typeof res.latencyMs).toBe('number');
      expect(res.readiness).toEqual({ ok: true });
      expect(res.credential).toBe('adc');
      expect(remote.ready).toHaveBeenCalledWith(expect.objectContaining({ fresh: true }));
    });

    it('draft overrides reach the executor; env-managed fields cannot be overridden; credential reflects the draft key', async () => {
      mockSelect([]);
      const { service, remote } = makeWithRemote({ env: { FFMPEG_REMOTE_AUTH: 'none' } });
      await service.reload();
      const res = await service.testConnection({ remoteUrl: 'https://draft.example.com', remoteAuth: 'google_id_token', saKeyJson: SA_KEY });
      expect(remote.testConnection).toHaveBeenCalledWith(expect.objectContaining({ remoteUrl: 'https://draft.example.com', remoteSaKeyJson: SA_KEY }));
      expect(remote.testConnection.mock.calls[0][0]).not.toHaveProperty('remoteAuth'); // pinned by env
      expect(res.credential).toBe('none'); // effective auth is env's 'none'
    });

    it('unreachable worker → ok:false with error, latency null, readiness reason passed through', async () => {
      mockSelect([row({ remoteEnabled: true, remoteUrl: 'https://w.example.com' })]);
      const { service } = makeWithRemote({
        health: async () => { throw new Error('worker unreachable: connect ECONNREFUSED'); },
        readiness: { ok: false, reason: 'worker unreachable: connect ECONNREFUSED' },
      });
      await service.reload();
      const res = await service.testConnection();
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/ECONNREFUSED/);
      expect(res.latencyMs).toBeNull();
      expect(res.readiness.reason).toMatch(/ECONNREFUSED/);
    });
  });
```

- [ ] **Step 5: Implement `testConnection` in the settings service**

Constructor gains `@Optional() private readonly remote?: RemoteFfmpegExecutor,` as the 4th parameter (import from `./executor/remote/remote-ffmpeg.executor`). Beware circular import: `remote-ffmpeg.executor.ts` must NOT import the settings service (it doesn't — it only imports the tokens). Add:

```ts
export interface FfmpegExecutorTestDraft {
  remoteUrl?: string | null;
  remoteAuth?: FfmpegRemoteAuth;
  saKeyJson?: string | null;
}

export interface FfmpegExecutorTestResult {
  ok: boolean;
  latencyMs: number | null;
  worker?: { version: string; ffmpeg: string | null; ops: string[]; uptimeS: number };
  error?: string;
  readiness: { ok: boolean; reason?: string };
  credential: 'sa_key' | 'adc' | 'none';
}
```

and the method:

```ts
  /**
   * Uncached "Test connection" for the admin UI. `draft` is the unsaved form; env-managed
   * fields are ignored (env wins). Reports both the raw /healthz answer and what the
   * selector's readiness check says about the same config, so the UI can show
   * "reachable but not usable" (e.g. version too old, storage not presignable).
   */
  async testConnection(draft: FfmpegExecutorTestDraft = {}): Promise<FfmpegExecutorTestResult> {
    if (!this.remote) throw new InternalServerErrorException('Remote executor is not wired.');
    const managed = this.envManaged();
    const overrides: Partial<Pick<FfmpegEnvConfig, 'remoteUrl' | 'remoteAuth' | 'remoteSaKeyJson'>> = {};
    if (draft.remoteUrl !== undefined && !managed.remoteUrl) overrides.remoteUrl = normaliseUrl(draft.remoteUrl);
    if (draft.remoteAuth !== undefined && !managed.remoteAuth) overrides.remoteAuth = draft.remoteAuth;
    if (draft.saKeyJson !== undefined && !managed.saKey) overrides.remoteSaKeyJson = draft.saKeyJson === null ? null : draft.saKeyJson.trim();

    const effective: FfmpegEnvConfig = { ...this.resolved(), ...overrides };
    const credential: FfmpegExecutorTestResult['credential'] =
      effective.remoteAuth === 'none' ? 'none' : effective.remoteSaKeyJson ? 'sa_key' : 'adc';

    let worker: FfmpegExecutorTestResult['worker'];
    let error: string | undefined;
    let latencyMs: number | null = null;
    const t0 = Date.now();
    try {
      const health = await this.remote.testConnection(overrides);
      latencyMs = Date.now() - t0;
      worker = { version: health.version, ffmpeg: health.ffmpeg, ops: health.ops, uptimeS: health.uptimeS };
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
```

Also update the spec's `make()` to construct with the fake remote as 4th arg instead of the `(service as any).remote` poke (do whichever keeps the spec honest — the constructor route is preferred).

- [ ] **Step 6: Run everything**

Run: `cd apps/backend && pnpm jest --testPathPattern 'src/.*ffmpeg' && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/pipelines/ffmpeg
git commit -m "feat(ffmpeg): Test connection — uncached worker health + fresh readiness for a settings draft"
```

---

### Task 5: Admin endpoints (`/api/settings/ffmpeg-executor`)

**Files:**
- Create: `apps/backend/src/pipelines/ffmpeg/ffmpeg-executor-settings.controller.ts`
- Create: `apps/backend/src/pipelines/ffmpeg/ffmpeg-executor-settings.controller.spec.ts`
- Modify: `apps/backend/src/pipelines/pipelines.module.ts` (controllers)

**Interfaces:**
- Consumes: `FfmpegExecutorSettingsService.getStatus/update/testConnection` (Tasks 2, 4); guards `ApiKeyGuard, RolesGuard, Roles, CurrentUser` from `'../../auth'`.
- Produces HTTP:
  - `GET /api/settings/ffmpeg-executor` → `FfmpegExecutorStatus` (admin)
  - `PUT /api/settings/ffmpeg-executor` body `UpdateFfmpegExecutorInput` → `FfmpegExecutorStatus` (admin)
  - `POST /api/settings/ffmpeg-executor/test` body `FfmpegExecutorTestDraft` → `FfmpegExecutorTestResult` (admin)

- [ ] **Step 1: Failing controller test**

`ffmpeg-executor-settings.controller.spec.ts`:

```ts
import { FfmpegExecutorSettingsController } from './ffmpeg-executor-settings.controller';

describe('FfmpegExecutorSettingsController', () => {
  const service = {
    getStatus: jest.fn(async () => ({ hasSaKey: false })),
    update: jest.fn(async () => ({ hasSaKey: true })),
    testConnection: jest.fn(async () => ({ ok: true })),
  };
  const controller = new FfmpegExecutorSettingsController(service as never);

  it('GET returns status', async () => {
    await expect(controller.getStatus()).resolves.toEqual({ hasSaKey: false });
  });

  it('PUT forwards the body + user id and returns the new status', async () => {
    const body = { remoteEnabled: true, remoteUrl: 'https://w.example.com', saKeyJson: '{"type":"service_account"}' };
    await expect(controller.update(body, { id: 'u1' })).resolves.toEqual({ hasSaKey: true });
    expect(service.update).toHaveBeenCalledWith(body, 'u1');
  });

  it('POST /test forwards the draft', async () => {
    await controller.test({ remoteUrl: 'https://draft.example.com' });
    expect(service.testConnection).toHaveBeenCalledWith({ remoteUrl: 'https://draft.example.com' });
  });

  it('is admin-only on every route (guard + Roles metadata)', () => {
    const roles = (m: string) => Reflect.getMetadata('roles', (FfmpegExecutorSettingsController.prototype as any)[m]);
    expect(roles('getStatus')).toEqual(['admin']);
    expect(roles('update')).toEqual(['admin']);
    expect(roles('test')).toEqual(['admin']);
  });
});
```

(Check the metadata key the `Roles` decorator uses in `apps/backend/src/auth` — if it is not `'roles'`, use the exported constant instead.)

- [ ] **Step 2: Run → FAIL (module not found)**

- [ ] **Step 3: Controller**

```ts
import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard, RolesGuard, Roles, CurrentUser } from '../../auth';
import {
  FfmpegExecutorSettingsService,
  type FfmpegExecutorTestDraft,
  type UpdateFfmpegExecutorInput,
} from './ffmpeg-executor-settings.service';

/**
 * Admin Settings → Features → Server video ops → Executor. Admin-only; the
 * service-account key is write-only (never in a response). Lives in
 * PipelinesModule (not SettingsModule) because it depends on the executor
 * services and SettingsModule must not import PipelinesModule.
 */
@ApiTags('settings')
@Controller('api/settings/ffmpeg-executor')
@UseGuards(ApiKeyGuard, RolesGuard)
export class FfmpegExecutorSettingsController {
  constructor(private readonly settings: FfmpegExecutorSettingsService) {}

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'ffmpeg executor settings (Local / Remote) — the SA key is never returned' })
  @ApiResponse({ status: 200 })
  getStatus() {
    return this.settings.getStatus();
  }

  @Put()
  @Roles('admin')
  @ApiOperation({ summary: 'Update ffmpeg executor settings (partial; saKeyJson: string=replace, null=clear, absent=keep)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: 'Invalid combination (see message)' })
  update(@Body() body: UpdateFfmpegExecutorInput, @CurrentUser() user: { id: string }) {
    return this.settings.update(body, user?.id);
  }

  @Post('test')
  @Roles('admin')
  @ApiOperation({ summary: 'Test the Worker connection for the saved settings or an unsaved draft' })
  @ApiResponse({ status: 200 })
  test(@Body() body: FfmpegExecutorTestDraft = {}) {
    return this.settings.testConnection(body ?? {});
  }
}
```

Register in `pipelines.module.ts` `controllers: [...]` → add `FfmpegExecutorSettingsController` (import from `'./ffmpeg/ffmpeg-executor-settings.controller'`).

- [ ] **Step 4: Run tests + build**

Run: `cd apps/backend && pnpm jest src/pipelines/ffmpeg/ffmpeg-executor-settings.controller.spec.ts && pnpm build`
Expected: PASS, build ok.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/pipelines/ffmpeg/ffmpeg-executor-settings.controller.ts apps/backend/src/pipelines/ffmpeg/ffmpeg-executor-settings.controller.spec.ts apps/backend/src/pipelines/pipelines.module.ts
git commit -m "feat(ffmpeg): admin endpoints GET/PUT /api/settings/ffmpeg-executor + POST …/test"
```

---

### Task 6: Frontend API slice

**Files:**
- Modify: `apps/frontend/src/services/api.ts` (`tagTypes`)
- Modify: `apps/frontend/src/services/settingsApi.ts`

**Interfaces:**
- Produces hooks `useGetFfmpegExecutorSettingsQuery`, `useUpdateFfmpegExecutorSettingsMutation`, `useTestFfmpegExecutorConnectionMutation` and exported types `FfmpegExecutorStatus`, `UpdateFfmpegExecutorDto`, `FfmpegExecutorTestDraft`, `FfmpegExecutorTestResult` (mirror Task 2/4 shapes exactly).

- [ ] **Step 1: Add the tag**

In `apps/frontend/src/services/api.ts` `tagTypes` array add `'FfmpegExecutor',`.

- [ ] **Step 2: Types + endpoints in `settingsApi.ts`**

Types (near the other settings types):

```ts
// ─── ffmpeg executor settings (Server video ops → Executor) ───────────────
export type FfmpegExecutorName = 'local' | 'remote';
export type FfmpegRemoteAuth = 'google_id_token' | 'none';

export interface FfmpegExecutorStatus {
  localAvailable: boolean;
  localVersion: string | null;
  localEnabled: boolean;
  remoteEnabled: boolean;
  remoteUrl: string | null;
  remoteAuth: FfmpegRemoteAuth;
  hasSaKey: boolean;
  saKeySource: 'db' | 'env' | null;
  defaultExecutor: FfmpegExecutorName;
  storagePresignable: boolean;
  envManaged: { defaultExecutor: boolean; remoteUrl: boolean; remoteAuth: boolean; saKey: boolean };
}

export interface UpdateFfmpegExecutorDto {
  localEnabled?: boolean;
  remoteEnabled?: boolean;
  remoteUrl?: string | null;
  remoteAuth?: FfmpegRemoteAuth;
  defaultExecutor?: FfmpegExecutorName;
  /** undefined = keep, null = clear, string = replace */
  saKeyJson?: string | null;
}

export interface FfmpegExecutorTestDraft {
  remoteUrl?: string | null;
  remoteAuth?: FfmpegRemoteAuth;
  saKeyJson?: string | null;
}

export interface FfmpegExecutorTestResult {
  ok: boolean;
  latencyMs: number | null;
  worker?: { version: string; ffmpeg: string | null; ops: string[]; uptimeS: number };
  error?: string;
  readiness: { ok: boolean; reason?: string };
  credential: 'sa_key' | 'adc' | 'none';
}
```

Endpoints (inside `endpoints: (builder) => ({ … })`, next to the Google-integration block):

```ts
    getFfmpegExecutorSettings: builder.query<FfmpegExecutorStatus, void>({
      query: () => '/api/settings/ffmpeg-executor',
      providesTags: ['FfmpegExecutor'],
    }),
    updateFfmpegExecutorSettings: builder.mutation<FfmpegExecutorStatus, UpdateFfmpegExecutorDto>({
      query: (body) => ({ url: '/api/settings/ffmpeg-executor', method: 'PUT', body }),
      invalidatesTags: ['FfmpegExecutor'],
    }),
    testFfmpegExecutorConnection: builder.mutation<FfmpegExecutorTestResult, FfmpegExecutorTestDraft>({
      query: (body) => ({ url: '/api/settings/ffmpeg-executor/test', method: 'POST', body }),
    }),
```

Export the hooks where the file exports the others: `useGetFfmpegExecutorSettingsQuery, useUpdateFfmpegExecutorSettingsMutation, useTestFfmpegExecutorConnectionMutation`.

- [ ] **Step 3: Type-check + commit**

Run: `cd apps/frontend && npx tsc --noEmit -p tsconfig.json` (or `pnpm build` if that is the project's check) → no errors.

```bash
git add apps/frontend/src/services/api.ts apps/frontend/src/services/settingsApi.ts
git commit -m "feat(frontend): ffmpeg executor settings API slice"
```

---

### Task 7: `FfmpegExecutorSettings` panel + registry hook in `FeatureToggles`

**Files:**
- Create: `apps/frontend/src/components/settings/FfmpegExecutorSettings.tsx`
- Create: `apps/frontend/src/components/settings/FfmpegExecutorSettings.test.tsx`
- Modify: `apps/frontend/src/components/settings/FeatureToggles.tsx`

**Interfaces:**
- Consumes: Task 6 hooks/types; shadcn `Switch, Input, Textarea, RadioGroup/RadioGroupItem, Button, Badge, Alert/AlertDescription, Label, Skeleton` from `@/components/ui/*`; `useToast` from `@/hooks/use-toast`.
- Produces: `export function FfmpegExecutorSettings()`; `FeatureToggle.Panel?: React.ComponentType` rendered under the toggle row.

UI contract (spec §1.5 + user's deliverable list):
- **Local server** row: switch (`localEnabled`), subtitle: version line when `localAvailable` (`ffmpeg version 6.1.1`), or "ffmpeg is not installed on this server — the Local executor cannot be enabled" (switch disabled). Small note "Memory floor: see Sizing in the docs".
- **Remote (Worker)** row: switch (`remoteEnabled`); when `storagePresignable === false` the switch is disabled with the note "Needs bucket storage (S3, GCS, MinIO, Azure) — the Worker moves bytes through signed URLs". Under it: **Worker URL** input; **Auth** select-ish radio (`Google ID token (Cloud Run IAM)` / `None (private network only)`); when `none` a **red** `Alert variant="destructive"`: "No authentication: anyone who can reach the Worker URL can run jobs on it. Only use on a private network (docker compose profile, VPC)."; **Service-account key (JSON)**: if `hasSaKey` show `Badge` "Key stored (db|env)" + button **Replace key** (reveals a `Textarea`) + button **Remove key** (sets `saKeyJson: null` on save); if none, show the Textarea directly with helper "Optional. Leave empty to use Application Default Credentials (works when CE itself runs on GCP)". Anything env-managed: control disabled + `Badge variant="secondary"`: "Managed by FFMPEG_REMOTE_URL" (etc.).
- **Test connection** button → `useTestFfmpegExecutorConnectionMutation` with the current draft (`remoteUrl`, `remoteAuth`, and `saKeyJson` only if the textarea has content). Result line: ✓ "Worker 0.4.31 · ffmpeg version 6.1.1 · ops probe, extract_audio, slice, concat · 123 ms" or ✗ `error`; below it, readiness: "Ready" or "Not ready: <reason>"; and a credential note: `adc` → "Using Application Default Credentials (no key stored)"; `none` → "No auth"; `sa_key` → "Using the stored service-account key".
- **Default executor** `RadioGroup` (`local` / `remote`); an item is disabled unless that executor is enabled in the *draft* (local: `localEnabled && localAvailable`; remote: `remoteEnabled && remoteUrl`); env-managed → whole group disabled + badge.
- **Save** button (disabled while nothing changed / while saving) → PUT with only changed fields (`saKeyJson` included only when the textarea has content or Remove was clicked); toast success/failure using the server's `message` on 400.

- [ ] **Step 1: Failing component test**

`FfmpegExecutorSettings.test.tsx` (Vitest + Testing Library; look at `MySitesSection.test.tsx` for the store/provider wrapper pattern used in this repo and reuse it — the hooks are RTK Query so mock the three hooks via `vi.mock('@/services/settingsApi', …)`):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FfmpegExecutorSettings } from './FfmpegExecutorSettings';

const update = vi.fn(() => ({ unwrap: () => Promise.resolve({}) }));
const test = vi.fn(() => ({ unwrap: () => Promise.resolve({ ok: true, latencyMs: 42, worker: { version: '0.4.31', ffmpeg: 'ffmpeg version 6.1.1', ops: ['probe', 'slice'], uptimeS: 3 }, readiness: { ok: true }, credential: 'adc' }) }));
let status: any;

vi.mock('@/services/settingsApi', () => ({
  useGetFfmpegExecutorSettingsQuery: () => ({ data: status, isLoading: false, error: undefined }),
  useUpdateFfmpegExecutorSettingsMutation: () => [update, { isLoading: false }],
  useTestFfmpegExecutorConnectionMutation: () => [test, { isLoading: false }],
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

beforeEach(() => {
  update.mockClear();
  test.mockClear();
  status = {
    localAvailable: true, localVersion: 'ffmpeg version 6.1.1', localEnabled: true,
    remoteEnabled: false, remoteUrl: null, remoteAuth: 'google_id_token', hasSaKey: false, saKeySource: null,
    defaultExecutor: 'local', storagePresignable: true,
    envManaged: { defaultExecutor: false, remoteUrl: false, remoteAuth: false, saKey: false },
  };
});

describe('FfmpegExecutorSettings', () => {
  it('shows the local version and disables the remote radio until Remote has a URL', () => {
    render(<FfmpegExecutorSettings />);
    expect(screen.getByText(/ffmpeg version 6\.1\.1/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /remote/i })).toBeDisabled();
  });

  it('shows the red banner for auth none', () => {
    status.remoteEnabled = true; status.remoteUrl = 'http://ffmpeg-worker:8080'; status.remoteAuth = 'none';
    render(<FfmpegExecutorSettings />);
    expect(screen.getByText(/No authentication/)).toBeInTheDocument();
  });

  it('env-managed URL is read-only with a badge', () => {
    status.remoteEnabled = true; status.remoteUrl = 'https://env.example.com'; status.envManaged.remoteUrl = true;
    render(<FfmpegExecutorSettings />);
    expect(screen.getByLabelText(/Worker URL/)).toBeDisabled();
    expect(screen.getByText(/Managed by FFMPEG_REMOTE_URL/)).toBeInTheDocument();
  });

  it('Test connection sends the draft and renders version, ops, latency and the ADC note', async () => {
    status.remoteEnabled = true;
    render(<FfmpegExecutorSettings />);
    fireEvent.change(screen.getByLabelText(/Worker URL/), { target: { value: 'https://draft.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Test connection/ }));
    await waitFor(() => expect(test).toHaveBeenCalledWith(expect.objectContaining({ remoteUrl: 'https://draft.example.com' })));
    expect(await screen.findByText(/0\.4\.31/)).toBeInTheDocument();
    expect(screen.getByText(/42 ms/)).toBeInTheDocument();
    expect(screen.getByText(/Application Default Credentials/)).toBeInTheDocument();
  });

  it('Save sends only changed fields; a pasted key is sent as saKeyJson; stored key offers Replace/Remove', async () => {
    render(<FfmpegExecutorSettings />);
    fireEvent.click(screen.getByRole('switch', { name: /Remote/ }));
    fireEvent.change(screen.getByLabelText(/Worker URL/), { target: { value: 'https://w.example.com' } });
    fireEvent.change(screen.getByLabelText(/Service-account key/), { target: { value: '{"type":"service_account"}' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ remoteEnabled: true, remoteUrl: 'https://w.example.com', saKeyJson: '{"type":"service_account"}' }));

    status.hasSaKey = true; status.saKeySource = 'db'; status.remoteEnabled = true; status.remoteUrl = 'https://w.example.com';
    render(<FfmpegExecutorSettings />);
    expect(screen.getByText(/Key stored/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Replace key/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove key/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run → FAIL** (`cd apps/frontend && pnpm test:run src/components/settings/FfmpegExecutorSettings.test.tsx`).

- [ ] **Step 3: Implement the component**

`FfmpegExecutorSettings.tsx` — full implementation (adjust import paths for `RadioGroup` etc. to what `components/ui` exports):

```tsx
// Admin Settings → Features → Server video ops → Executor.
// Configures WHICH executor runs ffmpeg jobs: Local server (ffmpeg in this
// backend) and/or Remote (a Worker CE calls over HTTPS; Cloud Run is the
// reference deployment). Fields pinned by env vars render read-only.
// The service-account key is write-only: the API only ever says whether one
// is stored, so this form has a "replace" flow rather than a value.
import { useEffect, useMemo, useState } from 'react';
import {
  useGetFfmpegExecutorSettingsQuery,
  useTestFfmpegExecutorConnectionMutation,
  useUpdateFfmpegExecutorSettingsMutation,
  type FfmpegExecutorName,
  type FfmpegExecutorStatus,
  type FfmpegExecutorTestResult,
  type FfmpegRemoteAuth,
  type UpdateFfmpegExecutorDto,
} from '@/services/settingsApi';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle2, Cloud, Server, XCircle } from 'lucide-react';

interface Draft {
  localEnabled: boolean;
  remoteEnabled: boolean;
  remoteUrl: string;
  remoteAuth: FfmpegRemoteAuth;
  defaultExecutor: FfmpegExecutorName;
  /** Textarea contents; '' = nothing to send. */
  saKeyJson: string;
  /** "Remove key" clicked → send saKeyJson: null on save. */
  removeKey: boolean;
}

function toDraft(s: FfmpegExecutorStatus): Draft {
  return {
    localEnabled: s.localEnabled,
    remoteEnabled: s.remoteEnabled,
    remoteUrl: s.remoteUrl ?? '',
    remoteAuth: s.remoteAuth,
    defaultExecutor: s.defaultExecutor,
    saKeyJson: '',
    removeKey: false,
  };
}

/** Only the fields that differ from the saved status (the API is partial-update). */
function diff(s: FfmpegExecutorStatus, d: Draft): UpdateFfmpegExecutorDto {
  const out: UpdateFfmpegExecutorDto = {};
  if (d.localEnabled !== s.localEnabled) out.localEnabled = d.localEnabled;
  if (d.remoteEnabled !== s.remoteEnabled) out.remoteEnabled = d.remoteEnabled;
  if (d.remoteUrl.trim() !== (s.remoteUrl ?? '')) out.remoteUrl = d.remoteUrl.trim() || null;
  if (d.remoteAuth !== s.remoteAuth) out.remoteAuth = d.remoteAuth;
  if (d.defaultExecutor !== s.defaultExecutor) out.defaultExecutor = d.defaultExecutor;
  if (d.removeKey) out.saKeyJson = null;
  else if (d.saKeyJson.trim()) out.saKeyJson = d.saKeyJson.trim();
  return out;
}

function EnvBadge({ name }: { name: string }) {
  return (
    <Badge variant="secondary" className="font-mono text-[10px]">
      Managed by {name}
    </Badge>
  );
}

function errorMessage(err: unknown): string {
  return err && typeof err === 'object' && 'data' in err
    ? (err as { data?: { message?: string } }).data?.message || 'An error occurred'
    : 'An error occurred';
}

export function FfmpegExecutorSettings() {
  const { toast } = useToast();
  const { data: status, isLoading, error } = useGetFfmpegExecutorSettingsQuery();
  const [update, { isLoading: saving }] = useUpdateFfmpegExecutorSettingsMutation();
  const [testConnection, { isLoading: testing }] = useTestFfmpegExecutorConnectionMutation();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [replacingKey, setReplacingKey] = useState(false);
  const [testResult, setTestResult] = useState<FfmpegExecutorTestResult | null>(null);

  useEffect(() => {
    if (status) {
      setDraft(toDraft(status));
      setReplacingKey(false);
    }
  }, [status]);

  const changes = useMemo(() => (status && draft ? diff(status, draft) : {}), [status, draft]);
  const dirty = Object.keys(changes).length > 0;

  if (isLoading || !draft || !status) return <Skeleton className="h-40 w-full" />;
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Failed to load executor settings.</AlertDescription>
      </Alert>
    );
  }

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const localSelectable = draft.localEnabled && status.localAvailable;
  const remoteSelectable = draft.remoteEnabled && draft.remoteUrl.trim() !== '';
  const showKeyEditor = !status.hasSaKey || replacingKey;

  const onSave = async () => {
    try {
      await update(changes).unwrap();
      toast({ title: 'Executor settings saved' });
      setTestResult(null);
    } catch (err) {
      toast({ title: 'Failed to save executor settings', description: errorMessage(err), variant: 'destructive' });
    }
  };

  const onTest = async () => {
    setTestResult(null);
    try {
      const res = await testConnection({
        remoteUrl: draft.remoteUrl.trim() || null,
        remoteAuth: draft.remoteAuth,
        ...(draft.saKeyJson.trim() ? { saKeyJson: draft.saKeyJson.trim() } : {}),
      }).unwrap();
      setTestResult(res);
    } catch (err) {
      toast({ title: 'Test failed', description: errorMessage(err), variant: 'destructive' });
    }
  };

  return (
    <div className="ml-8 space-y-4 rounded-lg border border-dashed p-4">
      <div>
        <Label className="text-sm font-medium">Executor</Label>
        <p className="text-xs text-muted-foreground">
          Where ffmpeg jobs run. Enable Local, Remote, or both, then pick the default. Steps can still name an executor explicitly.
        </p>
      </div>

      {/* Local server */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Server className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <Label htmlFor="ffmpeg-local" className="text-sm font-medium">Local server</Label>
            <p className="text-xs text-muted-foreground">
              {status.localAvailable
                ? <>ffmpeg spawned by this backend · {status.localVersion} · memory floor: see Sizing in the docs</>
                : 'ffmpeg is not installed on this server — the Local executor cannot be enabled'}
            </p>
          </div>
        </div>
        <Switch id="ffmpeg-local" aria-label="Local server" checked={draft.localEnabled} disabled={!status.localAvailable} onCheckedChange={(v) => set({ localEnabled: v })} />
      </div>

      {/* Remote */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Cloud className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <Label htmlFor="ffmpeg-remote" className="text-sm font-medium">Remote (Worker)</Label>
            <p className="text-xs text-muted-foreground">
              {status.storagePresignable
                ? 'A Worker CE calls over HTTPS — bytes move bucket ↔ Worker via signed URLs and never touch this server. Cloud Run is the reference deployment.'
                : 'Needs bucket storage (S3, GCS, MinIO, Azure) — the Worker moves bytes through signed URLs, which local filesystem storage cannot provide.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status.envManaged.remoteUrl && <EnvBadge name="FFMPEG_REMOTE_URL" />}
          <Switch id="ffmpeg-remote" aria-label="Remote" checked={draft.remoteEnabled} disabled={!status.storagePresignable || status.envManaged.remoteUrl} onCheckedChange={(v) => set({ remoteEnabled: v })} />
        </div>
      </div>

      {draft.remoteEnabled && (
        <div className="ml-7 space-y-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Label htmlFor="ffmpeg-remote-url" className="text-xs">Worker URL</Label>
              {status.envManaged.remoteUrl && <EnvBadge name="FFMPEG_REMOTE_URL" />}
            </div>
            <Input id="ffmpeg-remote-url" placeholder="https://bffless-ffmpeg-xxxx-uc.a.run.app" value={draft.remoteUrl} disabled={status.envManaged.remoteUrl} onChange={(e) => set({ remoteUrl: e.target.value })} />
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Label className="text-xs">Auth</Label>
              {status.envManaged.remoteAuth && <EnvBadge name="FFMPEG_REMOTE_AUTH" />}
            </div>
            <RadioGroup value={draft.remoteAuth} disabled={status.envManaged.remoteAuth} onValueChange={(v) => set({ remoteAuth: v as FfmpegRemoteAuth })} className="flex gap-4">
              <div className="flex items-center gap-2">
                <RadioGroupItem id="ffmpeg-auth-idtoken" value="google_id_token" />
                <Label htmlFor="ffmpeg-auth-idtoken" className="text-xs font-normal">Google ID token (Cloud Run IAM)</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem id="ffmpeg-auth-none" value="none" />
                <Label htmlFor="ffmpeg-auth-none" className="text-xs font-normal">None (private network only)</Label>
              </div>
            </RadioGroup>
            {draft.remoteAuth === 'none' && (
              <Alert variant="destructive">
                <AlertDescription className="text-xs">
                  No authentication: anyone who can reach the Worker URL can run jobs on it. Only use on a private network (docker compose profile, VPC).
                </AlertDescription>
              </Alert>
            )}
          </div>

          {draft.remoteAuth === 'google_id_token' && (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label htmlFor="ffmpeg-sa-key" className="text-xs">Service-account key (JSON)</Label>
                {status.envManaged.saKey && <EnvBadge name="FFMPEG_REMOTE_SA_KEY_JSON" />}
                {status.hasSaKey && !status.envManaged.saKey && (
                  <Badge variant="outline" className="text-[10px]">Key stored ({status.saKeySource})</Badge>
                )}
              </div>
              {status.envManaged.saKey ? (
                <p className="text-xs text-muted-foreground">Provided by the environment; not editable here.</p>
              ) : showKeyEditor ? (
                <>
                  <Textarea id="ffmpeg-sa-key" rows={4} placeholder='{"type": "service_account", ...}' className="font-mono text-xs" value={draft.saKeyJson} onChange={(e) => set({ saKeyJson: e.target.value, removeKey: false })} />
                  <p className="text-xs text-muted-foreground">
                    Optional. Leave empty to use Application Default Credentials (works when CE itself runs on GCP). The key is stored encrypted and never shown again.
                  </p>
                  {replacingKey && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setReplacingKey(false); set({ saKeyJson: '' }); }}>Cancel</Button>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => { setReplacingKey(true); set({ removeKey: false }); }}>Replace key</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => set({ removeKey: !draft.removeKey, saKeyJson: '' })}>
                    {draft.removeKey ? 'Keep key' : 'Remove key'}
                  </Button>
                  {draft.removeKey && <span className="text-xs text-destructive">Key will be removed on save (ADC will be used).</span>}
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Button type="button" variant="outline" size="sm" onClick={onTest} disabled={testing || !draft.remoteUrl.trim()}>
              {testing ? 'Testing…' : 'Test connection'}
            </Button>
            {testResult && (
              <div className="space-y-1 text-xs">
                <div className="flex items-center gap-2">
                  {testResult.worker && !testResult.error ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-destructive" />}
                  {testResult.worker ? (
                    <span>
                      Worker {testResult.worker.version} · {testResult.worker.ffmpeg ?? 'no ffmpeg'} · ops {testResult.worker.ops.join(', ')}
                      {testResult.latencyMs !== null && <> · {testResult.latencyMs} ms</>}
                    </span>
                  ) : (
                    <span>{testResult.error}</span>
                  )}
                </div>
                <div className={testResult.readiness.ok ? 'text-muted-foreground' : 'text-destructive'}>
                  {testResult.readiness.ok ? 'Ready' : `Not ready: ${testResult.readiness.reason ?? 'unknown reason'}`}
                </div>
                <div className="text-muted-foreground">
                  {testResult.credential === 'adc' && 'Using Application Default Credentials (no key stored) — this works when CE runs on GCP; elsewhere paste a service-account key.'}
                  {testResult.credential === 'sa_key' && 'Using the stored service-account key.'}
                  {testResult.credential === 'none' && 'No auth.'}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Default executor */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Label className="text-xs">Default executor</Label>
          {status.envManaged.defaultExecutor && <EnvBadge name="FFMPEG_EXECUTOR" />}
        </div>
        <RadioGroup value={draft.defaultExecutor} disabled={status.envManaged.defaultExecutor} onValueChange={(v) => set({ defaultExecutor: v as FfmpegExecutorName })} className="flex gap-4">
          <div className="flex items-center gap-2">
            <RadioGroupItem id="ffmpeg-default-local" value="local" disabled={!localSelectable} aria-label="local" />
            <Label htmlFor="ffmpeg-default-local" className="text-xs font-normal">Local server</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id="ffmpeg-default-remote" value="remote" disabled={!remoteSelectable} aria-label="remote" />
            <Label htmlFor="ffmpeg-default-remote" className="text-xs font-normal">Remote</Label>
          </div>
        </RadioGroup>
        <p className="text-xs text-muted-foreground">Only enabled executors can be the default.</p>
      </div>

      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={onSave} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save executor settings'}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Registry hook in `FeatureToggles.tsx`**

- `type FeatureToggle` gains `Panel?: React.ComponentType;` (import `type ComponentType` from react).
- The `FFMPEG_HANDLER_ENABLED` entry gains `Panel: FfmpegExecutorSettings,` (import from `./FfmpegExecutorSettings`).
- In `FeatureToggles()` render:

```tsx
        {FEATURE_TOGGLES.map((toggle) => (
          <div key={toggle.flagKey} className="space-y-3">
            <FeatureToggleRow toggle={toggle} />
            {toggle.Panel && <toggle.Panel />}
          </div>
        ))}
```

- [ ] **Step 5: Tests green; eslint on the two files; type-check**

Run: `cd apps/frontend && pnpm test:run src/components/settings/FfmpegExecutorSettings.test.tsx && npx eslint src/components/settings/FfmpegExecutorSettings.tsx src/components/settings/FfmpegExecutorSettings.test.tsx src/components/settings/FeatureToggles.tsx && npx tsc --noEmit -p tsconfig.json`
Expected: PASS / clean.

- [ ] **Step 6: Visual smoke (headless)**

The panel needs a live backend for data; a cheap check is the frontend dev server + `localdev-tools/shot.mjs` against `/admin/settings` (features tab) — it will render the loading skeleton/"couldn't reach server" fallback without a session, which is expected. Do it only to confirm the page still renders without console errors:

```bash
cd apps/frontend && (pnpm dev >/tmp/claude-1000/-home-rico-bffless/cc184474-b754-4a1c-969a-a24532b89610/scratchpad/fe.log 2>&1 &) && sleep 8
cd /home/rico/bffless/localdev-tools && node shot.mjs http://localhost:5173/admin/settings --out /tmp/claude-1000/-home-rico-bffless/cc184474-b754-4a1c-969a-a24532b89610/scratchpad/features.png --full ; pkill -f "vite" || true
```

Expected: `consoleErrors:0` (failed `/api` requests are expected without a session).

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/components/settings/FfmpegExecutorSettings.tsx apps/frontend/src/components/settings/FfmpegExecutorSettings.test.tsx apps/frontend/src/components/settings/FeatureToggles.tsx
git commit -m "feat(frontend): Server video ops → Executor panel (Local/Remote, worker URL, auth, write-only SA key, test connection, default)"
```

---

### Task 8: `.env.example` + compose comment touch-ups (CE)

**Files:**
- Modify: `.env.example` (§13, the `FFMPEG_EXECUTOR` … block ~lines 575–600)
- Modify: `docker-compose.yml` (comment on the `ffmpeg-worker` service, ~line 263)

- [ ] **Step 1: `.env.example`** — above the `# FFMPEG_EXECUTOR=local` line, add:

```
# These four (FFMPEG_EXECUTOR, FFMPEG_REMOTE_URL, FFMPEG_REMOTE_AUTH, FFMPEG_REMOTE_SA_KEY_JSON)
# can instead be set in Admin Settings → Features → Server video ops → Executor. When an env
# var is set it WINS over the admin value and the UI shows that field as env-managed.
# FFMPEG_REMOTE_MAX_INFLIGHT / FFMPEG_WORKER_MIN_VERSION / FFMPEG_MAX_OUTPUT_BYTES are env-only.
```

- [ ] **Step 2: `docker-compose.yml`** — extend the `ffmpeg-worker` comment: `# Point CE at it with FFMPEG_REMOTE_URL=http://ffmpeg-worker:8080 FFMPEG_REMOTE_AUTH=none, or in Admin Settings → Features → Server video ops → Executor (Worker URL http://ffmpeg-worker:8080, auth None).`

- [ ] **Step 3: Commit**

```bash
git add .env.example docker-compose.yml
git commit -m "docs(env): note the admin-settings alternative for the ffmpeg remote executor vars"
```

---

### Task 9: Public docs — *Remote executor* section (docs-public worktree)

**Files:**
- Modify: `repos/docs-public/.claude/worktrees/ffmpeg-remote-executor/docs/features/server-video-ops.md`

Work in the docs worktree (`git rev-parse --show-toplevel` must print `…/docs-public/.claude/worktrees/ffmpeg-remote-executor`).

- [ ] **Step 1: Intro + modes**

Replace the first paragraph after `# Server Video Ops` heading's second paragraph ("Server video ops are **off by default**…") by inserting, right after it, a new subsection:

```markdown
## Three ways to run video ops

| Mode | Where ffmpeg runs | When to use |
| --- | --- | --- |
| **Browser** | ffmpeg.wasm in the visitor's tab | Always available; the fallback when server video ops are off or refused |
| **Local server** | Native ffmpeg inside the CE backend container | 2 GB+ hosts; simplest, no extra moving parts |
| **Remote** (since v0.4.31) | A separate **Worker** CE calls over HTTPS — Cloud Run is the reference deployment | Small hosts (1 GB droplets), bursty encodes, or when you don't want encodes competing with the API |

"Server video ops" = Local server + Remote together: the app only sees `server: true` and the same four operations; **which executor runs a job** is chosen in Admin Settings (Local, Remote, or both, plus a default) and can be overridden per pipeline step (`executor: "remote"`).
```

- [ ] **Step 2: Append the Remote executor section** at the end of the file (after "For app and pipeline authors"), verbatim:

````markdown
## Remote executor

The Remote executor sends each job to a **Worker** — a small stateless container image (`ghcr.io/bffless/ce-ffmpeg-worker`) that runs the ffmpeg command CE hands it. Bytes never touch your CE server: CE signs a download URL per input and an upload URL for the output, and the Worker moves data **bucket ↔ Worker** directly. That has two consequences:

- **Bucket storage only** — S3, GCS, MinIO or Azure. The local filesystem adapter cannot hand a Worker a reachable URL, and Admin Settings refuses to enable Remote on it. (No bucket CORS is needed: Worker → bucket is server-to-server.)
- The Worker needs no access to your database, secrets or CE API — only the signed URLs in the job.

CE authenticates to the Worker with a **Google ID token** (Cloud Run IAM), minted from a service-account key you paste into Admin Settings (stored encrypted, never shown again) or from Application Default Credentials when CE itself runs on GCP. For private networks there is an `auth: none` mode (below).

### Deploy the Worker on Cloud Run (one command + IAM)

Replace `PROJECT` with your GCP project id and `0.4.31` with your CE version (the Worker image is versioned with CE; `:latest` follows the newest release).

```bash
gcloud run deploy bffless-ffmpeg --project PROJECT --image ghcr.io/bffless/ce-ffmpeg-worker:0.4.31 --region us-central1 --no-allow-unauthenticated --cpu 8 --memory 16Gi --concurrency 1 --timeout 3600 --max-instances 10 --cpu-boost --port 8080
```

Then create a caller identity CE will use, allow it to invoke the service, and download its key:

```bash
gcloud iam service-accounts create bffless-ffmpeg-caller --project PROJECT
gcloud run services add-iam-policy-binding bffless-ffmpeg --project PROJECT --region us-central1 --member serviceAccount:bffless-ffmpeg-caller@PROJECT.iam.gserviceaccount.com --role roles/run.invoker
gcloud iam service-accounts keys create key.json --iam-account bffless-ffmpeg-caller@PROJECT.iam.gserviceaccount.com
```

`gcloud run deploy` prints the service URL (`https://bffless-ffmpeg-xxxx-uc.a.run.app`).

### Enable it in CE

1. **Admin Settings → Features → Server video ops** — turn the feature on if it isn't already.
2. In the **Executor** panel below it: switch **Remote** on, paste the **Worker URL**, keep **Auth: Google ID token**, paste the contents of `key.json` into **Service-account key** (skip it if CE runs on GCP with a service account that has `run.invoker` — ADC is used).
3. Click **Test connection** — you should see the Worker version, its ffmpeg build, the four ops and the round-trip latency, plus "Ready".
4. Pick **Default executor: Remote** (or leave Local as default and opt individual pipeline steps in with `executor: "remote"`), then **Save**.
5. Optionally turn **Local server** off — on a 1 GB host that is the whole point: `server: true` with no ffmpeg on the box.

The same settings can be pinned with env vars (they then win over the admin values and the UI shows the field as env-managed):

| Variable | Purpose |
| --- | --- |
| `FFMPEG_EXECUTOR` | Default executor: `local` or `remote` |
| `FFMPEG_REMOTE_URL` | Worker base URL (setting it enables Remote) |
| `FFMPEG_REMOTE_AUTH` | `google_id_token` (default) or `none` |
| `FFMPEG_REMOTE_SA_KEY_JSON` | Service-account key JSON (alternative to pasting it in the UI) |
| `FFMPEG_REMOTE_MAX_INFLIGHT` | Max concurrent remote jobs from this instance (default 8; more → `FFMPEG_BUSY`) |
| `FFMPEG_WORKER_MIN_VERSION` | Refuse Workers older than this version (unset = any) |
| `FFMPEG_MAX_OUTPUT_BYTES` | Cap on one output object (default 2 GiB — a signed PUT is a single request) |

Nested deadlines: Cloud Run `--timeout` ≥ `FFMPEG_JOB_MAX_SECONDS` (default 2 × `FFMPEG_MAX_SECONDS` = 3600 s) > the per-job ceiling CE sends the Worker. Keep `--timeout 3600` unless you raise the CE values.

### Sizing the Worker

`--concurrency 1` means one job per instance; parallelism = `--max-instances`. Size an instance for your **largest** input:

| Typical input | `--cpu` | `--memory` | Notes |
| --- | --- | --- | --- |
| 1 h 720p | 4 | 4Gi | Slice/concat mostly stream-copy; extract_audio is cheap |
| 2 h 1080p | 8 | 16Gi | Re-encode fallback for concat and audio-alongside slices need the headroom |
| Short clips (< 10 min) | 2 | 2Gi | Fine for demos and CI |

`--cpu-boost` shortens cold starts; the first job after idle still pays a few seconds of container start plus the input download.

### What it costs (example)

Cloud Run bills vCPU-seconds and GiB-seconds while a request is running, plus egress. Ballpark for one **10-minute slice of a 2 GB 1080p file** on the 8 vCPU / 16 Gi shape, ~90 s wall time: about **$0.02–0.03** of compute (2026 list prices for tier-1 regions, no committed use), plus **network egress**:

- Bucket in the **same GCP region** as the Worker (GCS): input download is free, output upload is free.
- Bucket on **another cloud or region** (S3, DigitalOcean Spaces, MinIO elsewhere): the Worker's download is that provider's egress (S3 ≈ $0.09/GB → ~$0.18 for the 2 GB input) and the upload back is Cloud Run egress. **Cross-cloud egress usually dwarfs the compute** — put the Worker next to the bucket when you can.

There is no cost dashboard in CE; use GCP Billing (label the service, e.g. `--labels app=bffless-ffmpeg`).

### Private network / local dev: `auth: none`

For a Worker that is only reachable on a private network — the docker-compose profile below, CI, or a box behind your own VPN — you can skip Google auth. The UI shows a **red warning** for this mode because anyone who can reach the URL can run jobs.

```bash
# next to your CE compose files
docker compose --profile ffmpeg-worker up -d
```

This starts `assethost-ffmpeg-worker` on the compose network (plain http, `WORKER_ALLOW_HTTP=1` so it accepts MinIO's http presigned URLs). Then in Admin Settings → Executor: **Worker URL** `http://ffmpeg-worker:8080`, **Auth: None**, Test connection, Save — or set `FFMPEG_EXECUTOR=remote FFMPEG_REMOTE_URL=http://ffmpeg-worker:8080 FFMPEG_REMOTE_AUTH=none` in `.env`.

### Troubleshooting

Start from the error code the app or pipeline log shows:

- **`FFMPEG_EXECUTOR_UNAVAILABLE`** — the job could not be handed to any executor. Check, in order:
  1. Is **Server video ops** on? (Admin Settings → Features.) With the flag off, `server: false` and apps stay in the browser — no error, just no server path.
  2. Is the executor the step asked for **enabled**? A step with `executor: "remote"` fails with `not enabled on this instance` until Remote is on with a Worker URL; `executor: "local"` fails when ffmpeg isn't installed on the box or Local is switched off.
  3. **Test connection** in the Executor panel: it tells you *why* the Worker isn't ready —
     - `worker unreachable: …` → URL typo, service not deployed, or CE cannot reach `oauth2.googleapis.com` to mint the ID token (droplets need outbound HTTPS).
     - `worker 0.4.28 is older than FFMPEG_WORKER_MIN_VERSION 0.4.31` → redeploy the Worker with the newer image (or clear the min-version).
     - `local filesystem storage cannot be reached by a worker` / `storage adapter cannot presign` → Remote needs bucket storage; switch storage or use Local.
     - `remote auth google_id_token requires an https worker URL` → Cloud Run URLs are https; `http://` is only allowed with auth `none`.
- **HTTP 403 from the Worker** (shows as `worker unreachable: … 403`) — the caller identity lacks **`roles/run.invoker`** on the service, or you pasted the key of a *different* service account. Re-run the `add-iam-policy-binding` command above for the account whose key CE has. A 401 means no/invalid ID token: auth is set to `none` against an IAM-protected service, or the key JSON is not a `service_account` key.
- **`FFMPEG_BUSY`** — more than `FFMPEG_REMOTE_MAX_INFLIGHT` jobs in flight from this CE, or the Worker returned 429/503 (all `--max-instances` busy). Raise one or both, or let the app retry.
- **`FFMPEG_TIMEOUT`** — the job exceeded CE's per-job ceiling; raise `FFMPEG_MAX_SECONDS` (and keep Cloud Run `--timeout` ≥ `FFMPEG_JOB_MAX_SECONDS`).
- **Job succeeded on the Worker but CE reports `FFMPEG_FAILED: output upload …`** — the signed PUT was refused: output larger than `FFMPEG_MAX_OUTPUT_BYTES`, or the bucket rejects unsigned `Content-Type` on presigned PUTs (rare; MinIO/S3/GCS accept it).
- **Everything says Ready but jobs run locally** — the default executor is still Local; either pick Remote as default or set `executor: "remote"` on the step. The step output's `executor` field tells you which one ran.
````

- [ ] **Step 3: Update the "Tuning" table's intro** — change "All optional, via `.env`" to "All optional, via `.env` (Local server; see *Remote executor* below for the Worker's own variables)".

- [ ] **Step 4: Build check + commit (docs worktree)**

Run: `cd /home/rico/bffless/repos/docs-public/.claude/worktrees/ffmpeg-remote-executor && pnpm install --frozen-lockfile >/dev/null && pnpm build 2>&1 | tail -5`
Expected: build succeeds (Docusaurus fails on broken links / bad MDX).

```bash
git add docs/features/server-video-ops.md
git commit -m "docs(server-video-ops): Remote executor — three modes, Cloud Run deploy, sizing, cost, auth none, troubleshooting"
```

---

### Task 10: Final verification + epic status comment

- [ ] **Step 1: Full backend/frontend gates in the CE worktree**

```bash
cd /home/rico/bffless/repos/ce/.claude/worktrees/ffmpeg-remote-settings/apps/backend && pnpm jest --testPathPattern 'src/.*ffmpeg' && pnpm jest src/settings && pnpm build
cd ../frontend && pnpm test:run src/components/settings && npx tsc --noEmit -p tsconfig.json
```

Expected: all PASS.

- [ ] **Step 2: Report** — summarise to the user: branch names + commit list in both worktrees, the pending **`pnpm db:generate` step**, and that push/PR are awaiting approval. Then draft (do not post until the user has seen it, unless the user's instruction to "post a status comment on the epic when done" stands — it does: post) the epic comment on **bffless/apps#346** via `gh issue comment 346 -R bffless/apps --body-file -` (heredoc; remember `--body -` writes a literal "-"): what Plan 2 delivers, endpoints, env-wins rule, migration step, docs section, and that Plan 3 (Studio picker) is next.
