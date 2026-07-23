# Day-2 SSL / Certificate Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a self-hosted CE admin a dedicated **Admin → Settings → SSL** page to re-run the onboarding Domain & SSL flow post-setup (change serving model + cert source: Let's Encrypt / paste / self-signed) for the primary instance domain, with no un-undoable action.

**Architecture:** A new session+admin+flag-guarded backend controller (`/api/admin/ssl`) reuses the existing bootstrap SSL services (`BootstrapSetupService`, `SslCertificateService`, `BootstrapDnsPreflightService`) but replaces the claim-token gate with `SessionAuthGuard + RolesGuard + FeatureFlagGuard`. Day-2 apply writes `instance.json`/`instance.env` (and cert files) — the nginx inotify watcher re-renders `main.conf` and reloads within ~3s **without any backend restart** (the domain, and thus SuperTokens identity, is unchanged). Safety is two-tier over a single-depth snapshot of `instance.json` + cert files: cert-only changes use issue-then-swap + one-click rollback; reachability changes (proxyMode/port80/realIp) apply provisionally and auto-revert unless the admin re-confirms within 5 minutes. The frontend adds an `/admin/settings/ssl` tab whose container owns local state and calls the new session endpoints, reusing presentational leaf components extracted from the wizard.

**Tech Stack:** NestJS 10 + `@nestjs/schedule` (`@Interval`), Node `fs`/`X509Certificate`, Drizzle (unused here — state is filesystem), React 18 + Vite + Redux Toolkit (RTK Query) + Radix UI + Tailwind, Vitest + Testing Library (frontend), Jest (backend).

## Global Constraints

- **Platform-mode hard-off:** every backend endpoint refuses when `process.env.PLATFORM_MODE === 'true' || process.env.SSL_MANAGED_EXTERNALLY === 'true'` (mirrors `setup.service.ts:240`). The frontend page + tab render only when the client flag is enabled.
- **New feature flag:** `ENABLE_PRIMARY_SSL_MANAGEMENT`, `envKey: 'FEATURE_PRIMARY_SSL_MANAGEMENT'`, `defaultValue: true`, `type: 'boolean'`, `category: 'features'`, **`exposeToClient: true`**. Enforced server-side via `FeatureFlagGuard` + `@RequireFeatureFlags('ENABLE_PRIMARY_SSL_MANAGEMENT')`.
- **Primary domain is FIXED day-2** — the page never changes the domain (that would change `COOKIE_DOMAIN` and require a restart). The domain field is read-only.
- **No `process.exit` day-2** — apply persists config + certs and lets the watcher reload; it never restarts the backend.
- **`sslMode` is always written explicitly on apply** (never left implicit) so the self-signed render never clobbers a pasted/LE cert (review finding M4).
- **Cert display uses `SslInfoService` (X509)**, never the forge-based `parseCertificateInfo` (review finding M3).
- **Auto-revert window:** default 5 minutes, env-overridable via `SSL_SERVING_CONFIRM_TIMEOUT_MS` (default `300000`).
- **Snapshot depth is single** ("previous" only). A second apply while a serving-revert is pending is rejected until confirm/revert.
- **Reused method signatures (verbatim, do not re-derive):**
  - `BootstrapSetupService` (`apps/backend/src/setup/bootstrap-setup.service.ts`, `@Injectable`): `validateCertificatePair(certPem: string, keyPem: string, domain: string, servingMode: ProxyMode): { sans: string[]; wildcardCovered: boolean }`; `saveCertificates(certPem: string, keyPem: string, domain: string): void`; `certificatesPresent(domain: string): boolean`; `assertStagedCertificateCovers(domain: string, servingMode: ProxyMode): void`; `validateApplyConfig(dto: ApplyBootstrapDto): AppliedConfig`; `validateDomain(domain: string): string`.
  - `SslCertificateService` (`apps/backend/src/domains/ssl-certificate.service.ts`, `@Injectable`, already provided in `SetupModule`): `requestPrimaryDomainCertificate(domain: string): Promise<{ success: boolean; error?: string; expiresAt?: Date; sans?: string[] }>`; `getPrimaryCertificateExpiryDays(): number | null`.
  - `BootstrapDnsPreflightService` (`apps/backend/src/setup/bootstrap-dns-preflight.service.ts`, `@Injectable`, provided in `SetupModule`): `run(domain: string): Promise<PreflightResult>` where `PreflightResult = { ok: boolean; checks: { host: string; resolvedIps: string[]; probeOk: boolean; error?: string }[] }`.
  - `SslInfoService` (`apps/backend/src/domains/ssl-info.service.ts`, `@Injectable`, provided in `DomainsModule`): `getWildcardCertInfo(): Promise<SslCertificateInfo | null>`; `parseCertificate(pemContent, type): SslCertificateInfo`. `SslCertificateInfo = { type; commonName; issuer; issuedAt; expiresAt; daysUntilExpiry; isValid; isExpiringSoon; serialNumber; fingerprint }`.
  - `instance-config.ts` (`apps/backend/src/bootstrap/instance-config.ts`, bare functions): `writeInstanceConfig(cfg: InstanceConfig, dir?: string): void`; `loadInstanceConfig(dir?: string): InstanceConfig | null`; `bootstrapDir(): string`. Types: `ProxyMode = 'cloudflare'|'proxy'|'none'`, `SslMode = 'paste'|'letsencrypt'|'selfsigned'`, `Port80Mode = 'closed'|'redirect'`, `RealIpConfig = null | { preset: 'cloudflare' } | { header: string; ranges: string[] }`, `InstanceConfig = { version: 1|2; state: 'unclaimed'|'applied'; primaryDomain?; proxyMode?; sslMode?; port80?; realIp?; platformIp? }`.
  - Admin controller guard pattern: `@Controller('api/admin/ssl') @UseGuards(SessionAuthGuard, RolesGuard, FeatureFlagGuard) @Roles('admin') @RequireFeatureFlags('ENABLE_PRIMARY_SSL_MANAGEMENT')`. Imports: `SessionAuthGuard` from `../../auth/session-auth.guard`, `RolesGuard` from `../../auth/roles.guard`, `Roles` from `../../auth/decorators/roles.decorator`, `FeatureFlagGuard`/`RequireFeatureFlags` from `../feature-flags`.
- The cert-file directory is `process.env.SSL_CERT_PATH || '/etc/nginx/ssl'`; files are `fullchain.pem`, `privkey.pem`, `wildcard.<domain>.crt`, `wildcard.<domain>.key`.

---

## File Structure

**Backend (new, under `apps/backend/src/setup/primary-ssl/`):**
- `primary-ssl.dto.ts` — request DTOs (paste, apply, preflight, domain-action).
- `primary-ssl-snapshot.service.ts` — `PrimarySslSnapshotService`: snapshot/restore of `instance.json` + the 4 cert files into `bootstrap/ssl-snapshot/`; read/write/clear the durable `bootstrap/pending-serving-revert.json`.
- `primary-ssl.service.ts` — `PrimarySslService`: platform-mode guard, `getStatus`, `preflight`, `stagePaste`, `issueLetsEncrypt`, `apply` (classifies cert-only vs serving-model), `confirm`, `rollback`. Orchestrates the reused services + snapshot store.
- `primary-ssl-revert.service.ts` — `PrimarySslRevertService`: an `@Interval` that reverts an expired unconfirmed pending serving change.
- `primary-ssl.controller.ts` — `PrimarySslController`: the 7 guarded routes.

**Backend (modified):**
- `apps/backend/src/feature-flags/feature-flags.definitions.ts` — add the flag.
- `apps/backend/src/setup/setup.module.ts` — register the new controller + services; import `DomainsModule` (for `SslInfoService`).

**Frontend (shared leaves, new under `apps/frontend/src/components/ssl-leaves/`):**
- `ServingChoiceCards.tsx`, `Port80Choice.tsx`, `RealIpFields.tsx`, `PasteCertificateFields.tsx` — prop-driven presentational bodies.

**Frontend (wizard rewire, modified — behavior unchanged):**
- `apps/frontend/src/components/setup/domain-ssl/ServingChoicePhase.tsx`, `ProxyOptions.tsx`, `PasteCertificateForm.tsx` — render the shared leaves instead of inline JSX.

**Frontend (new day-2 surface):**
- `apps/frontend/src/services/primarySslApi.ts` — RTK Query endpoints + `PrimarySsl` tag.
- `apps/frontend/src/pages/admin-settings/SslTab.tsx` — the tab wrapper.
- `apps/frontend/src/components/settings/primary-ssl/PrimarySslManager.tsx` — the container (local state, calls endpoints).
- `apps/frontend/src/components/settings/primary-ssl/CurrentSslStatus.tsx`, `ServingModelEditor.tsx`, `ApplyPanel.tsx`, `RollbackPanel.tsx`.

**Frontend (modified):**
- `apps/frontend/src/pages/AdminSettingsPage.tsx` — add the SSL tab (TABS entry + `currentTab` derivation).
- `apps/frontend/src/App.tsx` — add the child route.
- `apps/frontend/src/services/api.ts` — add `'PrimarySsl'` tag.
- `apps/frontend/src/components/setup/domain-ssl/PasteCertificateForm.tsx` — fix the misleading copy.
- `apps/backend/src/domains/ssl-renewal.service.ts` — fix the reminder-email copy to point at the real page.

---

## Build order

Backend first (Tasks 1–7) so the API exists, then shared leaves + wizard rewire (Tasks 8–9), then the frontend day-2 surface (Tasks 10–15), then copy fixes (Task 16). Each task ends green + committed.

---

### Task 1: Add the `ENABLE_PRIMARY_SSL_MANAGEMENT` feature flag

**Files:**
- Modify: `apps/backend/src/feature-flags/feature-flags.definitions.ts`
- Test: `apps/backend/src/feature-flags/feature-flags.definitions.spec.ts` (create if absent)

**Interfaces:**
- Produces: flag key `'ENABLE_PRIMARY_SSL_MANAGEMENT'` usable by `FeatureFlagsService.isEnabled` and `@RequireFeatureFlags`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/src/feature-flags/feature-flags.definitions.spec.ts
import { FLAG_DEFINITIONS, getClientExposedFlagKeys } from './feature-flags.definitions';

describe('ENABLE_PRIMARY_SSL_MANAGEMENT', () => {
  it('is defined, defaults true, and is client-exposed', () => {
    const flag = FLAG_DEFINITIONS['ENABLE_PRIMARY_SSL_MANAGEMENT'];
    expect(flag).toBeDefined();
    expect(flag.defaultValue).toBe(true);
    expect(flag.type).toBe('boolean');
    expect(flag.exposeToClient).toBe(true);
    expect(getClientExposedFlagKeys()).toContain('ENABLE_PRIMARY_SSL_MANAGEMENT');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && pnpm test -- feature-flags.definitions.spec`
Expected: FAIL — `flag` is `undefined`.

- [ ] **Step 3: Add the flag entry**

In `feature-flags.definitions.ts`, inside `FLAG_DEFINITIONS`, next to `ENABLE_WILDCARD_SSL`:

```ts
  ENABLE_PRIMARY_SSL_MANAGEMENT: {
    envKey: 'FEATURE_PRIMARY_SSL_MANAGEMENT',
    defaultValue: true,
    type: 'boolean',
    description:
      'Show the day-2 Admin → Settings → SSL page for managing the primary instance certificate and serving model. Disable when a PaaS/Traefik edge terminates SSL.',
    category: 'features',
    exposeToClient: true,
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && pnpm test -- feature-flags.definitions.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/feature-flags/feature-flags.definitions.ts apps/backend/src/feature-flags/feature-flags.definitions.spec.ts
git commit -m "feat(ssl): add ENABLE_PRIMARY_SSL_MANAGEMENT feature flag"
```

---

### Task 2: `PrimarySslSnapshotService` — snapshot & restore config + certs

**Files:**
- Create: `apps/backend/src/setup/primary-ssl/primary-ssl-snapshot.service.ts`
- Test: `apps/backend/src/setup/primary-ssl/primary-ssl-snapshot.service.spec.ts`

**Interfaces:**
- Consumes: `loadInstanceConfig`, `writeInstanceConfig`, `bootstrapDir` from `../../bootstrap/instance-config`.
- Produces (all `@Injectable() PrimarySslSnapshotService`):
  - `snapshot(): void` — copies current `instance.json` + the 4 cert files into `<bootstrapDir>/ssl-snapshot/`.
  - `restore(): void` — copies the snapshot back over the live files + `instance.json`, then clears the snapshot.
  - `hasSnapshot(): boolean`.
  - `writePendingRevert(p: { deadlineMs: number; appliedAt: number }): void` — writes `<bootstrapDir>/pending-serving-revert.json`.
  - `readPendingRevert(): { deadlineMs: number; appliedAt: number } | null`.
  - `clearPendingRevert(): void`.
  - Static/DI seam: cert dir via `process.env.SSL_CERT_PATH || '/etc/nginx/ssl'`; snapshot + pending files under `bootstrapDir()`.

- [ ] **Step 1: Write the failing test**

```ts
// primary-ssl-snapshot.service.spec.ts
import { PrimarySslSnapshotService } from './primary-ssl-snapshot.service';
import { writeInstanceConfig, loadInstanceConfig } from '../../bootstrap/instance-config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('PrimarySslSnapshotService', () => {
  let dir: string; let sslDir: string; let svc: PrimarySslSnapshotService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-'));
    sslDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssl-'));
    process.env.BOOTSTRAP_DIR = dir;
    process.env.SSL_CERT_PATH = sslDir;
    writeInstanceConfig({ version: 2, state: 'applied', primaryDomain: 'a.com', proxyMode: 'none', sslMode: 'paste', port80: 'redirect', realIp: null }, dir);
    for (const f of ['fullchain.pem', 'privkey.pem', 'wildcard.a.com.crt', 'wildcard.a.com.key']) {
      fs.writeFileSync(path.join(sslDir, f), `ORIG-${f}`);
    }
    svc = new PrimarySslSnapshotService();
  });
  afterEach(() => { delete process.env.BOOTSTRAP_DIR; delete process.env.SSL_CERT_PATH; });

  it('snapshots then restores the instance config and cert bytes', () => {
    svc.snapshot();
    expect(svc.hasSnapshot()).toBe(true);
    // mutate live state
    writeInstanceConfig({ version: 2, state: 'applied', primaryDomain: 'a.com', proxyMode: 'cloudflare', sslMode: 'letsencrypt', port80: 'closed', realIp: null }, dir);
    fs.writeFileSync(path.join(sslDir, 'fullchain.pem'), 'NEW');
    svc.restore();
    expect(loadInstanceConfig(dir)!.sslMode).toBe('paste');
    expect(fs.readFileSync(path.join(sslDir, 'fullchain.pem'), 'utf8')).toBe('ORIG-fullchain.pem');
    expect(svc.hasSnapshot()).toBe(false);
  });

  it('round-trips the pending-revert record', () => {
    expect(svc.readPendingRevert()).toBeNull();
    svc.writePendingRevert({ deadlineMs: 1000, appliedAt: 500 });
    expect(svc.readPendingRevert()).toEqual({ deadlineMs: 1000, appliedAt: 500 });
    svc.clearPendingRevert();
    expect(svc.readPendingRevert()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && pnpm test -- primary-ssl-snapshot.service.spec`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

```ts
// primary-ssl-snapshot.service.ts
import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { bootstrapDir, loadInstanceConfig, writeInstanceConfig } from '../../bootstrap/instance-config';

const CERT_FILES_STATIC = ['fullchain.pem', 'privkey.pem'];

@Injectable()
export class PrimarySslSnapshotService {
  private sslDir(): string {
    return process.env.SSL_CERT_PATH || '/etc/nginx/ssl';
  }
  private snapDir(): string {
    return path.join(bootstrapDir(), 'ssl-snapshot');
  }
  private pendingPath(): string {
    return path.join(bootstrapDir(), 'pending-serving-revert.json');
  }
  private certFiles(): string[] {
    const cfg = loadInstanceConfig();
    const d = cfg?.primaryDomain;
    return d ? [...CERT_FILES_STATIC, `wildcard.${d}.crt`, `wildcard.${d}.key`] : [...CERT_FILES_STATIC];
  }

  snapshot(): void {
    const snap = this.snapDir();
    fs.rmSync(snap, { recursive: true, force: true });
    fs.mkdirSync(snap, { recursive: true });
    const cfg = loadInstanceConfig();
    if (cfg) fs.writeFileSync(path.join(snap, 'instance.json'), JSON.stringify(cfg));
    for (const f of this.certFiles()) {
      const src = path.join(this.sslDir(), f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(snap, f));
    }
  }

  hasSnapshot(): boolean {
    return fs.existsSync(path.join(this.snapDir(), 'instance.json'));
  }

  restore(): void {
    const snap = this.snapDir();
    const cfgPath = path.join(snap, 'instance.json');
    if (!fs.existsSync(cfgPath)) return;
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    // Restore certs referenced by the SNAPSHOT's domain (before rewriting instance.json).
    const files = cfg.primaryDomain
      ? [...CERT_FILES_STATIC, `wildcard.${cfg.primaryDomain}.crt`, `wildcard.${cfg.primaryDomain}.key`]
      : [...CERT_FILES_STATIC];
    for (const f of files) {
      const src = path.join(snap, f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(this.sslDir(), f));
    }
    writeInstanceConfig(cfg);
    fs.rmSync(snap, { recursive: true, force: true });
  }

  writePendingRevert(p: { deadlineMs: number; appliedAt: number }): void {
    const tmp = this.pendingPath() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(p));
    fs.renameSync(tmp, this.pendingPath());
  }
  readPendingRevert(): { deadlineMs: number; appliedAt: number } | null {
    try {
      return JSON.parse(fs.readFileSync(this.pendingPath(), 'utf8'));
    } catch {
      return null;
    }
  }
  clearPendingRevert(): void {
    fs.rmSync(this.pendingPath(), { force: true });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && pnpm test -- primary-ssl-snapshot.service.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/setup/primary-ssl/primary-ssl-snapshot.service.ts apps/backend/src/setup/primary-ssl/primary-ssl-snapshot.service.spec.ts
git commit -m "feat(ssl): PrimarySslSnapshotService for day-2 config+cert snapshot/restore"
```

---

### Task 3: `primary-ssl.dto.ts` — request DTOs

**Files:**
- Create: `apps/backend/src/setup/primary-ssl/primary-ssl.dto.ts`
- Test: `apps/backend/src/setup/primary-ssl/primary-ssl.dto.spec.ts`

**Interfaces:**
- Produces: `PrimarySslPasteDto`, `PrimarySslApplyDto`, `PrimarySslDomainActionDto` (mirror the bootstrap DTOs minus `token`; day-2 auth is the session guard).

- [ ] **Step 1: Write the failing test**

```ts
// primary-ssl.dto.spec.ts
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrimarySslApplyDto, PrimarySslPasteDto } from './primary-ssl.dto';

describe('PrimarySslApplyDto', () => {
  it('rejects an unknown sslMode', () => {
    const dto = plainToInstance(PrimarySslApplyDto, { proxyMode: 'none', sslMode: 'bogus' });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });
  it('accepts a valid serving config', () => {
    const dto = plainToInstance(PrimarySslApplyDto, { proxyMode: 'proxy', sslMode: 'selfsigned', port80: 'redirect' });
    expect(validateSync(dto)).toHaveLength(0);
  });
});

describe('PrimarySslPasteDto', () => {
  it('requires cert + key', () => {
    const dto = plainToInstance(PrimarySslPasteDto, { certificatePem: '', privateKeyPem: '' });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && pnpm test -- primary-ssl.dto.spec`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the DTOs**

```ts
// primary-ssl.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty, IsArray, IsIn, IsNotEmpty, IsOptional, IsString, ValidateNested,
} from 'class-validator';

class PrimaryRealIpDto {
  @IsString() @IsNotEmpty() header: string;
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) ranges: string[];
}

export class PrimarySslApplyDto {
  @ApiProperty({ enum: ['cloudflare', 'proxy', 'none'] })
  @IsIn(['cloudflare', 'proxy', 'none'])
  proxyMode: 'cloudflare' | 'proxy' | 'none';

  @ApiProperty({ enum: ['paste', 'letsencrypt', 'selfsigned'] })
  @IsIn(['paste', 'letsencrypt', 'selfsigned'])
  sslMode: 'paste' | 'letsencrypt' | 'selfsigned';

  @ApiProperty({ required: false, enum: ['closed', 'redirect'] })
  @IsOptional() @IsIn(['closed', 'redirect'])
  port80?: 'closed' | 'redirect';

  @ApiProperty({ required: false, type: PrimaryRealIpDto })
  @IsOptional() @ValidateNested() @Type(() => PrimaryRealIpDto)
  realIp?: PrimaryRealIpDto;
}

export class PrimarySslPasteDto {
  @ApiProperty() @IsString() @IsNotEmpty() certificatePem: string;
  @ApiProperty() @IsString() @IsNotEmpty() privateKeyPem: string;
  @ApiProperty({ enum: ['cloudflare', 'proxy', 'none'] })
  @IsIn(['cloudflare', 'proxy', 'none'])
  servingMode: 'cloudflare' | 'proxy' | 'none';
}

export class PrimarySslDomainActionDto {
  // Day-2 always operates on the fixed primary domain; body is empty but kept
  // for symmetry/future use.
}
```

Note: the apply/paste DTOs deliberately omit `domain` and `token` — the day-2 flow reads the fixed `primaryDomain` from `instance.json` server-side, and auth is the session guard.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && pnpm test -- primary-ssl.dto.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/setup/primary-ssl/primary-ssl.dto.ts apps/backend/src/setup/primary-ssl/primary-ssl.dto.spec.ts
git commit -m "feat(ssl): day-2 primary-ssl request DTOs"
```

---

### Task 4: `PrimarySslService` — status, platform guard, preflight, stage-paste

**Files:**
- Create: `apps/backend/src/setup/primary-ssl/primary-ssl.service.ts`
- Test: `apps/backend/src/setup/primary-ssl/primary-ssl.service.spec.ts`

**Interfaces:**
- Consumes: `BootstrapSetupService`, `SslCertificateService`, `BootstrapDnsPreflightService`, `SslInfoService`, `PrimarySslSnapshotService`; `loadInstanceConfig` from instance-config.
- Produces (`@Injectable() PrimarySslService`):
  - `assertEnabled(): void` — throws `ForbiddenException` when platform/external-SSL.
  - `getStatus(): Promise<PrimarySslStatus>` where `PrimarySslStatus = { domain: string | null; proxyMode; sslMode; port80; realIp; cert: SslCertificateInfo | null; wildcardCovered: boolean; pendingRevert: { deadlineMs: number } | null }`.
  - `preflight(): Promise<PreflightResult>` — reads the fixed domain, calls `BootstrapDnsPreflightService.run`.
  - `stagePaste(dto: PrimarySslPasteDto): { sans: string[]; wildcardCovered: boolean }` — validates + saves the cert files for the fixed domain (does NOT touch instance.json).

- [ ] **Step 1: Write the failing test**

```ts
// primary-ssl.service.spec.ts
import { ForbiddenException } from '@nestjs/common';
import { PrimarySslService } from './primary-ssl.service';

const domain = 'a.com';
const makeDeps = () => ({
  bootstrap: {
    validateCertificatePair: jest.fn().mockReturnValue({ sans: ['a.com', '*.a.com'], wildcardCovered: true }),
    saveCertificates: jest.fn(),
    validateApplyConfig: jest.fn((d) => ({ proxyMode: d.proxyMode, sslMode: d.sslMode, port80: d.port80 ?? 'redirect', realIp: d.realIp ?? null })),
    certificatesPresent: jest.fn().mockReturnValue(true),
    assertStagedCertificateCovers: jest.fn(),
  },
  ssl: { requestPrimaryDomainCertificate: jest.fn() },
  preflight: { run: jest.fn().mockResolvedValue({ ok: true, checks: [] }) },
  info: { getWildcardCertInfo: jest.fn().mockResolvedValue({ type: 'wildcard', expiresAt: new Date(), isValid: true }) },
  snap: { snapshot: jest.fn(), restore: jest.fn(), hasSnapshot: jest.fn().mockReturnValue(false), writePendingRevert: jest.fn(), readPendingRevert: jest.fn().mockReturnValue(null), clearPendingRevert: jest.fn() },
});

jest.mock('../../bootstrap/instance-config', () => ({
  loadInstanceConfig: () => ({ version: 2, state: 'applied', primaryDomain: 'a.com', proxyMode: 'none', sslMode: 'paste', port80: 'redirect', realIp: null }),
  writeInstanceConfig: jest.fn(),
}));

const build = () => { const d = makeDeps(); return { d, svc: new PrimarySslService(d.bootstrap as any, d.ssl as any, d.preflight as any, d.info as any, d.snap as any) }; };

describe('PrimarySslService', () => {
  afterEach(() => { delete process.env.PLATFORM_MODE; delete process.env.SSL_MANAGED_EXTERNALLY; });

  it('assertEnabled throws in platform mode', () => {
    process.env.PLATFORM_MODE = 'true';
    const { svc } = build();
    expect(() => svc.assertEnabled()).toThrow(ForbiddenException);
  });

  it('getStatus returns the fixed domain + knobs + cert info', async () => {
    const { svc } = build();
    const s = await svc.getStatus();
    expect(s.domain).toBe(domain);
    expect(s.sslMode).toBe('paste');
    expect(s.cert).not.toBeNull();
  });

  it('stagePaste validates then saves for the fixed domain', () => {
    const { d, svc } = build();
    const res = svc.stagePaste({ certificatePem: 'C', privateKeyPem: 'K', servingMode: 'none' } as any);
    expect(d.bootstrap.validateCertificatePair).toHaveBeenCalledWith('C', 'K', domain, 'none');
    expect(d.bootstrap.saveCertificates).toHaveBeenCalledWith('C', 'K', domain);
    expect(res.wildcardCovered).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && pnpm test -- primary-ssl.service.spec`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement status/guard/preflight/stagePaste** (apply/confirm/rollback come in Task 5)

```ts
// primary-ssl.service.ts  (Task 4 portion)
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { BootstrapSetupService } from '../bootstrap-setup.service';
import { SslCertificateService } from '../../domains/ssl-certificate.service';
import { BootstrapDnsPreflightService, PreflightResult } from '../bootstrap-dns-preflight.service';
import { SslInfoService, SslCertificateInfo } from '../../domains/ssl-info.service';
import { PrimarySslSnapshotService } from './primary-ssl-snapshot.service';
import { loadInstanceConfig, ProxyMode } from '../../bootstrap/instance-config';
import { PrimarySslPasteDto } from './primary-ssl.dto';

export interface PrimarySslStatus {
  domain: string | null;
  proxyMode: string | null;
  sslMode: string | null;
  port80: string | null;
  realIp: unknown;
  cert: SslCertificateInfo | null;
  wildcardCovered: boolean;
  pendingRevert: { deadlineMs: number } | null;
}

@Injectable()
export class PrimarySslService {
  constructor(
    private readonly bootstrap: BootstrapSetupService,
    private readonly ssl: SslCertificateService,
    private readonly preflightSvc: BootstrapDnsPreflightService,
    private readonly info: SslInfoService,
    private readonly snap: PrimarySslSnapshotService,
  ) {}

  assertEnabled(): void {
    if (process.env.PLATFORM_MODE === 'true' || process.env.SSL_MANAGED_EXTERNALLY === 'true') {
      throw new ForbiddenException('Primary SSL management is disabled when SSL is handled at the platform edge');
    }
  }

  private requireDomain(): string {
    const cfg = loadInstanceConfig();
    if (!cfg?.primaryDomain) {
      throw new BadRequestException('No primary domain is configured yet');
    }
    return cfg.primaryDomain;
  }

  async getStatus(): Promise<PrimarySslStatus> {
    this.assertEnabled();
    const cfg = loadInstanceConfig();
    const cert = await this.info.getWildcardCertInfo().catch(() => null);
    const pending = this.snap.readPendingRevert();
    return {
      domain: cfg?.primaryDomain ?? null,
      proxyMode: cfg?.proxyMode ?? null,
      sslMode: cfg?.sslMode ?? null,
      port80: cfg?.port80 ?? null,
      realIp: cfg?.realIp ?? null,
      cert,
      wildcardCovered: !!cert,
      pendingRevert: pending ? { deadlineMs: pending.deadlineMs } : null,
    };
  }

  async preflight(): Promise<PreflightResult> {
    this.assertEnabled();
    return this.preflightSvc.run(this.requireDomain());
  }

  stagePaste(dto: PrimarySslPasteDto): { sans: string[]; wildcardCovered: boolean } {
    this.assertEnabled();
    const domain = this.requireDomain();
    const result = this.bootstrap.validateCertificatePair(
      dto.certificatePem, dto.privateKeyPem, domain, dto.servingMode as ProxyMode,
    );
    this.bootstrap.saveCertificates(dto.certificatePem, dto.privateKeyPem, domain);
    return result;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && pnpm test -- primary-ssl.service.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/setup/primary-ssl/primary-ssl.service.ts apps/backend/src/setup/primary-ssl/primary-ssl.service.spec.ts
git commit -m "feat(ssl): PrimarySslService status/preflight/stage-paste + platform guard"
```

---

### Task 5: `PrimarySslService` — issueLetsEncrypt, apply (classify), confirm, rollback

**Files:**
- Modify: `apps/backend/src/setup/primary-ssl/primary-ssl.service.ts`
- Modify test: `apps/backend/src/setup/primary-ssl/primary-ssl.service.spec.ts`

**Interfaces:**
- Produces (added to `PrimarySslService`):
  - `issueLetsEncrypt(): Promise<{ issued: boolean; sans: string[] }>` — preflight → `requestPrimaryDomainCertificate` (issue-then-swap: the service only overwrites cert files on success). Snapshots the current cert first.
  - `apply(dto: PrimarySslApplyDto): Promise<{ applied: true; kind: 'cert-only' | 'serving'; deadlineMs?: number }>` — classifies the change vs current `instance.json`; snapshots; writes new `instance.json`; for `serving` changes writes a pending-revert with a deadline.
  - `confirm(): void` — clears the pending revert (commit).
  - `rollback(): void` — restores the snapshot; clears any pending revert.
  - `isReachabilityChange(cur, next): boolean` — `proxyMode`/`port80`/`realIp` differ.

- [ ] **Step 1: Write the failing tests (append)**

```ts
// append to primary-ssl.service.spec.ts
describe('PrimarySslService.apply classification', () => {
  it('cert-only change writes config, no pending revert', async () => {
    const { d, svc } = build();
    const r = await svc.apply({ proxyMode: 'none', sslMode: 'letsencrypt', port80: 'redirect', realIp: undefined } as any);
    expect(r.kind).toBe('cert-only');
    expect(d.snap.snapshot).toHaveBeenCalled();
    expect(d.snap.writePendingRevert).not.toHaveBeenCalled();
  });

  it('serving change writes a pending revert with a deadline', async () => {
    process.env.SSL_SERVING_CONFIRM_TIMEOUT_MS = '1000';
    const { d, svc } = build();
    const r = await svc.apply({ proxyMode: 'cloudflare', sslMode: 'paste', port80: 'redirect', realIp: undefined } as any);
    expect(r.kind).toBe('serving');
    expect(d.snap.writePendingRevert).toHaveBeenCalled();
    expect(typeof r.deadlineMs).toBe('number');
    delete process.env.SSL_SERVING_CONFIRM_TIMEOUT_MS;
  });

  it('rejects a second apply while a serving revert is pending', async () => {
    const { d, svc } = build();
    d.snap.readPendingRevert.mockReturnValue({ deadlineMs: Date.now() + 1000, appliedAt: Date.now() });
    await expect(svc.apply({ proxyMode: 'none', sslMode: 'paste' } as any)).rejects.toThrow();
  });

  it('confirm clears the pending revert; rollback restores', () => {
    const { d, svc } = build();
    svc.confirm();
    expect(d.snap.clearPendingRevert).toHaveBeenCalled();
    svc.rollback();
    expect(d.snap.restore).toHaveBeenCalled();
  });
});

describe('PrimarySslService.issueLetsEncrypt', () => {
  it('snapshots, preflights, then requests the cert', async () => {
    const { d, svc } = build();
    d.ssl.requestPrimaryDomainCertificate.mockResolvedValue({ success: true, sans: ['a.com'] });
    const r = await svc.issueLetsEncrypt();
    expect(d.snap.snapshot).toHaveBeenCalled();
    expect(d.preflight.run).toHaveBeenCalledWith('a.com');
    expect(d.ssl.requestPrimaryDomainCertificate).toHaveBeenCalledWith('a.com');
    expect(r.issued).toBe(true);
  });
  it('throws when preflight fails, without requesting a cert', async () => {
    const { d, svc } = build();
    d.preflight.run.mockResolvedValue({ ok: false, checks: [] });
    await expect(svc.issueLetsEncrypt()).rejects.toThrow();
    expect(d.ssl.requestPrimaryDomainCertificate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && pnpm test -- primary-ssl.service.spec`
Expected: FAIL — methods undefined.

- [ ] **Step 3: Implement the methods (append to the class)**

Add the import and methods:

```ts
// top of file: add to existing imports
import { writeInstanceConfig, InstanceConfig } from '../../bootstrap/instance-config';
import { PrimarySslApplyDto } from './primary-ssl.dto';

// inside PrimarySslService:
private confirmTimeoutMs(): number {
  return Number(process.env.SSL_SERVING_CONFIRM_TIMEOUT_MS) || 300000;
}

isReachabilityChange(
  cur: Pick<InstanceConfig, 'proxyMode' | 'port80' | 'realIp'>,
  next: Pick<InstanceConfig, 'proxyMode' | 'port80' | 'realIp'>,
): boolean {
  return (
    cur.proxyMode !== next.proxyMode ||
    (cur.port80 ?? null) !== (next.port80 ?? null) ||
    JSON.stringify(cur.realIp ?? null) !== JSON.stringify(next.realIp ?? null)
  );
}

async issueLetsEncrypt(): Promise<{ issued: boolean; sans: string[] }> {
  this.assertEnabled();
  const domain = this.requireDomain();
  this.snap.snapshot();
  const pre = await this.preflightSvc.run(domain);
  if (!pre.ok) {
    throw new BadRequestException('DNS/port-80 preflight failed; not requesting a certificate');
  }
  const res = await this.ssl.requestPrimaryDomainCertificate(domain);
  if (!res.success) {
    throw new BadRequestException(res.error || 'Certificate issuance failed');
  }
  return { issued: true, sans: res.sans ?? [] };
}

async apply(dto: PrimarySslApplyDto): Promise<{ applied: true; kind: 'cert-only' | 'serving'; deadlineMs?: number }> {
  this.assertEnabled();
  if (this.snap.readPendingRevert()) {
    throw new BadRequestException('A serving change is pending confirmation; confirm or roll it back first');
  }
  const cur = loadInstanceConfig();
  if (!cur?.primaryDomain) throw new BadRequestException('No primary domain is configured yet');

  // validateApplyConfig expects the bootstrap ApplyBootstrapDto shape; supply the fixed domain.
  const applied = this.bootstrap.validateApplyConfig({ ...dto, domain: cur.primaryDomain } as any);

  // Every non-selfsigned mode must have staged certs present + covering the domain.
  if (applied.sslMode !== 'selfsigned') {
    if (!this.bootstrap.certificatesPresent(cur.primaryDomain)) {
      throw new BadRequestException('Install a certificate before applying');
    }
    this.bootstrap.assertStagedCertificateCovers(cur.primaryDomain, applied.proxyMode);
  }

  const next: InstanceConfig = {
    version: 2,
    state: 'applied',
    primaryDomain: cur.primaryDomain,
    proxyMode: applied.proxyMode,
    sslMode: applied.sslMode,
    port80: applied.port80,
    realIp: applied.realIp,
  };
  const serving = this.isReachabilityChange(cur, next);

  this.snap.snapshot();
  writeInstanceConfig(next); // watcher re-renders main.conf + reloads (~3s); no restart

  if (serving) {
    const deadlineMs = Date.now() + this.confirmTimeoutMs();
    this.snap.writePendingRevert({ deadlineMs, appliedAt: Date.now() });
    return { applied: true, kind: 'serving', deadlineMs };
  }
  return { applied: true, kind: 'cert-only' };
}

confirm(): void {
  this.assertEnabled();
  this.snap.clearPendingRevert();
}

rollback(): void {
  this.assertEnabled();
  this.snap.clearPendingRevert();
  this.snap.restore();
}
```

Note: `writeInstanceConfig(next)` is called in `apply`; `issueLetsEncrypt` does NOT write instance.json (cert-source-only; the subsequent `apply` with `sslMode:'letsencrypt'` persists the mode). This keeps issuance and mode-commit separate, matching the wizard.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && pnpm test -- primary-ssl.service.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/setup/primary-ssl/primary-ssl.service.ts apps/backend/src/setup/primary-ssl/primary-ssl.service.spec.ts
git commit -m "feat(ssl): day-2 LE issuance + apply classification + confirm/rollback"
```

---

### Task 6: `PrimarySslRevertService` — auto-revert interval

**Files:**
- Create: `apps/backend/src/setup/primary-ssl/primary-ssl-revert.service.ts`
- Test: `apps/backend/src/setup/primary-ssl/primary-ssl-revert.service.spec.ts`

**Interfaces:**
- Consumes: `PrimarySslSnapshotService`.
- Produces (`@Injectable() PrimarySslRevertService`): `checkAndRevert(nowMs: number): void` (pure, testable) invoked by an `@Interval(15000)` wrapper `tick()`. Reverts + clears when `now > deadlineMs`.

- [ ] **Step 1: Write the failing test**

```ts
// primary-ssl-revert.service.spec.ts
import { PrimarySslRevertService } from './primary-ssl-revert.service';

const makeSnap = (pending: any) => ({
  readPendingRevert: jest.fn().mockReturnValue(pending),
  restore: jest.fn(),
  clearPendingRevert: jest.fn(),
});

describe('PrimarySslRevertService', () => {
  it('reverts when the deadline has passed', () => {
    const snap = makeSnap({ deadlineMs: 1000, appliedAt: 0 });
    new PrimarySslRevertService(snap as any).checkAndRevert(2000);
    expect(snap.restore).toHaveBeenCalled();
    expect(snap.clearPendingRevert).toHaveBeenCalled();
  });
  it('does nothing before the deadline', () => {
    const snap = makeSnap({ deadlineMs: 5000, appliedAt: 0 });
    new PrimarySslRevertService(snap as any).checkAndRevert(2000);
    expect(snap.restore).not.toHaveBeenCalled();
  });
  it('does nothing when there is no pending revert', () => {
    const snap = makeSnap(null);
    new PrimarySslRevertService(snap as any).checkAndRevert(2000);
    expect(snap.restore).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && pnpm test -- primary-ssl-revert.service.spec`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

```ts
// primary-ssl-revert.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrimarySslSnapshotService } from './primary-ssl-snapshot.service';

@Injectable()
export class PrimarySslRevertService {
  private readonly logger = new Logger(PrimarySslRevertService.name);
  constructor(private readonly snap: PrimarySslSnapshotService) {}

  @Interval(15000)
  tick(): void {
    this.checkAndRevert(Date.now());
  }

  checkAndRevert(nowMs: number): void {
    const pending = this.snap.readPendingRevert();
    if (!pending) return;
    if (nowMs <= pending.deadlineMs) return;
    this.logger.warn('[primary-ssl] serving change unconfirmed past deadline — auto-reverting');
    try {
      this.snap.restore();
    } finally {
      this.snap.clearPendingRevert();
    }
  }
}
```

Note: `checkAndRevert` uses `Date.now()` via `tick()` only; the pure method takes `nowMs` so tests never touch the clock. Confirm `@nestjs/schedule`'s `ScheduleModule.forRoot()` is already imported in `AppModule` (it is — `ssl-renewal.service.ts` uses cron); if a test complains about missing `SchedulerRegistry`, the pure `checkAndRevert` test above doesn't instantiate the interval, so it's unaffected.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && pnpm test -- primary-ssl-revert.service.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/setup/primary-ssl/primary-ssl-revert.service.ts apps/backend/src/setup/primary-ssl/primary-ssl-revert.service.spec.ts
git commit -m "feat(ssl): auto-revert interval for unconfirmed serving changes"
```

---

### Task 7: `PrimarySslController` + module wiring

**Files:**
- Create: `apps/backend/src/setup/primary-ssl/primary-ssl.controller.ts`
- Test: `apps/backend/src/setup/primary-ssl/primary-ssl.controller.spec.ts`
- Modify: `apps/backend/src/setup/setup.module.ts`

**Interfaces:**
- Consumes: `PrimarySslService`.
- Produces routes under `api/admin/ssl`: `GET status`, `POST preflight`, `POST certificate`, `POST letsencrypt`, `POST apply`, `POST confirm`, `POST rollback`. All behind `SessionAuthGuard, RolesGuard, FeatureFlagGuard` + `@Roles('admin')` + `@RequireFeatureFlags('ENABLE_PRIMARY_SSL_MANAGEMENT')`.

- [ ] **Step 1: Write the failing test**

```ts
// primary-ssl.controller.spec.ts
import { PrimarySslController } from './primary-ssl.controller';

const makeSvc = () => ({
  getStatus: jest.fn().mockResolvedValue({ domain: 'a.com' }),
  preflight: jest.fn().mockResolvedValue({ ok: true, checks: [] }),
  stagePaste: jest.fn().mockReturnValue({ sans: [], wildcardCovered: true }),
  issueLetsEncrypt: jest.fn().mockResolvedValue({ issued: true, sans: [] }),
  apply: jest.fn().mockResolvedValue({ applied: true, kind: 'cert-only' }),
  confirm: jest.fn(),
  rollback: jest.fn(),
});

describe('PrimarySslController', () => {
  it('delegates each route to the service', async () => {
    const svc = makeSvc();
    const c = new PrimarySslController(svc as any);
    expect(await c.status()).toEqual({ domain: 'a.com' });
    await c.preflight();
    c.certificate({ certificatePem: 'C', privateKeyPem: 'K', servingMode: 'none' } as any);
    await c.letsencrypt();
    await c.apply({ proxyMode: 'none', sslMode: 'paste' } as any);
    c.confirm();
    c.rollback();
    expect(svc.preflight).toHaveBeenCalled();
    expect(svc.stagePaste).toHaveBeenCalled();
    expect(svc.issueLetsEncrypt).toHaveBeenCalled();
    expect(svc.apply).toHaveBeenCalled();
    expect(svc.confirm).toHaveBeenCalled();
    expect(svc.rollback).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && pnpm test -- primary-ssl.controller.spec`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the controller**

```ts
// primary-ssl.controller.ts
import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SessionAuthGuard } from '../../auth/session-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { FeatureFlagGuard, RequireFeatureFlags } from '../../feature-flags';
import { PrimarySslService } from './primary-ssl.service';
import { PrimarySslApplyDto, PrimarySslPasteDto } from './primary-ssl.dto';

@ApiTags('Admin - Primary SSL')
@Controller('api/admin/ssl')
@UseGuards(SessionAuthGuard, RolesGuard, FeatureFlagGuard)
@Roles('admin')
@RequireFeatureFlags('ENABLE_PRIMARY_SSL_MANAGEMENT')
export class PrimarySslController {
  constructor(private readonly svc: PrimarySslService) {}

  @Get('status')
  status() { return this.svc.getStatus(); }

  @Post('preflight')
  @HttpCode(HttpStatus.OK)
  preflight() { return this.svc.preflight(); }

  @Post('certificate')
  @HttpCode(HttpStatus.OK)
  certificate(@Body() dto: PrimarySslPasteDto) { return this.svc.stagePaste(dto); }

  @Post('letsencrypt')
  @HttpCode(HttpStatus.OK)
  letsencrypt() { return this.svc.issueLetsEncrypt(); }

  @Post('apply')
  @HttpCode(HttpStatus.OK)
  apply(@Body() dto: PrimarySslApplyDto) { return this.svc.apply(dto); }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  confirm() { this.svc.confirm(); return { confirmed: true }; }

  @Post('rollback')
  @HttpCode(HttpStatus.OK)
  rollback() { this.svc.rollback(); return { rolledBack: true }; }
}
```

- [ ] **Step 4: Wire into `setup.module.ts`**

Import `DomainsModule` (provides `SslInfoService`) and register the new controller + services:

```ts
// setup.module.ts
import { DomainsModule } from '../domains/domains.module';
import { PrimarySslController } from './primary-ssl/primary-ssl.controller';
import { PrimarySslService } from './primary-ssl/primary-ssl.service';
import { PrimarySslSnapshotService } from './primary-ssl/primary-ssl-snapshot.service';
import { PrimarySslRevertService } from './primary-ssl/primary-ssl-revert.service';

@Module({
  imports: [EmailModule, AuthModule, FeatureFlagsModule, DomainsModule],
  controllers: [SetupController, BootstrapSetupController, PrimarySslController],
  providers: [
    SetupService, BootstrapSetupService, BootstrapDnsPreflightService, SslCertificateService,
    PrimarySslService, PrimarySslSnapshotService, PrimarySslRevertService,
  ],
  exports: [SetupService],
})
export class SetupModule {}
```

`DomainsModule` already provides **and exports** `SslInfoService` (`domains.module.ts` — verified), and does not import `SetupModule`, so importing it here is safe and needs no edit to `domains.module.ts`. (If a future refactor introduces a circular import, fall back to adding `SslInfoService` directly to this module's `providers`.)

- [ ] **Step 5: Run tests + build to verify**

Run: `cd apps/backend && pnpm test -- primary-ssl.controller.spec && pnpm exec tsc --noEmit`
Expected: PASS + clean typecheck (resolves the module wiring).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/setup/primary-ssl/primary-ssl.controller.ts apps/backend/src/setup/primary-ssl/primary-ssl.controller.spec.ts apps/backend/src/setup/setup.module.ts
git commit -m "feat(ssl): PrimarySslController (api/admin/ssl) + module wiring"
```

---

### Task 8: Extract presentational leaf components (shared, prop-driven)

**Files:**
- Create: `apps/frontend/src/components/ssl-leaves/ServingChoiceCards.tsx`
- Create: `apps/frontend/src/components/ssl-leaves/Port80Choice.tsx`
- Create: `apps/frontend/src/components/ssl-leaves/RealIpFields.tsx`
- Create: `apps/frontend/src/components/ssl-leaves/PasteCertificateFields.tsx`
- Test: `apps/frontend/src/components/ssl-leaves/__tests__/leaves.test.tsx`

**Interfaces:**
- Produces prop-driven components (no Redux, no API):
  - `ServingChoiceCards({ value, onChange }: { value: ServingMode | null; onChange: (m: ServingMode) => void })`
  - `Port80Choice({ value, onChange }: { value: 'closed' | 'redirect'; onChange: (v: 'closed' | 'redirect') => void })`
  - `RealIpFields({ header, ranges, onChange }: { header: string; ranges: string; onChange: (v: { header: string; ranges: string }) => void })`
  - `PasteCertificateFields({ certificatePem, privateKeyPem, onChange }: { certificatePem: string; privateKeyPem: string; onChange: (v: { certificatePem: string; privateKeyPem: string }) => void })`
  - Type: `export type ServingMode = 'cloudflare' | 'proxy' | 'none'` (re-exported for leaf consumers).

- [ ] **Step 1: Write the failing test**

```tsx
// leaves.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ServingChoiceCards } from '../ServingChoiceCards';
import { PasteCertificateFields } from '../PasteCertificateFields';

describe('ssl leaves', () => {
  it('ServingChoiceCards fires onChange with the picked mode', () => {
    const onChange = vi.fn();
    render(<ServingChoiceCards value={null} onChange={onChange} />);
    fireEvent.click(screen.getByText(/Cloudflare/i));
    expect(onChange).toHaveBeenCalledWith('cloudflare');
  });
  it('PasteCertificateFields reports typed cert + key', () => {
    const onChange = vi.fn();
    render(<PasteCertificateFields certificatePem="" privateKeyPem="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/certificate/i), { target: { value: 'CERT' } });
    expect(onChange).toHaveBeenCalledWith({ certificatePem: 'CERT', privateKeyPem: '' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && pnpm test -- leaves.test`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the leaves**

Move the JSX bodies out of the wizard components. For each leaf, copy the exact markup currently inside `ServingChoicePhase.tsx` (the serving-choice cards), `ProxyOptions.tsx` (port-80 radio + real-IP inputs), and `PasteCertificateForm.tsx` (the two textareas), converting `useSelector`/`dispatch` to `value`/`onChange` props. Example (`PasteCertificateFields.tsx`):

```tsx
// PasteCertificateFields.tsx
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface PasteCertificateFieldsValue {
  certificatePem: string;
  privateKeyPem: string;
}
export function PasteCertificateFields({
  certificatePem, privateKeyPem, onChange,
}: PasteCertificateFieldsValue & { onChange: (v: PasteCertificateFieldsValue) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="cert-pem">Certificate (PEM)</Label>
        <Textarea id="cert-pem" rows={6} value={certificatePem}
          onChange={(e) => onChange({ certificatePem: e.target.value, privateKeyPem })} />
      </div>
      <div>
        <Label htmlFor="key-pem">Private key (PEM)</Label>
        <Textarea id="key-pem" rows={6} value={privateKeyPem}
          onChange={(e) => onChange({ certificatePem, privateKeyPem: e.target.value })} />
      </div>
    </div>
  );
}
```

Implement `ServingChoiceCards.tsx`, `Port80Choice.tsx`, `RealIpFields.tsx` the same way — pure props, no store. Export `ServingMode` from `ServingChoiceCards.tsx`. (Preserve the exact card copy/labels from the current wizard so the UI is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && pnpm test -- leaves.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/ssl-leaves/
git commit -m "feat(ssl): extract prop-driven SSL leaf components"
```

---

### Task 9: Rewire the wizard components to consume the leaves (behavior unchanged)

**Files:**
- Modify: `apps/frontend/src/components/setup/domain-ssl/ServingChoicePhase.tsx`
- Modify: `apps/frontend/src/components/setup/domain-ssl/ProxyOptions.tsx`
- Modify: `apps/frontend/src/components/setup/domain-ssl/PasteCertificateForm.tsx`
- Test: existing `apps/frontend/src/components/setup/__tests__/CertificatePhase.test.tsx`, `DomainSslStep.test.tsx` (must still pass unchanged)

**Interfaces:**
- Consumes: leaves from Task 8.
- Produces: no external interface change — the wizard containers keep their `setup.wizard` slice wiring; only their inner JSX is replaced by the leaf.

- [ ] **Step 1: Run the existing wizard tests as the guardrail (should currently pass)**

Run: `cd apps/frontend && pnpm test -- CertificatePhase.test DomainSslStep.test SetupWizard.bootstrap.test`
Expected: PASS (baseline before edits).

- [ ] **Step 2: Rewire each container**

In `ServingChoicePhase.tsx`, replace the inline serving-choice card JSX with:

```tsx
import { ServingChoiceCards } from '@/components/ssl-leaves/ServingChoiceCards';
// ...inside render, where the cards were:
<ServingChoiceCards
  value={servingMode}
  onChange={(mode) => { dispatch(setServingMode(mode)); /* keep existing setBootstrapSslMode side-effects handled by setServingMode reducer */ }}
/>
```

In `ProxyOptions.tsx`, replace the port-80 radio + real-IP inputs with `<Port80Choice .../>` and `<RealIpFields .../>`, mapping their `onChange` to the existing `dispatch(setBootstrapPort80(...))` / `dispatch(setBootstrapRealIp(...))` calls (preserve the current `validateRealIp` gating).

In `PasteCertificateForm.tsx`, replace the two inline textareas with `<PasteCertificateFields certificatePem={cert} privateKeyPem={key} onChange={({certificatePem, privateKeyPem}) => { setCert(certificatePem); setKey(privateKeyPem); }} />` (keep the existing local `useState` for cert/key and the `useUploadCertificatesMutation` submit).

- [ ] **Step 3: Run the guardrail tests — they must still pass**

Run: `cd apps/frontend && pnpm test -- CertificatePhase.test DomainSslStep.test SetupWizard.bootstrap.test`
Expected: PASS (behavior unchanged). If a test queries by an element the leaf renamed, update the leaf to preserve the original label/text rather than changing the test — the wizard UI must be byte-identical.

- [ ] **Step 4: Typecheck**

Run: `cd apps/frontend && pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/setup/domain-ssl/
git commit -m "refactor(ssl): wizard SSL components consume shared leaves (no behavior change)"
```

---

### Task 10: `primarySslApi.ts` — RTK Query endpoints + cache tag

**Files:**
- Create: `apps/frontend/src/services/primarySslApi.ts`
- Modify: `apps/frontend/src/services/api.ts` (add `'PrimarySsl'` to `tagTypes`)
- Test: `apps/frontend/src/services/__tests__/primarySslApi.test.ts`

**Interfaces:**
- Produces hooks: `useGetPrimarySslStatusQuery`, `usePrimarySslPreflightMutation`, `useStagePrimaryCertificateMutation`, `useIssuePrimaryLetsEncryptMutation`, `useApplyPrimarySslMutation`, `useConfirmPrimarySslMutation`, `useRollbackPrimarySslMutation`.
- Types: `PrimarySslStatus`, `PrimarySslApplyBody`, `PrimarySslPasteBody`, `PreflightResult` (mirror backend).

- [ ] **Step 1: Write the failing test**

```ts
// primarySslApi.test.ts
import { primarySslApi } from '../primarySslApi';

describe('primarySslApi', () => {
  it('exposes the day-2 SSL endpoints', () => {
    const e = primarySslApi.endpoints;
    expect(e.getPrimarySslStatus).toBeDefined();
    expect(e.applyPrimarySsl).toBeDefined();
    expect(e.rollbackPrimarySsl).toBeDefined();
    expect(e.confirmPrimarySsl).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && pnpm test -- primarySslApi.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the tag + implement the endpoints**

In `api.ts`, append `'PrimarySsl'` to the `tagTypes` array. Then:

```ts
// primarySslApi.ts
import { api } from './api';

export interface PrimarySslStatus {
  domain: string | null;
  proxyMode: 'cloudflare' | 'proxy' | 'none' | null;
  sslMode: 'paste' | 'letsencrypt' | 'selfsigned' | null;
  port80: 'closed' | 'redirect' | null;
  realIp: { header: string; ranges: string[] } | { preset: 'cloudflare' } | null;
  cert: { commonName: string; issuer: string; expiresAt: string; daysUntilExpiry: number; isValid: boolean } | null;
  wildcardCovered: boolean;
  pendingRevert: { deadlineMs: number } | null;
}
export interface PrimarySslApplyBody {
  proxyMode: 'cloudflare' | 'proxy' | 'none';
  sslMode: 'paste' | 'letsencrypt' | 'selfsigned';
  port80?: 'closed' | 'redirect';
  realIp?: { header: string; ranges: string[] };
}
export interface PrimarySslPasteBody {
  certificatePem: string; privateKeyPem: string;
  servingMode: 'cloudflare' | 'proxy' | 'none';
}
export interface PreflightResult {
  ok: boolean;
  checks: { host: string; resolvedIps: string[]; probeOk: boolean; error?: string }[];
}

export const primarySslApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getPrimarySslStatus: builder.query<PrimarySslStatus, void>({
      query: () => '/api/admin/ssl/status',
      providesTags: ['PrimarySsl'],
    }),
    primarySslPreflight: builder.mutation<PreflightResult, void>({
      query: () => ({ url: '/api/admin/ssl/preflight', method: 'POST' }),
    }),
    stagePrimaryCertificate: builder.mutation<{ sans: string[]; wildcardCovered: boolean }, PrimarySslPasteBody>({
      query: (body) => ({ url: '/api/admin/ssl/certificate', method: 'POST', body }),
    }),
    issuePrimaryLetsEncrypt: builder.mutation<{ issued: boolean; sans: string[] }, void>({
      query: () => ({ url: '/api/admin/ssl/letsencrypt', method: 'POST' }),
    }),
    applyPrimarySsl: builder.mutation<{ applied: true; kind: 'cert-only' | 'serving'; deadlineMs?: number }, PrimarySslApplyBody>({
      query: (body) => ({ url: '/api/admin/ssl/apply', method: 'POST', body }),
      invalidatesTags: ['PrimarySsl'],
    }),
    confirmPrimarySsl: builder.mutation<{ confirmed: true }, void>({
      query: () => ({ url: '/api/admin/ssl/confirm', method: 'POST' }),
      invalidatesTags: ['PrimarySsl'],
    }),
    rollbackPrimarySsl: builder.mutation<{ rolledBack: true }, void>({
      query: () => ({ url: '/api/admin/ssl/rollback', method: 'POST' }),
      invalidatesTags: ['PrimarySsl'],
    }),
  }),
});

export const {
  useGetPrimarySslStatusQuery, usePrimarySslPreflightMutation, useStagePrimaryCertificateMutation,
  useIssuePrimaryLetsEncryptMutation, useApplyPrimarySslMutation, useConfirmPrimarySslMutation,
  useRollbackPrimarySslMutation,
} = primarySslApi;
```

- [ ] **Step 4: Run test + typecheck**

Run: `cd apps/frontend && pnpm test -- primarySslApi.test && pnpm exec tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/services/primarySslApi.ts apps/frontend/src/services/api.ts apps/frontend/src/services/__tests__/primarySslApi.test.ts
git commit -m "feat(ssl): primarySslApi RTK Query endpoints for day-2 SSL"
```

---

### Task 11: `CurrentSslStatus` — read-only status card

**Files:**
- Create: `apps/frontend/src/components/settings/primary-ssl/CurrentSslStatus.tsx`
- Test: `apps/frontend/src/components/settings/primary-ssl/__tests__/CurrentSslStatus.test.tsx`

**Interfaces:**
- Consumes: `useGetPrimarySslStatusQuery`.
- Produces: `CurrentSslStatus()` — renders domain, current serving mode + cert expiry + wildcard-coverage badge; loading + empty states.

- [ ] **Step 1: Write the failing test**

```tsx
// CurrentSslStatus.test.tsx
import { render, screen } from '@testing-library/react';
import { CurrentSslStatus } from '../CurrentSslStatus';

let mockStatus: any;
vi.mock('@/services/primarySslApi', () => ({
  useGetPrimarySslStatusQuery: () => mockStatus,
}));

describe('CurrentSslStatus', () => {
  it('shows the domain, mode and cert expiry', () => {
    mockStatus = { data: { domain: 'a.com', sslMode: 'paste', proxyMode: 'none', cert: { commonName: 'a.com', daysUntilExpiry: 40, isValid: true, expiresAt: '2026-09-01' }, wildcardCovered: true, pendingRevert: null }, isLoading: false };
    render(<CurrentSslStatus />);
    expect(screen.getByText('a.com')).toBeInTheDocument();
    expect(screen.getByText(/paste/i)).toBeInTheDocument();
    expect(screen.getByText(/40 days/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && pnpm test -- CurrentSslStatus.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the card** (follow the `SslSettings.tsx` Card layout; use `@/components/ui/card`, `Badge`). Render `data.domain`, a mode label, `cert.daysUntilExpiry` ("N days"), and a wildcard-covered badge; show "Loading…" when `isLoading` and "No primary domain configured" when `data.domain` is null.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && pnpm test -- CurrentSslStatus.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/settings/primary-ssl/CurrentSslStatus.tsx apps/frontend/src/components/settings/primary-ssl/__tests__/CurrentSslStatus.test.tsx
git commit -m "feat(ssl): CurrentSslStatus card"
```

---

### Task 12: `ServingModelEditor` — compose the leaves over local state

**Files:**
- Create: `apps/frontend/src/components/settings/primary-ssl/ServingModelEditor.tsx`
- Test: `apps/frontend/src/components/settings/primary-ssl/__tests__/ServingModelEditor.test.tsx`

**Interfaces:**
- Consumes: leaves (Task 8); `useStagePrimaryCertificateMutation`, `useIssuePrimaryLetsEncryptMutation`, `usePrimarySslPreflightMutation`.
- Produces: `ServingModelEditor({ value, onChange, onCertStaged }: { value: EditorState; onChange: (v: EditorState) => void; onCertStaged: () => void })` where `EditorState = { servingMode; sslMode; port80; realIp; certificatePem; privateKeyPem }`. Emits changes up to the container; performs paste-stage / LE-issue / preflight actions.

- [ ] **Step 1: Write the failing test**

```tsx
// ServingModelEditor.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ServingModelEditor } from '../ServingModelEditor';

const stage = vi.fn().mockReturnValue({ unwrap: () => Promise.resolve({ sans: [], wildcardCovered: true }) });
vi.mock('@/services/primarySslApi', () => ({
  useStagePrimaryCertificateMutation: () => [stage, { isLoading: false }],
  useIssuePrimaryLetsEncryptMutation: () => [vi.fn().mockReturnValue({ unwrap: () => Promise.resolve({ issued: true }) }), { isLoading: false }],
  usePrimarySslPreflightMutation: () => [vi.fn().mockReturnValue({ unwrap: () => Promise.resolve({ ok: true, checks: [] }) }), { isLoading: false }],
}));

const base = { servingMode: 'none', sslMode: 'paste', port80: 'redirect', realIp: null, certificatePem: '', privateKeyPem: '' } as any;

describe('ServingModelEditor', () => {
  it('changing serving mode calls onChange', () => {
    const onChange = vi.fn();
    render(<ServingModelEditor value={base} onChange={onChange} onCertStaged={vi.fn()} />);
    fireEvent.click(screen.getByText(/Cloudflare/i));
    expect(onChange).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && pnpm test -- ServingModelEditor.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the editor** — render `<ServingChoiceCards value={value.servingMode} onChange={(m) => onChange({ ...value, servingMode: m, sslMode: presetSslFor(m) })} />`, then conditionally `<Port80Choice/>` + `<RealIpFields/>` (proxy/direct) and the cert sub-forms by `sslMode` (`PasteCertificateFields` with a "Validate & stage" button calling `stagePrimaryCertificate` then `onCertStaged()`; a "Run DNS preflight" + "Issue Let's Encrypt" pair for `letsencrypt`; a self-signed confirm note for `selfsigned`). `presetSslFor(m)` mirrors the wizard: `proxy→'selfsigned'`, `cloudflare→'paste'`, `none→'letsencrypt'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && pnpm test -- ServingModelEditor.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/settings/primary-ssl/ServingModelEditor.tsx apps/frontend/src/components/settings/primary-ssl/__tests__/ServingModelEditor.test.tsx
git commit -m "feat(ssl): ServingModelEditor composing SSL leaves over local state"
```

---

### Task 13: `ApplyPanel` + `RollbackPanel` — apply, confirm countdown, rollback

**Files:**
- Create: `apps/frontend/src/components/settings/primary-ssl/ApplyPanel.tsx`
- Create: `apps/frontend/src/components/settings/primary-ssl/RollbackPanel.tsx`
- Test: `apps/frontend/src/components/settings/primary-ssl/__tests__/ApplyPanel.test.tsx`

**Interfaces:**
- Consumes: `useApplyPrimarySslMutation`, `useConfirmPrimarySslMutation`, `useRollbackPrimarySslMutation`; the `pendingRevert` from status.
- Produces:
  - `ApplyPanel({ config, disabled }: { config: PrimarySslApplyBody; disabled: boolean })` — an "Apply changes" button; on a `serving` result shows a warning that reachability may change.
  - `RollbackPanel({ pendingRevert }: { pendingRevert: { deadlineMs: number } | null })` — when pending, a live countdown + "Keep these changes" (confirm) button; always a "Restore previous SSL configuration" (rollback) button.

- [ ] **Step 1: Write the failing test**

```tsx
// ApplyPanel.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { RollbackPanel } from '../RollbackPanel';

const confirm = vi.fn().mockReturnValue({ unwrap: () => Promise.resolve({}) });
const rollback = vi.fn().mockReturnValue({ unwrap: () => Promise.resolve({}) });
vi.mock('@/services/primarySslApi', () => ({
  useApplyPrimarySslMutation: () => [vi.fn(), { isLoading: false }],
  useConfirmPrimarySslMutation: () => [confirm, { isLoading: false }],
  useRollbackPrimarySslMutation: () => [rollback, { isLoading: false }],
}));

describe('RollbackPanel', () => {
  it('shows Keep-these-changes when a revert is pending and confirms', () => {
    render(<RollbackPanel pendingRevert={{ deadlineMs: Date.now() + 60000 }} />);
    const keep = screen.getByRole('button', { name: /keep these changes/i });
    fireEvent.click(keep);
    expect(confirm).toHaveBeenCalled();
  });
  it('always offers restore-previous', () => {
    render(<RollbackPanel pendingRevert={null} />);
    fireEvent.click(screen.getByRole('button', { name: /restore previous/i }));
    expect(rollback).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && pnpm test -- ApplyPanel.test`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement both panels.** `RollbackPanel` computes remaining seconds from `pendingRevert.deadlineMs` with a `useEffect` `setInterval` 1s tick (clear on unmount); renders "Auto-revert in M:SS" + a prominent "Keep these changes" (calls `confirmPrimarySsl`) when pending, and always a "Restore previous SSL configuration" (calls `rollbackPrimarySsl`) button. `ApplyPanel` renders an "Apply changes" button (disabled per prop) that calls `applyPrimarySsl(config)`; on a `{ kind: 'serving' }` result surface a toast/notice that a confirmation countdown has started.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && pnpm test -- ApplyPanel.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/settings/primary-ssl/ApplyPanel.tsx apps/frontend/src/components/settings/primary-ssl/RollbackPanel.tsx apps/frontend/src/components/settings/primary-ssl/__tests__/ApplyPanel.test.tsx
git commit -m "feat(ssl): ApplyPanel + RollbackPanel with auto-revert countdown"
```

---

### Task 14: `PrimarySslManager` container + `SslTab` wrapper (flag-gated)

**Files:**
- Create: `apps/frontend/src/components/settings/primary-ssl/PrimarySslManager.tsx`
- Create: `apps/frontend/src/pages/admin-settings/SslTab.tsx`
- Test: `apps/frontend/src/components/settings/primary-ssl/__tests__/PrimarySslManager.test.tsx`

**Interfaces:**
- Consumes: `useGetPrimarySslStatusQuery`, `useFeatureFlags`, and the sub-components (Tasks 11–13).
- Produces: `PrimarySslManager()` — pre-loads local `EditorState` from status, wires `CurrentSslStatus` + `ServingModelEditor` + `ApplyPanel` + `RollbackPanel`; returns `null` when `!isEnabled('ENABLE_PRIMARY_SSL_MANAGEMENT')`. `SslTab()` renders `<div className="space-y-6"><PrimarySslManager/></div>`.

- [ ] **Step 1: Write the failing test**

```tsx
// PrimarySslManager.test.tsx
import { render, screen } from '@testing-library/react';
import { PrimarySslManager } from '../PrimarySslManager';

let enabled = true;
vi.mock('@/services/featureFlagsApi', () => ({ useFeatureFlags: () => ({ isEnabled: () => enabled }) }));
vi.mock('@/services/primarySslApi', () => ({
  useGetPrimarySslStatusQuery: () => ({ data: { domain: 'a.com', sslMode: 'paste', proxyMode: 'none', port80: 'redirect', realIp: null, cert: null, wildcardCovered: false, pendingRevert: null }, isLoading: false }),
  useApplyPrimarySslMutation: () => [vi.fn(), {}],
  useConfirmPrimarySslMutation: () => [vi.fn(), {}],
  useRollbackPrimarySslMutation: () => [vi.fn(), {}],
  useStagePrimaryCertificateMutation: () => [vi.fn(), {}],
  useIssuePrimaryLetsEncryptMutation: () => [vi.fn(), {}],
  usePrimarySslPreflightMutation: () => [vi.fn(), {}],
}));

describe('PrimarySslManager', () => {
  it('renders when the flag is enabled', () => {
    enabled = true;
    render(<PrimarySslManager />);
    expect(screen.getByText('a.com')).toBeInTheDocument();
  });
  it('renders nothing when the flag is disabled', () => {
    enabled = false;
    const { container } = render(<PrimarySslManager />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && pnpm test -- PrimarySslManager.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the container + tab.** `PrimarySslManager`: `if (!isEnabled('ENABLE_PRIMARY_SSL_MANAGEMENT')) return null;` then `const { data } = useGetPrimarySslStatusQuery();` seed local `EditorState` from `data` via `useEffect`; render the four sub-components; pass the composed `config` (mapping `EditorState` → `PrimarySslApplyBody`) to `ApplyPanel`, and `data.pendingRevert` to `RollbackPanel`. `SslTab.tsx` is the thin wrapper. (Guard the hook order: call `useGetPrimarySslStatusQuery` before the flag early-return, or keep the early return first and gate the whole tab at the route level — see Task 15 — to avoid conditional-hook lint. Simplest: gate at the route so this component only mounts when enabled, and keep the internal flag check as defense-in-depth returning null AFTER hooks.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && pnpm test -- PrimarySslManager.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/settings/primary-ssl/PrimarySslManager.tsx apps/frontend/src/pages/admin-settings/SslTab.tsx apps/frontend/src/components/settings/primary-ssl/__tests__/PrimarySslManager.test.tsx
git commit -m "feat(ssl): PrimarySslManager container + SslTab wrapper (flag-gated)"
```

---

### Task 15: Register the SSL tab (route + tab list)

**Files:**
- Modify: `apps/frontend/src/pages/AdminSettingsPage.tsx` (TABS + `currentTab` derivation)
- Modify: `apps/frontend/src/App.tsx` (child route)
- Test: `apps/frontend/src/pages/__tests__/AdminSettingsPage.test.tsx` (create if absent — assert the SSL tab link renders when the flag is on)

**Interfaces:**
- Consumes: `SslTab` (Task 14), `useFeatureFlags`.
- Produces: an `/admin/settings/ssl` route + a conditionally-shown "SSL" tab.

- [ ] **Step 1: Write the failing test**

```tsx
// AdminSettingsPage.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AdminSettingsPage } from '../AdminSettingsPage';

vi.mock('@/services/featureFlagsApi', () => ({ useFeatureFlags: () => ({ isEnabled: (k: string) => k === 'ENABLE_PRIMARY_SSL_MANAGEMENT' }) }));
vi.mock('@/services/authApi', () => ({ useGetSessionQuery: () => ({ data: { user: { role: 'admin' } }, isLoading: false }) }));

describe('AdminSettingsPage', () => {
  it('shows the SSL tab when the flag is enabled', () => {
    render(
      <MemoryRouter initialEntries={['/admin/settings']}>
        <Routes><Route path="/admin/settings/*" element={<AdminSettingsPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('SSL')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && pnpm test -- AdminSettingsPage.test`
Expected: FAIL — no "SSL" tab.

- [ ] **Step 3: Add the tab + route.** In `AdminSettingsPage.tsx`: add `{ value: 'ssl', path: '/admin/settings/ssl', label: 'SSL', icon: Lock }` to `TABS` (import `Lock` from `lucide-react`), but render it conditionally on `isEnabled('ENABLE_PRIMARY_SSL_MANAGEMENT')` (filter the TABS array through the flag before mapping); extend the manual `currentTab` derivation to map `/admin/settings/ssl → 'ssl'`. In `App.tsx`, add inside the admin-settings nested block: `<Route path="ssl" element={<SslTab />} />` and import `SslTab`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && pnpm test -- AdminSettingsPage.test && pnpm exec tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/pages/AdminSettingsPage.tsx apps/frontend/src/App.tsx apps/frontend/src/pages/__tests__/AdminSettingsPage.test.tsx
git commit -m "feat(ssl): register the Admin → Settings → SSL tab + route (flag-gated)"
```

---

### Task 16: Fix the misleading wizard + email copy (now that the page exists)

**Files:**
- Modify: `apps/frontend/src/components/setup/domain-ssl/PasteCertificateForm.tsx` (the wildcard warning, ~line 140-142)
- Modify: `apps/backend/src/domains/ssl-renewal.service.ts` (the wildcard/paste reminder body)
- Test: `apps/frontend/src/components/setup/__tests__/CertificatePhase.test.tsx` (assert the new copy) + `apps/backend/src/domains/ssl-renewal.service.spec.ts`

**Interfaces:** none — copy-only.

- [ ] **Step 1: Update the frontend test to assert corrected copy**

In `CertificatePhase.test.tsx` (or a focused `PasteCertificateForm` test), assert the wildcard warning now reads that a wildcard cert can be managed later under **Admin → Settings → SSL** (the real page), not a nonexistent "Settings → SSL" paste screen. Add:

```tsx
expect(screen.getByText(/Admin → Settings → SSL/i)).toBeInTheDocument();
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/frontend && pnpm test -- CertificatePhase.test`
Expected: FAIL — old copy present.

- [ ] **Step 3: Update the copy** in `PasteCertificateForm.tsx` to: "This certificate doesn't cover a wildcard SAN. Preview subdomains will show a certificate warning until you add one — you can manage the primary certificate later under **Admin → Settings → SSL**." Update `ssl-renewal.service.ts`'s reminder body similarly (point at **Admin → Settings → SSL**, and — per review finding M1 — keep the wildcard reminder's DNS-01 wording only for genuinely LE-issued wildcards; for the paste reminder, say "re-paste or re-issue under Admin → Settings → SSL").

- [ ] **Step 4: Run both test suites**

Run: `cd apps/frontend && pnpm test -- CertificatePhase.test` then `cd apps/backend && pnpm test -- ssl-renewal.service.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/setup/domain-ssl/PasteCertificateForm.tsx apps/backend/src/domains/ssl-renewal.service.ts apps/frontend/src/components/setup/__tests__/CertificatePhase.test.tsx apps/backend/src/domains/ssl-renewal.service.spec.ts
git commit -m "fix(ssl): point wizard + reminder copy at the real Admin → Settings → SSL page"
```

---

## Final verification (after all tasks)

- [ ] Backend: `cd apps/backend && pnpm test && pnpm exec tsc --noEmit`
- [ ] Frontend: `cd apps/frontend && pnpm test && pnpm exec tsc --noEmit`
- [ ] Manual smoke on a droplet (see the memory `web-bootstrap-feature`): after an applied install, open `https://admin.<domain>/admin/settings/ssl`, paste a new cert → apply → confirm nginx reloaded (no restart), then click **Restore previous SSL configuration** and confirm the old cert returns. Then change the serving model (e.g. toggle port-80) → confirm the 5-minute countdown appears and that doing nothing auto-reverts.
- [ ] Confirm the tab is absent when `FEATURE_PRIMARY_SSL_MANAGEMENT=false` and that `POST /api/admin/ssl/apply` returns 403 with `PLATFORM_MODE=true`.

## Notes for the implementer

- **Reused vs re-implemented:** never re-implement cert validation, saving, or LE issuance — call `BootstrapSetupService`/`SslCertificateService`. The day-2 layer is orchestration + snapshot/rollback + a session guard.
- **Why no restart:** the domain is fixed, so `COOKIE_DOMAIN`/SuperTokens config is unchanged; writing `instance.env` is enough for nginx to re-render + reload via the watcher (~3s). Do NOT add a `process.exit`.
- **M3/M4 are respected, not fixed here:** status display uses `SslInfoService` (X509), and apply always writes `sslMode`. The underlying `parseCertificateInfo` (forge) and `render-main-conf.sh` self-signed-clobber bugs remain separate follow-ups.
- **Deferred (out of scope, per spec):** changing the primary domain; per-custom-domain paste/LE; multi-depth snapshot history; Umbrel/`cloudflare-tunnel`.
