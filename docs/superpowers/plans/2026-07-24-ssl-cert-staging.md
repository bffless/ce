# SSL Cert Staging + Day-2 Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Certificates stage to `<SSL_CERT_PATH>/staging/` and are promoted to the live watched dir only by `apply()` (closes #514); the day-2 Apply button disables until a cert is actually available, with a Discard action (closes #512); the bootstrap wizard adopts the shared `Port80Choice` radio (closes #513).

**Architecture:** A plain-function staging module (`ssl-staging.ts`, mirroring `instance-config.ts`'s style) owns the staging dir; the three user-driven cert writers write there; both apply endpoints promote via atomic per-file `rename()`. The LE renewal cron keeps writing live. Status gains `stagedCert`; the UI derives `canApply` from it.

**Tech Stack:** NestJS + Jest (backend), React + RTK Query + Vitest (frontend). Repo: `/home/rico/bffless/repos/ce` (pnpm monorepo).

**Spec:** `docs/superpowers/specs/2026-07-24-ssl-cert-staging-and-followups-design.md`

## Global Constraints

- Two PRs: **PR A** = Tasks 1–9 on branch `ssl-cert-staging` (#514 + #512); **PR B** = Task 10 on branch `wizard-port80-unify` (#513). Both branch from `main`.
- Workspace rule: **every commit needs user approval** unless the user has granted blanket approval for these branches. Commit messages use conventional commits and end with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` + `Claude-Session:` trailer block from the session prompt.
- The LE renewal cron path (`ssl-renewal.service.ts`) must keep writing certs **live** — never staged. Do not modify that file.
- The nginx render script's only-if-missing guard (`render-main-conf.sh` lines ~154–157) stays as-is. No watcher (`nginx-reload-watcher.sh`) changes.
- Backend commands run from `apps/backend/`, frontend from `apps/frontend/`. Type checks: `pnpm --filter backend exec tsc --noEmit`, `pnpm --filter frontend exec tsc --noEmit` from the repo root.
- All new backend fs tests use the existing pattern: `fs.mkdtempSync(path.join(os.tmpdir(), ...))` + `process.env.SSL_CERT_PATH`, cleaned up in `afterEach`.

---

## PR A — cert staging (#514) + Apply gating (#512)

### Task 1: Branch + commit the spec

**Files:**
- Commit: `docs/superpowers/specs/2026-07-24-ssl-cert-staging-and-followups-design.md`
- Commit: `docs/superpowers/plans/2026-07-24-ssl-cert-staging.md`

- [ ] **Step 1: Create the branch**

```bash
cd /home/rico/bffless/repos/ce
git checkout main && git pull
git checkout -b ssl-cert-staging
```

- [ ] **Step 2: Commit spec + plan (with user approval)**

```bash
git add docs/superpowers/specs/2026-07-24-ssl-cert-staging-and-followups-design.md docs/superpowers/plans/2026-07-24-ssl-cert-staging.md
git commit -m "docs: spec + plan for SSL cert staging (#514, #512, #513)"
```

### Task 2: `ssl-staging.ts` module

**Files:**
- Create: `apps/backend/src/setup/ssl-staging.ts`
- Test: `apps/backend/src/setup/ssl-staging.spec.ts`

**Interfaces:**
- Produces (consumed by Tasks 3–7):
  - `sslLiveDir(): string` — `SSL_CERT_PATH` env or `/etc/nginx/ssl`
  - `sslStagingDir(): string` — `<sslLiveDir()>/staging`
  - `stagingPopulated(): boolean` — staged `fullchain.pem` AND `privkey.pem` both exist
  - `promoteStagedCertificates(): string[]` — atomically renames every staged regular file (dotfiles skipped) into the live dir, removes the staging dir, returns promoted filenames; `[]` no-op when not populated
  - `discardStagedCertificates(): void` — removes the staging dir, idempotent

- [ ] **Step 1: Write the failing test**

`apps/backend/src/setup/ssl-staging.spec.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  sslLiveDir,
  sslStagingDir,
  stagingPopulated,
  promoteStagedCertificates,
  discardStagedCertificates,
} from './ssl-staging';

describe('ssl-staging', () => {
  let liveDir: string;

  beforeEach(() => {
    liveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bffless-ssl-'));
    process.env.SSL_CERT_PATH = liveDir;
  });

  afterEach(() => {
    fs.rmSync(liveDir, { recursive: true, force: true });
    delete process.env.SSL_CERT_PATH;
  });

  const stage = (name: string, content = name) => {
    fs.mkdirSync(sslStagingDir(), { recursive: true });
    fs.writeFileSync(path.join(sslStagingDir(), name), content);
  };

  it('resolves the staging dir inside the live dir', () => {
    expect(sslStagingDir()).toBe(path.join(liveDir, 'staging'));
    expect(sslLiveDir()).toBe(liveDir);
  });

  it('stagingPopulated requires BOTH fullchain.pem and privkey.pem', () => {
    expect(stagingPopulated()).toBe(false);
    stage('fullchain.pem');
    expect(stagingPopulated()).toBe(false);
    stage('privkey.pem');
    expect(stagingPopulated()).toBe(true);
  });

  it('promote moves every staged file into the live dir and clears staging', () => {
    stage('fullchain.pem', 'CERT');
    stage('privkey.pem', 'KEY');
    stage('wildcard.example.com.crt', 'WCERT');
    stage('wildcard.example.com.key', 'WKEY');
    const promoted = promoteStagedCertificates();
    expect(promoted.sort()).toEqual([
      'fullchain.pem', 'privkey.pem', 'wildcard.example.com.crt', 'wildcard.example.com.key',
    ]);
    expect(fs.readFileSync(path.join(liveDir, 'fullchain.pem'), 'utf8')).toBe('CERT');
    expect(fs.readFileSync(path.join(liveDir, 'wildcard.example.com.key'), 'utf8')).toBe('WKEY');
    expect(fs.existsSync(sslStagingDir())).toBe(false);
  });

  it('promote overwrites existing live files', () => {
    fs.writeFileSync(path.join(liveDir, 'fullchain.pem'), 'OLD');
    stage('fullchain.pem', 'NEW');
    stage('privkey.pem', 'KEY');
    promoteStagedCertificates();
    expect(fs.readFileSync(path.join(liveDir, 'fullchain.pem'), 'utf8')).toBe('NEW');
  });

  it('promote is a no-op returning [] when staging is absent or not populated', () => {
    expect(promoteStagedCertificates()).toEqual([]);
    stage('fullchain.pem'); // no privkey — not populated
    expect(promoteStagedCertificates()).toEqual([]);
    expect(fs.existsSync(path.join(liveDir, 'fullchain.pem'))).toBe(false);
  });

  it('promote skips leftover dotfile tmp artifacts', () => {
    stage('fullchain.pem', 'CERT');
    stage('privkey.pem', 'KEY');
    stage('.fullchain.pem.123-abcd.tmp', 'JUNK');
    const promoted = promoteStagedCertificates();
    expect(promoted).not.toContain('.fullchain.pem.123-abcd.tmp');
    expect(fs.existsSync(path.join(liveDir, '.fullchain.pem.123-abcd.tmp'))).toBe(false);
  });

  it('discard removes staging and is idempotent', () => {
    stage('fullchain.pem');
    discardStagedCertificates();
    expect(fs.existsSync(sslStagingDir())).toBe(false);
    expect(() => discardStagedCertificates()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && pnpm test -- ssl-staging.spec`
Expected: FAIL — `Cannot find module './ssl-staging'`

- [ ] **Step 3: Write the implementation**

`apps/backend/src/setup/ssl-staging.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';

/**
 * Staging area for primary-domain certificates (#514). User-driven writers
 * (day-2 paste, day-2 LE issuance, bootstrap wizard upload/issuance) write
 * here; only apply() promotes into the live dir. Plain functions in the
 * style of instance-config.ts so callers don't need DI plumbing.
 *
 * The staging dir deliberately lives INSIDE the live SSL dir: same
 * filesystem, so promotion is an atomic per-file rename() (never a copy,
 * never EXDEV). The nginx reload-watcher's inotifywait is non-recursive, so
 * writes inside staging/ are invisible to it; creating/removing the dir
 * itself wakes the watcher once, which is a benign guarded re-render.
 */
export function sslLiveDir(): string {
  return process.env.SSL_CERT_PATH || '/etc/nginx/ssl';
}

export function sslStagingDir(): string {
  return path.join(sslLiveDir(), 'staging');
}

/** A stage is only usable once the generic serving pair is fully present. */
export function stagingPopulated(): boolean {
  return (
    fs.existsSync(path.join(sslStagingDir(), 'fullchain.pem')) &&
    fs.existsSync(path.join(sslStagingDir(), 'privkey.pem'))
  );
}

/**
 * Promote staging → live: rename every staged regular file over its live
 * counterpart, then drop the staging dir. Dotfiles are skipped — a crashed
 * atomic write can leave a `.<name>.<pid>-<rand>.tmp` behind, and promoting
 * junk into the watched dir would trigger a pointless reload.
 */
export function promoteStagedCertificates(): string[] {
  if (!stagingPopulated()) return [];
  const staging = sslStagingDir();
  const promoted: string[] = [];
  for (const name of fs.readdirSync(staging)) {
    if (name.startsWith('.')) continue;
    const src = path.join(staging, name);
    if (!fs.statSync(src).isFile()) continue;
    fs.renameSync(src, path.join(sslLiveDir(), name));
    promoted.push(name);
  }
  fs.rmSync(staging, { recursive: true, force: true });
  return promoted;
}

/** Abandoning a staged cert is just discarding the staging dir. Idempotent. */
export function discardStagedCertificates(): void {
  fs.rmSync(sslStagingDir(), { recursive: true, force: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && pnpm test -- ssl-staging.spec`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit (with user approval)**

```bash
git add apps/backend/src/setup/ssl-staging.ts apps/backend/src/setup/ssl-staging.spec.ts
git commit -m "feat(ssl): add cert staging module (staging dir, promote, discard) (#514)"
```

### Task 3: `BootstrapSetupService` writes to staging; presence/coverage read staging-first

**Files:**
- Modify: `apps/backend/src/setup/bootstrap-setup.service.ts` (`saveCertificates` ~line 270, `certificatesPresent` ~line 304, `assertStagedCertificateCovers` ~line 246)
- Test: `apps/backend/src/setup/bootstrap-setup.service.spec.ts`

**Interfaces:**
- Consumes: `sslStagingDir()`, `sslLiveDir()` from Task 2.
- Produces (behavioral contract for Tasks 5 & 7):
  - `saveCertificates(certPem, keyPem, domain): void` — now writes its four files into **staging/** (same names, same atomic write, same modes)
  - `certificatesPresent(domain): boolean` — true when each of the four filenames exists in staging **or** live (per-file union)
  - `assertStagedCertificateCovers(domain, servingMode): void` — reads `staging/fullchain.pem` when it exists, else live `fullchain.pem`

- [ ] **Step 1: Write the failing tests**

Add to `bootstrap-setup.service.spec.ts` (it already has `sslDir` tmp + `makeCert` helpers; `stagingDir` below means `path.join(sslDir, 'staging')`):

```ts
describe('staging semantics (#514)', () => {
  const stagingDir = () => path.join(sslDir, 'staging');

  it('saveCertificates writes the four files into staging/, not the live dir', () => {
    const { certPem, keyPem } = makeCert('example.com', keyA);
    service.saveCertificates(certPem, keyPem, 'example.com');
    for (const f of ['fullchain.pem', 'privkey.pem', 'wildcard.example.com.crt', 'wildcard.example.com.key']) {
      expect(fs.existsSync(path.join(stagingDir(), f))).toBe(true);
      expect(fs.existsSync(path.join(sslDir, f))).toBe(false);
    }
  });

  it('certificatesPresent is a per-file union of staging and live', () => {
    const { certPem, keyPem } = makeCert('example.com', keyA);
    expect(service.certificatesPresent('example.com')).toBe(false);
    // generic pair staged, wildcard pair live (the LE + real-DNS-01-wildcard case)
    fs.mkdirSync(stagingDir(), { recursive: true });
    fs.writeFileSync(path.join(stagingDir(), 'fullchain.pem'), certPem);
    fs.writeFileSync(path.join(stagingDir(), 'privkey.pem'), keyPem);
    fs.writeFileSync(path.join(sslDir, 'wildcard.example.com.crt'), certPem);
    fs.writeFileSync(path.join(sslDir, 'wildcard.example.com.key'), keyPem);
    expect(service.certificatesPresent('example.com')).toBe(true);
  });

  it('assertStagedCertificateCovers prefers the STAGED fullchain over the live one', () => {
    const a = makeCert('aaa.com', keyA); // live: covers only aaa.com
    const b = makeCert('bbb.com', keyB); // staged: covers only bbb.com
    fs.writeFileSync(path.join(sslDir, 'fullchain.pem'), a.certPem);
    fs.mkdirSync(stagingDir(), { recursive: true });
    fs.writeFileSync(path.join(stagingDir(), 'fullchain.pem'), b.certPem);
    // staged cert covers bbb.com → passes even though live covers only aaa.com
    expect(() => service.assertStagedCertificateCovers('bbb.com', 'proxy')).not.toThrow();
    // and correctly fails for aaa.com (staged takes precedence)
    expect(() => service.assertStagedCertificateCovers('aaa.com', 'proxy')).toThrow(/does not cover/);
  });

  it('assertStagedCertificateCovers falls back to the live fullchain when nothing is staged', () => {
    const a = makeCert('aaa.com', keyA);
    fs.writeFileSync(path.join(sslDir, 'fullchain.pem'), a.certPem);
    expect(() => service.assertStagedCertificateCovers('aaa.com', 'proxy')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd apps/backend && pnpm test -- bootstrap-setup.service.spec`
Expected: the 4 new tests FAIL (files land in live dir; no staging fallback). Note which OLD tests also fail — any that assert `saveCertificates` wrote into `sslDir` directly now encode the pre-#514 behavior.

- [ ] **Step 3: Implement**

In `bootstrap-setup.service.ts`, add the import:

```ts
import { sslLiveDir, sslStagingDir } from './ssl-staging';
```

Replace the body of `sslDir()` (keep the method — other members use it) and note the delegation:

```ts
  /** Live cert dir — delegates to ssl-staging.ts so there is one resolution. */
  private sslDir(): string {
    return sslLiveDir();
  }
```

In `saveCertificates`, change only the dir resolution (first lines of the method) — the atomic `write` helper and the four `write(...)` calls are unchanged:

```ts
  saveCertificates(certPem: string, keyPem: string, domain: string): void {
    const validatedDomain = this.assertValidDomain(domain);
    // #514: user-driven writes are provisional — they land in staging/ and
    // only apply() promotes them into the watched live dir.
    const dir = sslStagingDir();
    fs.mkdirSync(dir, { recursive: true });
    // ... (write helper + four write() calls exactly as before)
```

Replace `certificatesPresent`:

```ts
  certificatesPresent(domain: string): boolean {
    const validatedDomain = this.assertValidDomain(domain);
    // Per-file union of staging and live: after #514 a stage may hold only
    // the generic pair (LE issuance with a real DNS-01 wildcard installed
    // live), and after a promote everything is live — both must count.
    const present = (name: string) =>
      fs.existsSync(path.join(sslStagingDir(), name)) ||
      fs.existsSync(path.join(this.sslDir(), name));
    return (
      present('fullchain.pem') &&
      present('privkey.pem') &&
      present(`wildcard.${validatedDomain}.crt`) &&
      present(`wildcard.${validatedDomain}.key`)
    );
  }
```

In `assertStagedCertificateCovers`, replace the read with staging-first:

```ts
  assertStagedCertificateCovers(domain: string, servingMode: ProxyMode): void {
    const validatedDomain = this.assertValidDomain(domain);
    const stagedPath = path.join(sslStagingDir(), 'fullchain.pem');
    const certPath = fs.existsSync(stagedPath)
      ? stagedPath
      : path.join(this.sslDir(), 'fullchain.pem');
    let cert: X509Certificate;
    try {
      cert = new X509Certificate(fs.readFileSync(certPath));
    } catch {
      throw new BadRequestException(
        'Installed certificate could not be read — re-install the certificate for this domain',
      );
    }
    this.checkSansCover(this.dnsSans(cert), validatedDomain, servingMode);
  }
```

- [ ] **Step 4: Run the whole spec; fix old assertions that encoded live-writes**

Run: `cd apps/backend && pnpm test -- bootstrap-setup.service.spec`
Expected: new tests PASS. Update any pre-existing test that asserted the four files appear directly in `sslDir` after `saveCertificates` (or that seeded `fullchain.pem` in `sslDir` to satisfy `assertStagedCertificateCovers` after a `saveCertificates` call) to use the staging path — the new expected behavior, not the test, is authoritative. Then: full spec PASS.

- [ ] **Step 5: Commit (with user approval)**

```bash
git add apps/backend/src/setup/bootstrap-setup.service.ts apps/backend/src/setup/bootstrap-setup.service.spec.ts
git commit -m "feat(ssl): bootstrap cert writes stage; presence/coverage read staging-first (#514)"
```

### Task 4: `SslCertificateService` — issuance target + staging-aware reuse check

**Files:**
- Modify: `apps/backend/src/domains/ssl-certificate.service.ts` (`requestPrimaryDomainCertificate` ~line 503, `stagedPrimaryCertificate` ~line 588, `savePrimaryCertificate` ~line 606, `issueMockPrimaryCertificate` ~line 648)
- Test: `apps/backend/src/domains/ssl-certificate.service.spec.ts` (add cases; MOCK_SSL path makes this testable without ACME)

**Interfaces:**
- Consumes: `sslStagingDir()` from Task 2 (import path: `'../setup/ssl-staging'`).
- Produces (consumed by Tasks 5 & 7):
  - `requestPrimaryDomainCertificate(domain: string, opts?: { target?: 'live' | 'staging' })` — default `'live'` so the **renewal cron call site is untouched**; `'staging'` writes the issued cert into staging.
  - Reuse semantics: for `target: 'live'` the check reads the **live** fullchain only (cron must never be satisfied by a stale staged cert); for `target: 'staging'` it reads staging first, then live.

- [ ] **Step 1: Write the failing tests**

Add to the existing spec (it runs the service with `MOCK_SSL`; reuse its tmp-dir + env setup — if the file has no primary-issuance describe with tmp `SSL_CERT_PATH`, create one following the Task 2 spec's beforeEach/afterEach pattern, plus `process.env.MOCK_SSL = 'true'` and `await service.initialize()`):

```ts
describe('requestPrimaryDomainCertificate target (#514)', () => {
  it("target 'staging' writes the issued cert under staging/, not live", async () => {
    const res = await service.requestPrimaryDomainCertificate('example.com', { target: 'staging' });
    expect(res.success).toBe(true);
    expect(fs.existsSync(path.join(sslDir, 'staging', 'fullchain.pem'))).toBe(true);
    expect(fs.existsSync(path.join(sslDir, 'staging', 'privkey.pem'))).toBe(true);
    expect(fs.existsSync(path.join(sslDir, 'fullchain.pem'))).toBe(false);
  });

  it('default target writes live (renewal-cron contract)', async () => {
    const res = await service.requestPrimaryDomainCertificate('example.com');
    expect(res.success).toBe(true);
    expect(fs.existsSync(path.join(sslDir, 'fullchain.pem'))).toBe(true);
    expect(fs.existsSync(path.join(sslDir, 'staging'))).toBe(false);
  });

  it("a valid STAGED cert does NOT satisfy the reuse check for target 'live'", async () => {
    // Stage a valid covering cert...
    await service.requestPrimaryDomainCertificate('example.com', { target: 'staging' });
    // ...then a live-target request must still issue (not report reused).
    const res = await service.requestPrimaryDomainCertificate('example.com');
    expect(res.reused).toBeFalsy();
    expect(fs.existsSync(path.join(sslDir, 'fullchain.pem'))).toBe(true);
  });

  it("a valid staged cert IS reused for target 'staging'", async () => {
    await service.requestPrimaryDomainCertificate('example.com', { target: 'staging' });
    const res = await service.requestPrimaryDomainCertificate('example.com', { target: 'staging' });
    expect(res.reused).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failures**

Run: `cd apps/backend && pnpm test -- ssl-certificate.service.spec`
Expected: new tests FAIL (`opts` unknown / files land live).

- [ ] **Step 3: Implement**

Import at top of `ssl-certificate.service.ts`:

```ts
import { sslStagingDir } from '../setup/ssl-staging';
```

Signature + reuse check in `requestPrimaryDomainCertificate`:

```ts
  async requestPrimaryDomainCertificate(
    domain: string,
    opts: { target?: 'live' | 'staging' } = {},
  ): Promise<{ success: boolean; error?: string; expiresAt?: Date; sans?: string[]; reused?: boolean }> {
    const target = opts.target ?? 'live';
    const sans = [domain, `www.${domain}`, `admin.${domain}`];

    // Idempotency (rate-limit protection). Target-scoped on purpose: the
    // renewal cron (target 'live') must never be satisfied by a stale staged
    // cert while the LIVE one approaches expiry; a user-driven staging
    // request may reuse either a fresh stage or a still-valid live cert.
    const staged = this.stagedPrimaryCertificate(sans, target);
    if (staged) {
      this.logger.log(`Primary cert already covers [${sans.join(', ')}] — reusing`);
      return { success: true, expiresAt: staged.expiresAt, sans, reused: true };
    }

    if (this.mockMode) {
      return this.issueMockPrimaryCertificate(domain, sans, target);
    }
    // ... unchanged ACME flow, except the save call at the end:
      await this.savePrimaryCertificate(domain, certificate, key, target);
    // ... rest unchanged
```

`stagedPrimaryCertificate` becomes target-aware:

```ts
  private stagedPrimaryCertificate(
    sans: string[],
    target: 'live' | 'staging',
  ): { expiresAt: Date } | null {
    const candidates =
      target === 'staging'
        ? [join(sslStagingDir(), 'fullchain.pem'), join(this.getSslPath(), 'fullchain.pem')]
        : [join(this.getSslPath(), 'fullchain.pem')];
    for (const certPath of candidates) {
      try {
        const cert = new X509Certificate(fs.readFileSync(certPath));
        const certSans = (cert.subjectAltName ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.startsWith('DNS:'))
          .map((s) => s.slice(4));
        const covers = sans.every((s) => certSans.includes(s));
        const expiresAt = new Date(cert.validTo);
        const daysLeft = (expiresAt.getTime() - Date.now()) / 86_400_000;
        if (covers && daysLeft > 30) return { expiresAt };
      } catch {
        // try next candidate
      }
    }
    return null;
  }
```

`savePrimaryCertificate` gains the target dir (the `installedWildcardIsReal` guard **stays pointed at the live dir** — it decides whether wildcard copies may exist at all, and a real live wildcard must never be clobbered at promote time):

```ts
  private async savePrimaryCertificate(
    domain: string,
    certificate: string,
    key: Buffer,
    target: 'live' | 'staging' = 'live',
  ): Promise<void> {
    const dir = target === 'staging' ? sslStagingDir() : this.getSslPath();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'fullchain.pem'), certificate, { mode: 0o644 });
    await writeFile(join(dir, 'privkey.pem'), key, { mode: 0o600 });
    // (comment block unchanged) — guard still checks the LIVE wildcard:
    if (!this.installedWildcardIsReal(domain)) {
      await writeFile(join(dir, `wildcard.${domain}.crt`), certificate, { mode: 0o644 });
      await writeFile(join(dir, `wildcard.${domain}.key`), key, { mode: 0o600 });
    }
  }
```

`issueMockPrimaryCertificate` threads the target:

```ts
  private async issueMockPrimaryCertificate(
    domain: string,
    sans: string[],
    target: 'live' | 'staging' = 'live',
  ): Promise<{ success: boolean; expiresAt?: Date; sans?: string[] }> {
    const certPem = this.selfSignWithForge(domain, [...sans, `*.${domain}`]);
    await this.savePrimaryCertificate(domain, certPem, Buffer.from(this.mockPrimaryKeyPem!), target);
    // ... rest unchanged
```

- [ ] **Step 4: Run tests**

Run: `cd apps/backend && pnpm test -- ssl-certificate.service.spec`
Expected: PASS (new + existing; existing callers compile because `opts` is optional).

- [ ] **Step 5: Commit (with user approval)**

```bash
git add apps/backend/src/domains/ssl-certificate.service.ts apps/backend/src/domains/ssl-certificate.service.spec.ts
git commit -m "feat(ssl): primary-cert issuance can target staging; target-scoped reuse check (#514)"
```

### Task 5: `PrimarySslService` — stage without snapshot, apply promotes, discard endpoint logic, staged status

**Files:**
- Modify: `apps/backend/src/setup/primary-ssl/primary-ssl.service.ts`
- Modify: `apps/backend/src/domains/ssl-info.service.ts` (add `getStagedPrimaryCertInfo`)
- Test: `apps/backend/src/setup/primary-ssl/primary-ssl.service.spec.ts`

**Interfaces:**
- Consumes: `stagingPopulated()`, `promoteStagedCertificates()`, `discardStagedCertificates()` from Task 2 (import path `'../ssl-staging'`); `requestPrimaryDomainCertificate(domain, { target: 'staging' })` from Task 4.
- Produces (consumed by Tasks 6 & 9):
  - `PrimarySslStatus` gains `stagedCert: SslCertificateInfo | null`
  - `discardStaged(): { discarded: true }`
  - `SslInfoService.getStagedPrimaryCertInfo(): Promise<SslCertificateInfo | null>` — parses `staging/fullchain.pem`, silent `null` when absent (absence is the normal state — no warn log)

- [ ] **Step 1: Add `getStagedPrimaryCertInfo` to `ssl-info.service.ts`** (below `getServedPrimaryCertInfo`):

```ts
  /**
   * Cert staged for the primary domain but not yet promoted by apply()
   * (<SSL_CERT_PATH>/staging/fullchain.pem). Absence is the normal state,
   * so unlike getServedPrimaryCertInfo this logs nothing on a miss.
   */
  async getStagedPrimaryCertInfo(): Promise<SslCertificateInfo | null> {
    try {
      const certContent = await readFile(
        join(this.getSslPath(), 'staging', 'fullchain.pem'),
        'utf-8',
      );
      return this.parseCertificate(certContent, 'individual');
    } catch {
      return null;
    }
  }
```

- [ ] **Step 2: Update the failing/changed service-spec expectations**

The spec mocks collaborators (see its `d.bootstrap` / `d.snap` fixtures) and will need `jest.mock('../ssl-staging')` plus these behavioral flips — the module mock at the top of the spec:

```ts
import * as staging from '../ssl-staging';
jest.mock('../ssl-staging', () => ({
  stagingPopulated: jest.fn().mockReturnValue(false),
  promoteStagedCertificates: jest.fn().mockReturnValue([]),
  discardStagedCertificates: jest.fn(),
}));
```

(and add `getStagedPrimaryCertInfo: jest.fn().mockResolvedValue(null)` to the `info` mock fixture). Then:

1. `'stagePaste validates then saves for the fixed domain, snapshotting the OLD cert first'` (~line 78) → becomes `'stagePaste validates then saves WITHOUT touching the snapshot (staging is provisional)'`: keep the `saveCertificates` assertion, replace the snapshot-order assertions with `expect(d.snap.snapshotForChangeCycle).not.toHaveBeenCalled();`
2. `'issueLetsEncrypt snapshots, preflights, then requests the cert'` (~line 189) → drop the snapshot assertion; add `expect(d.ssl.requestPrimaryDomainCertificate).toHaveBeenCalledWith(domain, { target: 'staging' });`
3. Delete `'snapshots BEFORE issuing so the OLD cert is the rollback baseline'` (~line 210) — the ordering hazard no longer exists; replace with:

```ts
  it('issueLetsEncrypt never snapshots — nothing live is written until apply', async () => {
    const d = deps();
    await service(d).issueLetsEncrypt();
    expect(d.snap.snapshotForChangeCycle).not.toHaveBeenCalled();
    expect(d.snap.snapshot).not.toHaveBeenCalled();
  });
```

4. New apply tests:

```ts
  it('apply promotes staging after snapshotting, in that order', async () => {
    const d = deps();
    (staging.stagingPopulated as jest.Mock).mockReturnValue(true);
    await service(d).apply({ proxyMode: 'proxy', sslMode: 'paste', port80: 'closed' } as any);
    expect(staging.promoteStagedCertificates).toHaveBeenCalled();
    const snapOrder = d.snap.snapshotForChangeCycle.mock.invocationCallOrder[0];
    const promoteOrder = (staging.promoteStagedCertificates as jest.Mock).mock.invocationCallOrder[0];
    expect(snapOrder).toBeLessThan(promoteOrder);
  });

  it('apply with sslMode selfsigned DISCARDS staging instead of promoting', async () => {
    const d = deps();
    (staging.stagingPopulated as jest.Mock).mockReturnValue(true);
    await service(d).apply({ proxyMode: 'proxy', sslMode: 'selfsigned' } as any);
    expect(staging.discardStagedCertificates).toHaveBeenCalled();
    expect(staging.promoteStagedCertificates).not.toHaveBeenCalled();
  });

  it('a populated stage on direct serving triggers the confirm window (certAffecting)', async () => {
    const d = deps(); // current config: proxyMode 'none', sslMode 'paste' — same next values
    (staging.stagingPopulated as jest.Mock).mockReturnValue(true);
    const res = await service(d).apply({ proxyMode: 'none', sslMode: 'paste', port80: 'redirect' } as any);
    expect(res.deadlineMs).toBeDefined();
    expect(d.snap.writePendingRevert).toHaveBeenCalled();
  });

  it('getStatus reports stagedCert from getStagedPrimaryCertInfo', async () => {
    const d = deps();
    d.info.getStagedPrimaryCertInfo.mockResolvedValue({ commonName: 'staged.example.com' });
    const status = await service(d).getStatus();
    expect(status.stagedCert).toEqual({ commonName: 'staged.example.com' });
  });

  it('discardStaged clears the staging dir', () => {
    const d = deps();
    expect(service(d).discardStaged()).toEqual({ discarded: true });
    expect(staging.discardStagedCertificates).toHaveBeenCalled();
  });
```

Also update the existing `certAffecting` tests (~lines 130–160): the old heuristic asserted `isApplied`/`hasSnapshot` mock interplay — those become `stagingPopulated` mock returns. The `'sslMode-only swap ... even with no staged files'` test (~line 142) stays valid as-is (sslMode change still triggers).

- [ ] **Step 3: Run to verify failures**

Run: `cd apps/backend && pnpm test -- primary-ssl.service.spec`
Expected: new/updated tests FAIL against the current implementation.

- [ ] **Step 4: Implement in `primary-ssl.service.ts`**

Imports:

```ts
import { discardStagedCertificates, promoteStagedCertificates, stagingPopulated } from '../ssl-staging';
```

`PrimarySslStatus` interface — add:

```ts
  stagedCert: SslCertificateInfo | null;
```

`getStatus()` — add alongside the `cert` lookup and to the return object:

```ts
    const stagedCert = await this.info.getStagedPrimaryCertInfo().catch(() => null);
    // ...
    return { /* existing fields */, stagedCert, /* rest */ };
```

`stagePaste` — delete the `snapshotForChangeCycle()` call and its comment; replace with:

```ts
    // #514: saveCertificates writes into staging/ — nothing live changes, so
    // no snapshot is needed here. apply() snapshots before promoting.
    this.bootstrap.saveCertificates(dto.certificatePem, dto.privateKeyPem, domain);
```

`issueLetsEncrypt` — delete its `snapshotForChangeCycle()` call + comment; change the request:

```ts
    const res = await this.ssl.requestPrimaryDomainCertificate(domain, { target: 'staging' });
```

`apply()` — replace the section from `const serving = ...` through `writeInstanceConfig(next);` with:

```ts
    const serving = this.isReachabilityChange(cur, next);
    // A cert change is in flight iff files are staged. An sslMode switch also
    // changes the served cert (e.g. paste -> selfsigned) with nothing staged.
    const certAffecting = stagingPopulated() || cur.sslMode !== next.sslMode;
    // (needsConfirm comment unchanged)
    const needsConfirm = serving || (certAffecting && next.proxyMode === 'none');

    // Snapshot the live pre-change state, THEN promote staging over it — the
    // ordering is now structurally correct instead of call-order discipline.
    this.snap.snapshotForChangeCycle();
    if (applied.sslMode === 'selfsigned') {
      // Committing to self-signed abandons any staged cert: self-signed
      // serves the bootstrap pair regardless, and a lingering "staged"
      // indicator after this apply would mislead.
      discardStagedCertificates();
    } else {
      promoteStagedCertificates();
    }
    writeInstanceConfig(next); // watcher re-renders main.conf + reloads (~3s); no restart
```

Add the discard method (after `rollback()`):

```ts
  discardStaged(): { discarded: true } {
    this.assertEnabled();
    // Touches nothing live, so no pending-revert gate: discarding while a
    // revert is pending is harmless (staging was already cleared by apply).
    discardStagedCertificates();
    return { discarded: true };
  }
```

- [ ] **Step 5: Run tests**

Run: `cd apps/backend && pnpm test -- primary-ssl.service.spec`
Expected: PASS.

- [ ] **Step 6: Commit (with user approval)**

```bash
git add apps/backend/src/setup/primary-ssl/primary-ssl.service.ts apps/backend/src/domains/ssl-info.service.ts apps/backend/src/setup/primary-ssl/primary-ssl.service.spec.ts
git commit -m "feat(ssl): day-2 stage/issue write staging; apply promotes; add discard + stagedCert status (#514)"
```

### Task 6: `DELETE /api/admin/ssl/staged` endpoint

**Files:**
- Modify: `apps/backend/src/setup/primary-ssl/primary-ssl.controller.ts`
- Test: `apps/backend/src/setup/primary-ssl/primary-ssl.controller.spec.ts`

**Interfaces:**
- Consumes: `svc.discardStaged()` from Task 5.
- Produces: `DELETE /api/admin/ssl/staged` → `{ discarded: true }` (admin session + `ENABLE_PRIMARY_SSL_MANAGEMENT` flag, same guards as siblings — they're class-level).

- [ ] **Step 1: Write the failing test** (follow the existing controller-spec pattern of calling controller methods with a mocked service):

```ts
  it('DELETE staged delegates to discardStaged', () => {
    expect(controller.discardStaged()).toEqual({ discarded: true });
    expect(svc.discardStaged).toHaveBeenCalled();
  });
```

(add `discardStaged: jest.fn().mockReturnValue({ discarded: true })` to the service mock.)

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && pnpm test -- primary-ssl.controller.spec`
Expected: FAIL — `controller.discardStaged is not a function`

- [ ] **Step 3: Implement** — add `Delete` to the `@nestjs/common` import and:

```ts
  @Delete('staged')
  discardStaged() { return this.svc.discardStaged(); }
```

- [ ] **Step 4: Run tests** — `pnpm test -- primary-ssl.controller.spec` → PASS

- [ ] **Step 5: Commit (with user approval)**

```bash
git add apps/backend/src/setup/primary-ssl/primary-ssl.controller.ts apps/backend/src/setup/primary-ssl/primary-ssl.controller.spec.ts
git commit -m "feat(ssl): DELETE /api/admin/ssl/staged discards the staged certificate (#514)"
```

### Task 7: Bootstrap wizard apply promotes

**Files:**
- Modify: `apps/backend/src/setup/bootstrap-setup.controller.ts` (`apply` ~line 57)
- Test: `apps/backend/src/setup/bootstrap-setup.controller.spec.ts`

**Interfaces:**
- Consumes: `promoteStagedCertificates()`, `discardStagedCertificates()` from Task 2; `requestPrimaryDomainCertificate(domain, { target: 'staging' })` from Task 4.

- [ ] **Step 1: Write the failing tests** (the controller spec mocks `writeInstanceConfig` via `jest.mock('../bootstrap/instance-config')`; mock `./ssl-staging` the same way):

```ts
import * as staging from './ssl-staging';
jest.mock('./ssl-staging', () => ({
  promoteStagedCertificates: jest.fn().mockReturnValue([]),
  discardStagedCertificates: jest.fn(),
}));
```

```ts
  it('apply promotes staged certs BEFORE writing instance config (non-selfsigned)', async () => {
    await controller.apply(applyDto({ sslMode: 'paste' }));
    expect(staging.promoteStagedCertificates).toHaveBeenCalled();
    const promoteOrder = (staging.promoteStagedCertificates as jest.Mock).mock.invocationCallOrder[0];
    const writeOrder = (writeInstanceConfig as jest.Mock).mock.invocationCallOrder[0];
    expect(promoteOrder).toBeLessThan(writeOrder);
  });

  it('apply with selfsigned discards staging and does not promote', async () => {
    await controller.apply(applyDto({ sslMode: 'selfsigned', proxyMode: 'proxy' }));
    expect(staging.discardStagedCertificates).toHaveBeenCalled();
    expect(staging.promoteStagedCertificates).not.toHaveBeenCalled();
  });
```

(`applyDto` = whatever valid-DTO helper the spec already uses; reuse it.)

- [ ] **Step 2: Run to verify failures** — `pnpm test -- bootstrap-setup.controller.spec` → new tests FAIL.

- [ ] **Step 3: Implement.** In `apply()`, after `const applied = this.bootstrap.validateApplyConfig(dto);` and **before** `await this.bootstrap.finalizeSetup();`:

```ts
    // #514: certs staged by uploadCertificates / issue-certificate go live
    // here — after every validation gate, before the instance write whose
    // watcher-triggered render flips SSL_MODE and starts serving them.
    if (applied.sslMode === 'selfsigned') {
      discardStagedCertificates();
    } else {
      promoteStagedCertificates();
    }
```

with the import `import { discardStagedCertificates, promoteStagedCertificates } from './ssl-staging';`. Also switch the wizard's LE issuance to staging in `issueCertificate` (~line 137):

```ts
    const result = await this.sslCert.requestPrimaryDomainCertificate(domain, { target: 'staging' });
```

- [ ] **Step 4: Run tests** — `pnpm test -- bootstrap-setup.controller.spec` → PASS (update any existing test seeding live certs to satisfy presence checks — seed staging instead).

- [ ] **Step 5: Commit (with user approval)**

```bash
git add apps/backend/src/setup/bootstrap-setup.controller.ts apps/backend/src/setup/bootstrap-setup.controller.spec.ts
git commit -m "feat(ssl): bootstrap apply promotes staged certs; wizard LE issuance stages (#514)"
```

### Task 8: Integration spec — stage → apply → rollback under staging semantics

**Files:**
- Modify: `apps/backend/src/setup/primary-ssl/primary-ssl.integration.service.spec.ts` (real services + tmp dirs; it already wires real `BootstrapSetupService`, snapshot service, and tmp `SSL_CERT_PATH`/`BOOTSTRAP_DIR`)

- [ ] **Step 1: Add the end-to-end staging tests**

```ts
  it('stagePaste leaves the live cert untouched until apply promotes it', () => {
    // seed a live cert as the "currently served" one
    fs.writeFileSync(path.join(sslDir, 'fullchain.pem'), oldCertPem);
    fs.writeFileSync(path.join(sslDir, 'privkey.pem'), oldKeyPem);
    svc.stagePaste({ certificatePem: newCertPem, privateKeyPem: newKeyPem, servingMode: 'proxy' });
    // live file unchanged; staged file holds the new cert
    expect(fs.readFileSync(path.join(sslDir, 'fullchain.pem'), 'utf8')).toBe(oldCertPem);
    expect(fs.readFileSync(path.join(sslDir, 'staging', 'fullchain.pem'), 'utf8')).toBe(newCertPem);
  });

  it('apply promotes the staged cert and rollback restores the OLD live cert', async () => {
    fs.writeFileSync(path.join(sslDir, 'fullchain.pem'), oldCertPem);
    fs.writeFileSync(path.join(sslDir, 'privkey.pem'), oldKeyPem);
    svc.stagePaste({ certificatePem: newCertPem, privateKeyPem: newKeyPem, servingMode: 'none' });
    await svc.apply({ proxyMode: 'none', sslMode: 'paste', port80: 'redirect' } as any);
    expect(fs.readFileSync(path.join(sslDir, 'fullchain.pem'), 'utf8')).toBe(newCertPem);
    expect(fs.existsSync(path.join(sslDir, 'staging'))).toBe(false);
    svc.rollback();
    expect(fs.readFileSync(path.join(sslDir, 'fullchain.pem'), 'utf8')).toBe(oldCertPem);
  });

  it('discardStaged aborts a stage cleanly', () => {
    svc.stagePaste({ certificatePem: newCertPem, privateKeyPem: newKeyPem, servingMode: 'proxy' });
    svc.discardStaged();
    expect(fs.existsSync(path.join(sslDir, 'staging'))).toBe(false);
  });
```

Use the spec's existing cert fixtures for `oldCertPem`/`newCertPem` — it already mints real cert pairs (two distinct pairs covering the test domain; reuse its makeCert-style helper and instance-config seeding, and match its existing `apply` call shape). The exact rollback assertion — restoring the pre-stage cert — is bug 1's regression test under the new architecture.

- [ ] **Step 2: Run** — `pnpm test -- primary-ssl.integration.service.spec` → new tests PASS after fixing any pre-existing cases that asserted stage-writes-live (e.g. "stagePaste snapshots before overwriting" — that ordering concern is gone; the equivalent guarantee is now the apply-promotes test above).

- [ ] **Step 3: Full backend suite + typecheck**

```bash
cd apps/backend && pnpm test
cd ../.. && pnpm --filter backend exec tsc --noEmit
```
Expected: all green.

- [ ] **Step 4: Commit (with user approval)**

```bash
git add apps/backend/src/setup/primary-ssl/primary-ssl.integration.service.spec.ts
git commit -m "test(ssl): integration coverage for stage->promote->rollback staging semantics (#514)"
```

### Task 9: Frontend — Apply gating + Discard button (#512)

**Files:**
- Modify: `apps/frontend/src/services/primarySslApi.ts`
- Modify: `apps/frontend/src/components/settings/primary-ssl/PrimarySslManager.tsx`
- Modify: `apps/frontend/src/components/settings/primary-ssl/ServingModelEditor.tsx` (drop the now-dead `onCertStaged` prop)
- Test: `apps/frontend/src/components/settings/primary-ssl/__tests__/PrimarySslManager.test.tsx`, `.../ServingModelEditor.test.tsx`

**Interfaces:**
- Consumes: `stagedCert` on `GET /api/admin/ssl/status`, `DELETE /api/admin/ssl/staged` (Tasks 5–6).
- Produces: exported `canApply(editor: EditorState, status: PrimarySslStatus | undefined): boolean` from `PrimarySslManager.tsx` (exported for unit tests like `toApplyBody`).

- [ ] **Step 1: API layer.** In `primarySslApi.ts`:

Add to `PrimarySslStatus`:

```ts
  stagedCert: { commonName: string; issuer: string; expiresAt: string; daysUntilExpiry: number; isValid: boolean } | null;
```

Make staging visible + discardable (stage/issue must now invalidate the status so `stagedCert` refreshes):

```ts
    stagePrimaryCertificate: builder.mutation<{ sans: string[]; wildcardCovered: boolean }, PrimarySslPasteBody>({
      query: (body) => ({ url: '/api/admin/ssl/certificate', method: 'POST', body }),
      invalidatesTags: ['PrimarySsl'],
    }),
    issuePrimaryLetsEncrypt: builder.mutation<{ issued: boolean; sans: string[]; reused: boolean }, void>({
      query: () => ({ url: '/api/admin/ssl/letsencrypt', method: 'POST' }),
      invalidatesTags: ['PrimarySsl'],
    }),
    discardStagedCertificate: builder.mutation<{ discarded: true }, void>({
      query: () => ({ url: '/api/admin/ssl/staged', method: 'DELETE' }),
      invalidatesTags: ['PrimarySsl'],
    }),
```

Export `useDiscardStagedCertificateMutation` from the hooks list.

- [ ] **Step 2: Write the failing manager tests.** Add to `PrimarySslManager.test.tsx` (it already unit-tests exported helpers; extend the same style):

```ts
import { canApply } from '../PrimarySslManager';

const status = (over: Partial<PrimarySslStatus> = {}): PrimarySslStatus => ({
  domain: 'example.com', proxyMode: 'proxy', sslMode: 'paste', port80: 'closed',
  realIp: null, cert: { commonName: 'example.com' } as any, stagedCert: null,
  wildcardCovered: false, pendingRevert: null, ...over,
});
const editor = (over: Partial<EditorState> = {}): EditorState => ({
  servingMode: 'proxy', sslMode: 'paste', port80: 'closed',
  realIp: null, certificatePem: '', privateKeyPem: '', ...over,
});

describe('canApply (#512)', () => {
  it('selfsigned needs no cert', () => {
    expect(canApply(editor({ sslMode: 'selfsigned' }), undefined)).toBe(true);
  });
  it('a staged cert enables Apply for paste/letsencrypt', () => {
    expect(canApply(editor(), status({ stagedCert: { commonName: 'x' } as any }))).toBe(true);
    expect(canApply(editor({ sslMode: 'letsencrypt' }), status({ stagedCert: { commonName: 'x' } as any }))).toBe(true);
  });
  it('knob-only changes on the already-active mode stay enabled (live cert present)', () => {
    expect(canApply(editor(), status())).toBe(true); // editor paste === status paste, cert present
  });
  it('switching mode with nothing staged disables Apply', () => {
    expect(canApply(editor({ sslMode: 'paste' }), status({ sslMode: 'selfsigned' }))).toBe(false);
  });
  it('no status yet (loading) disables non-selfsigned Apply', () => {
    expect(canApply(editor(), undefined)).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify failure** — `cd apps/frontend && pnpm test -- PrimarySslManager` → FAIL (`canApply` not exported).

- [ ] **Step 4: Implement `PrimarySslManager.tsx`.**

```ts
// eslint-disable-next-line react-refresh/only-export-components -- exported for unit testing (see PrimarySslManager.test.tsx)
export function canApply(editor: EditorState, status: PrimarySslStatus | undefined): boolean {
  if (editor.sslMode === 'selfsigned') return true; // needs no cert
  if (status?.stagedCert) return true; // a staged cert is ready to promote
  // Knob-only edits (port 80 / real-IP) on the mode that's already serving a
  // cert stay enabled; switching modes requires staging first. The backend
  // remains authoritative — this only prevents the guaranteed-422 click.
  return editor.sslMode === status?.sslMode && status?.cert != null;
}
```

In the component body:

```tsx
  const [discardStaged, { isLoading: isDiscarding }] = useDiscardStagedCertificateMutation();
  const applyEnabled = canApply(editorState, data);
```

and replace the `<ApplyPanel ... />` line with:

```tsx
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <ApplyPanel config={config} disabled={!applyEnabled} />
          {data?.stagedCert && (
            <Button variant="outline" onClick={() => discardStaged()} disabled={isDiscarding}>
              {isDiscarding ? 'Discarding…' : 'Discard staged certificate'}
            </Button>
          )}
        </div>
        {!applyEnabled && (
          <p className="text-sm text-muted-foreground">
            Validate &amp; stage a certificate to enable Apply.
          </p>
        )}
      </div>
```

(import `Button` from `@/components/ui/button`; import `type PrimarySslStatus` from the api service.)

- [ ] **Step 5: Remove the dead `onCertStaged` prop.** Delete it from `ServingModelEditor`'s props + the `onCertStaged()` call in `handleStage` (RTK tag invalidation now refreshes `stagedCert`), and delete the no-op prop at the call site in `PrimarySslManager`. Update any `ServingModelEditor.test.tsx` renders passing `onCertStaged` (remove the prop; if a test asserted the callback fired on stage, replace it with nothing — the invalidation is covered by the api-layer `invalidatesTags` config).

- [ ] **Step 6: Run frontend tests + typecheck**

```bash
cd apps/frontend && pnpm test -- primary-ssl
cd ../.. && pnpm --filter frontend exec tsc --noEmit
```
Expected: PASS.

- [ ] **Step 7: Commit (with user approval), then open PR A**

```bash
git add apps/frontend/src/services/primarySslApi.ts apps/frontend/src/components/settings/primary-ssl/
git commit -m "fix(frontend): disable SSL Apply until a cert is staged; add discard action (#512)"
git push -u origin ssl-cert-staging
gh pr create --repo bffless/ce --title "feat(ssl): stage certs to a staging path; gate + discard staged certs in day-2 UI" --body "Closes #514. Closes #512. <summary + test plan>"
```

(PR body per repo conventions; include the standard generated-with footer.)

---

## PR B — wizard port-80 unification (#513)

### Task 10: `ProxyOptions` adopts `Port80Choice`

**Files:**
- Modify: `apps/frontend/src/components/setup/domain-ssl/ProxyOptions.tsx`
- Test: `apps/frontend/src/components/setup/__tests__/CertificatePhase.test.tsx` (lines ~151, ~193, ~390–408 reference the checkbox)

**Interfaces:**
- Consumes: `Port80Choice` (`value: 'closed' | 'redirect'`, `onChange`), `setBootstrapPort80(PayloadAction<'closed' | 'redirect' | null>)` — both existing, unchanged.
- Behavior contract: store resolution is identical — backend maps `null → 'redirect'` in proxy mode, so dispatching explicit `'redirect'` instead of `null` is observationally equivalent.

- [ ] **Step 1: Branch**

```bash
cd /home/rico/bffless/repos/ce
git checkout main && git pull && git checkout -b wizard-port80-unify
```

- [ ] **Step 2: Update the tests first.** In `CertificatePhase.test.tsx`:
  - ~line 151 `getByText(/close port 80/i)` still matches (the radio option keeps that copy) — verify, don't change blindly.
  - ~line 193 `user.click(getByLabelText(/close port 80/i))` → the radio's label: `user.click(screen.getByLabelText(/close port 80/i))` still works (radio labels wrap inputs the same way in `Port80Choice`); the dispatch assertion changes from `setBootstrapPort80('closed')` on check / `null` on uncheck to `'closed'` on selecting the closed radio and `'redirect'` on selecting the redirect radio. Update the assertion accordingly.
  - ~line 390/408 (hidden in LE mode): now assert the replacement copy is shown instead:

```ts
    expect(screen.queryByText(/close port 80/i)).not.toBeInTheDocument();
    expect(screen.getByText(/port 80 stays open so let's encrypt can validate/i)).toBeInTheDocument();
```

  - Add one new test: switching sub-mode to letsencrypt still dispatches `setBootstrapPort80(null)` (the LE-clear effect is unchanged).

- [ ] **Step 3: Run to verify failures** — `cd apps/frontend && pnpm test -- CertificatePhase` → updated tests FAIL.

- [ ] **Step 4: Implement.** In `ProxyOptions.tsx`, replace the checkbox state + JSX:

```tsx
import { Port80Choice } from '@/components/ssl-leaves/Port80Choice';
```

State: replace `const [closePort80, setClosePort80] = useState(false);` with:

```tsx
  // Explicit 'redirect' mirrors the backend's null→redirect resolution for
  // proxy mode (validateApplyConfig), so swapping the old checkbox's
  // unchecked/null state for this default is behavior-preserving (#513).
  const [port80, setPort80] = useState<'closed' | 'redirect'>('redirect');
```

LE-clear effect: replace `setClosePort80(false);` with `setPort80('redirect');` (the `dispatch(setBootstrapPort80(null))` line stays exactly as-is).

JSX: replace the checkbox `<label>…</label>` block with:

```tsx
      {bootstrapSslMode !== 'letsencrypt' ? (
        <Port80Choice
          value={port80}
          onChange={(v) => {
            setPort80(v);
            dispatch(setBootstrapPort80(v));
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Port 80 stays open so Let&apos;s Encrypt can validate over HTTP-01.
        </p>
      )}
```

- [ ] **Step 5: Run tests + typecheck**

```bash
cd apps/frontend && pnpm test -- CertificatePhase && pnpm test -- ProxyOptions
cd ../.. && pnpm --filter frontend exec tsc --noEmit
```
Expected: PASS.

- [ ] **Step 6: Commit (with user approval), open PR B**

```bash
git add apps/frontend/src/components/setup/domain-ssl/ProxyOptions.tsx apps/frontend/src/components/setup/__tests__/CertificatePhase.test.tsx
git commit -m "refactor(frontend): wizard adopts shared Port80Choice control (#513)"
git push -u origin wizard-port80-unify
gh pr create --repo bffless/ce --title "refactor(frontend): unify the wizard's port-80 control with the day-2 leaf" --body "Closes #513. <summary + test plan>"
```

---

## Final verification (both PRs)

- [ ] `cd apps/backend && pnpm test` — full backend suite green
- [ ] `cd apps/frontend && pnpm test` — full frontend suite green
- [ ] `pnpm --filter backend exec tsc --noEmit && pnpm --filter frontend exec tsc --noEmit`
- [ ] `grep -rn "staging" docs/ --include="*.md" -l` — check whether any day-2 SSL docs describe the old write-live "stage" semantics and update wording if so (the UI's "Validate & stage" copy is now accurate, not misleading)
- [ ] Superpowers verification-before-completion + requesting-code-review before merge
