# Zero-SSH Web Bootstrap Setup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cert-less CE install boots into an HTTPS "bootstrap mode" and the user completes claim → admin → domain → SSL-cert install → apply entirely in the browser, ending on `https://admin.<domain>` — no SSH required.

**Architecture:** A shared-volume runtime config (`bootstrap/instance.json` + shell-readable `bootstrap/instance.env`) carries domain identity. The backend hydrates `process.env` from it at the very top of `main.ts` (so SuperTokens/CORS/cookies pick it up with zero per-consumer changes) and self-exits after "apply" so Docker's restart policy revives it with the new identity. Nginx's main-config rendering moves from one-shot entrypoint code into a re-runnable script; the existing inotify watcher re-renders + reloads when the bootstrap config or certs change — nginx never restarts. New setup endpoints (`POST /api/setup/certificates`, `POST /api/setup/apply`) and three wizard steps complete the flow.

**Tech Stack:** NestJS 10 + Jest (backend), React + RTK Query + Vitest (frontend), nginx + POSIX sh (docker/nginx), node-forge (cert validation — already a dependency of `ssl-certificate.service.ts`).

**Spec:** `docs/superpowers/specs/2026-07-20-web-bootstrap-setup-design.md` (committed, PR #508). Read it first.

**Out of this plan (separate follow-ups):** Umbrel profile (own plan — different entrypoints/packaging); **Let's Encrypt wizard path** (spec includes it, but primary-domain ACME issuance needs a new service method — own follow-up plan; until then the wizard's Domain & SSL step offers Cloudflare paste only); `repos/platform` chart PR (one-line flag default; noted in Task 3); docs-public updates.

## Global Constraints

- **No docker socket, no host agent** — the backend may only write files and `process.exit()`.
- **`PLATFORM_MODE=true` or `SSL_MANAGED_EXTERNALLY=true` ⇒ new endpoints return 403** and bootstrap mode never activates. Guards live in services/controllers, not just UI.
- **Bootstrap port 80 serves only `/.well-known/acme-challenge/` + 301 redirect to HTTPS.** The wizard, claim token, and cert paste are HTTPS-only (self-signed cert auto-generated at nginx start).
- **Identity precedence: `bootstrap/instance.json` → env fallback.** An env-only install with no instance file must behave byte-identically to today (regression-tested in Task 2).
- **Claim token = existing `ONBOARDING_TOKEN`** env mechanism; `?token=` URL relay (Platform) keeps working unchanged.
- **Never bake secrets**: token generated at runtime by `setup.sh --bootstrap`, certs written per-instance.
- Backend files: 2-space indent, NestJS module conventions, Jest specs colocated as `*.spec.ts`. Shell: POSIX `sh` for anything running in alpine containers, `bash` OK for repo-root scripts. Run `cd apps/backend && pnpm test -- <pattern>` for backend tests.
- Commit prefix: `feat(bootstrap): …` (or `fix`/`test`/`docs` as appropriate).

## File Structure (locked in)

```
apps/backend/src/bootstrap/instance-config.ts          # NEW pure module: types, load/derive/hydrate/write
apps/backend/src/bootstrap/instance-config.spec.ts     # NEW
apps/backend/src/main.ts                               # MODIFY: hydrate process.env first
apps/backend/src/feature-flags/feature-flags.definitions.ts  # MODIFY: ENABLE_BOOTSTRAP_SETUP flag
apps/backend/src/setup/bootstrap-setup.service.ts      # NEW: bootstrap status, cert validate/save, apply
apps/backend/src/setup/bootstrap-setup.service.spec.ts # NEW
apps/backend/src/setup/bootstrap-setup.controller.ts   # NEW: /api/setup/certificates, /api/setup/apply
apps/backend/src/setup/bootstrap-setup.controller.spec.ts # NEW
apps/backend/src/setup/setup.dto.ts                    # MODIFY: bootstrap fields on SetupStatusResponseDto
apps/backend/src/setup/setup.service.ts                # MODIFY: getSetupStatus() bootstrap fields
apps/backend/src/setup/setup.module.ts                 # MODIFY: register new provider/controller
docker/nginx/render-main-conf.sh                       # NEW: re-runnable renderer (bootstrap|normal)
docker/nginx/sites-available/bootstrap.conf.template   # NEW: bootstrap server blocks
docker/nginx/docker-entrypoint.sh                      # MODIFY: delegate to renderer, stop hard-exiting
docker/nginx/nginx-reload-watcher.sh                   # MODIFY: watch bootstrap dir, re-render
docker/nginx/Dockerfile                                # MODIFY: add openssl, COPY new files
docker-compose.yml                                     # MODIFY: shared ./bootstrap volume
apps/frontend/src/services/setupApi.ts                 # MODIFY: status fields + 2 mutations
apps/frontend/src/components/setup/ClaimStep.tsx       # NEW
apps/frontend/src/components/setup/DomainSslStep.tsx   # NEW
apps/frontend/src/components/setup/ApplyStep.tsx       # NEW
apps/frontend/src/components/setup/SetupWizard.tsx     # MODIFY: conditional bootstrap steps
setup.sh                                               # MODIFY: --bootstrap mode
test-bootstrap.sh                                      # NEW: full-stack smoke script
```

---

### Task 1: `instance-config` pure module (backend)

**Files:**
- Create: `apps/backend/src/bootstrap/instance-config.ts`
- Test: `apps/backend/src/bootstrap/instance-config.spec.ts`

**Interfaces:**
- Consumes: nothing (pure Node, no Nest imports — it must be importable from `main.ts` before Nest boots).
- Produces (later tasks rely on these exact names):
  - `interface InstanceConfig { version: 1; state: 'unclaimed' | 'applied'; primaryDomain?: string; proxyMode?: 'cloudflare' | 'none'; sslMode?: 'paste' | 'letsencrypt'; platformIp?: string; }`
  - `bootstrapDir(): string` — `process.env.BOOTSTRAP_DIR || path.resolve(process.cwd(), '../../bootstrap')`
  - `loadInstanceConfig(dir?: string): InstanceConfig | null` — null on missing/corrupt file (never throws)
  - `deriveIdentityEnv(cfg: InstanceConfig): Record<string, string>` — `{}` unless `state === 'applied'` with a `primaryDomain`
  - `hydrateProcessEnv(dir?: string): InstanceConfig | null` — load + assign derived vars onto `process.env` (overwriting)
  - `writeInstanceConfig(cfg: InstanceConfig, dir?: string): void` — atomic write of `instance.json` **and** shell-sourceable `instance.env`

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/src/bootstrap/instance-config.spec.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  InstanceConfig,
  loadInstanceConfig,
  deriveIdentityEnv,
  hydrateProcessEnv,
  writeInstanceConfig,
} from './instance-config';

describe('instance-config', () => {
  let dir: string;
  const applied: InstanceConfig = {
    version: 1,
    state: 'applied',
    primaryDomain: 'example.com',
    proxyMode: 'cloudflare',
    sslMode: 'paste',
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bffless-bootstrap-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when instance.json is missing', () => {
    expect(loadInstanceConfig(dir)).toBeNull();
  });

  it('returns null on corrupt json instead of throwing', () => {
    fs.writeFileSync(path.join(dir, 'instance.json'), '{not json');
    expect(loadInstanceConfig(dir)).toBeNull();
  });

  it('derives full identity env from an applied config', () => {
    expect(deriveIdentityEnv(applied)).toEqual({
      PRIMARY_DOMAIN: 'example.com',
      FRONTEND_URL: 'https://www.example.com',
      API_DOMAIN: 'https://www.example.com',
      ADMIN_DOMAIN: 'admin.example.com',
      COOKIE_DOMAIN: '.example.com',
      COOKIE_SECURE: 'true',
      PROXY_MODE: 'cloudflare',
    });
  });

  it('derives nothing from an unclaimed config (env fallback wins)', () => {
    expect(deriveIdentityEnv({ version: 1, state: 'unclaimed' })).toEqual({});
  });

  it('round-trips write + load and emits a shell-sourceable instance.env', () => {
    writeInstanceConfig(applied, dir);
    expect(loadInstanceConfig(dir)).toEqual(applied);
    const envFile = fs.readFileSync(path.join(dir, 'instance.env'), 'utf8');
    expect(envFile).toContain('STATE=applied');
    expect(envFile).toContain('PRIMARY_DOMAIN=example.com');
    expect(envFile).toContain('PROXY_MODE=cloudflare');
  });

  it('hydrateProcessEnv overwrites process.env from an applied config', () => {
    writeInstanceConfig(applied, dir);
    process.env.PRIMARY_DOMAIN = 'stale.old';
    hydrateProcessEnv(dir);
    expect(process.env.PRIMARY_DOMAIN).toBe('example.com');
    expect(process.env.COOKIE_DOMAIN).toBe('.example.com');
    delete process.env.PRIMARY_DOMAIN;
    delete process.env.COOKIE_DOMAIN;
    delete process.env.FRONTEND_URL;
    delete process.env.API_DOMAIN;
    delete process.env.ADMIN_DOMAIN;
    delete process.env.COOKIE_SECURE;
    delete process.env.PROXY_MODE;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && pnpm test -- instance-config`
Expected: FAIL — `Cannot find module './instance-config'`

- [ ] **Step 3: Write the implementation**

```ts
// apps/backend/src/bootstrap/instance-config.ts
// Pure Node module — NO NestJS imports. It runs at the very top of main.ts,
// before Nest (and therefore before SuperTokens/CORS) reads process.env.
import * as fs from 'fs';
import * as path from 'path';

export interface InstanceConfig {
  version: 1;
  state: 'unclaimed' | 'applied';
  primaryDomain?: string;
  proxyMode?: 'cloudflare' | 'none';
  sslMode?: 'paste' | 'letsencrypt';
  platformIp?: string;
}

export function bootstrapDir(): string {
  return process.env.BOOTSTRAP_DIR || path.resolve(process.cwd(), '../../bootstrap');
}

export function loadInstanceConfig(dir: string = bootstrapDir()): InstanceConfig | null {
  try {
    const raw = fs.readFileSync(path.join(dir, 'instance.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !parsed?.state) return null;
    return parsed as InstanceConfig;
  } catch {
    return null;
  }
}

// Mirrors setup.sh's derivation exactly (see create_env_file in setup.sh):
// FRONTEND_URL=https://www.<domain>, COOKIE_DOMAIN=.<domain>, COOKIE_SECURE=true
export function deriveIdentityEnv(cfg: InstanceConfig): Record<string, string> {
  if (cfg.state !== 'applied' || !cfg.primaryDomain) return {};
  const d = cfg.primaryDomain;
  const env: Record<string, string> = {
    PRIMARY_DOMAIN: d,
    FRONTEND_URL: `https://www.${d}`,
    API_DOMAIN: `https://www.${d}`,
    ADMIN_DOMAIN: `admin.${d}`,
    COOKIE_DOMAIN: `.${d}`,
    COOKIE_SECURE: 'true',
  };
  if (cfg.proxyMode) env.PROXY_MODE = cfg.proxyMode;
  return env;
}

export function hydrateProcessEnv(dir: string = bootstrapDir()): InstanceConfig | null {
  const cfg = loadInstanceConfig(dir);
  if (!cfg) return null;
  Object.assign(process.env, deriveIdentityEnv(cfg));
  return cfg;
}

export function writeInstanceConfig(cfg: InstanceConfig, dir: string = bootstrapDir()): void {
  fs.mkdirSync(dir, { recursive: true });
  const jsonTmp = path.join(dir, 'instance.json.tmp');
  fs.writeFileSync(jsonTmp, JSON.stringify(cfg, null, 2) + '\n');
  fs.renameSync(jsonTmp, path.join(dir, 'instance.json'));

  // Shell-sourceable sibling so the nginx render script needs no JSON parser.
  const lines = [
    `STATE=${cfg.state}`,
    cfg.primaryDomain ? `PRIMARY_DOMAIN=${cfg.primaryDomain}` : '',
    cfg.proxyMode ? `PROXY_MODE=${cfg.proxyMode}` : '',
  ].filter(Boolean);
  const envTmp = path.join(dir, 'instance.env.tmp');
  fs.writeFileSync(envTmp, lines.join('\n') + '\n');
  fs.renameSync(envTmp, path.join(dir, 'instance.env'));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && pnpm test -- instance-config`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/bootstrap/
git commit -m "feat(bootstrap): add instance-config module (load/derive/hydrate/write)"
```

---

### Task 2: Hydrate identity in `main.ts` (env-fallback regression-safe)

**Files:**
- Modify: `apps/backend/src/main.ts` (top of file, before any Nest bootstrap)

**Interfaces:**
- Consumes: `hydrateProcessEnv` from Task 1.
- Produces: at runtime, `process.env.PRIMARY_DOMAIN`/`FRONTEND_URL`/`COOKIE_DOMAIN`/`API_DOMAIN`/`COOKIE_SECURE`/`PROXY_MODE` reflect `instance.json` when applied. All existing consumers (`supertokens.config.ts` lines 49-50/121-130, CORS in `main.ts`, `ConfigService` readers) pick this up unmodified — that is the point of hydrating `process.env` instead of touching each consumer.

- [ ] **Step 1: Add the hydration call**

Open `apps/backend/src/main.ts`. As the **first executable statement** (above the existing imports' usage — place the import with the other imports, but call before `NestFactory.create` and before `initSuperTokens()` is invoked):

```ts
import { hydrateProcessEnv } from './bootstrap/instance-config';

// Bootstrap-mode identity: instance.json (when applied) overrides env-derived
// domain identity. Must run before SuperTokens/CORS capture process.env.
const instanceCfg = hydrateProcessEnv();
if (instanceCfg?.state === 'applied') {
  // eslint-disable-next-line no-console
  console.log(`[bootstrap] identity hydrated from instance.json: ${instanceCfg.primaryDomain}`);
}
```

Note: if `initSuperTokens()` is called at import time in `main.ts`'s import graph, move the hydration into a tiny `apps/backend/src/bootstrap/hydrate.ts` that `main.ts` imports **first** (`import './bootstrap/hydrate';` as line 1) — side-effect imports execute in order, which guarantees hydration precedes SuperTokens init. Check the actual import order in `main.ts` and use whichever variant guarantees ordering; add a comment stating the ordering requirement.

- [ ] **Step 2: Regression check — env-only install unchanged**

Run: `cd apps/backend && pnpm test`
Expected: full suite PASS (no instance.json exists in the repo → `hydrateProcessEnv()` returns null → zero behavior change).

Also verify boot logs locally: `pnpm dev` (or `pnpm --filter backend dev`) → no `[bootstrap]` log line appears.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/main.ts apps/backend/src/bootstrap/
git commit -m "feat(bootstrap): hydrate domain identity from instance.json at boot"
```

---

### Task 3: Feature flag + bootstrap fields on `GET /api/setup/status`

**Files:**
- Modify: `apps/backend/src/feature-flags/feature-flags.definitions.ts` (append near `ENABLE_WILDCARD_SSL`, ~line 315)
- Modify: `apps/backend/src/setup/setup.dto.ts` (`SetupStatusResponseDto`)
- Modify: `apps/backend/src/setup/setup.service.ts` (`getSetupStatus()`, ~line 164)
- Test: extend `apps/backend/src/setup/setup.service.spec.ts` (or create if the status path is untested)

**Interfaces:**
- Produces: `SetupStatusResponseDto` gains
  `bootstrapMode: boolean` (true ⇔ flag on AND not platform-managed AND no applied instance.json AND setup not complete),
  `claimRequired: boolean` (true ⇔ bootstrapMode AND `ONBOARDING_TOKEN` set AND no admin user yet).
  Frontend (Task 10) consumes exactly these two names.
- New feature flag key: `ENABLE_BOOTSTRAP_SETUP`, env var `FEATURE_BOOTSTRAP_SETUP`, default `true`.
- New helper on `SetupService`: `isPlatformManaged(): boolean` — `process.env.PLATFORM_MODE === 'true' || process.env.SSL_MANAGED_EXTERNALLY === 'true'`. Task 5/6 guards reuse it.

- [ ] **Step 1: Write the failing test**

```ts
// append to apps/backend/src/setup/setup.service.spec.ts (create describe block; follow the
// file's existing mock/DI setup for SetupService — reuse its beforeEach wiring)
describe('getSetupStatus — bootstrap fields', () => {
  afterEach(() => {
    delete process.env.PLATFORM_MODE;
    delete process.env.SSL_MANAGED_EXTERNALLY;
    delete process.env.ONBOARDING_TOKEN;
    delete process.env.BOOTSTRAP_DIR;
  });

  it('reports bootstrapMode=true and claimRequired=true on a fresh unclaimed install with a token', async () => {
    process.env.BOOTSTRAP_DIR = '/nonexistent-bootstrap-dir'; // no applied instance.json
    process.env.ONBOARDING_TOKEN = 'tok-123';
    // arrange existing mocks: isSetupComplete=false, hasAdminUser=false (follow file conventions)
    const status = await service.getSetupStatus();
    expect(status.bootstrapMode).toBe(true);
    expect(status.claimRequired).toBe(true);
  });

  it('reports bootstrapMode=false when PLATFORM_MODE=true', async () => {
    process.env.PLATFORM_MODE = 'true';
    const status = await service.getSetupStatus();
    expect(status.bootstrapMode).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && pnpm test -- setup.service`
Expected: FAIL — `bootstrapMode` undefined.

- [ ] **Step 3: Implement**

Flag definition (mirror the exact object shape of neighboring flags in `feature-flags.definitions.ts` — copy the structure of `ENABLE_WILDCARD_SSL` and adjust):

```ts
ENABLE_BOOTSTRAP_SETUP: {
  key: 'ENABLE_BOOTSTRAP_SETUP',
  envVar: 'FEATURE_BOOTSTRAP_SETUP',
  defaultValue: true,
  description:
    'Web-based bootstrap setup wizard for cert-less installs (domain + SSL configured in browser). ' +
    'Disable on platform-managed deployments.',
},
```

`SetupService` additions:

```ts
isPlatformManaged(): boolean {
  return process.env.PLATFORM_MODE === 'true' || process.env.SSL_MANAGED_EXTERNALLY === 'true';
}
```

In `getSetupStatus()`, after the existing fields are computed (it already knows `isSetupComplete` and `hasAdminUser`):

```ts
import { loadInstanceConfig } from '../bootstrap/instance-config';
// ...
const instance = loadInstanceConfig();
const flagOn = this.featureFlagsService.isEnabled('ENABLE_BOOTSTRAP_SETUP'); // match the file's existing flag-read pattern
const bootstrapMode =
  flagOn && !this.isPlatformManaged() && instance?.state !== 'applied' && !isSetupComplete;
const claimRequired = bootstrapMode && !!process.env.ONBOARDING_TOKEN && !hasAdminUser;
return { ...existingFields, bootstrapMode, claimRequired };
```

DTO: add to `SetupStatusResponseDto` (with `@ApiProperty()` decorators matching the file's style):

```ts
@ApiProperty({ description: 'True when the instance is in web-bootstrap mode (cert-less, pre-apply)' })
bootstrapMode: boolean;

@ApiProperty({ description: 'True when a claim token must accompany admin creation' })
claimRequired: boolean;
```

- [ ] **Step 4: Run tests**

Run: `cd apps/backend && pnpm test -- setup.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/feature-flags/feature-flags.definitions.ts apps/backend/src/setup/
git commit -m "feat(bootstrap): ENABLE_BOOTSTRAP_SETUP flag + bootstrap fields on setup status"
```

**Note for `repos/platform` (separate repo, separate PR — do NOT do here):** add `FEATURE_BOOTSTRAP_SETUP: false` to `charts/workspace/templates/configmap-features.yaml` + `values.yaml` (same pattern as `sslToggle: false`).

---

### Task 4: Claim-token rate limiting on `initialize`

**Files:**
- Modify: `apps/backend/src/setup/setup.service.ts` (`validateOnboardingToken`, ~line 141)
- Test: extend `apps/backend/src/setup/setup.service.spec.ts`

**Interfaces:**
- Produces: `validateOnboardingToken(token?: string)` now throws `UnauthorizedException('Too many attempts, try again later')` after **5 failed attempts within 15 minutes** (in-memory counter — single-process CE is fine; document that k8s replicas don't share it, which is acceptable because Platform relays the correct token). Successful validation resets the counter. Existing behavior (valid token passes, token check skipped when `ONBOARDING_TOKEN` unset) is unchanged — that preserves the Platform `?token=` relay byte-identically.

- [ ] **Step 1: Write the failing test**

```ts
describe('validateOnboardingToken — rate limiting', () => {
  beforeEach(() => {
    process.env.ONBOARDING_TOKEN = 'right-token';
    (service as any).claimAttempts = { count: 0, windowStart: 0 }; // reset internal state
  });
  afterEach(() => delete process.env.ONBOARDING_TOKEN);

  it('locks out after 5 failed attempts', () => {
    for (let i = 0; i < 5; i++) {
      expect(() => service.validateOnboardingToken('wrong')).toThrow(/invalid/i);
    }
    // 6th attempt — even with the RIGHT token — is rejected as rate-limited
    expect(() => service.validateOnboardingToken('right-token')).toThrow(/too many/i);
  });

  it('a successful validation resets the counter', () => {
    expect(() => service.validateOnboardingToken('wrong')).toThrow();
    expect(() => service.validateOnboardingToken('right-token')).not.toThrow();
    expect((service as any).claimAttempts.count).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/backend && pnpm test -- setup.service`
Expected: FAIL (no rate limiting yet — 6th attempt with right token succeeds).

- [ ] **Step 3: Implement**

In `SetupService` (adapt to the existing method — it currently compares the supplied token against `process.env.ONBOARDING_TOKEN` and throws on mismatch; wrap that logic):

```ts
private claimAttempts = { count: 0, windowStart: 0 };
private static readonly CLAIM_MAX_ATTEMPTS = 5;
private static readonly CLAIM_WINDOW_MS = 15 * 60 * 1000;

validateOnboardingToken(token?: string): void {
  const expected = process.env.ONBOARDING_TOKEN;
  if (!expected) return; // no token configured — open (existing behavior)

  const now = Date.now();
  if (now - this.claimAttempts.windowStart > SetupService.CLAIM_WINDOW_MS) {
    this.claimAttempts = { count: 0, windowStart: now };
  }
  if (this.claimAttempts.count >= SetupService.CLAIM_MAX_ATTEMPTS) {
    throw new UnauthorizedException('Too many attempts, try again later');
  }
  if (token !== expected) {
    this.claimAttempts.count += 1;
    if (this.claimAttempts.windowStart === 0) this.claimAttempts.windowStart = now;
    throw new UnauthorizedException('Invalid onboarding token');
  }
  this.claimAttempts = { count: 0, windowStart: 0 };
}
```

Keep the original error message text if callers/tests depend on it — check existing usages first and preserve exact strings where asserted.

- [ ] **Step 4: Run tests** — `pnpm test -- setup.service` → PASS (full file, not just new tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/setup/setup.service.ts apps/backend/src/setup/setup.service.spec.ts
git commit -m "feat(bootstrap): rate-limit onboarding-token validation"
```

---

### Task 5: `BootstrapSetupService` — cert validation + save

**Files:**
- Create: `apps/backend/src/setup/bootstrap-setup.service.ts`
- Test: `apps/backend/src/setup/bootstrap-setup.service.spec.ts`

**Interfaces:**
- Consumes: `isPlatformManaged()` pattern (re-implement locally reading the same env vars, or inject `SetupService` — prefer injecting `SetupService` since Task 3 defined the helper there), `node-forge` (already in `apps/backend/package.json`).
- Produces:
  - `validateCertificatePair(certPem: string, keyPem: string, domain: string): { sans: string[] }` — throws `BadRequestException` with a specific message on: unparseable PEM, key↔cert mismatch, SAN not covering both `domain` and `*.domain`, expired/not-yet-valid cert.
  - `saveCertificates(certPem: string, keyPem: string, domain: string): void` — writes `fullchain.pem` (644), `privkey.pem` (600), `wildcard.<domain>.crt` (644), `wildcard.<domain>.key` (600) into `SSL_CERT_PATH` (default `/etc/nginx/ssl` — same resolution as `ssl-certificate.service.ts` `getSslPath()`, line 1039; extract or duplicate the 3-line resolution, do not import the whole ACME service).
  - `assertBootstrapAllowed(): void` — throws `ForbiddenException('Not available on platform-managed deployments')` when platform-managed; throws `BadRequestException('Bootstrap setup is disabled')` when the `ENABLE_BOOTSTRAP_SETUP` flag is off. Task 6 controller calls this first on every endpoint.

- [ ] **Step 1: Write the failing test** (generate a real self-signed cert with wildcard SAN in-test via node-forge — no fixtures on disk)

```ts
// apps/backend/src/setup/bootstrap-setup.service.spec.ts
import * as forge from 'node-forge';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BootstrapSetupService } from './bootstrap-setup.service';

function makeCert(domain: string, opts: { includeWildcard?: boolean; expired?: boolean } = {}) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400_000);
  cert.validity.notAfter = new Date(Date.now() + (opts.expired ? -3600_000 : 365 * 86400_000));
  const attrs = [{ name: 'commonName', value: domain }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  const altNames = [{ type: 2, value: domain }];
  if (opts.includeWildcard !== false) altNames.push({ type: 2, value: `*.${domain}` });
  cert.setExtensions([{ name: 'subjectAltName', altNames }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

describe('BootstrapSetupService', () => {
  let service: BootstrapSetupService;
  let sslDir: string;

  beforeEach(() => {
    sslDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bffless-ssl-'));
    process.env.SSL_CERT_PATH = sslDir;
    service = new BootstrapSetupService({ isPlatformManaged: () => false } as any, {
      isEnabled: () => true,
    } as any);
  });
  afterEach(() => {
    fs.rmSync(sslDir, { recursive: true, force: true });
    delete process.env.SSL_CERT_PATH;
  });

  it('accepts a matching pair with apex + wildcard SANs', () => {
    const { certPem, keyPem } = makeCert('example.com');
    expect(() => service.validateCertificatePair(certPem, keyPem, 'example.com')).not.toThrow();
  });

  it('rejects a key that does not match the cert', () => {
    const a = makeCert('example.com');
    const b = makeCert('example.com');
    expect(() => service.validateCertificatePair(a.certPem, b.keyPem, 'example.com')).toThrow(
      BadRequestException,
    );
  });

  it('rejects a cert whose SANs do not cover the wildcard', () => {
    const { certPem, keyPem } = makeCert('example.com', { includeWildcard: false });
    expect(() => service.validateCertificatePair(certPem, keyPem, 'example.com')).toThrow(/wildcard/i);
  });

  it('rejects an expired cert', () => {
    const { certPem, keyPem } = makeCert('example.com', { expired: true });
    expect(() => service.validateCertificatePair(certPem, keyPem, 'example.com')).toThrow(/expired/i);
  });

  it('rejects garbage PEM', () => {
    expect(() => service.validateCertificatePair('not a cert', 'not a key', 'example.com')).toThrow(
      BadRequestException,
    );
  });

  it('saves the four cert files with correct permissions', () => {
    const { certPem, keyPem } = makeCert('example.com');
    service.saveCertificates(certPem, keyPem, 'example.com');
    const mode = (f: string) => fs.statSync(path.join(sslDir, f)).mode & 0o777;
    expect(mode('fullchain.pem')).toBe(0o644);
    expect(mode('privkey.pem')).toBe(0o600);
    expect(mode('wildcard.example.com.crt')).toBe(0o644);
    expect(mode('wildcard.example.com.key')).toBe(0o600);
  });

  it('assertBootstrapAllowed throws 403 when platform-managed', () => {
    const svc = new BootstrapSetupService({ isPlatformManaged: () => true } as any, {
      isEnabled: () => true,
    } as any);
    expect(() => svc.assertBootstrapAllowed()).toThrow(ForbiddenException);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm test -- bootstrap-setup.service` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// apps/backend/src/setup/bootstrap-setup.service.ts
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import * as forge from 'node-forge';
import * as fs from 'fs';
import * as path from 'path';
import { SetupService } from './setup.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

@Injectable()
export class BootstrapSetupService {
  constructor(
    private readonly setupService: SetupService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  private sslDir(): string {
    return process.env.SSL_CERT_PATH || '/etc/nginx/ssl';
  }

  assertBootstrapAllowed(): void {
    if (this.setupService.isPlatformManaged()) {
      throw new ForbiddenException('Not available on platform-managed deployments');
    }
    if (!this.featureFlags.isEnabled('ENABLE_BOOTSTRAP_SETUP')) {
      throw new BadRequestException('Bootstrap setup is disabled');
    }
  }

  validateCertificatePair(certPem: string, keyPem: string, domain: string): { sans: string[] } {
    let cert: forge.pki.Certificate;
    let key: forge.pki.rsa.PrivateKey;
    try {
      cert = forge.pki.certificateFromPem(certPem);
      key = forge.pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey;
    } catch {
      throw new BadRequestException('Could not parse certificate or private key PEM');
    }

    const certModulus = (cert.publicKey as forge.pki.rsa.PublicKey).n.toString(16);
    if (certModulus !== key.n.toString(16)) {
      throw new BadRequestException('Private key does not match the certificate');
    }

    const now = new Date();
    if (now > cert.validity.notAfter) throw new BadRequestException('Certificate is expired');
    if (now < cert.validity.notBefore) throw new BadRequestException('Certificate is not yet valid');

    const sanExt = cert.getExtension('subjectAltName') as { altNames?: { value: string }[] } | null;
    const sans = (sanExt?.altNames || []).map((a) => a.value);
    const covers = (name: string) => sans.includes(name);
    if (!covers(domain)) {
      throw new BadRequestException(`Certificate does not cover ${domain}`);
    }
    if (!covers(`*.${domain}`)) {
      throw new BadRequestException(
        `Certificate does not cover the wildcard *.${domain} (needed for admin/www/preview subdomains)`,
      );
    }
    return { sans };
  }

  saveCertificates(certPem: string, keyPem: string, domain: string): void {
    const dir = this.sslDir();
    fs.mkdirSync(dir, { recursive: true });
    const write = (name: string, content: string, mode: number) => {
      const tmp = path.join(dir, `${name}.tmp`);
      fs.writeFileSync(tmp, content, { mode });
      fs.renameSync(tmp, path.join(dir, name));
      fs.chmodSync(path.join(dir, name), mode);
    };
    write('fullchain.pem', certPem, 0o644);
    write('privkey.pem', keyPem, 0o600);
    write(`wildcard.${domain}.crt`, certPem, 0o644);
    write(`wildcard.${domain}.key`, keyPem, 0o600);
  }
}
```

- [ ] **Step 4: Run tests** — `pnpm test -- bootstrap-setup.service` → PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/setup/bootstrap-setup.service.*
git commit -m "feat(bootstrap): cert pair validation + save service"
```

---

### Task 6: Bootstrap controller — `POST /api/setup/certificates` + `POST /api/setup/apply`

**Files:**
- Create: `apps/backend/src/setup/bootstrap-setup.controller.ts`
- Modify: `apps/backend/src/setup/setup.dto.ts` (two DTOs below)
- Modify: `apps/backend/src/setup/setup.module.ts` (register controller + service)
- Test: `apps/backend/src/setup/bootstrap-setup.controller.spec.ts`

**Interfaces:**
- Consumes: `BootstrapSetupService` (Task 5), `writeInstanceConfig` (Task 1), `SessionAuthGuard` + `RolesGuard` + `@Roles(['admin'])` (existing — same imports as `setup.controller.ts` lines 18-20).
- Produces (frontend Task 10 depends on these exact routes/shapes):
  - `POST /api/setup/certificates` body `{ domain: string, certificatePem: string, privateKeyPem: string }` → 200 `{ saved: true, sans: string[] }`. Admin-session-guarded.
  - `POST /api/setup/apply` body `{ domain: string, proxyMode: 'cloudflare' | 'none' }` → 200 `{ applying: true, adminUrl: string }` then the process exits ~500 ms later. Admin-session-guarded. Refuses (400) if cert files are missing for the domain.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/src/setup/bootstrap-setup.controller.spec.ts
import { BadRequestException } from '@nestjs/common';
import { BootstrapSetupController } from './bootstrap-setup.controller';

describe('BootstrapSetupController', () => {
  let controller: BootstrapSetupController;
  const svc = {
    assertBootstrapAllowed: jest.fn(),
    validateCertificatePair: jest.fn().mockReturnValue({ sans: ['example.com', '*.example.com'] }),
    saveCertificates: jest.fn(),
    certificatesPresent: jest.fn().mockReturnValue(true),
  };
  const exitFn = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new BootstrapSetupController(svc as any);
    (controller as any).scheduleExit = exitFn; // do not actually exit in tests
  });

  it('validates then saves certificates', () => {
    const res = controller.uploadCertificates({
      domain: 'example.com',
      certificatePem: 'CERT',
      privateKeyPem: 'KEY',
    });
    expect(svc.assertBootstrapAllowed).toHaveBeenCalled();
    expect(svc.validateCertificatePair).toHaveBeenCalledWith('CERT', 'KEY', 'example.com');
    expect(svc.saveCertificates).toHaveBeenCalledWith('CERT', 'KEY', 'example.com');
    expect(res).toEqual({ saved: true, sans: ['example.com', '*.example.com'] });
  });

  it('apply writes instance config and schedules exit', () => {
    const writeSpy = jest
      .spyOn(require('../bootstrap/instance-config'), 'writeInstanceConfig')
      .mockImplementation(() => undefined);
    const res = controller.apply({ domain: 'example.com', proxyMode: 'cloudflare' });
    expect(writeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'applied', primaryDomain: 'example.com', proxyMode: 'cloudflare' }),
    );
    expect(res).toEqual({ applying: true, adminUrl: 'https://admin.example.com' });
    expect(exitFn).toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it('apply refuses when certs are missing', () => {
    svc.certificatesPresent.mockReturnValueOnce(false);
    expect(() => controller.apply({ domain: 'example.com', proxyMode: 'cloudflare' })).toThrow(
      BadRequestException,
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm test -- bootstrap-setup.controller` → FAIL.

- [ ] **Step 3: Implement**

Add to `BootstrapSetupService` (Task 5 file) the presence check:

```ts
certificatesPresent(domain: string): boolean {
  const dir = this.sslDir();
  return (
    fs.existsSync(path.join(dir, 'fullchain.pem')) &&
    fs.existsSync(path.join(dir, 'privkey.pem')) &&
    fs.existsSync(path.join(dir, `wildcard.${domain}.crt`))
  );
}
```

DTOs in `setup.dto.ts` (class-validator style matching the file):

```ts
export class UploadCertificatesDto {
  @ApiProperty() @IsString() @IsNotEmpty() domain: string;
  @ApiProperty() @IsString() @IsNotEmpty() certificatePem: string;
  @ApiProperty() @IsString() @IsNotEmpty() privateKeyPem: string;
}

export class ApplyBootstrapDto {
  @ApiProperty() @IsString() @IsNotEmpty() domain: string;
  @ApiProperty({ enum: ['cloudflare', 'none'] }) @IsIn(['cloudflare', 'none']) proxyMode: 'cloudflare' | 'none';
}
```

Controller:

```ts
// apps/backend/src/setup/bootstrap-setup.controller.ts
import { BadRequestException, Body, Controller, Logger, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BootstrapSetupService } from './bootstrap-setup.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { writeInstanceConfig } from '../bootstrap/instance-config';
import { ApplyBootstrapDto, UploadCertificatesDto } from './setup.dto';

@ApiTags('Setup')
@Controller('api/setup')
export class BootstrapSetupController {
  private readonly logger = new Logger(BootstrapSetupController.name);

  constructor(private readonly bootstrap: BootstrapSetupService) {}

  // Overridable in tests. Exit lets docker's restart policy revive the backend,
  // which re-runs main.ts hydration and adopts the new identity. No docker socket.
  private scheduleExit(): void {
    setTimeout(() => {
      this.logger.log('[bootstrap] apply complete — exiting for identity restart');
      process.exit(0);
    }, 500).unref();
  }

  @Post('certificates')
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles(['admin'])
  @ApiOperation({ summary: 'Validate and install SSL certificate pair (bootstrap mode)' })
  uploadCertificates(@Body() dto: UploadCertificatesDto): { saved: true; sans: string[] } {
    this.bootstrap.assertBootstrapAllowed();
    const { sans } = this.bootstrap.validateCertificatePair(
      dto.certificatePem,
      dto.privateKeyPem,
      dto.domain,
    );
    this.bootstrap.saveCertificates(dto.certificatePem, dto.privateKeyPem, dto.domain);
    return { saved: true, sans };
  }

  @Post('apply')
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles(['admin'])
  @ApiOperation({ summary: 'Apply domain identity and restart into HTTPS mode (bootstrap mode)' })
  apply(@Body() dto: ApplyBootstrapDto): { applying: true; adminUrl: string } {
    this.bootstrap.assertBootstrapAllowed();
    if (!this.bootstrap.certificatesPresent(dto.domain)) {
      throw new BadRequestException('Install certificates before applying');
    }
    writeInstanceConfig({
      version: 1,
      state: 'applied',
      primaryDomain: dto.domain,
      proxyMode: dto.proxyMode,
      sslMode: 'paste',
    });
    this.scheduleExit();
    return { applying: true, adminUrl: `https://admin.${dto.domain}` };
  }
}
```

Register in `setup.module.ts`: add `BootstrapSetupController` to `controllers`, `BootstrapSetupService` to `providers`.

- [ ] **Step 4: Run tests** — `pnpm test -- bootstrap-setup` → PASS. Then the full backend suite: `pnpm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/setup/
git commit -m "feat(bootstrap): certificates + apply endpoints with self-exit restart"
```

---

### Task 7: nginx — re-runnable renderer with bootstrap mode

**Files:**
- Create: `docker/nginx/render-main-conf.sh`
- Create: `docker/nginx/sites-available/bootstrap.conf.template`
- Modify: `docker/nginx/docker-entrypoint.sh` (replace the render + hard-exit logic with a call to the renderer)
- Modify: `docker/nginx/Dockerfile` (`apk add --no-cache openssl` if absent; `COPY render-main-conf.sh` + template; keep entrypoint COPY)

**Interfaces:**
- Consumes: `/etc/nginx/bootstrap/instance.env` (Task 1 writes it via the shared volume; Task 9 mounts it), existing env `PRIMARY_DOMAIN`, `PROXY_MODE`, `ENABLE_MINIO`, existing templates.
- Produces: `render-main-conf.sh` — idempotent, safe to run at container start AND from the watcher. Renders either bootstrap config or the normal `main.conf`. **Never exits non-zero for missing certs** (that's the old hard-fail this feature removes); instead falls into bootstrap mode.

- [ ] **Step 1: Write `bootstrap.conf.template`**

```nginx
# Bootstrap mode — no domain configured yet.
# Port 80: ACME webroot + redirect only (never serves the wizard or secrets).
server {
    listen 80 default_server;
    server_name _;

    location /.well-known/acme-challenge/ {
        root /var/www/acme;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# Port 443: serve the admin SPA + API for ANY host (bare IP, or the user's
# domain proxied through Cloudflare in "Full" mode against our self-signed cert).
server {
    listen 443 ssl default_server;
    http2 on;
    server_name _;

    ssl_certificate /etc/nginx/ssl/bootstrap-selfsigned.crt;
    ssl_certificate_key /etc/nginx/ssl/bootstrap-selfsigned.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    root /usr/share/nginx/html;
    index index.html;
    client_max_body_size 10M;

    location /api {
        proxy_pass http://backend:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /auth {
        proxy_pass http://backend:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 2: Write `render-main-conf.sh`**

```sh
#!/bin/sh
# Re-runnable main-config renderer. Called by docker-entrypoint.sh at start and
# by nginx-reload-watcher.sh when /etc/nginx/bootstrap/ or certs change.
# Decides between BOOTSTRAP mode (no domain identity + no certs) and NORMAL mode.
set -e

SSL_DIR="/etc/nginx/ssl"
BOOTSTRAP_DIR="/etc/nginx/bootstrap"
SITES_AVAILABLE="/etc/nginx/sites-available"

# Domain identity: instance.env (written by the backend on apply) overrides env.
STATE=""
if [ -f "${BOOTSTRAP_DIR}/instance.env" ]; then
    # shellcheck disable=SC1091
    . "${BOOTSTRAP_DIR}/instance.env"
fi
PRIMARY_DOMAIN="${PRIMARY_DOMAIN:-}"
PROXY_MODE="${PROXY_MODE:-none}"

have_certs() {
    [ -f "${SSL_DIR}/fullchain.pem" ] && [ -f "${SSL_DIR}/privkey.pem" ]
}

if [ "${STATE}" != "applied" ] && ! have_certs; then
    # ------------------------- BOOTSTRAP MODE -------------------------
    echo "🥾 Bootstrap mode: no domain identity and no certificates"
    mkdir -p /var/www/acme "${SSL_DIR}"

    if [ ! -f "${SSL_DIR}/bootstrap-selfsigned.crt" ]; then
        echo "🔐 Generating self-signed bootstrap certificate..."
        openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
            -keyout "${SSL_DIR}/bootstrap-selfsigned.key" \
            -out "${SSL_DIR}/bootstrap-selfsigned.crt" \
            -subj "/CN=bffless-bootstrap" 2>/dev/null
        chmod 600 "${SSL_DIR}/bootstrap-selfsigned.key"
    fi

    cp "${SITES_AVAILABLE}/bootstrap.conf.template" "${SITES_AVAILABLE}/main.conf"
    # Neutralize minio config in bootstrap mode
    echo "# minio disabled in bootstrap mode" > "${SITES_AVAILABLE}/minio.conf"
    echo "# realip inactive in bootstrap mode" > /etc/nginx/cloudflare-realip.conf
    echo "✅ Bootstrap config rendered"
    exit 0
fi

# --------------------------- NORMAL MODE ---------------------------
if [ -z "${PRIMARY_DOMAIN}" ]; then
    echo "❌ Certs exist but PRIMARY_DOMAIN is unset — cannot render"
    exit 1
fi
echo "🔧 Rendering nginx config for PRIMARY_DOMAIN: ${PRIMARY_DOMAIN} (PROXY_MODE=${PROXY_MODE})"

# [MOVE, do not rewrite] Everything from the current docker-entrypoint.sh between
# the PROXY_MODE comment banner and "✅ Nginx configuration generated" moves here
# verbatim: cloudflare/none cert resolution, WILDCARD_CERT/KEY selection,
# PORT80_ACTION, cloudflare-realip.conf generation, envsubst of main.conf.template
# and minio.conf handling — with ONE change: where the old code did `exit 1` on
# missing certs, keep it (normal mode with STATE=applied but missing certs IS an
# error; bootstrap mode was handled above).
```

(The bracketed MOVE note is an instruction to the implementer: cut lines ~11-190 of the current `docker-entrypoint.sh` into this script beneath the marker, preserving behavior exactly.)

- [ ] **Step 3: Slim `docker-entrypoint.sh`**

Replace the moved block so the entrypoint becomes:

```sh
#!/bin/sh
set -e
/usr/local/bin/render-main-conf.sh
exec "$@"
```

- [ ] **Step 4: Dockerfile**

In `docker/nginx/Dockerfile`: ensure `openssl` is installed (`RUN apk add --no-cache openssl` alongside the existing inotify-tools/gettext installs), and add:

```dockerfile
COPY render-main-conf.sh /usr/local/bin/render-main-conf.sh
COPY sites-available/bootstrap.conf.template /etc/nginx/sites-available/bootstrap.conf.template
RUN chmod +x /usr/local/bin/render-main-conf.sh
```

- [ ] **Step 5: Verify by container build + run**

```bash
cd /path/to/ce
shellcheck docker/nginx/render-main-conf.sh docker/nginx/docker-entrypoint.sh
docker compose build nginx
# Bootstrap-mode boot check (no ssl/ certs, no bootstrap/instance.env):
mv ssl ssl.bak 2>/dev/null; mkdir -p ssl bootstrap
docker compose up -d nginx
docker compose logs nginx | grep "Bootstrap mode"        # expected: present
curl -ks https://localhost/ -o /dev/null -w '%{http_code}\n'   # expected: 200 (SPA shell)
curl -s  http://localhost/ -o /dev/null -w '%{http_code}\n'    # expected: 301
docker compose down; rm -rf ssl; mv ssl.bak ssl 2>/dev/null
```

- [ ] **Step 6: Commit**

```bash
git add docker/nginx/
git commit -m "feat(bootstrap): re-runnable nginx renderer with cert-less bootstrap mode"
```

---

### Task 8: Watcher re-renders on bootstrap config change

**Files:**
- Modify: `docker/nginx/nginx-reload-watcher.sh`

**Interfaces:**
- Consumes: `render-main-conf.sh` (Task 7), `/etc/nginx/bootstrap/` mount (Task 9).
- Produces: when `instance.env`/certs change, the watcher re-renders main config then validates + reloads. Nginx transitions bootstrap → normal **without a container restart**.

- [ ] **Step 1: Modify the watcher**

Change the `inotifywait` line and add a render call before validation:

```sh
  inotifywait -e create,modify,delete,moved_to -q \
    /etc/nginx/sites-enabled/ /etc/nginx/ssl/ /etc/nginx/bootstrap/ 2>/dev/null

  echo "📝 Config/certificate/bootstrap change detected, waiting for write to complete..."
  sleep 1

  # Re-render main config — picks up bootstrap→applied transitions and new certs.
  if ! /usr/local/bin/render-main-conf.sh; then
    echo "❌ Render failed, skipping reload"
    continue
  fi
```

(Keep the existing `nginx -t` + `nginx -s reload` + debounce logic unchanged after this.)
Note: `moved_to` is added because both the backend (Task 1) and renderer write via rename-into-place.

- [ ] **Step 2: Verify end-to-end transition**

With the Task 7 bootstrap stack running (`docker compose up -d nginx` in cert-less state):

```bash
# Simulate an apply: drop certs + instance.env like the backend would
openssl req -x509 -nodes -days 30 -newkey rsa:2048 -keyout ssl/privkey.pem -out ssl/fullchain.pem -subj "/CN=test.local" -addext "subjectAltName=DNS:test.local,DNS:*.test.local" 2>/dev/null
cp ssl/fullchain.pem ssl/wildcard.test.local.crt && cp ssl/privkey.pem ssl/wildcard.test.local.key
printf 'STATE=applied\nPRIMARY_DOMAIN=test.local\nPROXY_MODE=cloudflare\n' > bootstrap/instance.env
sleep 5
docker compose logs nginx | tail -20   # expected: "Rendering nginx config for PRIMARY_DOMAIN: test.local" + reload
curl -ks --resolve admin.test.local:443:127.0.0.1 https://admin.test.local/ -o /dev/null -w '%{http_code}\n'  # expected: 200
```

- [ ] **Step 3: Commit**

```bash
git add docker/nginx/nginx-reload-watcher.sh
git commit -m "feat(bootstrap): watcher re-renders main config on bootstrap/cert changes"
```

---

### Task 9: docker-compose — shared `bootstrap/` volume + env

**Files:**
- Modify: `docker-compose.yml`

**Interfaces:**
- Produces: `./bootstrap` bind-mounted **rw** into backend at `/app/bootstrap` and **ro** into nginx at `/etc/nginx/bootstrap`; backend env `BOOTSTRAP_DIR=/app/bootstrap`. `./ssl` is already rw in backend + ro in nginx (verified in exploration) — no change needed there, but the nginx ssl mount must become **rw** (the renderer writes the self-signed pair): flip nginx's `./ssl` mount to rw.

- [ ] **Step 1: Edit compose**

In the `backend` service `volumes:` add `- ./bootstrap:/app/bootstrap` and under `environment:` add `- BOOTSTRAP_DIR=/app/bootstrap`. In the `nginx` service `volumes:` add `- ./bootstrap:/etc/nginx/bootstrap:ro` and change `- ./ssl:/etc/nginx/ssl:ro` → `- ./ssl:/etc/nginx/ssl` (rw, self-signed generation). Add `bootstrap/` to `.gitignore` (alongside the existing `ssl/` ignore — check it's there).

- [ ] **Step 2: Verify**

```bash
docker compose config | grep -A3 bootstrap    # both mounts render
docker compose up -d && docker compose exec backend sh -c 'touch /app/bootstrap/w && rm /app/bootstrap/w && echo backend-rw-ok'
docker compose exec nginx sh -c 'test -d /etc/nginx/bootstrap && echo nginx-ro-ok'
docker compose down
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml .gitignore
git commit -m "feat(bootstrap): share bootstrap/ volume between backend and nginx"
```

---

### Task 10: Frontend — setupApi additions

**Files:**
- Modify: `apps/frontend/src/services/setupApi.ts`
- Test: `apps/frontend/src/services/__tests__/setupApi.test.ts` (create if absent; follow the project's existing RTK Query test pattern — if none exists, a type-level check inside the wizard tests of Task 11 suffices and this task is types+endpoints only)

**Interfaces:**
- Consumes: Task 3 status fields, Task 6 endpoints.
- Produces (Tasks 11-13 import these exact hooks):
  - `SetupStatus` type gains `bootstrapMode: boolean; claimRequired: boolean;`
  - `useUploadCertificatesMutation()` → `POST /api/setup/certificates` with `{ domain, certificatePem, privateKeyPem }` → `{ saved: boolean; sans: string[] }`
  - `useApplyBootstrapMutation()` → `POST /api/setup/apply` with `{ domain, proxyMode }` → `{ applying: boolean; adminUrl: string }`

- [ ] **Step 1: Add endpoints** (match the file's `injectEndpoints`/tag conventions):

```ts
uploadCertificates: builder.mutation<
  { saved: boolean; sans: string[] },
  { domain: string; certificatePem: string; privateKeyPem: string }
>({
  query: (body) => ({ url: '/api/setup/certificates', method: 'POST', body }),
}),
applyBootstrap: builder.mutation<
  { applying: boolean; adminUrl: string },
  { domain: string; proxyMode: 'cloudflare' | 'none' }
>({
  query: (body) => ({ url: '/api/setup/apply', method: 'POST', body }),
}),
```

Extend the setup-status response type with `bootstrapMode: boolean; claimRequired: boolean;` and export the two generated hooks.

- [ ] **Step 2: Type-check** — `pnpm --filter frontend exec tsc --noEmit` → clean.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/services/setupApi.ts
git commit -m "feat(bootstrap): setup API endpoints + status fields (frontend)"
```

---

### Task 11: Frontend — `ClaimStep` + wizard step gating

**Files:**
- Create: `apps/frontend/src/components/setup/ClaimStep.tsx`
- Modify: `apps/frontend/src/components/setup/SetupWizard.tsx`
- Modify: `apps/frontend/src/store/slices/setupSlice.ts` (add `claimToken: string | null` + `setClaimToken` action)
- Test: `apps/frontend/src/components/setup/__tests__/SetupWizard.bootstrap.test.tsx`

**Interfaces:**
- Consumes: `useGetSetupStatusQuery` (`bootstrapMode`, `claimRequired`), existing step components, `setupSlice`.
- Produces: wizard step model becomes a **computed list** instead of hard-coded numbers:
  - bootstrap mode: `['claim'?, 'admin', 'domain-ssl', 'storage', 'cache', 'email', 'apply']` (`claim` only when `claimRequired`)
  - normal mode (today's behavior, unchanged): `['admin', 'storage', 'cache', 'email', 'complete']`
  - The claim token: read from `?token=` query param on mount (Platform relay — auto-claims, step skipped); otherwise `ClaimStep` collects it. Stored in the wizard sub-state (`state.setup.wizard.claimToken` — same object `bootstrapDomain` joins in Task 12); the admin-creation call (existing `initialize` mutation) passes it (the backend already accepts a token on initialize — check the existing DTO field name, likely `onboardingToken` or `token`, and use it verbatim).

- [ ] **Step 1: Write the failing wizard test**

```tsx
// apps/frontend/src/components/setup/__tests__/SetupWizard.bootstrap.test.tsx
// Follow the project's existing component-test setup (Vitest + testing-library +
// store/provider helpers — copy the wrapper from an existing page test).
import { render, screen } from '@testing-library/react';
import { SetupWizard } from '../SetupWizard';

vi.mock('@/services/setupApi', async (importOriginal) => {
  const mod: any = await importOriginal();
  return {
    ...mod,
    useGetSetupStatusQuery: () => ({
      data: {
        isSetupComplete: false,
        hasAdminUser: false,
        bootstrapMode: true,
        claimRequired: true,
      },
    }),
  };
});

it('shows the claim step first in bootstrap mode with a required claim', () => {
  render(<SetupWizard />, { wrapper: TestProviders }); // use the project's provider wrapper
  expect(screen.getByText(/claim this instance/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails** — `cd apps/frontend && pnpm test -- SetupWizard.bootstrap` → FAIL.

- [ ] **Step 3: Implement `ClaimStep`**

```tsx
// apps/frontend/src/components/setup/ClaimStep.tsx
import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { setClaimToken, nextWizardStep } from '@/store/slices/setupSlice';
import { Button } from '@/components/ui/button';   // match the project's UI kit imports
import { Input } from '@/components/ui/input';

export function ClaimStep() {
  const dispatch = useDispatch();
  const [token, setToken] = useState('');

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Claim this instance</h3>
      <p className="text-sm text-muted-foreground">
        Enter the claim token for this server. On DigitalOcean, open your droplet&apos;s
        <strong> Console</strong> from the control panel — the token is shown in the login banner.
      </p>
      <Input
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Claim token"
        autoFocus
      />
      <Button
        className="w-full"
        disabled={!token.trim()}
        onClick={() => {
          dispatch(setClaimToken(token.trim()));
          dispatch(nextWizardStep());
        }}
      >
        Continue
      </Button>
    </div>
  );
}
```

(The token is *verified server-side* when `initialize` is called with it — a wrong token surfaces as the existing 401 error on the admin step, which the wizard already displays. No separate verify round-trip.)

- [ ] **Step 4: Rework `SetupWizard` to a computed step list**

Replace the numeric `switch` with:

```tsx
type StepId = 'claim' | 'admin' | 'domain-ssl' | 'storage' | 'cache' | 'email' | 'apply' | 'complete';

function stepList(status: SetupStatus | undefined, urlToken: string | null): StepId[] {
  if (!status?.bootstrapMode) return ['admin', 'storage', 'cache', 'email', 'complete'];
  const steps: StepId[] = [];
  if (status.claimRequired && !urlToken) steps.push('claim');
  return [...steps, 'admin', 'domain-ssl', 'storage', 'cache', 'email', 'apply'];
}
```

On mount, read `new URLSearchParams(window.location.search).get('token')` → if present, `dispatch(setClaimToken(urlToken))` (Platform relay: claim screen skipped). Keep the existing auto-advance logic keyed to the computed list (`hasAdminUser` ⇒ index of the step after `'admin'`, etc.). `setupSlice` gains `claimToken: string | null` with `setClaimToken` reducer and a `nextWizardStep` action if one doesn't already exist (check the slice — it has `setWizardStep`; add `nextWizardStep` incrementing `currentStep`). The `AdminAccountStep`'s initialize call site passes `claimToken` from the store into the existing initialize mutation body using the DTO's existing token field name.

`DomainSslStep` and `ApplyStep` render placeholders until Tasks 12-13 land — import them and let Tasks 12/13 fill them in (create the two files now with `export function DomainSslStep() { return null; }` bodies so the build stays green).

- [ ] **Step 5: Run tests** — `pnpm test -- SetupWizard` → PASS; `pnpm exec tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/components/setup/ apps/frontend/src/store/slices/setupSlice.ts
git commit -m "feat(bootstrap): claim step + computed wizard step list"
```

---

### Task 12: Frontend — `DomainSslStep` (Cloudflare paste)

**Files:**
- Modify: `apps/frontend/src/components/setup/DomainSslStep.tsx` (fill the Task 11 placeholder)
- Test: `apps/frontend/src/components/setup/__tests__/DomainSslStep.test.tsx`

**Interfaces:**
- Consumes: `useUploadCertificatesMutation` (Task 10), `setupSlice` (store the chosen domain: add `bootstrapDomain: string | null` + `setBootstrapDomain` to the slice), `window.location.hostname` for domain pre-fill.
- Produces: on success advances the wizard; the chosen `domain` is in `setupSlice.bootstrapDomain` for `ApplyStep` (Task 13).

- [ ] **Step 1: Failing test**

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DomainSslStep } from '../DomainSslStep';

const uploadMock = vi.fn().mockReturnValue({ unwrap: () => Promise.resolve({ saved: true, sans: [] }) });
vi.mock('@/services/setupApi', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  useUploadCertificatesMutation: () => [uploadMock, { isLoading: false }],
}));

it('pre-fills domain from hostname and submits pasted certs', async () => {
  // simulate arriving via https://admin.example.com
  Object.defineProperty(window, 'location', {
    value: { hostname: 'admin.example.com' }, writable: true,
  });
  render(<DomainSslStep />, { wrapper: TestProviders });
  expect(screen.getByLabelText(/domain/i)).toHaveValue('example.com'); // admin. prefix stripped
  fireEvent.change(screen.getByLabelText(/origin certificate/i), { target: { value: 'CERT' } });
  fireEvent.change(screen.getByLabelText(/private key/i), { target: { value: 'KEY' } });
  fireEvent.click(screen.getByRole('button', { name: /install certificate/i }));
  await waitFor(() =>
    expect(uploadMock).toHaveBeenCalledWith({
      domain: 'example.com', certificatePem: 'CERT', privateKeyPem: 'KEY',
    }),
  );
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm test -- DomainSslStep` → FAIL (placeholder renders null).

- [ ] **Step 3: Implement**

```tsx
// apps/frontend/src/components/setup/DomainSslStep.tsx
import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { useUploadCertificatesMutation } from '@/services/setupApi';
import { setBootstrapDomain, nextWizardStep } from '@/store/slices/setupSlice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

function guessDomain(): string {
  const h = window.location.hostname;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h === 'localhost') return '';
  return h.replace(/^(admin|www)\./, '');
}

export function DomainSslStep() {
  const dispatch = useDispatch();
  const [domain, setDomain] = useState(guessDomain());
  const [certPem, setCertPem] = useState('');
  const [keyPem, setKeyPem] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [upload, { isLoading }] = useUploadCertificatesMutation();

  const submit = async () => {
    setError(null);
    try {
      await upload({ domain, certificatePem: certPem, privateKeyPem: keyPem }).unwrap();
      dispatch(setBootstrapDomain(domain));
      dispatch(nextWizardStep());
    } catch (e: any) {
      setError(e?.data?.message ?? 'Certificate validation failed');
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Domain &amp; SSL</h3>
      <p className="text-sm text-muted-foreground">
        Paste the <strong>Cloudflare Origin Certificate</strong> for your domain
        (Cloudflare dashboard → SSL/TLS → Origin Server → Create Certificate; include{' '}
        <code>*.yourdomain</code> in the hostnames). Set your zone&apos;s SSL mode to{' '}
        <strong>Full</strong> now, and <strong>Full (strict)</strong> after this wizard finishes.
      </p>
      <div>
        <Label htmlFor="bs-domain">Domain</Label>
        <Input id="bs-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />
      </div>
      <div>
        <Label htmlFor="bs-cert">Origin Certificate (PEM)</Label>
        <Textarea id="bs-cert" rows={6} value={certPem} onChange={(e) => setCertPem(e.target.value)} placeholder="-----BEGIN CERTIFICATE-----" />
      </div>
      <div>
        <Label htmlFor="bs-key">Private Key (PEM)</Label>
        <Textarea id="bs-key" rows={6} value={keyPem} onChange={(e) => setKeyPem(e.target.value)} placeholder="-----BEGIN PRIVATE KEY-----" />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button className="w-full" disabled={!domain || !certPem || !keyPem || isLoading} onClick={submit}>
        {isLoading ? 'Validating…' : 'Install certificate'}
      </Button>
    </div>
  );
}
```

Add `bootstrapDomain: string | null` + `setBootstrapDomain` to `setupSlice` (same pattern as `setClaimToken` in Task 11).

- [ ] **Step 4: Run tests** — `pnpm test -- DomainSslStep` → PASS; `tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/setup/DomainSslStep.tsx apps/frontend/src/components/setup/__tests__/ apps/frontend/src/store/slices/setupSlice.ts
git commit -m "feat(bootstrap): domain + Cloudflare origin-cert paste step"
```

---

### Task 13: Frontend — `ApplyStep` (apply, poll, redirect)

**Files:**
- Modify: `apps/frontend/src/components/setup/ApplyStep.tsx` (fill the Task 11 placeholder)
- Test: `apps/frontend/src/components/setup/__tests__/ApplyStep.test.tsx`

**Interfaces:**
- Consumes: `useApplyBootstrapMutation` (Task 10), `setupSlice.bootstrapDomain` (Task 12).
- Produces: calls apply, shows "Switching to https://admin.<domain>…", polls `https://admin.<domain>/api/setup/status` every 3 s (plain `fetch`, `mode: 'cors'` — the restarted backend's CORS now allows the new origin), and sets `window.location.href = adminUrl` once a poll succeeds. Also reminds the user to flip Cloudflare to **Full (strict)**.

- [ ] **Step 1: Failing test**

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApplyStep } from '../ApplyStep';

const applyMock = vi.fn().mockReturnValue({
  unwrap: () => Promise.resolve({ applying: true, adminUrl: 'https://admin.example.com' }),
});
vi.mock('@/services/setupApi', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  useApplyBootstrapMutation: () => [applyMock, { isLoading: false }],
}));

it('applies with the stored domain and shows the switching state', async () => {
  render(<ApplyStep />, { wrapper: TestProviders /* seed store: bootstrapDomain='example.com' */ });
  fireEvent.click(screen.getByRole('button', { name: /finish setup/i }));
  await waitFor(() =>
    expect(applyMock).toHaveBeenCalledWith({ domain: 'example.com', proxyMode: 'cloudflare' }),
  );
  expect(await screen.findByText(/switching to/i)).toBeInTheDocument();
  expect(screen.getByText(/full \(strict\)/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm test -- ApplyStep` → FAIL.

- [ ] **Step 3: Implement**

```tsx
// apps/frontend/src/components/setup/ApplyStep.tsx
import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '@/store';
import { useApplyBootstrapMutation } from '@/services/setupApi';
import { Button } from '@/components/ui/button';

export function ApplyStep() {
  const domain = useSelector((s: RootState) => s.setup.wizard.bootstrapDomain);
  const [apply, { isLoading }] = useApplyBootstrapMutation();
  const [adminUrl, setAdminUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (!adminUrl) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${adminUrl}/api/setup/status`, { mode: 'cors' });
        if (res.ok) {
          clearInterval(pollRef.current);
          window.location.href = adminUrl;
        }
      } catch {
        /* backend still restarting / DNS still propagating — keep polling */
      }
    }, 3000);
    return () => clearInterval(pollRef.current);
  }, [adminUrl]);

  const finish = async () => {
    if (!domain) return;
    setError(null);
    try {
      const res = await apply({ domain, proxyMode: 'cloudflare' }).unwrap();
      setAdminUrl(res.adminUrl);
    } catch (e: any) {
      setError(e?.data?.message ?? 'Apply failed');
    }
  };

  if (adminUrl) {
    return (
      <div className="space-y-4 text-center">
        <h3 className="text-lg font-semibold">Switching to {adminUrl}…</h3>
        <p className="text-sm text-muted-foreground">
          The server is restarting with its new identity. This page will redirect automatically.
        </p>
        <p className="text-sm">
          Last step afterwards: set your Cloudflare zone&apos;s SSL mode to{' '}
          <strong>Full (strict)</strong> — your origin now has a trusted certificate.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Finish</h3>
      <p className="text-sm text-muted-foreground">
        This applies <strong>{domain}</strong> as the server&apos;s domain, switches nginx to your
        new certificate, and restarts the backend.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button className="w-full" disabled={!domain || isLoading} onClick={finish}>
        {isLoading ? 'Applying…' : 'Finish setup'}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests** — `pnpm test -- ApplyStep` → PASS; full frontend suite `pnpm test` → PASS; `tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/setup/
git commit -m "feat(bootstrap): apply step with restart polling and redirect"
```

---

### Task 14: `setup.sh --bootstrap` mode

**Files:**
- Modify: `setup.sh`

**Interfaces:**
- Produces: `./setup.sh --bootstrap` — fully non-interactive: generates all secrets (reusing the existing `generate_secrets` + `create_env_file` functions with `PRIMARY_DOMAIN` left EMPTY and cookie values on localhost-safe defaults), generates and persists a claim token, creates `bootstrap/` dir, prints the next-step banner. **Does not** prompt, does not touch SSL. The DO image's first-boot script (other spec) will call exactly this then `./start.sh`.

- [ ] **Step 1: Implement**

Add `--bootstrap` to the arg parser (`INTERACTIVE=false; BOOTSTRAP_MODE=true`). Then a dedicated path before the normal flow:

```sh
if [ "$BOOTSTRAP_MODE" = true ]; then
    print_header
    check_prerequisites
    check_existing_env          # respects --force semantics; aborts if .env exists without it

    PRIMARY_DOMAIN=""           # identity comes later from the web wizard via instance.json
    POSTGRES_PASSWORD=$(generate_password 32)
    MINIO_ROOT_USER="$DEFAULT_MINIO_USER"
    MINIO_ROOT_PASSWORD=$(generate_password 32)
    REDIS_PASSWORD=$(generate_password 32)
    generate_secrets

    # create_env_file derives cookie/frontend values from PRIMARY_DOMAIN; with an
    # empty domain we want the localhost-safe branch — set it explicitly:
    PRIMARY_DOMAIN="localhost" create_env_file
    set_env_var "PRIMARY_DOMAIN" ""      # blank until applied via the wizard

    # Claim token (the web wizard's ONBOARDING_TOKEN)
    CLAIM_TOKEN=$(generate_hex_secret 16)
    echo "" >> .env
    echo "# Web-bootstrap claim token (shown in the server's login banner)" >> .env
    echo "ONBOARDING_TOKEN=${CLAIM_TOKEN}" >> .env

    mkdir -p bootstrap ssl
    verify_configuration

    echo ""
    print_success "Bootstrap configuration ready"
    echo ""
    echo "  Claim token: ${CLAIM_TOKEN}"
    echo ""
    echo "  Next: ./start.sh, then finish setup in your browser:"
    echo "    1. Point your domain at this server (Cloudflare: A records @ and *, SSL mode: Full)"
    echo "    2. Open https://admin.<your-domain>  (or https://<server-ip> — expect a browser warning)"
    echo "    3. Enter the claim token above"
    echo ""
    exit 0
fi
```

Also document `--bootstrap` in the header comment block of `setup.sh`.

- [ ] **Step 2: Verify**

```bash
shellcheck setup.sh
cd "$(mktemp -d)" && cp -r /path/to/ce/. . && rm -f .env
./setup.sh --bootstrap
grep -q '^PRIMARY_DOMAIN=$' .env && echo domain-blank-ok
grep -q '^ONBOARDING_TOKEN=.' .env && echo token-ok
test -d bootstrap && echo dir-ok
```

- [ ] **Step 3: Commit**

```bash
git add setup.sh
git commit -m "feat(bootstrap): setup.sh --bootstrap non-interactive mode"
```

---

### Task 15: Full-stack smoke script + README note

**Files:**
- Create: `test-bootstrap.sh`
- Modify: `README.md` (short "Web bootstrap setup" subsection pointing at the spec)

**Interfaces:**
- Consumes: everything above.
- Produces: one command that proves the loop on any docker host: cert-less boot → wizard reachable over self-signed HTTPS → simulated apply (writes certs + instance files exactly as the backend does) → nginx transitions without restart → backend restart adopts identity.

- [ ] **Step 1: Write `test-bootstrap.sh`**

```bash
#!/bin/bash
# Smoke test for web-bootstrap mode. Run from repo root on a docker host.
# Uses test.local as the domain; requires no DNS (curl --resolve).
set -euo pipefail

fail() { echo "❌ $1"; exit 1; }
ok()   { echo "✅ $1"; }

[ -f .env ] || ./setup.sh --bootstrap
mkdir -p bootstrap ssl

echo "— boot cert-less stack —"
./start.sh
sleep 10

curl -s  -o /dev/null -w '%{http_code}' http://localhost/ | grep -q 301 || fail "port 80 should redirect"
ok "port 80 redirects to https"
curl -ks -o /dev/null -w '%{http_code}' https://localhost/ | grep -q 200 || fail "bootstrap wizard should serve on 443"
ok "wizard serves over self-signed https"
curl -ks https://localhost/api/setup/status | grep -q '"bootstrapMode":true' || fail "status should report bootstrapMode"
ok "backend reports bootstrap mode"

echo "— simulate wizard apply (certs + instance files, as the backend writes them) —"
openssl req -x509 -nodes -days 30 -newkey rsa:2048 \
  -keyout ssl/privkey.pem -out ssl/fullchain.pem \
  -subj "/CN=test.local" -addext "subjectAltName=DNS:test.local,DNS:*.test.local" 2>/dev/null
cp ssl/fullchain.pem ssl/wildcard.test.local.crt
cp ssl/privkey.pem  ssl/wildcard.test.local.key
printf '{ "version": 1, "state": "applied", "primaryDomain": "test.local", "proxyMode": "cloudflare", "sslMode": "paste" }\n' > bootstrap/instance.json
printf 'STATE=applied\nPRIMARY_DOMAIN=test.local\nPROXY_MODE=cloudflare\n' > bootstrap/instance.env

sleep 8   # watcher debounce + re-render
curl -ks --resolve admin.test.local:443:127.0.0.1 https://admin.test.local/ -o /dev/null -w '%{http_code}' \
  | grep -q 200 || fail "admin block should serve after apply (no nginx restart)"
ok "nginx transitioned to applied identity without restart"

docker compose restart backend >/dev/null
sleep 10
docker compose logs backend | grep -q "identity hydrated from instance.json" || fail "backend should hydrate identity"
ok "backend adopted instance.json identity on restart"

echo "— cleanup —"
./stop.sh
echo "🎉 bootstrap smoke test passed"
```

`chmod +x test-bootstrap.sh`.

- [ ] **Step 2: Run it** on the VPS (or any docker host with the repo): `./test-bootstrap.sh` → ends with `🎉 bootstrap smoke test passed`. Fix anything it catches before proceeding.

- [ ] **Step 3: README**

Add under the deployment/setup section:

```markdown
### Web bootstrap setup (no SSH)

A cert-less install boots into **bootstrap mode**: run `./setup.sh --bootstrap && ./start.sh`,
then finish everything in the browser — claim token, admin account, domain, and SSL
certificate — at `https://admin.<your-domain>` (Cloudflare zone on SSL mode **Full**) or
`https://<server-ip>`. Design: `docs/superpowers/specs/2026-07-20-web-bootstrap-setup-design.md`.
```

- [ ] **Step 4: Commit**

```bash
git add test-bootstrap.sh README.md
git commit -m "feat(bootstrap): full-stack smoke script + README"
```

---

## Final verification (whole feature)

- [ ] `cd apps/backend && pnpm test` — full suite green
- [ ] `cd apps/frontend && pnpm test && pnpm exec tsc --noEmit` — green
- [ ] `shellcheck setup.sh test-bootstrap.sh docker/nginx/render-main-conf.sh docker/nginx/nginx-reload-watcher.sh docker/nginx/docker-entrypoint.sh` — clean
- [ ] `./test-bootstrap.sh` — passes end-to-end
- [ ] Regression: with `bootstrap/` absent and a normal `.env` + certs, `./start.sh` boots identically to main (no `[bootstrap]` log, no bootstrap server block)
- [ ] Manual (real droplet + spare domain, per spec Testing section): CF Full → wizard → paste → apply → `https://admin.<domain>` live; second visit shows login, not wizard
- [ ] Follow-ups filed as issues: Umbrel profile plan, LE wizard path, `repos/platform` chart flag PR, docs-public pages
