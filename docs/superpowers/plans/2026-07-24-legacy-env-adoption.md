# Legacy Env-Install Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Legacy env-only CE installs are adopted into `bootstrap/instance.json` on first boot after upgrade (`origin: 'env'`), with `.env` remaining the live source of truth via boot-time re-sync — so day-2 features (LE renewal, paste-expiry reminders) activate uniformly without breaking the "edit `.env` and restart" workflow.

**Architecture:** All adoption/re-sync logic lives in the pure-Node pre-Nest module `apps/backend/src/bootstrap/instance-config.ts` (executed via the `hydrate.ts` side-effect import that is `main.ts`'s first import). `origin: 'env'` files are derived caches of `.env` (rewritten only on change, never overriding `process.env`); `origin: 'wizard'` (or absent) keeps today's semantics exactly. The renewal cron preserves existing-cert SANs for adopted installs.

**Tech Stack:** NestJS 10 + Jest (backend), `node:crypto` `X509Certificate` (issuer sniff / SAN read), POSIX sh (nginx render tests), bash (smoke test).

**Spec:** `docs/superpowers/specs/2026-07-24-legacy-env-adoption-design.md` — read it first.

## Global Constraints

- Adoption **never writes `.env`** — rollback to a pre-adoption image must be a no-op.
- Never clobber a present-but-unparseable `instance.json` (could be a wizard file with transient corruption): log and skip.
- Skip adoption when `PRIMARY_DOMAIN` is unset or `localhost`, or when `process.env.PLATFORM_MODE === 'true' || process.env.SSL_MANAGED_EXTERNALLY === 'true'` (exact check copied from `setup.service.ts:240`).
- Adopted configs omit `port80`/`realIp` (v1-style, derived by `deriveKnobs`) — byte-parity with `render-main-conf.sh`'s env fallback.
- `origin` absent ⇒ `'wizard'` semantics; `version` stays `2`; `instance.env` format unchanged.
- No failure in adoption/re-sync may crash the backend — worst case is today's env-only behavior plus a log line.
- Renewal must never drop SANs present in the current cert (legacy certbot certs carry `minio.<domain>`; the wizard set is only apex+www+admin).
- Backend: 2-space indent, Jest specs colocated `*.spec.ts`, run `cd apps/backend && pnpm test -- <pattern>`. Shell: POSIX sh for `docker/nginx/`, bash for `test-bootstrap.sh`.
- Commit prefix: `feat(env-adoption): …` (or `fix`/`test`/`docs`).
- Branch: `spec/legacy-env-adoption` (already created off `origin/main`, spec committed as `79fe308`).

## File Structure

```
apps/backend/src/bootstrap/instance-config.ts        # MODIFY: origin field, sslDir, sniffSslMode, envIdentity, deriveAdoptedConfig, adoptOrResyncEnvInstall, hydrate skip
apps/backend/src/bootstrap/instance-config.spec.ts   # MODIFY: new describe blocks
apps/backend/src/bootstrap/hydrate.ts                # MODIFY: call adoptOrResyncEnvInstall() before hydrateProcessEnv()
apps/backend/src/setup/bootstrap-setup.controller.ts # MODIFY: stamp origin:'wizard' in apply
apps/backend/src/setup/bootstrap-setup.controller.spec.ts # MODIFY: assert the stamp
apps/backend/src/setup/primary-ssl/primary-ssl.service.ts # VERIFY/MODIFY: preserve loaded origin on write
apps/backend/src/setup/primary-ssl/primary-ssl-snapshot.service.spec.ts # MODIFY: origin-preservation test
apps/backend/src/domains/ssl-certificate.service.ts  # MODIFY: extraSans param, getPrimaryCertificateSans
apps/backend/src/domains/ssl-certificate.service.spec.ts # MODIFY: SAN union + parse tests
apps/backend/src/domains/ssl-renewal.service.ts      # MODIFY: pass current SANs for origin:'env'
apps/backend/src/domains/ssl-renewal.service.spec.ts # MODIFY: adopted-install renewal tests
docker/nginx/render-main-conf.test.sh                # MODIFY: adopted-vs-pure-env parity case
test-bootstrap.sh                                    # MODIFY: opt-in legacy-upgrade leg (RUN_LEGACY_LEG=1)
```

Dependency order: Task 1 → 2 → 3 are sequential; Task 4 depends on 1; Tasks 5–6 independent of 3–4; Task 7 (docs note) last and lives in the separate `repos/docs-public` repo.

---

### Task 1: `origin` field + `sniffSslMode()`

**Files:**
- Modify: `apps/backend/src/bootstrap/instance-config.ts`
- Test: `apps/backend/src/bootstrap/instance-config.spec.ts`

**Interfaces:**
- Consumes: existing `SslMode` type, `fs`/`path` imports already in the module.
- Produces (later tasks rely on these exact names):
  - `InstanceConfig.origin?: 'wizard' | 'env'` (absent ⇒ wizard semantics)
  - `sslDir(): string` — `process.env.SSL_CERT_PATH || '/etc/nginx/ssl'`
  - `sniffSslMode(dir?: string, envProxyMode?: string): SslMode` — never throws; returns `'letsencrypt'` or `'paste'` only.

- [ ] **Step 1: Write the failing tests**

Append to `instance-config.spec.ts` (inside the top-level `describe`; `execFileSync`, `fs`, `os`, `path` are already imported):

```ts
describe('sniffSslMode', () => {
  let sslTmp: string;
  beforeEach(() => {
    sslTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bffless-ssl-'));
  });
  afterEach(() => {
    fs.rmSync(sslTmp, { recursive: true, force: true });
  });

  function mintCert(subj: string): void {
    execFileSync('openssl', [
      'req', '-x509', '-nodes', '-days', '2', '-newkey', 'rsa:2048',
      '-keyout', path.join(sslTmp, 'privkey.pem'),
      '-out', path.join(sslTmp, 'fullchain.pem'),
      '-subj', subj,
    ], { stdio: 'ignore' });
  }

  it('returns letsencrypt for an LE-issued cert when PROXY_MODE is not cloudflare', () => {
    mintCert("/O=Let's Encrypt/CN=R11");
    expect(sniffSslMode(sslTmp, 'none')).toBe('letsencrypt');
    expect(sniffSslMode(sslTmp, undefined)).toBe('letsencrypt'); // unset counts as not-cloudflare
  });

  it('returns paste for an LE cert behind cloudflare', () => {
    mintCert("/O=Let's Encrypt/CN=R11");
    expect(sniffSslMode(sslTmp, 'cloudflare')).toBe('paste');
  });

  it('returns paste for a non-LE issuer (Cloudflare Origin style)', () => {
    mintCert('/O=CloudFlare, Inc./CN=CloudFlare Origin Certificate');
    expect(sniffSslMode(sslTmp, 'none')).toBe('paste');
  });

  it('returns paste when fullchain.pem is missing or unparseable', () => {
    expect(sniffSslMode(sslTmp, 'none')).toBe('paste');
    fs.writeFileSync(path.join(sslTmp, 'fullchain.pem'), 'not a pem');
    expect(sniffSslMode(sslTmp, 'none')).toBe('paste');
  });
});
```

Add `sniffSslMode` to the import list at the top of the spec.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && pnpm test -- instance-config`
Expected: FAIL — `sniffSslMode` is not exported.

- [ ] **Step 3: Implement**

In `instance-config.ts`, add to the imports:

```ts
import { X509Certificate } from 'crypto';
```

Add `origin` to `InstanceConfig` (after `state`):

```ts
  // Who owns this file. 'wizard': the web wizard / admin UI wrote it — file is
  // truth, hydration overrides process.env (absent = 'wizard': all files
  // written before this field existed are wizard files). 'env': adopted from a
  // legacy .env install — .env is truth and this file is a derived cache,
  // re-synced on every boot by adoptOrResyncEnvInstall().
  origin?: 'wizard' | 'env';
```

Add below `bootstrapDir()`:

```ts
export function sslDir(): string {
  return process.env.SSL_CERT_PATH || '/etc/nginx/ssl';
}

// Adoption-time sslMode inference for legacy env-only installs (spec §2): an
// LE-issued primary cert on a non-cloudflare install means the operator used
// the setup.sh certbot path, whose renewal is broken by default (one-time
// copy into ssl/, standalone renew can't bind port 80) — adopt as
// 'letsencrypt' so the in-app renewer takes over. Everything else (CF origin
// certs, unknown issuers, missing/unreadable cert) adopts as 'paste'.
// Unset PROXY_MODE counts as not-cloudflare, matching render-main-conf.sh's
// derivation. Never throws: sniff failure must not prevent boot.
export function sniffSslMode(
  dir: string = sslDir(),
  envProxyMode: string | undefined = process.env.PROXY_MODE,
): SslMode {
  if (envProxyMode === 'cloudflare') return 'paste';
  try {
    const pem = fs.readFileSync(path.join(dir, 'fullchain.pem'));
    const cert = new X509Certificate(pem);
    if (/O=Let's Encrypt/.test(cert.issuer)) return 'letsencrypt';
  } catch {
    // missing/unreadable → paste
  }
  return 'paste';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && pnpm test -- instance-config`
Expected: PASS (all pre-existing cases too).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/bootstrap/instance-config.ts apps/backend/src/bootstrap/instance-config.spec.ts
git commit -m "feat(env-adoption): origin field + sslMode issuer sniff"
```

---

### Task 2: adoption + re-sync + hydrate skip

**Files:**
- Modify: `apps/backend/src/bootstrap/instance-config.ts`
- Modify: `apps/backend/src/bootstrap/hydrate.ts`
- Test: `apps/backend/src/bootstrap/instance-config.spec.ts`

**Interfaces:**
- Consumes: `sniffSslMode`, `sslDir` (Task 1); existing `loadInstanceConfig`, `writeInstanceConfig`, `deriveIdentityEnv`, `bootstrapDir`.
- Produces:
  - `envIdentity(env?: NodeJS.ProcessEnv): { primaryDomain: string; proxyMode?: ProxyMode } | null`
  - `deriveAdoptedConfig(env?: NodeJS.ProcessEnv, ssl?: string): InstanceConfig | null`
  - `adoptOrResyncEnvInstall(dir?: string, env?: NodeJS.ProcessEnv, ssl?: string): InstanceConfig | null`
  - Changed behavior: `hydrateProcessEnv()` no longer assigns to `process.env` when `cfg.origin === 'env'` (still returns the config).

- [ ] **Step 1: Write the failing tests**

Append to `instance-config.spec.ts`. These tests mutate `process.env`, so snapshot/restore it:

```ts
describe('env adoption & re-sync', () => {
  let sslTmp: string;
  let envBackup: NodeJS.ProcessEnv;

  const legacyEnv = (over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv =>
    ({ PRIMARY_DOMAIN: 'legacy.com', PROXY_MODE: 'cloudflare', ...over } as NodeJS.ProcessEnv);

  beforeEach(() => {
    envBackup = { ...process.env };
    sslTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bffless-ssl-'));
  });
  afterEach(() => {
    process.env = envBackup;
    fs.rmSync(sslTmp, { recursive: true, force: true });
  });

  it('adopts a legacy env install: applied, origin env, no knobs, sniffed sslMode', () => {
    const cfg = adoptOrResyncEnvInstall(dir, legacyEnv(), sslTmp);
    expect(cfg).toMatchObject({
      version: 2, state: 'applied', origin: 'env',
      primaryDomain: 'legacy.com', proxyMode: 'cloudflare', sslMode: 'paste',
    });
    expect(cfg!.port80).toBeUndefined();
    expect(cfg!.realIp).toBeUndefined();
    const onDisk = loadInstanceConfig(dir);
    expect(onDisk).toEqual(cfg);
    expect(fs.readFileSync(path.join(dir, 'instance.env'), 'utf8')).toContain('PRIMARY_DOMAIN=legacy.com');
  });

  it('omits proxyMode when PROXY_MODE is unset or unknown', () => {
    const cfg = adoptOrResyncEnvInstall(dir, legacyEnv({ PROXY_MODE: undefined }), sslTmp);
    expect(cfg!.proxyMode).toBeUndefined();
    fs.rmSync(path.join(dir, 'instance.json'));
    const cfg2 = adoptOrResyncEnvInstall(dir, legacyEnv({ PROXY_MODE: 'bogus' }), sslTmp);
    expect(cfg2!.proxyMode).toBeUndefined();
  });

  it('skips adoption for localhost, missing domain, and platform mode', () => {
    expect(adoptOrResyncEnvInstall(dir, legacyEnv({ PRIMARY_DOMAIN: 'localhost' }), sslTmp)).toBeNull();
    expect(adoptOrResyncEnvInstall(dir, legacyEnv({ PRIMARY_DOMAIN: undefined }), sslTmp)).toBeNull();
    expect(adoptOrResyncEnvInstall(dir, legacyEnv({ PLATFORM_MODE: 'true' }), sslTmp)).toBeNull();
    expect(adoptOrResyncEnvInstall(dir, legacyEnv({ SSL_MANAGED_EXTERNALLY: 'true' }), sslTmp)).toBeNull();
    expect(fs.existsSync(path.join(dir, 'instance.json'))).toBe(false);
  });

  it('never touches a wizard-origin file (explicit or absent origin)', () => {
    writeInstanceConfig({ version: 2, state: 'applied', primaryDomain: 'wizard.com', proxyMode: 'none', sslMode: 'paste' }, dir);
    const before = fs.readFileSync(path.join(dir, 'instance.json'), 'utf8');
    expect(adoptOrResyncEnvInstall(dir, legacyEnv(), sslTmp)).toBeNull();
    expect(fs.readFileSync(path.join(dir, 'instance.json'), 'utf8')).toBe(before);
  });

  it('leaves a corrupt instance.json untouched', () => {
    fs.writeFileSync(path.join(dir, 'instance.json'), '{not json');
    expect(adoptOrResyncEnvInstall(dir, legacyEnv(), sslTmp)).toBeNull();
    expect(fs.readFileSync(path.join(dir, 'instance.json'), 'utf8')).toBe('{not json');
  });

  it('re-syncs an env-origin file when .env changes, and skips the write when unchanged', () => {
    adoptOrResyncEnvInstall(dir, legacyEnv(), sslTmp);
    const writeSpy = jest.spyOn(fs, 'writeFileSync');
    adoptOrResyncEnvInstall(dir, legacyEnv(), sslTmp); // unchanged
    expect(writeSpy).not.toHaveBeenCalled();
    const cfg = adoptOrResyncEnvInstall(dir, legacyEnv({ PRIMARY_DOMAIN: 'renamed.com' }), sslTmp);
    expect(cfg!.primaryDomain).toBe('renamed.com');
    expect(loadInstanceConfig(dir)!.primaryDomain).toBe('renamed.com');
    writeSpy.mockRestore();
  });

  it('hydrateProcessEnv does not override process.env for origin:env files', () => {
    adoptOrResyncEnvInstall(dir, legacyEnv(), sslTmp);
    delete process.env.FRONTEND_URL;
    process.env.PRIMARY_DOMAIN = 'fresh-from-env.com';
    const cfg = hydrateProcessEnv(dir);
    expect(cfg!.origin).toBe('env');
    expect(process.env.PRIMARY_DOMAIN).toBe('fresh-from-env.com'); // NOT clobbered by the file
    expect(process.env.FRONTEND_URL).toBeUndefined();
  });

  it('hydrateProcessEnv still overrides process.env for wizard files', () => {
    writeInstanceConfig({ version: 2, state: 'applied', origin: 'wizard', primaryDomain: 'wizard.com', proxyMode: 'none', sslMode: 'paste' }, dir);
    hydrateProcessEnv(dir);
    expect(process.env.PRIMARY_DOMAIN).toBe('wizard.com');
    expect(process.env.FRONTEND_URL).toBe('https://www.wizard.com');
  });
});
```

Add `envIdentity`, `deriveAdoptedConfig`, `adoptOrResyncEnvInstall`, `sniffSslMode`, `sslDir` to the spec's import list.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && pnpm test -- instance-config`
Expected: FAIL — `adoptOrResyncEnvInstall` not exported; the two `hydrateProcessEnv` origin tests fail.

- [ ] **Step 3: Implement**

In `instance-config.ts`, add after `sniffSslMode`:

```ts
// Identity as expressed by a legacy .env install (docker-compose passes .env
// into the backend's environment). Null = not an adoptable install: no/localhost
// domain, or a platform workspace (identity is platform-managed there — same
// check as SetupService.isPlatformManaged).
export function envIdentity(
  env: NodeJS.ProcessEnv = process.env,
): { primaryDomain: string; proxyMode?: ProxyMode } | null {
  if (env.PLATFORM_MODE === 'true' || env.SSL_MANAGED_EXTERNALLY === 'true') return null;
  const d = env.PRIMARY_DOMAIN;
  if (!d || d === 'localhost') return null;
  const pm = env.PROXY_MODE;
  const proxyMode = pm === 'cloudflare' || pm === 'proxy' || pm === 'none' ? pm : undefined;
  return { primaryDomain: d, proxyMode };
}

// The instance.json a legacy env install maps to. Knobs (port80/realIp) are
// deliberately omitted (v1-style): deriveKnobs and render-main-conf.sh's env
// fallback derive identical values, so adoption changes nothing nginx renders.
export function deriveAdoptedConfig(
  env: NodeJS.ProcessEnv = process.env,
  ssl: string = sslDir(),
): InstanceConfig | null {
  const id = envIdentity(env);
  if (!id) return null;
  const cfg: InstanceConfig = {
    version: 2,
    state: 'applied',
    origin: 'env',
    primaryDomain: id.primaryDomain,
    sslMode: sniffSslMode(ssl, env.PROXY_MODE),
  };
  if (id.proxyMode) cfg.proxyMode = id.proxyMode;
  return cfg;
}

// Boot-time adoption/re-sync for legacy env installs (spec §§2–3). Rules:
//   - no instance.json + env identity present → write an adopted file
//   - origin:'env' file → re-derive from env, rewrite only if changed
//   - wizard file (origin absent/'wizard') or corrupt file → never touched
// For origin:'env', .env is truth and the files are derived caches — which is
// also why hydrateProcessEnv skips its process.env override for them.
// Must never throw: any failure degrades to today's env-only behavior.
export function adoptOrResyncEnvInstall(
  dir: string = bootstrapDir(),
  env: NodeJS.ProcessEnv = process.env,
  ssl: string = sslDir(),
): InstanceConfig | null {
  try {
    const jsonPath = path.join(dir, 'instance.json');
    const exists = fs.existsSync(jsonPath);
    const existing = loadInstanceConfig(dir);
    if (exists && !existing) {
      console.warn('[bootstrap] instance.json present but unreadable — leaving it untouched');
      return null;
    }
    if (existing && existing.origin !== 'env') {
      const d = env.PRIMARY_DOMAIN;
      if (d && d !== 'localhost' && d !== existing.primaryDomain) {
        console.warn(
          `[bootstrap] .env PRIMARY_DOMAIN=${d} differs from wizard-managed instance.json ` +
            `(${existing.primaryDomain}); instance.json wins — change identity via the admin UI`,
        );
      }
      return null;
    }
    const derived = deriveAdoptedConfig(env, ssl);
    if (!derived) return null;
    if (existing && JSON.stringify(existing) === JSON.stringify(derived)) return existing;
    writeInstanceConfig(derived, dir);
    console.log(
      `[bootstrap] ${existing ? 're-synced' : 'adopted'} env identity into instance.json: ${derived.primaryDomain}`,
    );
    return derived;
  } catch (err) {
    console.warn(`[bootstrap] env adoption skipped: ${(err as Error).message}`);
    return null;
  }
}
```

Change `hydrateProcessEnv`:

```ts
export function hydrateProcessEnv(dir: string = bootstrapDir()): InstanceConfig | null {
  const cfg = loadInstanceConfig(dir);
  if (!cfg) return null;
  // origin:'env' — .env is truth and already lives in process.env; assigning
  // the file's values would resurrect stale identity on the first boot after
  // an .env edit (SuperTokens captures env before re-sync could correct it).
  if (cfg.origin !== 'env') {
    Object.assign(process.env, deriveIdentityEnv(cfg));
  }
  return cfg;
}
```

In `hydrate.ts`, replace the import + call block at the bottom:

```ts
import { adoptOrResyncEnvInstall, hydrateProcessEnv } from './instance-config';

// Legacy env-install adoption/re-sync must run before hydration so the file
// hydrate reads is never stale relative to .env (spec §3).
adoptOrResyncEnvInstall();
const instanceCfg = hydrateProcessEnv();
if (instanceCfg?.state === 'applied') {
  // eslint-disable-next-line no-console
  console.log(
    `[bootstrap] identity hydrated from instance.json: ${instanceCfg.primaryDomain}` +
      (instanceCfg.origin === 'env' ? ' (env-adopted; .env remains authoritative)' : ''),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && pnpm test -- instance-config`
Expected: PASS. Also run `cd apps/backend && pnpm test -- hydrate` — the existing hydrate spec must still pass (its fixtures have no `origin`, i.e. wizard semantics).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/bootstrap/instance-config.ts apps/backend/src/bootstrap/instance-config.spec.ts apps/backend/src/bootstrap/hydrate.ts
git commit -m "feat(env-adoption): adopt & re-sync legacy env installs at boot"
```

---

### Task 3: origin stamping & preservation at the writers

**Files:**
- Modify: `apps/backend/src/setup/bootstrap-setup.controller.ts` (the `writeInstanceConfig({...})` call near line 97)
- Verify/Modify: `apps/backend/src/setup/primary-ssl/primary-ssl.service.ts` (the `writeInstanceConfig(next)` call near line 169)
- Verify: `apps/backend/src/setup/primary-ssl/primary-ssl-snapshot.service.ts` (line ~87 rewrites a loaded cfg)
- Test: `apps/backend/src/setup/bootstrap-setup.controller.spec.ts`, `apps/backend/src/setup/primary-ssl/primary-ssl-snapshot.service.spec.ts`

**Interfaces:**
- Consumes: `InstanceConfig.origin` (Task 1).
- Produces: the graduation rule — the wizard **apply** endpoint stamps `origin: 'wizard'`; mechanical rewrites (snapshot re-baselining) and day-2 cert-source changes **preserve** the loaded origin (cert actions must not silently stop `.env` edits from working; sslMode re-sync tracks cert reality anyway, per spec §3).

- [ ] **Step 1: Write the failing tests**

In `bootstrap-setup.controller.spec.ts`, inside an existing apply test that spies on `writeInstanceConfig`, add (or extend the closest existing assertion on the spy's argument):

```ts
it('apply stamps origin wizard so the install graduates from env adoption', async () => {
  const write = jest
    .spyOn(require('../bootstrap/instance-config'), 'writeInstanceConfig')
    .mockImplementation(() => undefined);
  await controller.apply(validApplyDto()); // reuse the spec's existing valid-DTO helper/fixture
  expect(write).toHaveBeenCalledWith(expect.objectContaining({ origin: 'wizard' }));
});
```

(Adapt the `controller.apply(...)` invocation to match how the surrounding tests in that file call apply — same DTO fixture, same spies for its other collaborators.)

In `primary-ssl-snapshot.service.spec.ts`, add:

```ts
it('re-baselining preserves an env origin instead of graduating it', () => {
  writeInstanceConfig({ version: 2, state: 'applied', origin: 'env', primaryDomain: 'a.com', proxyMode: 'none', sslMode: 'paste' }, dir);
  // invoke the same snapshot write path the surrounding tests use
  expect(loadInstanceConfig(dir)!.origin).toBe('env');
});
```

(Fill the middle line with the exact service call the file's neighboring tests use to trigger the `writeInstanceConfig(cfg)` write at `primary-ssl-snapshot.service.ts:87`.)

- [ ] **Step 2: Run tests to verify the controller one fails**

Run: `cd apps/backend && pnpm test -- bootstrap-setup.controller`
Expected: FAIL — apply's written config has no `origin`.
Run: `cd apps/backend && pnpm test -- primary-ssl-snapshot`
Expected: likely PASS already (the service rewrites the loaded object, so the field rides along). If it fails, the service strips fields — fix it to spread the loaded config.

- [ ] **Step 3: Implement**

In `bootstrap-setup.controller.ts`, add `origin: 'wizard'` to the object literal passed to `writeInstanceConfig` (~line 97):

```ts
    writeInstanceConfig({
      version: 2,
      state: 'applied',
      origin: 'wizard',
      // ...existing fields unchanged
```

In `primary-ssl.service.ts`, inspect how `next` is built for the `writeInstanceConfig(next)` call (~line 169). If it spreads the loaded config (`{ ...cfg, ... }`), no change. If it constructs a fresh object, carry the field: `origin: cfg.origin`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && pnpm test -- "bootstrap-setup|primary-ssl"`
Expected: PASS, including all pre-existing cases.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/setup
git commit -m "feat(env-adoption): apply stamps origin wizard; cert writers preserve origin"
```

---

### Task 4: renewal SAN preservation for adopted installs

**Files:**
- Modify: `apps/backend/src/domains/ssl-certificate.service.ts` (`requestPrimaryDomainCertificate`, ~line 503; new `getPrimaryCertificateSans`)
- Modify: `apps/backend/src/domains/ssl-renewal.service.ts` (`checkAndRenewPrimary`, ~line 204)
- Test: `apps/backend/src/domains/ssl-certificate.service.spec.ts`, `apps/backend/src/domains/ssl-renewal.service.spec.ts`

**Interfaces:**
- Consumes: `InstanceConfig.origin` (Task 1).
- Produces:
  - `requestPrimaryDomainCertificate(domain: string, extraSans?: string[])` — final SAN set is the deduped union `[domain, www.<domain>, admin.<domain>, ...extraSans]`; return shape unchanged.
  - `getPrimaryCertificateSans(): string[] | null` — DNS SANs of the current `<SSL_CERT_PATH>/fullchain.pem`, null when absent/unparseable/empty.

- [ ] **Step 1: Write the failing tests**

In `ssl-certificate.service.spec.ts` (mock/`MOCK_SSL` mode, following the file's existing service construction):

```ts
it('requestPrimaryDomainCertificate unions extraSans without duplicates', async () => {
  const result = await service.requestPrimaryDomainCertificate('example.com', [
    'example.com', 'minio.example.com', 'www.example.com',
  ]);
  expect(result.success).toBe(true);
  expect(result.sans).toEqual([
    'example.com', 'www.example.com', 'admin.example.com', 'minio.example.com',
  ]);
});

it('getPrimaryCertificateSans reads DNS SANs from fullchain.pem', () => {
  // Mint a cert with SANs into the spec's temp SSL_CERT_PATH dir:
  execFileSync('openssl', [
    'req', '-x509', '-nodes', '-days', '2', '-newkey', 'rsa:2048',
    '-keyout', path.join(sslTmp, 'privkey.pem'),
    '-out', path.join(sslTmp, 'fullchain.pem'),
    '-subj', '/CN=example.com',
    '-addext', 'subjectAltName=DNS:example.com,DNS:www.example.com,DNS:minio.example.com',
  ], { stdio: 'ignore' });
  expect(service.getPrimaryCertificateSans()).toEqual([
    'example.com', 'www.example.com', 'minio.example.com',
  ]);
});

it('getPrimaryCertificateSans returns null when the cert is missing', () => {
  expect(service.getPrimaryCertificateSans()).toBeNull();
});
```

(Use the spec's existing pattern for pointing `SSL_CERT_PATH` at a temp dir; create one if the file doesn't have one yet.)

In `ssl-renewal.service.spec.ts` (it already `jest.mock('../bootstrap/instance-config')`s and drives `loadInstanceConfig` via `mockReturnValue`):

```ts
it('renews an env-adopted install with the current cert SAN list preserved', async () => {
  (loadInstanceConfig as jest.Mock).mockReturnValue({
    version: 2, state: 'applied', origin: 'env',
    primaryDomain: 'example.com', proxyMode: 'none', sslMode: 'letsencrypt',
  });
  sslCertificateService.getPrimaryCertificateExpiryDays.mockReturnValue(5);
  sslCertificateService.getPrimaryCertificateSans.mockReturnValue([
    'example.com', 'www.example.com', 'admin.example.com', 'minio.example.com',
  ]);
  sslCertificateService.requestPrimaryDomainCertificate.mockResolvedValue({ success: true });
  await service.handleCron(); // the spec's existing cron entry-point invocation
  expect(sslCertificateService.requestPrimaryDomainCertificate).toHaveBeenCalledWith(
    'example.com',
    ['example.com', 'www.example.com', 'admin.example.com', 'minio.example.com'],
  );
});

it('renews a wizard install without a SAN override', async () => {
  (loadInstanceConfig as jest.Mock).mockReturnValue({
    version: 2, state: 'applied',
    primaryDomain: 'example.com', proxyMode: 'none', sslMode: 'letsencrypt',
  });
  sslCertificateService.getPrimaryCertificateExpiryDays.mockReturnValue(5);
  sslCertificateService.requestPrimaryDomainCertificate.mockResolvedValue({ success: true });
  await service.handleCron();
  expect(sslCertificateService.requestPrimaryDomainCertificate).toHaveBeenCalledWith(
    'example.com', undefined,
  );
});
```

(Match the mock-service object and cron invocation names to the file's existing tests around line 148 — the renewal spec already has a mocked `sslCertificateService` and drives the daily cron; extend that mock with `getPrimaryCertificateSans`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && pnpm test -- "ssl-certificate|ssl-renewal"`
Expected: FAIL — no `extraSans` param, no `getPrimaryCertificateSans`, renewal called with one argument.

- [ ] **Step 3: Implement**

In `ssl-certificate.service.ts` (ensure `X509Certificate` is imported from `'crypto'`; the file already uses it for paste validation — if not, add it):

```ts
  async requestPrimaryDomainCertificate(domain: string, extraSans?: string[]): Promise<{
    success: boolean;
    error?: string;
    expiresAt?: Date;
    sans?: string[];
    reused?: boolean;
  }> {
    // Renewal of an env-adopted install passes the current cert's SANs so we
    // never drop names the legacy certbot cert carried (e.g. minio.<domain>).
    const sans = Array.from(
      new Set([domain, `www.${domain}`, `admin.${domain}`, ...(extraSans ?? [])]),
    );
```

…and change the CSR to derive from `sans` instead of the hardcoded pair:

```ts
      const [key, csr] = await acme.crypto.createCsr({
        commonName: domain,
        altNames: sans.filter((d) => d !== domain),
      });
```

(The `createOrder` identifiers and `stagedPrimaryCertificate(sans)` already consume the `sans` variable — no further changes.)

Add the reader:

```ts
  /** DNS SANs of the current primary cert; null when absent/unparseable. */
  getPrimaryCertificateSans(): string[] | null {
    try {
      const pem = fs.readFileSync(join(this.getSslPath(), 'fullchain.pem'));
      const cert = new X509Certificate(pem);
      if (!cert.subjectAltName) return null;
      const sans = cert.subjectAltName
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.startsWith('DNS:'))
        .map((s) => s.slice(4));
      return sans.length ? sans : null;
    } catch {
      return null;
    }
  }
```

In `ssl-renewal.service.ts`, `checkAndRenewPrimary`, replace the request call:

```ts
    // Env-adopted installs (legacy certbot certs) may carry SANs the wizard
    // set doesn't (minio.<domain>) — renew with them preserved (spec §4).
    const extraSans =
      cfg.origin === 'env'
        ? (this.sslCertificateService.getPrimaryCertificateSans() ?? undefined)
        : undefined;
    const result = await this.sslCertificateService.requestPrimaryDomainCertificate(
      cfg.primaryDomain,
      extraSans,
    );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && pnpm test -- "ssl-certificate|ssl-renewal"`
Expected: PASS, including all pre-existing cases (the no-arg call sites — bootstrap wizard issue endpoint — are unaffected by the optional param).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/domains
git commit -m "feat(env-adoption): renewal preserves current-cert SANs on adopted installs"
```

---

### Task 5: render parity — adopted file vs pure env

**Files:**
- Modify: `docker/nginx/render-main-conf.test.sh` (append before the final `FAILURES` exit check)

**Interfaces:**
- Consumes: the harness's `assert_contains`, `setup_etc`, `run_render`, `$HERE`, `$FAILURES`.
- Produces: proof that an adopted `instance.env` renders `main.conf` byte-identically to the pure-env legacy render it replaces.

- [ ] **Step 1: Add the parity case**

Append (before the final failure-count exit):

```sh
# --- adoption parity: an env-adopted instance.env must render main.conf
# byte-identically to the pure-env legacy render it replaces (spec §2:
# adoption changes nothing nginx serves). Paths embed $ETC, so normalize. ---
setup_etc 'STATE=applied
PRIMARY_DOMAIN=example.com
PROXY_MODE=none
SSL_MODE=letsencrypt'
run_render
ADOPTED_CONF="$(mktemp)"
sed "s|$ETC|@ETC@|g" "$ETC/sites-available/main.conf" > "$ADOPTED_CONF"

# pure-env legacy install: certs present, NO instance.env, NO bootstrap
# marker (a genuine pre-wizard install never rendered bootstrap mode).
ETC="$(mktemp -d)"
mkdir -p "$ETC/ssl" "$ETC/bootstrap" "$ETC/sites-available"
cp "$HERE/sites-available/"*.template "$ETC/sites-available/"
openssl req -x509 -nodes -days 2 -newkey rsa:2048 -keyout "$ETC/ssl/privkey.pem" \
    -out "$ETC/ssl/fullchain.pem" -subj "/CN=test" 2>/dev/null
cp "$ETC/ssl/fullchain.pem" "$ETC/ssl/wildcard.example.com.crt"
cp "$ETC/ssl/privkey.pem" "$ETC/ssl/wildcard.example.com.key"
( NGINX_ETC="$ETC" CERTBOT_ROOT="$ETC/certbot" PRIMARY_DOMAIN=example.com PROXY_MODE=none \
    sh "$HERE/render-main-conf.sh" >/dev/null )
LEGACY_CONF="$(mktemp)"
sed "s|$ETC|@ETC@|g" "$ETC/sites-available/main.conf" > "$LEGACY_CONF"

if diff -u "$LEGACY_CONF" "$ADOPTED_CONF" >/dev/null; then
    echo "ok: adoption parity: adopted instance.env renders identically to pure env"
else
    echo "FAIL: adoption parity: adopted vs pure-env main.conf differ:"
    diff -u "$LEGACY_CONF" "$ADOPTED_CONF" || true
    FAILURES=$((FAILURES+1))
fi
```

- [ ] **Step 2: Run the harness**

Run: `sh docker/nginx/render-main-conf.test.sh`
Expected: all pre-existing cases plus `ok: adoption parity: ...`; exit 0. If the parity diff fails, the divergence is a real adoption bug — fix the adopted values (not the assertion) until the renders match.

- [ ] **Step 3: Commit**

```bash
git add docker/nginx/render-main-conf.test.sh
git commit -m "test(env-adoption): render parity between adopted instance.env and pure env"
```

---

### Task 6: legacy-upgrade smoke leg in test-bootstrap.sh

**Files:**
- Modify: `test-bootstrap.sh` (append after the LE-path leg block, before any final summary)

**Interfaces:**
- Consumes: the script's `fail`/`ok`/`info`/`wait_until` helpers, sandbox relocation (already active), compose project.
- Produces: an opt-in `RUN_LEGACY_LEG=1` leg proving the full loop on a real stack: legacy `.env` install boots → adoption writes `origin:'env'` files → `.env` edit + container recreate re-syncs them.

- [ ] **Step 1: Add the leg**

Append after the LE leg's `fi`:

```bash
# ===========================================================================
# Legacy-upgrade leg (opt-in: RUN_LEGACY_LEG=1). Simulates a pre-wizard
# env-only install (identity in .env, certs in ssl/, empty bootstrap/) being
# upgraded to this image: first boot must ADOPT it into bootstrap/
# instance.json with origin:'env', and a later .env edit + container
# recreate must RE-SYNC the file (spec §§2–3). Opt-in because it needs its
# own fresh stack boot, like the LE leg.
#   RUN_LEGACY_LEG=1 ./test-bootstrap.sh
# ===========================================================================
if [ "${RUN_LEGACY_LEG:-0}" = "1" ]; then
    info "legacy leg: tearing down, building a hand-made legacy env install"
    docker compose --profile postgres --profile minio --profile redis --profile supertokens down -v >/dev/null 2>&1
    rm -rf bootstrap ssl
    mkdir -p bootstrap ssl

    LEGACY_DOMAIN="legacy-test.local"
    # Legacy identity in .env, exactly as interactive setup.sh writes it.
    sed -i "s/^PRIMARY_DOMAIN=.*/PRIMARY_DOMAIN=${LEGACY_DOMAIN}/" .env
    sed -i "s|^FRONTEND_URL=.*|FRONTEND_URL=https://www.${LEGACY_DOMAIN}|" .env
    grep -q '^PROXY_MODE=' .env && sed -i 's/^PROXY_MODE=.*/PROXY_MODE=cloudflare/' .env || echo 'PROXY_MODE=cloudflare' >> .env
    # Legacy certs: self-signed stand-ins (non-LE issuer → must adopt as paste).
    openssl req -x509 -nodes -days 2 -newkey rsa:2048 -keyout ssl/privkey.pem \
        -out ssl/fullchain.pem -subj "/CN=${LEGACY_DOMAIN}" 2>/dev/null
    cp ssl/fullchain.pem "ssl/wildcard.${LEGACY_DOMAIN}.crt"
    cp ssl/privkey.pem "ssl/wildcard.${LEGACY_DOMAIN}.key"

    ./start.sh
    wait_until 90 "legacy leg: backend to adopt the env identity" -- \
        bash -c 'docker compose logs backend 2>/dev/null | grep -q "adopted env identity into instance.json"'
    grep -q '"origin": "env"' bootstrap/instance.json \
        || fail "legacy leg: adopted instance.json missing origin:env: $(cat bootstrap/instance.json)"
    grep -q "\"primaryDomain\": \"${LEGACY_DOMAIN}\"" bootstrap/instance.json \
        || fail "legacy leg: adopted instance.json has wrong domain: $(cat bootstrap/instance.json)"
    grep -q '"sslMode": "paste"' bootstrap/instance.json \
        || fail "legacy leg: self-signed legacy cert must adopt as paste: $(cat bootstrap/instance.json)"
    grep -q "PRIMARY_DOMAIN=${LEGACY_DOMAIN}" bootstrap/instance.env \
        || fail "legacy leg: instance.env not written for nginx"
    ok "legacy leg: env install adopted (origin:env, sslMode:paste)"

    # .env edit must still work: recreate the backend (compose re-reads .env)
    # and the file must follow.
    RENAMED_DOMAIN="renamed-test.local"
    sed -i "s/^PRIMARY_DOMAIN=.*/PRIMARY_DOMAIN=${RENAMED_DOMAIN}/" .env
    docker compose up -d backend >/dev/null 2>&1
    wait_until 90 "legacy leg: re-sync after .env edit" -- \
        bash -c "grep -q '\"primaryDomain\": \"${RENAMED_DOMAIN}\"' bootstrap/instance.json"
    ok "legacy leg passed: .env edit re-synced instance.json (env stays authoritative)"
else
    info "skipping legacy-upgrade leg (set RUN_LEGACY_LEG=1 to run it — needs its own fresh stack boot)"
fi
```

- [ ] **Step 2: Syntax-check and run the default legs**

Run: `bash -n test-bootstrap.sh`
Expected: no output (parses clean).
Run (on a docker host, several minutes): `RUN_LEGACY_LEG=1 ./test-bootstrap.sh`
Expected: the standard wizard legs pass, then `legacy leg passed: ...`. If no docker host is available in this session, note that in the task report — the leg runs in CI/droplet like `RUN_LE_LEG`.

- [ ] **Step 3: Commit**

```bash
git add test-bootstrap.sh
git commit -m "test(env-adoption): legacy-upgrade smoke leg (RUN_LEGACY_LEG=1)"
```

---

### Task 7: upgrade note (separate repo: docs-public)

**Files:**
- Modify: `/home/rico/bffless/repos/docs-public/docs/troubleshooting.md` (separate git repo — its own branch/commit/PR, do NOT mix into the CE branch)

**Interfaces:** none (documentation only).

- [ ] **Step 1: Add the note**

Append a section:

```markdown
## Upgrading a pre-wizard install (identity in `.env`)

Since the web-bootstrap release, instance identity lives in
`bootstrap/instance.json`. Installs set up earlier (interactive `setup.sh`,
identity in `.env`) are **adopted automatically** on the first boot after
upgrading: the backend writes `bootstrap/instance.json` marked as
env-managed. Nothing changes for you:

- Editing `PRIMARY_DOMAIN` (etc.) in `.env` and restarting keeps working —
  the file is re-synced from `.env` on every boot.
- Rolling back to an older image is safe; `.env` is never modified.

What you gain:

- **Let's Encrypt installs**: certificate renewal now happens in-app (the
  old `certbot --standalone` renewal could not re-bind port 80 while nginx
  held it). You can remove any host-side certbot cron for this domain.
- **Pasted certificates** (Cloudflare Origin or bring-your-own): you now get
  expiry-reminder emails.

If you later change your domain through the admin UI, the install graduates
to UI-managed identity and `.env` identity edits stop applying (the startup
log warns if the two ever diverge).
```

- [ ] **Step 2: Ask before committing**

This is a separate repo (`repos/docs-public/`). Create a branch, show the diff, and ask the user before committing (workspace git rules).

---

## Self-Review (completed)

- **Spec coverage:** §1 origin field → Task 1; §2 adoption + sniff → Tasks 1–2; §3 precedence/re-sync/graduation → Tasks 2–3; §4 renewal takeover + SAN rule → Task 4 (paste reminders need no code: they gate on `state: 'applied'`, which adoption provides — covered by the renewal spec's existing reminder tests plus Task 4's origin fixtures); §5 upgrade matrix → Tasks 2 (rollback/no-.env-writes, corrupt-file), 5 (render parity), 6 (real-stack adopt/re-sync); §6 error handling → Task 2 (try/catch + skip tests); §7 testing → Tasks 1–6; docs note → Task 7.
- **Adaptation points, not placeholders:** Tasks 3 and 4 reference existing spec-file fixtures/helpers by location and instruct matching the surrounding test idiom — the code shown is complete; only fixture/helper names may need renaming to the file's local conventions.
- **Type consistency:** `origin?: 'wizard' | 'env'`, `adoptOrResyncEnvInstall(dir?, env?, ssl?)`, `requestPrimaryDomainCertificate(domain, extraSans?)`, `getPrimaryCertificateSans(): string[] | null` used consistently across tasks.
