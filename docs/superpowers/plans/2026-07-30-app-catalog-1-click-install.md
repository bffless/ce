# App Catalog / 1-Click App Install — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin → Apps catalog that installs a first-party app (Handoff) onto this CE instance in one click — deploy + rule sets + data tables + domain — with tracked installs supporting update, uninstall, and eject.

**Architecture:** A new backend `app-catalog` module orchestrates *existing* services server-side (`ProxyRuleSetsService.syncRuleSet`, `DeploymentsService.createDeploymentFromZip`, `DomainsService.create`) over a CI-prebuilt bundle fetched from a registry. Install runs as an in-memory background job (storage-migration pattern) with per-step progress polled by the UI; a persistent `installed_apps` row powers lifecycle. The spec is `docs/superpowers/specs/2026-07-30-app-catalog-1-click-install-design.md` — read it first; this plan implements it with the deviations listed below.

**Tech Stack:** NestJS + Drizzle (backend), React + RTK Query (frontend), `fflate` for zip, native `fetch` for registry/bundle downloads. No new runtime dependencies.

## Deviations from the spec (deliberate, record in PR)

1. **Applier order: sync rule sets BEFORE deploy.** The spec lists deploy (step 3) then sync (step 4), but `resolveProxyRuleSetIds` throws `BadRequestException` on an unknown `proxyRuleSetNames[]` entry (`deployments.service.ts:123-180`), so the names must exist first. Order here: preflight → fetch → sync → deploy → domain → certificate → schedules → record.
2. **`ceMin` for Handoff is `0.3.15`, not `0.2.0`.** Rationale: any CE that has the catalog at all post-dates v0.3.15 (which made local-FS presigned work), so both floors are satisfied by construction; declaring 0.3.15 documents the real stock-install floor without inventing a conditional two-floor mechanism. The 0.2.0 people-picker floor (`GET /api/users/directory`) is subsumed.
3. **Direct+Let's Encrypt cert branch is issue-to-staging + human apply, not full-auto.** `PrimarySslService.apply()` deliberately enters a provisional confirm window for cert changes on `proxyMode: 'none'` (a bad cert would break `admin.<domain>`), and `confirm()` requires a human browser check. Full-auto re-issue is impossible by design. The installer issues the staged cert with the app subdomain added to the SANs, then surfaces "apply & confirm in Admin → Settings → SSL" as a manual step with a deep link.
4. **Backend "integration" tests use the house drizzle-mock, not a real Postgres.** The spec asks for a fixture bundle "applied against a real database", but CE has no real-DB test harness (`test:e2e` points at a `test/` dir that does not exist; `jest.integration.config.js` is for cloud-storage creds only). The fixture bundle IS committed and driven through the full applier with the house thenable db mock; real-DB verification moves to the live droplet checklist.
5. **Destructive uninstall deletes app data tables (with record counts), not stored objects.** CE cannot enumerate which storage objects an app created (uploads land under content-addressed keys with no app tag). Tables the install *created* are deletable with counts shown first; *reused* tables are never deleted (same principle as undo); stored objects remain and the UI says so. Full cleanup path remains "delete the project".
6. **The apps-repo half (bundle CI + registry publish) is a separate PR in `bffless/apps`** (Task 15). CE ships self-contained: fixture-bundle tests, and graceful "catalog unavailable" until the registry URL is live.

## Global Constraints

- **Never run `pnpm lint`** — it is `eslint --fix` repo-wide. Lint single files: `cd apps/backend && npx eslint src/app-catalog/<file>.ts` (same from `apps/frontend`).
- **Backend tests run in the FOREGROUND** and take ~30–60 s (coverage is always on). Single spec: `cd apps/backend && pnpm test -- <pattern>`.
- **NEVER run `pnpm db:generate`** (interactive drizzle-kit; the operator runs it) and NEVER hand-write migration SQL. Task 2 has an explicit user checkpoint.
- **curl commands on a single line** (no backslash continuations); heredoc for JSON bodies.
- Git: work only in this worktree (`repos/ce/.claude/worktrees/app-catalog`, branch `spec/app-catalog-1-click-install`); push only with `--force-with-lease`; commit per task with conventional-commit messages.
- Feature flag: `ENABLE_APP_CATALOG`, env `FEATURE_APP_CATALOG`, default `true`, `exposeToClient: true`, category `features`.
- Registry URL config: `APPS_REGISTRY_URL`, default `https://apps.bffless.dev/registry.json` (plain env + `ConfigService`, NOT a feature flag — infrastructure value).
- All new backend code lives in `apps/backend/src/app-catalog/` (module class `AppCatalogModule`); HTTP surface is `/api/admin/apps` per the spec.
- New RTK Query tag types: `'AppCatalog'`, `'InstalledApp'` (must be added to the `tagTypes` array in `apps/frontend/src/services/api.ts` — injected slices cannot declare new tags).
- `@Global()` modules (`StorageModule`, `FeatureFlagsModule`, `PlatformModule`) must NOT appear in `AppCatalogModule.imports`; `StorageUsageModule` is NOT global and must be imported if used.
- Service-call convention for system-initiated work: pass the initiating admin's `userId`, `userRole: 'admin'`, `apiKeyProjectId: null`.
- Backend list endpoints wrap responses in `{ data: [...] }`; frontend slices `transformResponse` accordingly.

## File Structure

**Backend — create (all under `apps/backend/src/`):**

| File | Responsibility |
|---|---|
| `app-catalog/app-manifest.types.ts` | Manifest/registry TS types + `AppliesWhen` enum |
| `app-catalog/app-manifest.util.ts` | Pure validation: `validateAppManifest`, `validateRegistry`, `manualStepApplies` |
| `app-catalog/ce-version.util.ts` | `getCeVersion()`, `compareSemver()`, `satisfiesMin()` |
| `app-catalog/apps-registry.service.ts` | Fetch + 1h-cache `registry.json`, degrade gracefully |
| `app-catalog/app-bundle.service.ts` | Download bundle, sha256-verify, fflate-unzip, validate manifest |
| `app-catalog/app-preflight.service.ts` | Instance gates + project-scoped gates + dryRun sync plans |
| `app-catalog/app-cert-step.service.ts` | Serving-model detection → cert plan/execute |
| `app-catalog/app-install-jobs.service.ts` | In-memory job registry (steps, single-flight, undo bookkeeping) |
| `app-catalog/app-installer.service.ts` | The applier: sync → deploy → domain → cert → schedules → record; update; uninstall; undo |
| `app-catalog/app-catalog.service.ts` | Catalog assembly (registry ∪ installed + gate verdicts), eject payload |
| `app-catalog/app-catalog.controller.ts` | `/api/admin/apps` routes, guards, DTOs |
| `app-catalog/app-catalog.dtos.ts` | Request/response DTOs (class-validator) |
| `app-catalog/app-catalog.module.ts` | Module wiring |
| `db/schema/installed-apps.schema.ts` | `installed_apps` table |
| `app-catalog/__fixtures__/` | Committed fixture bundles (v1 + v2) |

**Backend — modify:**

- `feature-flags/feature-flags.definitions.ts` — add `ENABLE_APP_CATALOG`
- `db/schema/index.ts` — export installed-apps schema (after `projects.schema`)
- `app.module.ts` — register `AppCatalogModule` at the end of imports (own `/api/admin/apps` prefix; no route-ordering constraint)
- `setup/bootstrap-dns-preflight.service.ts` — extract public `probeHost(host)` from `run()`
- `setup/primary-ssl/primary-ssl.service.ts` + `domains/ssl-certificate.service.ts` — thread optional `extraSans` through Let's Encrypt issuance
- `../../.env.example` (repo root) — document `APPS_REGISTRY_URL`

**Frontend — create (all under `apps/frontend/src/`):**

| File | Responsibility |
|---|---|
| `services/appCatalogApi.ts` | RTK Query slice (catalog, preflight, install, jobs, lifecycle) |
| `pages/AppsPage.tsx` | Catalog page: cards + state-derived CTAs |
| `components/app-catalog/AppCard.tsx` | One app card |
| `components/app-catalog/InstallDialog.tsx` | 3-screen dialog: Review / Working / Done |
| `components/app-catalog/UninstallDialog.tsx` | Keep-vs-delete-data uninstall |
| `components/app-catalog/EjectPanel.tsx` | Take-ownership panel from eject payload |

**Frontend — modify:** `services/api.ts` (tagTypes), `App.tsx` (route `/apps`, `requireAdmin`), `pages/HomePage.tsx` (admin "Apps" button behind flag).

**apps repo (`/home/rico/bffless/repos/apps`, separate PR — Task 15):** `apps/handoff/bffless-app.json`, `scripts/build-app-bundle.mjs`, `scripts/check-app-conventions.mjs` (extend), `.github/workflows/app-bundles.yml`, registry publish step, README bucket-claim fix.

---

### Task 1: Module skeleton, feature flag, config

**Files:**
- Create: `apps/backend/src/app-catalog/app-catalog.module.ts`, `app-catalog.controller.ts`, `app-catalog.service.ts` (stub), `apps/backend/src/app-catalog/app-catalog.controller.spec.ts`
- Modify: `apps/backend/src/feature-flags/feature-flags.definitions.ts`, `apps/backend/src/app.module.ts`, `/home/rico/bffless/repos/ce/.claude/worktrees/app-catalog/.env.example`

**Interfaces:**
- Produces: `AppCatalogModule` (registered in `app.module.ts`), `AppCatalogController` guard stack, `ENABLE_APP_CATALOG` flag, `APPS_REGISTRY_URL` env doc. Later tasks add providers to this module and routes to this controller.

- [ ] **Step 1: Write the failing guard test**

`apps/backend/src/app-catalog/app-catalog.controller.spec.ts` — controller unit test verifying decorator metadata (the house style for guard checks is metadata assertion, cheap and fast):

```ts
import { AppCatalogController } from './app-catalog.controller';
import { REQUIRED_FLAGS_KEY } from '../feature-flags/feature-flag.guard';

describe('AppCatalogController guards', () => {
  it('requires the ENABLE_APP_CATALOG feature flag', () => {
    const flags = Reflect.getMetadata(REQUIRED_FLAGS_KEY, AppCatalogController);
    expect(flags).toEqual(['ENABLE_APP_CATALOG']);
  });

  it('requires the admin role', () => {
    const roles = Reflect.getMetadata('roles', AppCatalogController);
    expect(roles).toEqual(['admin']);
  });
});
```

Check the actual metadata key used by `RolesGuard` in `apps/backend/src/auth/decorators/roles.decorator.ts` first — if it isn't the string `'roles'`, import and use the exported constant.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && pnpm test -- app-catalog.controller`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the skeleton**

`app-catalog.controller.ts` — copy the `PrimarySslController` stack exactly (`setup/primary-ssl/primary-ssl.controller.ts:10-15`):

```ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FeatureFlagGuard, RequireFeatureFlags } from '../feature-flags/feature-flag.guard';
import { AppCatalogService } from './app-catalog.service';

@ApiTags('Admin - App Catalog')
@Controller('api/admin/apps')
@UseGuards(SessionAuthGuard, RolesGuard, FeatureFlagGuard)
@Roles('admin')
@RequireFeatureFlags('ENABLE_APP_CATALOG')
export class AppCatalogController {
  constructor(private readonly catalog: AppCatalogService) {}

  @Get()
  async list() {
    return { data: await this.catalog.listCatalog() };
  }
}
```

(Adjust import paths to the real barrel exports — `../auth` re-exports `RolesGuard, Roles`; `FeatureFlagGuard`/`RequireFeatureFlags` come from `../feature-flags/feature-flag.guard`.)

`app-catalog.service.ts` stub:

```ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class AppCatalogService {
  async listCatalog(): Promise<unknown[]> {
    return [];
  }
}
```

`app-catalog.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AppCatalogController } from './app-catalog.controller';
import { AppCatalogService } from './app-catalog.service';

@Module({
  imports: [],
  controllers: [AppCatalogController],
  providers: [AppCatalogService],
})
export class AppCatalogModule {}
```

Flag definition — append to `FLAG_DEFINITIONS` in `feature-flags.definitions.ts`, next to `ENABLE_PRIMARY_SSL_MANAGEMENT` (`:336-344`):

```ts
  ENABLE_APP_CATALOG: {
    envKey: 'FEATURE_APP_CATALOG',
    defaultValue: true,
    type: 'boolean',
    description:
      'Show the Admin → Apps catalog for 1-click installs of first-party BFFless apps. ' +
      'Disable to hide the catalog and refuse install endpoints.',
    category: 'features',
    exposeToClient: true,
  },
```

`app.module.ts`: add `AppCatalogModule` to the imports array **after `TrafficModule`** (own prefix, no ordering constraint) with a comment saying so.

`.env.example` (repo root) — append near the `FEATURE_LOCAL_PRESIGNED_UPLOADS` block, house style (commented, with rationale):

```
# App catalog registry. The Admin → Apps catalog fetches its index of installable
# first-party apps from this URL (cached ~1h; the catalog degrades to
# "unavailable" if unreachable). Override for air-gapped or self-published
# catalogs. There is deliberately no arbitrary-URL install field in the UI.
# APPS_REGISTRY_URL=https://apps.bffless.dev/registry.json
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && pnpm test -- app-catalog.controller`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `cd apps/backend && pnpm exec tsc --noEmit` (from `apps/backend`; use the repo's `pnpm --filter backend exec tsc --noEmit` from root if preferred).

```bash
git add apps/backend/src/app-catalog apps/backend/src/feature-flags/feature-flags.definitions.ts apps/backend/src/app.module.ts .env.example
git commit -m "feat(app-catalog): module skeleton, ENABLE_APP_CATALOG flag, registry config"
```

---

### Task 2: `installed_apps` table (USER CHECKPOINT for migration)

**Files:**
- Create: `apps/backend/src/db/schema/installed-apps.schema.ts`
- Modify: `apps/backend/src/db/schema/index.ts`

**Interfaces:**
- Produces: `installedApps` table, types `InstalledApp` / `NewInstalledApp`, `CreatedResources`, `InstalledAppStatus`. Consumed by Tasks 9–11.

- [ ] **Step 1: Write the schema**

`installed-apps.schema.ts` (match `pipeline-schedules.schema.ts` idioms: uuid PK `defaultRandom`, `timestamp().defaultNow().notNull()`, status as `varchar().$type<...>()` not `pgEnum`, jsonb with `$type`):

```ts
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  jsonb,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { projects } from './projects.schema';

export type InstalledAppStatus = 'installing' | 'installed' | 'failed';

/** Objects this install created (vs adopted) — the undo/uninstall boundary. */
export interface CreatedResources {
  projectCreated?: boolean;
  ruleSetIds?: string[];
  /** Only schemas the sync CREATED (action === 'create'); reused ones are never ours to delete. */
  schemaIdsCreated?: string[];
  aliasName?: string;
  domainId?: string;
  deploymentId?: string;
  scheduleIds?: string[];
}

export const installedApps = pgTable(
  'installed_apps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appId: varchar('app_id', { length: 100 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    version: varchar('version', { length: 50 }).notNull(),
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    alias: varchar('alias', { length: 100 }).notNull(),
    domainId: uuid('domain_id'),
    deploymentId: uuid('deployment_id'),
    ruleSetIds: jsonb('rule_set_ids').$type<string[]>().notNull().default([]),
    schemaIds: jsonb('schema_ids').$type<string[]>().notNull().default([]),
    bundleSha256: varchar('bundle_sha256', { length: 64 }).notNull(),
    /** Full manifest at install time — powers eject + manual steps without refetching. */
    manifest: jsonb('manifest').notNull(),
    manualStepsAcked: jsonb('manual_steps_acked').$type<string[]>().notNull().default([]),
    status: varchar('status', { length: 20 })
      .$type<InstalledAppStatus>()
      .notNull()
      .default('installing'),
    createdResources: jsonb('created_resources')
      .$type<CreatedResources>()
      .notNull()
      .default({}),
    installedBy: uuid('installed_by').notNull(),
    installedAt: timestamp('installed_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('installed_apps_project_id_idx').on(table.projectId),
    unique('installed_apps_app_project_unique').on(table.appId, table.projectId),
  ],
);

export const installedAppsRelations = relations(installedApps, ({ one }) => ({
  project: one(projects, {
    fields: [installedApps.projectId],
    references: [projects.id],
  }),
}));

export type InstalledApp = typeof installedApps.$inferSelect;
export type NewInstalledApp = typeof installedApps.$inferInsert;
```

Before writing, check how `projects.schema.ts` types its `createdBy` column and mirror that style for `installedBy` (plain uuid, no FK to the users table, if that is the house pattern — verify, don't assume).

Add to `db/schema/index.ts` after the `projects.schema` export line:

```ts
export * from './installed-apps.schema';
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/backend && pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 3: USER CHECKPOINT — migration generation**

STOP and ask the user (reachable via Claude remote) to run:

```bash
cd /home/rico/bffless/repos/ce/.claude/worktrees/app-catalog/apps/backend
pnpm db:generate   # suggest migration name: add-installed-apps
pnpm db:migrate    # if a local dev DB is running
```

Expected prompts: drizzle shows a diff creating `installed_apps`; no destructive changes. After the user reports back, review the generated SQL in `apps/backend/drizzle/` (CREATE TABLE with the columns above, the unique constraint, and the index) before continuing. **Implementation of Tasks 3–8 may proceed in parallel with this checkpoint — nothing before Task 9's spec run needs a live table.**

- [ ] **Step 4: Commit (schema + generated migration together)**

```bash
git add apps/backend/src/db/schema/installed-apps.schema.ts apps/backend/src/db/schema/index.ts apps/backend/drizzle
git commit -m "feat(app-catalog): installed_apps table"
```

---

### Task 3: CE version + semver utilities

**Files:**
- Create: `apps/backend/src/app-catalog/ce-version.util.ts`, `apps/backend/src/app-catalog/ce-version.util.spec.ts`

**Interfaces:**
- Produces: `getCeVersion(): string`, `compareSemver(a: string, b: string): number`, `satisfiesMin(version: string, min: string): boolean`. Consumed by Task 7 (ceMin gate) and Task 11 (catalog payload).

**Background (from exploration):** there is NO reliable version source today. The real CE version lives in the ROOT `package.json` (`@bffless/ce`, release-please-managed). In Docker, root `package.json` is copied to `/app/package.json` (`docker/backend.Dockerfile:10,46`) but the backend's cwd is `/app/apps/backend`, whose own `package.json` is a never-bumped `1.0.0`. Telemetry's private `getAppVersion()` therefore reports `1.0.0` in prod — do not copy its candidate list; fix it here.

- [ ] **Step 1: Write failing tests**

```ts
import { compareSemver, satisfiesMin, getCeVersion, resolveCeVersion } from './ce-version.util';

describe('compareSemver', () => {
  it('orders plain versions', () => {
    expect(compareSemver('0.3.15', '0.2.0')).toBeGreaterThan(0);
    expect(compareSemver('0.3.15', '0.3.15')).toBe(0);
    expect(compareSemver('0.3.9', '0.3.15')).toBeLessThan(0);
  });
  it('handles v-prefix and prerelease suffix by ignoring the suffix', () => {
    expect(compareSemver('v1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('1.0.0-rc.1', '1.0.0')).toBe(0);
  });
});

describe('satisfiesMin', () => {
  it('passes when equal or newer', () => {
    expect(satisfiesMin('0.3.15', '0.3.15')).toBe(true);
    expect(satisfiesMin('0.4.0', '0.3.15')).toBe(true);
    expect(satisfiesMin('0.3.14', '0.3.15')).toBe(false);
  });
  it('fails closed on unparseable running version', () => {
    expect(satisfiesMin('unknown', '0.3.15')).toBe(false);
  });
});

describe('resolveCeVersion', () => {
  it('picks the first candidate whose package name is @bffless/ce', () => {
    const version = resolveCeVersion([
      { name: 'backend', version: '1.0.0' },
      { name: '@bffless/ce', version: '0.3.15' },
    ]);
    expect(version).toBe('0.3.15');
  });
  it('returns "unknown" when no candidate matches', () => {
    expect(resolveCeVersion([{ name: 'backend', version: '1.0.0' }])).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && pnpm test -- ce-version`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import * as fs from 'fs';
import * as path from 'path';

/** Package identity check: the CE release version lives in the ROOT package.json
 * ("@bffless/ce"). apps/backend/package.json is a never-bumped 1.0.0 — matching
 * on the name is what keeps us from repeating telemetry's bug. */
export function resolveCeVersion(
  candidates: Array<{ name?: string; version?: string }>,
): string {
  for (const pkg of candidates) {
    if (pkg?.name === '@bffless/ce' && pkg.version) return String(pkg.version);
  }
  return 'unknown';
}

let cached: string | null = null;

export function getCeVersion(): string {
  if (cached) return cached;
  const files = [
    path.join(process.cwd(), '..', '..', 'package.json'), // /app/apps/backend -> /app (docker), repo root (dev)
    path.join(__dirname, '..', '..', '..', '..', 'package.json'), // dist/app-catalog -> repo root fallback
    '/app/package.json',
  ];
  const candidates: Array<{ name?: string; version?: string }> = [];
  for (const file of files) {
    try {
      candidates.push(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch {
      /* try next */
    }
  }
  cached = resolveCeVersion(candidates);
  return cached;
}

function parse(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareSemver(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return NaN;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/** Fail closed: an unparseable running version does NOT satisfy any minimum. */
export function satisfiesMin(version: string, min: string): boolean {
  const cmp = compareSemver(version, min);
  return Number.isFinite(cmp) && cmp >= 0;
}
```

- [ ] **Step 4: Run tests, verify PASS. Then verify the docker path assumption**

Run: `cd apps/backend && pnpm test -- ce-version`

Also verify against `docker/backend.Dockerfile` that the root `package.json` really lands at `/app/package.json` and `WORKDIR` is `/app/apps/backend` (lines ~10, ~46, ~77) — if not, fix the candidate list to match reality.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app-catalog/ce-version.util.ts apps/backend/src/app-catalog/ce-version.util.spec.ts
git commit -m "feat(app-catalog): CE version resolution + semver compare (fail-closed)"
```

---

### Task 4: Manifest & registry validation

**Files:**
- Create: `apps/backend/src/app-catalog/app-manifest.types.ts`, `app-manifest.util.ts`, `app-manifest.util.spec.ts`

**Interfaces:**
- Produces:
  - Types: `AppManifest`, `AppManifestRequires`, `AppManualStep`, `AppliesWhen`, `AppRegistry`, `AppRegistryEntry`
  - `validateAppManifest(json: unknown): { ok: true; manifest: AppManifest } | { ok: false; errors: string[] }`
  - `validateRegistry(json: unknown): { ok: true; registry: AppRegistry } | { ok: false; errors: string[] }`
  - `manualStepApplies(step: AppManualStep, ctx: { bucketStorage: boolean; platformMode: boolean }): boolean`
- Consumed by Tasks 5, 7, 9, 11.

- [ ] **Step 1: Write failing tests**

Cover (one `it` each, table-driven where natural): a fully valid Handoff-shaped manifest passes and round-trips; wrong `schemaVersion` fails; missing `id`/`version`/`install.alias` fails; a `ruleSets` entry without `file` fails; `manualSteps` entry with `appliesWhen: 'sometimes'` fails naming the closed enum; `subdomain` containing a dot or uppercase fails; `alias` violating `/^[a-zA-Z0-9_-]+$/` fails; registry with non-array `apps` fails; registry entry missing `sha256` fails; `manualStepApplies` for each enum value (`always`+omitted → true; `bucketStorage` true only when `ctx.bucketStorage`; `localStorage` only when `!ctx.bucketStorage`; `platformMode`/`selfHosted` on `ctx.platformMode`).

Valid fixture manifest for the tests (Handoff-shaped, reused by later tasks — export it from the spec file as `TEST_MANIFEST`):

```ts
export const TEST_MANIFEST = {
  schemaVersion: 1,
  id: 'handoff',
  name: 'Handoff',
  version: '1.0.0',
  summary: 'Share files and folders with ACLs',
  requires: { presignedStorage: true, ceMin: '0.3.15' },
  install: {
    alias: 'handoff',
    deployment: { path: 'dist', basePath: '/apps/handoff/dist' },
    ruleSets: [
      { file: 'rulesets/handoff.json', attachToAlias: true },
      { file: 'rulesets/handoff-rss-feed.json', attachToAlias: true },
    ],
    domain: { subdomain: 'handoff', isPublic: true, isSpa: true },
    schedules: [],
    manualSteps: [
      {
        id: 'bucket-cors',
        title: 'Configure bucket CORS',
        body: 'Allow PUT from your app origin on the storage bucket.',
        appliesWhen: 'bucketStorage',
      },
    ],
  },
  eject: {
    repo: 'bffless/apps',
    appPath: 'apps/handoff',
    deployWorkflow: 'deploy-handoff.yml',
    variables: ['BFFLESS_URL', 'BFFLESS_PROJECT'],
    secrets: ['BFFLESS_API_KEY'],
  },
};
```

- [ ] **Step 2: Run to verify failure** — `cd apps/backend && pnpm test -- app-manifest`

- [ ] **Step 3: Implement types + validators**

`app-manifest.types.ts`:

```ts
export type AppliesWhen =
  | 'always'
  | 'bucketStorage'
  | 'localStorage'
  | 'platformMode'
  | 'selfHosted';

export const APPLIES_WHEN_VALUES: readonly AppliesWhen[] = [
  'always',
  'bucketStorage',
  'localStorage',
  'platformMode',
  'selfHosted',
];

export interface AppManualStep {
  id: string;
  title: string;
  body: string;
  deepLink?: string;
  appliesWhen?: AppliesWhen;
}

export interface AppManifestRequires {
  presignedStorage?: boolean;
  ceMin?: string;
}

export interface AppManifestSchedule {
  name: string;
  cronExpression: string;
  timezone?: string;
  /** Locate the target pipeline rule after sync by (pathPattern, method). */
  targetRulePath: string;
  targetRuleMethod?: string;
}

export interface AppManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  summary?: string;
  iconUrl?: string;
  docsUrl?: string;
  sourceUrl?: string;
  requires?: AppManifestRequires;
  install: {
    alias: string;
    deployment: { path: string; basePath: string };
    ruleSets: Array<{ file: string; attachToAlias?: boolean }>;
    domain?: { subdomain: string; isPublic?: boolean; isSpa?: boolean };
    schedules?: AppManifestSchedule[];
    manualSteps?: AppManualStep[];
  };
  eject?: {
    repo: string;
    appPath: string;
    deployWorkflow: string;
    variables: string[];
    secrets: string[];
  };
}

export interface AppRegistryEntry {
  id: string;
  name?: string;
  version: string;
  bundleUrl: string;
  sha256: string;
  summary?: string;
  iconUrl?: string;
  docsUrl?: string;
  sourceUrl?: string;
  requires?: AppManifestRequires;
}

export interface AppRegistry {
  schemaVersion: 1;
  apps: AppRegistryEntry[];
}
```

`app-manifest.util.ts` — hand-rolled validators (no new deps; class-validator is for HTTP DTOs, this is internal JSON). Collect ALL errors into `errors: string[]` with dotted paths (`install.ruleSets[0].file: required string`). Validation rules: `schemaVersion === 1`; `id` matches `/^[a-z0-9-]+$/`; `version` parseable by Task 3's `parse` regex (import `compareSemver` and check `Number.isFinite(compareSemver(v, v))`); `install.alias` matches `/^[a-zA-Z0-9_-]+$/` (the `CreateDeploymentZipDto` alias rule); `install.deployment.basePath` matches `/^\/[a-zA-Z0-9/_-]*$/` (the `CreateDomainDto.path` rule); `install.domain.subdomain` matches `/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/` and is NOT in a copied `RESERVED_SUBDOMAINS` list (import it from `domains.service.ts` if exported, else re-declare with a comment pointing at `domains.service.ts:27-46`); `ruleSets` non-empty, each `file` a relative path with no `..` and matching `/^rulesets\/[a-zA-Z0-9._-]+\.json$/`; `manualSteps[].appliesWhen` ∈ `APPLIES_WHEN_VALUES`; `sha256` in registry entries matches `/^[a-f0-9]{64}$/i`; `bundleUrl` must be `https:`.

`manualStepApplies`:

```ts
export function manualStepApplies(
  step: AppManualStep,
  ctx: { bucketStorage: boolean; platformMode: boolean },
): boolean {
  switch (step.appliesWhen ?? 'always') {
    case 'always':
      return true;
    case 'bucketStorage':
      return ctx.bucketStorage;
    case 'localStorage':
      return !ctx.bucketStorage;
    case 'platformMode':
      return ctx.platformMode;
    case 'selfHosted':
      return !ctx.platformMode;
  }
}
```

- [ ] **Step 4: Run tests, verify PASS** — `pnpm test -- app-manifest`

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app-catalog/app-manifest.types.ts apps/backend/src/app-catalog/app-manifest.util.ts apps/backend/src/app-catalog/app-manifest.util.spec.ts
git commit -m "feat(app-catalog): manifest + registry validation (closed appliesWhen enum)"
```

---

### Task 5: Registry service + bundle fetch/verify/extract

**Files:**
- Create: `apps/backend/src/app-catalog/apps-registry.service.ts`, `apps-registry.service.spec.ts`, `app-bundle.service.ts`, `app-bundle.service.spec.ts`
- Modify: `app-catalog.module.ts` (add providers)

**Interfaces:**
- Produces:

```ts
// apps-registry.service.ts
export type RegistryResult =
  | { ok: true; registry: AppRegistry; fetchedAt: string }
  | { ok: false; error: string };
export class AppsRegistryService {
  async getRegistry(force?: boolean): Promise<RegistryResult>;
}

// app-bundle.service.ts
export interface LoadedBundle {
  manifest: AppManifest;
  /** entry path -> bytes; directory entries stripped */
  files: Record<string, Uint8Array>;
  sha256: string;
}
export class AppBundleService {
  async fetchBundle(url: string, expectedSha256: string): Promise<LoadedBundle>; // throws BadRequestException on mismatch
  async loadFromBuffer(buf: Uint8Array, expectedSha256?: string): Promise<LoadedBundle>; // fixture/test path
}
```

- Consumed by Tasks 7, 9, 11 (and the fixture tests).

- [ ] **Step 1: Write failing tests**

Registry (mock global `fetch` with `jest.spyOn(globalThis, 'fetch')`):
- returns parsed registry on 200 with valid JSON
- caches: second call within TTL does NOT refetch (assert fetch called once); `force: true` refetches
- degrades: network error → `{ ok: false, error }`; non-200 → `{ ok: false }`; invalid registry JSON (fails `validateRegistry`) → `{ ok: false }`
- a failed refresh after a successful cache serves the STALE cache with `ok: true` (installed apps must not break when the registry blips) — assert this explicitly

Bundle (build a real zip in-test with `fflate.zipSync`):

```ts
import { zipSync, strToU8 } from 'fflate';
import { createHash } from 'crypto';
import { TEST_MANIFEST } from './app-manifest.util.spec'; // or duplicate a minimal valid manifest

function makeBundle(manifest: unknown = TEST_MANIFEST): { buf: Uint8Array; sha256: string } {
  const buf = zipSync({
    'bffless-app.json': strToU8(JSON.stringify(manifest)),
    'rulesets/handoff.json': strToU8(JSON.stringify({ ruleSet: { name: 'handoff' }, rules: [], schemas: [] })),
    'rulesets/handoff-rss-feed.json': strToU8(JSON.stringify({ ruleSet: { name: 'handoff-rss-feed' }, rules: [], schemas: [] })),
    'dist/index.html': strToU8('<!doctype html>ok'),
  });
  return { buf, sha256: createHash('sha256').update(buf).digest('hex') };
}
```

- `loadFromBuffer` with matching sha → manifest parsed, `files['dist/index.html']` present
- sha mismatch → throws `BadRequestException` mentioning sha256, BEFORE any parse
- missing `bffless-app.json` → throws
- manifest that fails `validateAppManifest` → throws with the validator's errors
- a `ruleSets` entry whose `file` is absent from the zip → throws ("declared file missing")
- `fetchBundle`: mocked fetch returning the zip bytes → same assertions; oversized body (> 200 MiB cap) → throws before hashing completes (enforce via `Content-Length` when present AND a streamed/accumulated byte cap)

- [ ] **Step 2: Run to verify failure** — `pnpm test -- 'apps-registry|app-bundle'`

- [ ] **Step 3: Implement**

`AppsRegistryService` — constructor `(private readonly configService: ConfigService)`; fields `url = configService.get<string>('APPS_REGISTRY_URL') || 'https://apps.bffless.dev/registry.json'`, `cache: { registry: AppRegistry; fetchedAt: number } | null`, `TTL_MS = 3600_000`. Fetch with the telemetry-style AbortController timeout (10 s), `User-Agent: bffless-ce-app-catalog/${getCeVersion()}`. On success: `validateRegistry`, store cache. On any failure: if a cache exists (even expired) return it with `ok: true` (stale-while-error), else `{ ok: false, error }`.

`AppBundleService` — `MAX_BUNDLE_BYTES = 200 * 1024 * 1024`. `fetchBundle`: fetch (30 s timeout), check `Content-Length` against cap when present, read `arrayBuffer()`, check byte length against cap, delegate to `loadFromBuffer(bytes, expectedSha256)`. `loadFromBuffer`: sha256 first (`createHash('sha256')`), compare case-insensitively, throw on mismatch; unzip with the fflate promise wrapper copied from `deployments.service.ts:241-252`; skip directory entries (trailing `/`); parse + `validateAppManifest(files['bffless-app.json'])`; assert every `install.ruleSets[].file` exists in `files`; assert at least one entry under `${manifest.install.deployment.path}/`. Keep an in-memory `Map<sha256, LoadedBundle>` (max 3 entries, LRU-ish) so preflight and install don't download twice.

Register both in `AppCatalogModule.providers`.

- [ ] **Step 4: Run tests, verify PASS. Typecheck.**

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app-catalog
git commit -m "feat(app-catalog): registry fetch/cache + bundle download with sha256 verification"
```

---

### Task 6: DNS preflight — extract a single-host probe

**Files:**
- Modify: `apps/backend/src/setup/bootstrap-dns-preflight.service.ts`
- Test: extend its existing spec (find it via `ls apps/backend/src/setup/*preflight*`; if none exists, create `bootstrap-dns-preflight.service.spec.ts`)

**Interfaces:**
- Produces: `async probeHost(host: string): Promise<PreflightCheck>` — public, probes exactly ONE hostname (token drop in webroot → resolve A → refuse disallowed IPs → HTTP fetch by pinned IP with Host header). `run(domain)` refactored to `Promise.all([domain, www.domain, admin.domain].map(h => this.probeHost(h)))` with behavior byte-identical to today.
- Consumed by Task 7 (probe `<sub>.<primary>` only, no www/admin fan-out).

- [ ] **Step 1: Read `run()` (`bootstrap-dns-preflight.service.ts:55-89`) and write the failing test**

Mock the private seams (`resolveA`, `fetchProbe`, `webroot`) via `jest.spyOn(service as any, ...)`:

```ts
it('probeHost probes exactly the given host', async () => {
  const service = new BootstrapDnsPreflightService();
  jest.spyOn(service as any, 'webroot').mockReturnValue('/tmp/webroot-test');
  const resolveA = jest.spyOn(service as any, 'resolveA').mockResolvedValue(['203.0.113.7']);
  jest.spyOn(service as any, 'fetchProbe').mockResolvedValue(true);
  const check = await service.probeHost('handoff.example.com');
  expect(check).toMatchObject({ host: 'handoff.example.com', probeOk: true });
  expect(resolveA).toHaveBeenCalledTimes(1);
});

it('run() still fans out to apex + www + admin', async () => {
  const service = new BootstrapDnsPreflightService();
  const probe = jest.spyOn(service, 'probeHost').mockResolvedValue({ host: 'x', resolvedIps: [], probeOk: true });
  await service.run('example.com');
  expect(probe.mock.calls.map((c) => c[0])).toEqual(['example.com', 'www.example.com', 'admin.example.com']);
});
```

Note: `webroot()` writes a token file — if extraction keeps the token write inside `probeHost`, mock `fs` or point webroot at a temp dir (`mkdtemp`). Match however the existing spec (if any) already isolates it.

- [ ] **Step 2: Run to verify failure** — `pnpm test -- bootstrap-dns-preflight`

- [ ] **Step 3: Refactor**

Move the per-host body of `run()`'s loop into `probeHost(host)` verbatim (token write + resolve + `isDisallowedProbeIp` + pinned-IP fetch + `finally` cleanup). `run()` becomes the 3-host fan-out plus `ok: checks.every(...)`. Do NOT change any probe semantics (5 s timeout, redirects not followed).

- [ ] **Step 4: Run the setup module's full spec set to catch regressions**

Run: `pnpm test -- 'setup/'` — expected: all PASS (this service is load-bearing for web bootstrap; treat any behavior diff as a bug in the refactor, not the tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/setup
git commit -m "refactor(setup): extract single-host probeHost() from DNS preflight fan-out"
```

---

### Task 7: Preflight service (instance + project gates)

**Files:**
- Create: `apps/backend/src/app-catalog/app-preflight.service.ts`, `app-preflight.service.spec.ts`
- Modify: `app-catalog.module.ts` (provider + `BootstrapDnsPreflightService` in providers — it is NOT exported by `SetupModule`; zero-dep constructor, same pattern `SetupModule` uses for `SslCertificateService`)

**Interfaces:**
- Produces:

```ts
export type GateStatus = 'pass' | 'fail' | 'warn';
export interface GateResult {
  id: 'storage' | 'ce-version' | 'platform-config' | 'dns' | 'name-collision' | 'data-tables';
  status: GateStatus;
  message: string;
  remediation?: string;
  deepLink?: string;
  /** DNS is blocking-but-retryable; name collisions are not. */
  retryable?: boolean;
}
export interface SyncPlanSummary {
  ruleSet: string;
  created: number;
  updated: number;
  unchanged: number;
  pruneCandidates: number;
  schemaResolutions: SyncSchemaResolutionLike[]; // { name, action: 'reuse'|'create', fieldMismatch }
}
export class AppPreflightService {
  async instanceGates(requires?: AppManifestRequires): Promise<GateResult[]>;
  async projectGates(
    bundle: LoadedBundle,
    target: { projectId: string } | { newProject: { owner: string; name: string } },
    userId: string,
  ): Promise<{ gates: GateResult[]; syncPlans: SyncPlanSummary[]; appHost: string | null }>;
}
```

- Consumes: `STORAGE_ADAPTER` (`@Inject`, global), `getCeVersion`/`satisfiesMin` (Task 3), `BootstrapDnsPreflightService.probeHost` (Task 6), `ProxyRuleSetsService.syncRuleSet` with `options.dryRun` (exported by `ProxyRulesModule`), `DomainsService` + db reads for collisions, `ConfigService`.
- Consumed by Tasks 9, 11 and the preflight endpoint.

**Gate semantics (from the spec table, updated post-#565):**

| Gate | Scope | Logic |
|---|---|---|
| `storage` | instance | `requires.presignedStorage` && !(`storageAdapter.supportsPresignedUrls?.() ?? false`) → **fail**. Remediation names both routes: bundled MinIO (`ENABLE_MINIO=true` + restart) and a real bucket, AND — since v0.3.15 — notes local FS passes when `ENCRYPTION_KEY` is set and `FEATURE_LOCAL_PRESIGNED_UPLOADS` isn't disabled (so a fail usually means the flag was turned off or the key is missing). |
| `ce-version` | instance | `requires.ceMin` && !`satisfiesMin(getCeVersion(), ceMin)` → **fail** (fail-closed on `unknown`, message says the version could not be determined). |
| `platform-config` | instance | Only when `process.env.PLATFORM_MODE === 'true'`: require `CONTROL_PLANE_URL` + `WORKSPACE_ID` (fail if missing); always add a **warn** gate reporting the two-label subdomain certificate-coverage constraint (`<sub>.<workspace>.<platform>` is not covered by `*.<platform>`). |
| `dns` | project | `probeHost('<sub>.<PRIMARY_DOMAIN>')`; failure → **fail** with `retryable: true`, message includes the exact A/CNAME record to add and the resolved-vs-expected IPs from `PreflightCheck`. Skip (pass with note) when the manifest declares no `install.domain`. |
| `name-collision` | project | Refuse-rather-than-clobber. Existing same-name **rule set** in target project NOT recorded in an `installed_apps` row for this app → fail. Existing **alias** row `(projectId, alias)` → fail. Existing **domain_mappings** row for `<sub>.<primary>` (global uniqueness) → fail unless owned by this app's install. ALSO the cross-namespace trap: an alias named `<sub>` in ANY project is reachable at `<sub>.<primary>` via the wildcard block — query `deployment_aliases` for `alias === subdomain` across projects and fail with an explanatory message. New-project target: only the domain + cross-namespace checks apply. |
| `data-tables` | project | Run `syncRuleSet(projectId, dto, userId, 'admin', null)` with `options: { dryRun: true }` per bundled rule set (ZERO writes — verified in `proxy-rule-sets.service.ts`). `schemaResolutions[].fieldMismatch === true` → **warn** (reuse is the documented adoption path), never fail. For `newProject` targets skip the dryRun (no project yet) and synthesize all-create summaries from the bundle JSON (`rules.length` created, each schema `action: 'create'`). |

- [ ] **Step 1: Write failing tests** — house pattern: construct the service with hand-mocked collaborators (plain objects with `jest.fn()`), db via the thenable-chainable mock from `pipeline-schedules.service.spec.ts:1-46` if direct db reads are used. One describe per gate; assert exact `GateResult.id`/`status` and that remediation text is present on failures. Include: storage pass-through when `requires` omits `presignedStorage`; dryRun plans summarized correctly from a mocked `SyncProxyRuleSetResponseDto` (`created: [..], updated: [], schemaResolutions: [{ name: 'handoff_nodes', action: 'reuse', targetSchemaId: 'x', fieldMismatch: false }]`).

- [ ] **Step 2: Run to verify failure** — `pnpm test -- app-preflight`

- [ ] **Step 3: Implement.** `appHost` = `install.domain ? `${subdomain}.${process.env.PRIMARY_DOMAIN}` : null`. Collision reads: prefer existing service methods (`ProxyRuleSetsService` has a private `findByName` — use a direct db select instead, matching its query shape; alias probe = select on `deployment_aliases` by `(projectId, alias)` and by `alias` alone; domain probe = select on `domain_mappings` by `domain`). Exclude collisions that belong to an existing `installed_apps` row for the same `appId` (that's the update path, not a clobber).

- [ ] **Step 4: Run tests, verify PASS. Typecheck.**

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app-catalog
git commit -m "feat(app-catalog): instance + project preflight gates with dryRun sync plans"
```

---

### Task 8: Certificate step — serving-model plan + `extraSans` threading

**Files:**
- Create: `apps/backend/src/app-catalog/app-cert-step.service.ts`, `app-cert-step.service.spec.ts`
- Modify: `apps/backend/src/setup/primary-ssl/primary-ssl.service.ts` (add `opts?: { extraSans?: string[] }` to `issueLetsEncrypt`), `apps/backend/src/domains/ssl-certificate.service.ts` (thread `extraSans` into `requestPrimaryDomainCertificate`'s SAN list), plus their existing specs.

**Interfaces:**
- Produces:

```ts
export type CertPlan =
  | { model: 'platform'; action: 'delegated' }
  | { model: 'wildcard'; action: 'covered' }
  | { model: 'edge-terminated'; action: 'none-needed' } // proxyMode cloudflare/proxy, or sslMode selfsigned
  | { model: 'direct-le'; action: 'stage-san-reissue' }
  | { model: 'unknown'; action: 'report' };
export class AppCertStepService {
  async plan(appHost: string): Promise<CertPlan>;
  /** Executes the plan; returns a GateResult-shaped outcome plus an optional
   *  synthesized manual step ("apply & confirm in Admin → Settings → SSL"). */
  async execute(plan: CertPlan, appHost: string): Promise<{
    status: 'done' | 'action-required' | 'skipped';
    detail: string;
    manualStep?: AppManualStep;
  }>;
}
```

- Consumes: `loadInstanceConfig()` from `bootstrap/instance-config.ts` (`proxyMode`/`sslMode`), `DomainsService.getWildcardCertificateStatus()`, `PrimarySslService` (`assertEnabled` throw = platform/external → `delegated`; `issueLetsEncrypt({ extraSans })`).
- Consumed by Task 9 (applier step 6).

**Branch logic for `plan()`:**
1. `process.env.PLATFORM_MODE === 'true'` or `SSL_MANAGED_EXTERNALLY === 'true'` → `{ model: 'platform', action: 'delegated' }` (`DomainsService.create` already forces `sslEnabled: true` and notifies the Control Plane).
2. `getWildcardCertificateStatus().exists` → `{ model: 'wildcard', action: 'covered' }`.
3. `loadInstanceConfig()` null (no bootstrap-managed box, e.g. legacy compose) → `{ model: 'unknown', action: 'report' }` — report-only, never touch certs.
4. `proxyMode` is `'cloudflare' | 'proxy'` OR `sslMode === 'selfsigned'` → `edge-terminated` (edge/self-signed serves `*.<primary>` via the wildcard 443 block; nothing to issue).
5. else (`proxyMode 'none'` + `sslMode 'letsencrypt'`) → `stage-san-reissue`.

**`execute` for `stage-san-reissue`:** call `primarySslService.issueLetsEncrypt({ extraSans: [appHost] })` (stages to `target: 'staging'`, never live). On success return `action-required` with a manual step `{ id: 'apply-ssl-cert', title: 'Apply the updated certificate', body: 'A new certificate including <appHost> was issued and staged. Review and apply it, then confirm within the safety window.', deepLink: '/admin/settings/ssl', appliesWhen: 'selfHosted' }`. On `issueLetsEncrypt` failure (its preflight hard-gate probes apex/www/admin and can fail for reasons unrelated to the app): degrade to `action-required` with body naming the failure and BOTH remediation routes (wildcard cert — auto-upgrades the subdomain later via `enableSslForAllSubdomains`; or manual SSL page re-issue). Never fail the install for a cert problem — the app is reachable over the wildcard/HTTP meanwhile.

**`extraSans` threading:** read `requestPrimaryDomainCertificate` in `ssl-certificate.service.ts` first; add the optional SANs to wherever the `-d` domain list / CSR SAN list is built, default `[]`, behavior byte-identical when absent. Extend `issueLetsEncrypt(opts?)` to pass through AND to include `extraSans` in its preflight probe list (reuse `probeHost` from Task 6 if its current preflight uses `BootstrapDnsPreflightService.run`; only add a probe for the extra hosts, don't reduce existing checks). Update `PrimarySslStatus.wildcardCovered`-adjacent tests only if they break; add focused new tests: `issueLetsEncrypt()` without opts produces the same SAN list as before (regression), with `extraSans: ['handoff.example.com']` the SAN list includes it.

- [ ] **Step 1: Write failing tests** for `plan()` (each of the 5 branches, mocking `loadInstanceConfig` via `jest.mock('../bootstrap/instance-config')` and a stub DomainsService) and `execute()` (`stage-san-reissue` success → `action-required` + manualStep with deepLink `/admin/settings/ssl`; issue failure → `action-required` degraded, install not failed; `covered`/`delegated`/`none-needed` → `done`/`skipped` without touching PrimarySslService — assert the mock was NOT called).
- [ ] **Step 2: Run to verify failure** — `pnpm test -- app-cert-step`
- [ ] **Step 3: Implement `AppCertStepService`, then the `extraSans` threading with its regression tests.**
- [ ] **Step 4: Run** `pnpm test -- 'app-cert-step|primary-ssl|ssl-certificate'` — all PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app-catalog apps/backend/src/setup/primary-ssl apps/backend/src/domains
git commit -m "feat(app-catalog): serving-model cert step; optional extraSans on LE issuance"
```

---

### Task 9: Install jobs + the applier

**Files:**
- Create: `apps/backend/src/app-catalog/app-install-jobs.service.ts`, `app-installer.service.ts`, `app-installer.service.spec.ts`, `app-install-jobs.service.spec.ts`
- Modify: `app-catalog.module.ts` — this is where the cross-module imports land:

```ts
@Module({
  imports: [
    forwardRef(() => ProxyRulesModule), // ProxyRuleSetsService (module forwardRefs internally)
    DeploymentsModule,                  // DeploymentsService
    DomainsModule,                      // DomainsService
    ProjectsModule,                     // ProjectsService
    PipelineSchedulesModule,            // PipelineSchedulesService
    PipelinesModule,                    // PipelineSchemasService (uninstall counts)
  ],
  controllers: [AppCatalogController],
  providers: [
    AppCatalogService, AppsRegistryService, AppBundleService,
    AppPreflightService, AppCertStepService,
    AppInstallJobsService, AppInstallerService,
    BootstrapDnsPreflightService, // not exported by SetupModule; zero-dep
  ],
})
```

**Interfaces:**
- Produces:

```ts
// app-install-jobs.service.ts — in-memory, storage-migration pattern
export type InstallStepId =
  | 'preflight' | 'fetch' | 'sync-rules' | 'deploy'
  | 'domain' | 'certificate' | 'schedules' | 'record';
export interface InstallStepState {
  id: InstallStepId;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'action-required';
  detail?: string;
  error?: string;
}
export interface InstallJob {
  id: string;                      // `app-install-${Date.now()}`
  kind: 'install' | 'update';
  appId: string;
  projectId: string | null;        // null until project resolved (newProject path)
  status: 'running' | 'succeeded' | 'failed' | 'undone';
  steps: InstallStepState[];
  installedAppId?: string;
  manualSteps?: AppManualStep[];   // filtered by manualStepApplies at completion
  appUrl?: string;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}
export class AppInstallJobsService {
  create(kind: 'install' | 'update', appId: string, stepIds: InstallStepId[]): InstallJob; // throws BadRequestException if a job is already running
  get(jobId: string): InstallJob | null;
  setStep(jobId: string, step: InstallStepId, patch: Partial<InstallStepState>): void;
  finish(jobId: string, status: InstallJob['status'], patch?: Partial<InstallJob>): void;
}

// app-installer.service.ts
export interface InstallTarget {
  projectId?: string;
  newProject?: { owner: string; name: string };
}
export class AppInstallerService {
  /** Kicks off the background run; returns immediately. */
  startInstall(entry: AppRegistryEntry, target: InstallTarget, userId: string): { jobId: string };
  startUpdate(installed: InstalledApp, entry: AppRegistryEntry, userId: string, opts: { prune: boolean }): { jobId: string };
  /** Deletes ONLY this job's created objects (from the installed_apps row's createdResources). */
  undo(installedAppId: string, userId: string): Promise<{ removed: string[] }>;
  uninstall(installedAppId: string, userId: string, opts: { deleteData: boolean }): Promise<UninstallSummary>;
}
```

- Consumes (exact signatures from exploration — do not re-derive):
  - `ProxyRuleSetsService.syncRuleSet(projectId, dto, userId, userRole, apiKeyProjectId?)` → `SyncProxyRuleSetResponseDto` (`proxy-rule-sets.service.ts:889`)
  - `DeploymentsService.createDeploymentFromZip(file, dto, userId, userRole?)` (`deployments.service.ts:185`) — `file` needs only `{ buffer, originalname, mimetype }`
  - `DomainsService.create(createDomainDto, userId, authToken?, apiKeyProjectId?)` (`domains.service.ts:525`) — **read back `sslEnabled` from the returned row**; a subdomain's `sslEnabled: true` is silently downgraded when no wildcard cert exists
  - `ProjectsService.findOrCreateProject(owner, name, createdBy)` (idempotent) / `projectExists(owner, name)`
  - `PipelineSchedulesService.createSchedule(projectId, dto, userId, userRole?, apiKeyProjectId?)` and `listPipelineRules(...)` to find the target rule by `(pathPattern, method)`
  - Task 5's `AppBundleService`, Task 7's `AppPreflightService`, Task 8's `AppCertStepService`
- Consumed by: Task 10 (uninstall/update endpoints), Task 11 (controller), Task 13 (UI polling contract).

**Applier step semantics (each step idempotent, individually reported):**

1. **`preflight`** — re-run `instanceGates` + `projectGates`; any `fail` → job fails before any write. (The UI already showed these, but the job re-checks — nothing is written that wasn't re-verified.)
2. **`fetch`** — `AppBundleService.fetchBundle(entry.bundleUrl, entry.sha256)` (cache hit if preflight just fetched). Then **validate each bundled rule-set JSON through the real DTO pipeline**: `plainToInstance(SyncProxyRuleSetDto, json)` + `validateSync` (class-transformer/-validator are already backend deps) so direct service calls get the same SSRF/shape validation as HTTP callers (`IsValidSyncTargetUrl` etc.). Abort on errors.
3. **project resolution** (inside `sync-rules` step start): `newProject` → `findOrCreateProject(owner, name, userId)`; set `createdResources.projectCreated = !await projectExists(...)` (check BEFORE creating). Insert the `installed_apps` row now with `status: 'installing'` — it survives restarts and powers undo.
4. **`sync-rules`** — per bundled rule set, in manifest order: `syncRuleSet(projectId, { ...parsedJson, options: { dryRun: false, prune: false }, source: { repo: manifest.eject?.repo, path: ruleSetEntry.file } }, userId, 'admin', null)`. Record `ruleSetId` into both `ruleSetIds` and `createdResources.ruleSetIds` (only when `setCreated === true` for the latter); collect `schemaResolutions` — `targetSchemaId`s into `schemaIds`, and `action === 'create'` ids into `createdResources.schemaIdsCreated`. Surface `missingSecrets`/`warnings` into the step's `detail`.
5. **`deploy`** — build a dist-only zip: for each bundle entry under `dist/`, re-key to `${basePath.slice(1)}/${rest}` (e.g. `dist/index.html` → `apps/handoff/dist/index.html`), `fflate.zipSync` the map, then `createDeploymentFromZip({ buffer: Buffer.from(zip), originalname: `${appId}-bundle.zip`, mimetype: 'application/zip' } as Express.Multer.File, dto, userId, 'admin')` with dto `{ repository: `${owner}/${name}`, commitSha: bundleSha256.slice(0, 40), branch: 'app-catalog', alias: manifest.install.alias, description: `App install: ${name} v${version}`, basePath: manifest.install.deployment.basePath, proxyRuleSetNames: ruleSets.filter(r => r.attachToAlias !== false).map(namesFromSyncResponses), source: 'manual' }`. **Assert the returned `aliases[]` includes the alias** — explicit-alias failure is swallowed upstream (`deployments.service.ts:393-396`); treat absence as step failure. Record `deploymentId`, `aliasName`.
6. **`domain`** — skip (status `skipped`) when manifest has no `install.domain`. Else `DomainsService.create({ projectId, alias, path: basePath, domain: appHost, domainType: 'subdomain', sslEnabled: true, isPublic, isSpa }, userId, undefined, null)`. Record `domainId` into row + `createdResources`. Idempotency: if the domain already exists AND is recorded in this app's own `installed_apps` row (re-run), skip.
7. **`certificate`** — `AppCertStepService.plan(appHost)` → `execute`; `action-required` outcomes append the synthesized manual step to the job's `manualSteps`. Also: if the domain step's returned row had `sslEnabled === false` on a non-platform box, note it in `detail`.
8. **`schedules`** — for each manifest schedule: find the rule via `listPipelineRules` matching `(targetRulePath, targetRuleMethod)`, list existing schedules and match by `name` (schedules have no name-uniqueness — the installer enforces idempotency itself), create if absent, record ids in `createdResources.scheduleIds`. Handoff ships `schedules: []` — the step reports `skipped` when empty.
9. **`record`** — update the `installed_apps` row: `status: 'installed'`, final `version`, `bundleSha256`, `updatedAt`. Compute `manualSteps` = manifest steps filtered by `manualStepApplies` with `ctx = { bucketStorage: !(storage adapter is local), platformMode }` + any cert-step synthesized ones; set `appUrl` (`https://${appHost}` when domain created, else the deployment's alias URL from `createDeploymentResponse.urls.default`).

**Failure handling:** any step throw → step `failed` with `error`, job `failed`, `installed_apps.status = 'failed'` (row kept — powers undo + resume). `undo()` deletes only `createdResources` in reverse order (schedules → domain → alias → deployment → rule sets → created schemas → project if `projectCreated` and it has no other content), then deletes the row and marks the job `undone`. Never touches reused schemas or pre-existing domains. Re-running install on a `failed` row is allowed (idempotent steps make it a resume).

**Update job** (`kind: 'update'`, steps `fetch → sync-rules → deploy → record`): re-sync with `prune` from opts (default false — user rules survive; `prune: true` is the explicit "reset to shipped rules" toggle), deploy new dist to the SAME alias (alias history = instant rollback), domain/schedules untouched, row version bumped. No preflight DNS/collision gates (already installed).

- [ ] **Step 1: Write failing tests for `AppInstallJobsService`** — create/get/single-flight (second `create` while running throws), `setStep` transitions, `finish`.
- [ ] **Step 2: Write failing tests for `AppInstallerService`** — the meat. House db mock for `installed_apps` reads/writes + `jest.fn()` stubs for every collaborator, returning realistic shapes (reuse `TEST_MANIFEST` + `makeBundle` from Tasks 4–5). Cases:
  - happy path: collaborators called in order (sync before deploy — assert call order via `mock.invocationCallOrder`), `proxyRuleSetNames` passed to deploy match synced set names, `createdResources` recorded correctly, row ends `installed`
  - deploy response missing the alias in `aliases[]` → step failed, job failed, row `failed`
  - sync `schemaResolutions` mixing reuse/create → only created ids land in `createdResources.schemaIdsCreated`, all land in `schemaIds`
  - no `install.domain` in manifest → domain + certificate steps `skipped`, `appUrl` falls back to deployment URL
  - cert step `action-required` → job succeeds with the manual step present
  - undo: deletes only created resources, reverse order, never calls schema-delete for reused ids
  - update: prune flag passed through; domain service NOT called
- [ ] **Step 3: Run to verify failure** — `pnpm test -- 'app-install'`
- [ ] **Step 4: Implement both services.** Job kickoff is fire-and-forget (`void this.runInstall(...)` with a top-level try/catch that always `finish()`es — copy the migration service's shape, `migration.service.ts:93-94`), with `setImmediate` yields between steps unnecessary (few steps, each awaits I/O).
- [ ] **Step 5: Run tests, verify PASS. Typecheck. Boot check:** `cd apps/backend && pnpm exec tsc --noEmit` then start the backend briefly if a local stack is available (`pnpm dev` from repo root) to catch Nest DI wiring errors (forwardRef cycles surface at boot, not compile). If no local stack, note it for the live checklist.
- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/app-catalog
git commit -m "feat(app-catalog): background install job + idempotent applier with undo"
```

---

### Task 10: Lifecycle backend — uninstall, eject, manual-step ack

**Files:**
- Modify: `apps/backend/src/app-catalog/app-installer.service.ts` (uninstall), `app-catalog.service.ts` (eject payload, ack), and their specs

**Interfaces:**
- Produces:

```ts
export interface UninstallSummary {
  removed: { ruleSets: number; alias: boolean; domain: boolean; deployment: boolean; schedules: number };
  dataTables: { kept: string[]; deleted: string[]; deletedRecordCounts: Record<string, number> };
  note: string; // "stored objects under project X remain; delete the project for full cleanup"
}
export interface UninstallPreview {
  dataTables: Array<{ name: string; recordCount: number; createdByInstall: boolean }>;
}
// app-catalog.service.ts
export interface EjectPayload {
  repo: string; appPath: string; deployWorkflow: string;
  forkUrl: string;                       // https://github.com/<repo>/fork
  variables: Record<string, string>;     // { BFFLESS_URL: <admin origin>, BFFLESS_PROJECT: "<owner>/<name>" }
  secrets: string[];                     // ['BFFLESS_API_KEY']
  alias: string;
  note: string;                          // "the workflow's first deploy lands on this same alias"
}
async ejectPayload(installedAppId: string): Promise<EjectPayload>;
async ackManualStep(installedAppId: string, stepId: string): Promise<string[]>; // returns updated acked list
async uninstallPreview(installedAppId: string): Promise<UninstallPreview>;
```

**Uninstall semantics (spec §Lifecycle + deviation 5):** default removes rule sets (only ids in `ruleSetIds`), alias (`DeploymentsService.deleteAlias`), domain (only `createdResources.domainId`), deployment (find the delete method on `DeploymentsService` — it exists; the MCP `delete_deployment` tool fronts it), schedules (`createdResources.scheduleIds`). Keeps ALL data tables and stored objects. With `deleteData: true`: additionally delete tables in `createdResources.schemaIdsCreated` via `PipelineSchemasService.delete`, having first fetched `recordCount` per table (`getByIdWithCount`) for the summary; reused tables are NEVER deleted regardless of the flag. Finally delete the `installed_apps` row. `uninstallPreview` powers the dialog's real counts ("this deletes 412 records across 3 tables").

**Eject:** `BFFLESS_URL` = `PUBLIC_ORIGIN` env if set, else `https://admin.${PRIMARY_DOMAIN}`. Manifest comes from the stored `installed_apps.manifest` jsonb (no registry fetch — eject works offline). API-key minting stays in the frontend via the EXISTING api-keys endpoints (`createApiKey` slice already exists) — no new backend surface.

- [ ] **Step 1: Write failing tests:** uninstall default keeps tables (schema delete NOT called) but removes the four object classes; `deleteData: true` deletes only created tables with counts collected first; reused-table protection; eject payload derives variables correctly (with and without `PUBLIC_ORIGIN`); ack appends idempotently (double-ack no duplicate).
- [ ] **Step 2: Run to verify failure** — `pnpm test -- 'app-installer|app-catalog.service'`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests, verify PASS.**
- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app-catalog
git commit -m "feat(app-catalog): uninstall (data kept by default), eject payload, manual-step ack"
```

---

### Task 11: Controller routes, catalog assembly, fixture bundle, orchestration spec

**Files:**
- Create: `apps/backend/src/app-catalog/app-catalog.dtos.ts`, `app-catalog/__fixtures__/make-fixture-bundle.ts` (test helper building v1/v2 bundles in-memory with `zipSync` — committed as code, not binary), `app-catalog.e2e-ish.spec.ts` (orchestration spec)
- Modify: `app-catalog.controller.ts`, `app-catalog.service.ts`, their specs

**Interfaces:**
- Produces the full HTTP surface (all under the Task 1 guard stack; `@CurrentUser() user: CurrentUserData` everywhere):

| Route | Handler | Request | Response |
|---|---|---|---|
| `GET /api/admin/apps` | `list` | — | `{ data: CatalogEntry[], registryError?: string }` |
| `POST /api/admin/apps/:appId/preflight` | `preflight` | `PreflightRequestDto` | `{ gates, syncPlans, appHost, appUrl }` |
| `POST /api/admin/apps/:appId/install` | `install` | `PreflightRequestDto` | `{ jobId }` |
| `GET /api/admin/apps/jobs/:jobId` | `getJob` | — | `InstallJob` (404 unknown) |
| `POST /api/admin/apps/jobs/:jobId/undo` | `undoJob` | — | `{ removed: string[] }` |
| `POST /api/admin/apps/installed/:id/update` | `update` | `{ prune?: boolean }` | `{ jobId }` |
| `GET /api/admin/apps/installed/:id/uninstall-preview` | `uninstallPreview` | — | `UninstallPreview` |
| `DELETE /api/admin/apps/installed/:id` | `uninstall` | query `deleteData=true\|false` | `UninstallSummary` |
| `GET /api/admin/apps/installed/:id/eject` | `eject` | — | `EjectPayload` |
| `POST /api/admin/apps/installed/:id/ack-manual-step` | `ack` | `{ stepId: string }` | `{ acked: string[] }` |

```ts
export class PreflightRequestDto {
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @ValidateNested() @Type(() => NewProjectDto) newProject?: NewProjectDto;
}
export class NewProjectDto {
  @IsString() @Matches(/^[a-zA-Z0-9_-]+$/) owner: string;
  @IsString() @Matches(/^[a-zA-Z0-9_-]+$/) name: string;
}
export interface CatalogEntry {
  id: string; name: string; summary?: string; iconUrl?: string; docsUrl?: string; sourceUrl?: string;
  registryVersion?: string;         // absent when registry unavailable but app installed
  gates: GateResult[];              // instance-level only
  installable: boolean;             // every instance gate passed && registry present
  installed?: {
    installedAppId: string; version: string; projectId: string; projectName: string;
    alias: string; appUrl?: string; status: InstalledAppStatus;
    updateAvailable: boolean;       // compareSemver(registryVersion, version) > 0
    manualSteps: AppManualStep[]; manualStepsAcked: string[];
  };
}
```

`listCatalog` = registry (`AppsRegistryService.getRegistry()`) ∪ installed rows: registry entries get `instanceGates(entry.requires)`; installed-but-not-in-registry apps still render (from the stored manifest) with a note; registry failure sets top-level `registryError` and the catalog still lists installed apps ("degrades to catalog-unavailable without affecting installed apps").

**Fixture bundle + orchestration spec** (deviation 4 — house db mock, not real PG): `make-fixture-bundle.ts` exports `makeFixtureBundle(version: '1.0.0' | '2.0.0')` — v1: manifest + 2 tiny rule sets (2 rules, 2 schemas incl. one shared name for the reuse path) + `dist/index.html`; v2 bumps version, adds a rule, changes `dist`. The orchestration spec drives `AppInstallerService` with REAL `AppBundleService` + REAL manifest validation + REAL zip bytes, mocked externals (sync/deploy/domains/projects returning realistic shapes), and asserts end-to-end: install v1 → row `installed` with correct bookkeeping; update to v2 → same alias redeployed, prune false; uninstall keep-data → tables kept; uninstall delete-data → only created tables deleted. This is the closest CE-side approximation of the spec's integration suite; the real-DB pass happens on the live droplet (Task 16 checklist).

- [ ] **Step 1: Write failing controller + orchestration tests** (controller: route handlers delegate with the right args; 404 on unknown job; ValidationPipe shapes via DTO metadata tests are optional).
- [ ] **Step 2: Run to verify failure** — `pnpm test -- app-catalog`
- [ ] **Step 3: Implement DTOs, controller routes, `listCatalog` assembly.**
- [ ] **Step 4: Run the whole new-module suite + typecheck:** `pnpm test -- 'app-catalog|app-install|app-preflight|app-cert|app-bundle|apps-registry|app-manifest|ce-version'` — all PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app-catalog
git commit -m "feat(app-catalog): full admin API, catalog assembly, fixture-driven orchestration spec"
```

---

### Task 12: Frontend — API slice, route, catalog page

**Files:**
- Create: `apps/frontend/src/services/appCatalogApi.ts`, `apps/frontend/src/pages/AppsPage.tsx`, `apps/frontend/src/components/app-catalog/AppCard.tsx`, `apps/frontend/src/components/app-catalog/__tests__/AppCard.test.tsx`
- Modify: `apps/frontend/src/services/api.ts` (add `'AppCatalog', 'InstalledApp'` to `tagTypes`), `apps/frontend/src/App.tsx` (route), `apps/frontend/src/pages/HomePage.tsx` (admin button)

**Interfaces:**
- Produces `appCatalogApi` hooks: `useGetAppCatalogQuery`, `usePreflightAppMutation`, `useInstallAppMutation`, `useGetInstallJobQuery`, `useUndoJobMutation`, `useUpdateAppMutation`, `useGetUninstallPreviewQuery`, `useUninstallAppMutation`, `useGetEjectPayloadQuery`, `useAckManualStepMutation`. TypeScript mirrors of `CatalogEntry`, `GateResult`, `InstallJob`, `SyncPlanSummary`, `EjectPayload`, `UninstallPreview`, `UninstallSummary` (copy the shapes from Tasks 7/9/10/11 — keep field names identical).
- Consumed by Tasks 13–14.

Slice skeleton (follow `pipelineSchedulesApi.ts` structure exactly — interfaces, envelope transform, per-scope tags):

```ts
import { api } from './api';
// ... interface definitions mirroring backend shapes ...

export const appCatalogApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getAppCatalog: builder.query<{ data: CatalogEntry[]; registryError?: string }, void>({
      query: () => '/api/admin/apps',
      providesTags: ['AppCatalog'],
    }),
    preflightApp: builder.mutation<PreflightResponse, { appId: string; body: PreflightRequest }>({
      query: ({ appId, body }) => ({ url: `/api/admin/apps/${appId}/preflight`, method: 'POST', body }),
    }),
    installApp: builder.mutation<{ jobId: string }, { appId: string; body: PreflightRequest }>({
      query: ({ appId, body }) => ({ url: `/api/admin/apps/${appId}/install`, method: 'POST', body }),
      invalidatesTags: ['AppCatalog', 'InstalledApp'],
    }),
    getInstallJob: builder.query<InstallJob, string>({
      query: (jobId) => `/api/admin/apps/jobs/${jobId}`,
      // no tags — polling replaces invalidation (migrationApi precedent)
    }),
    // ... update / uninstallPreview / uninstall / eject / ackManualStep,
    // lifecycle mutations invalidate ['AppCatalog', 'InstalledApp']
  }),
});
```

`AppsPage`: admin-only page (route `/apps` wrapped in `<ProtectedRoute requireAdmin>`), header + card grid from `useGetAppCatalogQuery`, `registryError` rendered as a dismissable notice ("Catalog unavailable — installed apps unaffected"), empty state, and while any card has a running job, `pollingInterval` on the catalog query is unnecessary (job polling lives in the dialog).

`AppCard` CTA state machine (spec table): preflight clean → **Install** (opens dialog); any instance gate `fail` → disabled button with the gate's `message` (*"Requires bucket storage"*, *"Requires CE ≥ 0.3.15"*) + a "Why?" popover showing `remediation` + `deepLink`; `installed` → badge `Installed · v{version}` + **Open ↗** (`appUrl`) + overflow menu (Update available?, Uninstall, Eject); `updateAvailable` → **Update to v{registryVersion}** primary.

HomePage admin section (`HomePage.tsx:301-320`): add

```tsx
{isEnabled('ENABLE_APP_CATALOG') && (
  <Button asChild variant="outline"><Link to="/apps">Apps</Link></Button>
)}
```

(the section is already `user?.role === 'admin'`-gated; `useFeatureFlags` is already imported on this page).

- [ ] **Step 1: Write failing `AppCard` tests** — house pattern (mock the slice module wholesale, `vi.mock('@/services/appCatalogApi', ...)`): renders Install when installable; disabled with gate message when a gate fails; Installed badge + Open link when installed; Update CTA when `updateAvailable`.
- [ ] **Step 2: Run to verify failure** — `cd apps/frontend && pnpm test -- AppCard`
- [ ] **Step 3: Implement slice + page + card + route + HomePage button + tagTypes.**
- [ ] **Step 4: Run tests + typecheck** — `pnpm test -- AppCard && pnpm exec tsc --noEmit`
- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src
git commit -m "feat(app-catalog): Apps page, catalog cards, RTK Query slice"
```

---

### Task 13: Frontend — Install dialog (Review / Working / Done)

**Files:**
- Create: `apps/frontend/src/components/app-catalog/InstallDialog.tsx`, `__tests__/InstallDialog.test.tsx`

**Interfaces:**
- Consumes Task 12's hooks. Props: `{ entry: CatalogEntry; open: boolean; onOpenChange: (o: boolean) => void }`.

**Screen 1 — Review.** Project picker: existing projects from the existing projects/repositories query (find the hook used by HomePage/repo pages — likely `getMyRepositories` in `repoApi`; reuse it, do not add an endpoint) + a "Create new project" option with owner/name inputs and the immutability warning verbatim: *"A project's owner/name can never be renamed."* Preselect when exactly one project exists. On selection change → `usePreflightAppMutation`; render: the app URL it will get (`appUrl`), each `GateResult` as a row (icon by status, message, "Why?" → remediation/deepLink, Retry button when `retryable`), and the dryRun plan in the spec's plain language — per rule set `"{created} rules created · {updated} updated"` and aggregated `"N data tables: X reused, Y created"` from `syncPlans[].schemaResolutions` (`fieldMismatch` renders a warning row). Install button enabled only when no gate is `fail`. Nothing is written that wasn't shown first.

**Screen 2 — Working.** After `useInstallAppMutation` → `{ jobId }`: `useGetInstallJobQuery(jobId, { pollingInterval: 1000, skip: !jobId })` (MigrationProgress precedent). Step list renders `job.steps` with status icons; `action-required` steps show their `detail`; DNS-failed preflight inside the job renders the exact record to add with a Retry (re-`install` — idempotent). Job `failed` → error + **Undo this install** (`useUndoJobMutation`) + Close.

**Screen 3 — Done.** `job.status === 'succeeded'`: app URL + **Open ↗**, and the `manualSteps` checklist — each with title/body/deepLink and an ack checkbox wired to `useAckManualStepMutation` (checked state from `manualStepsAcked`).

- [ ] **Step 1: Write failing tests** (mock hooks module; simulate job states): Review shows plan language "2 rules created" and disables Install on a failed gate; Working renders step statuses from a polled job object; Done renders manual steps and fires ack on check; failed job offers Undo.
- [ ] **Step 2: Run to verify failure** — `pnpm test -- InstallDialog`
- [ ] **Step 3: Implement** (Radix Dialog + existing `Progress`/`Checkbox`/`Button` ui components; match ProxyRuleSetsPage's dialog idioms).
- [ ] **Step 4: Run tests + typecheck.**
- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src
git commit -m "feat(app-catalog): three-screen install dialog with live job progress"
```

---

### Task 14: Frontend — lifecycle UI (update, uninstall, eject)

**Files:**
- Create: `apps/frontend/src/components/app-catalog/UninstallDialog.tsx`, `EjectPanel.tsx`, `__tests__/UninstallDialog.test.tsx`, `__tests__/EjectPanel.test.tsx`
- Modify: `AppCard.tsx` (wire overflow menu), `AppsPage.tsx` (mount dialogs)

**UninstallDialog:** loads `useGetUninstallPreviewQuery`; default mode copy: *"Removes the app's rule sets, alias, domain, and deployment. Your data tables and uploaded files are kept."* Checkbox *"Also delete the app's data tables"* reveals the real counts from the preview (*"this deletes {sum} records across {n} tables"*; reused tables listed as kept regardless). Confirm → `useUninstallAppMutation({ deleteData })` → summary toast.

**EjectPanel** (dialog or card section from `useGetEjectPayloadQuery`): fork link (`forkUrl`), the exact variables table (`BFFLESS_URL`, `BFFLESS_PROJECT` with copy buttons), secrets list with an inline **Mint API key** button using the EXISTING api-key creation hook (find it in `services/` — the ApiKeys settings page uses it) scoped to the app's project when supported, the workflow name to run, and the continuity note verbatim: *"The workflow's first deploy lands on this same alias — your install becomes the fork's deploy target."*

**Update:** AppCard's Update CTA → confirm popover with a *"Reset to the app's shipped rules (prune)"* toggle default OFF → `useUpdateAppMutation({ prune })` → reuse InstallDialog's Working screen (same job endpoint).

- [ ] **Step 1: Write failing tests:** UninstallDialog keeps-data copy by default and shows counts only after checkbox; Eject renders variables + note; update fires with `prune: false` by default.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Full frontend suite + typecheck:** `cd apps/frontend && pnpm test && pnpm exec tsc --noEmit` (lint the touched files with `npx eslint`, never `pnpm lint`).
- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src
git commit -m "feat(app-catalog): update, uninstall (data kept by default), eject panel"
```

---

### Task 15: `bffless/apps` — Handoff manifest, bundle build, registry (SEPARATE REPO + PR)

Work in `/home/rico/bffless/repos/apps` on a new branch `feat/app-catalog-bundles` (it IS a git repo; branch from `main`). This task is independent of CE tasks 1–14 and may run in parallel after Task 4 freezes the manifest shape.

**Files:**
- Create: `apps/handoff/bffless-app.json`, `scripts/build-app-bundle.mjs`, `.github/workflows/app-bundles.yml`
- Modify: `scripts/check-app-conventions.mjs` (validate manifest presence + shape for apps that ship one), `apps/handoff/bffless/README.md` (fix the stale claim), `docs/app-pipelines-convention.md` (document the manifest)

**Facts from exploration that shape this task:**
- There is NO release machinery: no tags, no releases, no release-please; `apps/handoff/package.json` is a pinned `0.0.0`. **The manifest's `version` field in `apps/handoff/bffless-app.json` becomes the per-app version source of truth**, bumped by hand in PRs (start at `1.0.0`).
- Built rule-set JSON is produced by `npx bffless rules build <set-dir> -o <file>` (nothing in CI does this today; `dist/.gitignore` is `*`). Output envelope: `{ version: 2, exportedAt, kind, ruleSet, rules, schemas }` — `exportedAt` is non-deterministic and CE's sync ignores it; `schemas[].id` carries SOURCE-project UUIDs, which is fine because CE's sync resolves by NAME (the id is only the in-payload reference key). Do NOT strip ids.
- `deploy-handoff.yml:26-67` already builds `dist` env-free (no VITE_ vars) — the bundle's dist is instance-agnostic.
- Registry publish precedent: Studio's second `upload-artifact` step with explicit `base-path` (`deploy-studio.yml:65-77`).

**`bffless-app.json`** — exactly the `TEST_MANIFEST` shape from CE Task 4 with real values: `id: handoff`, `name: Handoff`, `version: 1.0.0`, summary/docsUrl/sourceUrl, `requires: { presignedStorage: true, ceMin: "0.3.15" }`, install block (alias `handoff`, deployment `{ path: "dist", basePath: "/apps/handoff/dist" }`, both rule sets `attachToAlias: true`, domain `{ subdomain: "handoff", isPublic: true, isSpa: true }`, `schedules: []`), manualSteps: `bucket-cors` (`appliesWhen: "bucketStorage"`) + an `iframe-headers` step mirroring the README's COOP/COEP exception (`appliesWhen: "always"`), eject block per the spec example.

**`build-app-bundle.mjs`** — `node scripts/build-app-bundle.mjs handoff` → `dist-bundles/handoff-v<version>.bundle.zip` + `dist-bundles/handoff-v<version>.sha256`:
1. read + JSON-validate `apps/handoff/bffless-app.json` (basic checks: schemaVersion 1, id/version present, files referenced exist after build)
2. `pnpm --filter handoff build`
3. per rule set dir under `apps/handoff/.bffless/proxy-rules/*`: `npx --yes bffless@latest rules build <dir> -o <tmp>/rulesets/<name>.json`
4. assemble zip: `bffless-app.json` + `rulesets/*.json` + `dist/**` (entry paths exactly `dist/...`)
5. sha256 to the sidecar file; print both paths

**`app-bundles.yml`** — `workflow_dispatch` (input: app id) + `push: tags: ['handoff-v*']`. Steps: checkout → pnpm/node setup (copy from `deploy-handoff.yml:26-40`) → run the build script → `gh release create <tag> dist-bundles/*.zip --notes` (or upload to the existing tag's release) → build `registry.json` (small inline node step: read every `apps/*/bffless-app.json` that exists, emit `{ schemaVersion: 1, apps: [{ id, name, version, bundleUrl: <the release asset URL>, sha256: <from sidecar>, summary, iconUrl, requires }] }`) → publish it with `bffless/upload-artifact@v1` (`path` = a staging dir containing only `registry.json`, `alias: app-registry`, `api-url: ${{ vars.BFFLESS_URL }}`, `api-key: ${{ secrets.BFFLESS_API_KEY }}`). **Operator step (not CI):** map `apps.bffless.dev` to that alias on the target instance + a cache rule (~1h TTL) — record as a PR-description checklist item.

**`check-app-conventions.mjs`:** add — if `apps/<app>/bffless-app.json` exists, validate: parses, `schemaVersion === 1`, `id === <app>`, semver `version`, every `install.ruleSets[].file` maps to an authored set dir (`rulesets/<name>.json` ↔ `.bffless/proxy-rules/<name>/`), `install.alias` and `install.domain.subdomain` non-empty. (Handoff must pass; Studio/Reader without manifests must still pass — presence is optional, the catalog is opt-in per app.)

**README fix:** `apps/handoff/bffless/README.md` §1 — replace the "bucket REQUIRED / will not work on local file storage" block: as of CE v0.3.15 local-FS presigned uploads work on a stock install (`ENCRYPTION_KEY` + default-on `FEATURE_LOCAL_PRESIGNED_UPLOADS`); a real bucket is *recommended for production*. Keep the CORS instructions under a "bucket backends" heading.

- [ ] **Step 1:** Write `bffless-app.json` + extend `check-app-conventions.mjs`; run `pnpm apps:check` → PASS.
- [ ] **Step 2:** Write `build-app-bundle.mjs`; run it locally; unzip the output and verify layout (`bffless-app.json`, `rulesets/handoff.json` with 27 rules, `rulesets/handoff-rss-feed.json` with 2, `dist/index.html`); verify the sha256 sidecar matches.
- [ ] **Step 3:** Cross-check: feed the real produced bundle to CE's `AppBundleService.loadFromBuffer` via a one-off script against the CE worktree (`node -e` or a scratch spec) — the real Handoff bundle must pass CE validation. This is the contract seam; if it fails, fix whichever side is wrong.
- [ ] **Step 4:** Write the workflow + README/convention-doc updates.
- [ ] **Step 5:** Commit on the branch, push, open PR in `bffless/apps` titled `feat: app-catalog bundle build + registry publish (handoff v1.0.0)`; PR body lists the operator steps (create `apps.bffless.dev` mapping, set cache rule, cut the first `handoff-v1.0.0` tag). **Ask the user before pushing/opening the PR** if not already blanket-approved.

---

### Task 16: Finalize — whole-branch review, live checklist, PR #567

- [ ] **Step 1: Full verification in the CE worktree**

```bash
cd /home/rico/bffless/repos/ce/.claude/worktrees/app-catalog
pnpm --filter backend exec tsc --noEmit && pnpm --filter frontend exec tsc --noEmit
cd apps/backend && pnpm test          # foreground; ~minutes with coverage
cd ../frontend && pnpm test
```

All green before proceeding (pre-existing failures on main are the baseline — `git stash`-check if unsure a failure is ours).

- [ ] **Step 2: Whole-branch review** — superpowers:requesting-code-review against the full diff (`git diff main...HEAD`), plus `/security-review` (the installer fetches remote zips and executes nothing, but writes rule sets containing handler code — the sha256 + first-party-registry + DTO-validation story must hold up; this was also flagged as possibly skipped on #565).
- [ ] **Step 3: Live droplet checklist** (goes in the PR body as unchecked boxes — live validation is the only real test for nginx/vhost reachability, per the #565 lesson):
  - install Handoff on a stock local-FS droplet (wildcard absent): app serves at `handoff.<domain>` via the wildcard 443 block; SPA deep links work; presigned upload round-trips
  - wildcard-cert box: `sslEnabled` true on the created mapping; HTTPS direct
  - proxied/Cloudflare box; direct+LE box (staged SAN re-issue → apply → confirm)
  - platform-mode workspace: delegated cert path + two-label constraint reported
  - update v1→v2 keeps user-added rules (prune off) and alias history rollback works
  - uninstall keep-data leaves tables; delete-data removes only created tables
- [ ] **Step 4: Update PR #567** — push with `--force-with-lease` only if history was rewritten (otherwise plain push), then `gh pr edit 567 --title "feat(apps): app catalog — 1-click app install" --body-file -` (heredoc; `--body-file -`, never `--body -`) with: spec link, the 6 deviations, screenshots (localdev-tools/shot.mjs against `pnpm dev`), the live checklist, and the note that `bffless/apps` PR + registry DNS are follow-ups. Keep it draft until live validation. **Ask the user before merging anything, ever.**

## Self-Review (done at planning time)

- **Spec coverage:** trigger/catalog UI (T12), general mechanism + manifest (T4), GitHub-release bundles (T15), first-party registry + sha256 (T5, T15), project picker with immutability warning (T13), tracked installs + update/uninstall (T2, T9, T10, T14), eject (T10, T14), preflight split instance/project (T7, T11), background job + polling (T9, T13), cert branches incl. platform delegation (T8), manualSteps + appliesWhen closed enum (T4, T9, T13), failure→undo (T9), flag gating (T1), testing pyramid (unit per task, fixture orchestration T11, contract T15 step 3, live T16). Out-of-scope items honored: no arbitrary URLs, no drift detection, no path-mount serving, no MinIO auto-enable, Handoff only.
- **Known open risk:** `issueLetsEncrypt` preflight internals (T8) and the deployments delete-method name (T10) are described by behavior, not quoted signature — implementers must read those call sites first; both tasks say so.
- **Type consistency:** `GateResult`/`SyncPlanSummary` defined in T7, reused in T11–T13; `InstallJob`/`InstallStepId` defined in T9, reused in T11/T13; `CreatedResources` in T2, reused in T9/T10; `TEST_MANIFEST` in T4, reused in T5/T9/T15. Manifest shape identical in T4 (types) and T15 (real file).



