# Bootstrap Wizard — Full Domain/SSL Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The bootstrap wizard asks "how does traffic reach this server?" up front (Cloudflare / another CDN or WAF / directly) and adapts the DNS guidance, cert step (paste vs auto Let's Encrypt), `proxyMode`, port-80 behavior, and real-IP config to the answer — closing issue #509 so PR #508 can merge.

**Architecture:** `instance.json` moves to v2: explicit knobs (`port80`, `realIp`, `sslMode`) plus `proxyMode` kept as a preset label; v1 files read forward via knob derivation. The nginx render script branches only on knobs. A new `requestPrimaryDomainCertificate` HTTP-01 method (the one the 2026-07-20 spec deferred) plus a DNS-preflight self-probe service power the direct + Let's Encrypt path; the existing user-driven DNS-01 wildcard flow gets bootstrap-scoped endpoints for the optional in-wizard wildcard. The Domain & SSL step becomes a 3-phase sub-flow inside its one progress-bar slot; the proxyMode radio leaves the Apply step. The renewal cron learns to renew the LE primary cert and to warn (banner + email) about the un-auto-renewable DNS-01 wildcard.

**Tech Stack:** NestJS 10 + Jest (backend), React + RTK Query + Vitest (frontend), nginx + POSIX sh (docker/nginx), `acme-client` (existing ACME lib), `node:crypto` `X509Certificate` (replaces node-forge for paste validation — ECDSA support).

**Spec:** `docs/superpowers/specs/2026-07-21-bootstrap-domain-ssl-model-design.md` (committed). Read it first. Background on the existing bootstrap feature: `docs/superpowers/specs/2026-07-20-web-bootstrap-setup-design.md` + its plan.

**Out of this plan:** MOTD/getting-started copy, `setup.sh` parity, day-2 SSL panel copy rework, DNS-provider API auto-renew, the Umbrel/`cloudflare-tunnel` wizard profile (reserved values only).

## Global Constraints

- **Path mapping (spec §1):** Cloudflare → `proxyMode:'cloudflare', sslMode:'paste', port80:'closed', realIp:{preset:'cloudflare'}`. Other CDN → `'proxy','paste','redirect'(toggleable to 'closed'), null|{header,ranges}`. Direct+LE → `'none','letsencrypt','redirect'(locked), null`. Direct+BYO → `'none','paste','redirect', null`.
- **Combo validation (spec §3):** `letsencrypt` ⇒ `proxyMode:'none'` and `port80:'redirect'`; `port80:'closed'` ⇒ `proxyMode ∈ {cloudflare, proxy}`; custom `realIp` ⇒ `proxyMode:'proxy'`; omitted knobs default from the proxyMode preset.
- **Reserved values:** `proxyMode:'cloudflare-tunnel'` and `sslMode:'external'` are documented in types but never accepted by any DTO — apply rejects with "Cloudflare Tunnel setup isn't supported in the web wizard yet."
- **SAN policy:** apex always hard-required; `*.<domain>` hard-required only for `servingMode:'cloudflare'`; warning (`wildcardCovered:false`) otherwise.
- **v1 `instance.json` files must read forward byte-identically** (derive `port80`/`realIp` from `proxyMode`); env-only legacy installs (no instance.json) untouched.
- **LE preflight is a hard gate** and the server re-runs it before issuance — never trust the client.
- **All new endpoints:** `assertBootstrapAllowed()` first, then `validateClaimToken(dto.token)`, then work — same order as the existing bootstrap endpoints. All are `PLATFORM_MODE`/`SSL_MANAGED_EXTERNALLY`-disabled via that gate.
- **Nothing user-controlled reaches `instance.env` unvalidated** (it is `source`d by sh): domains via `validateDomain`, realIp header/ranges via the new validators.
- Backend: 2-space indent, Jest specs colocated `*.spec.ts`, run `cd apps/backend && pnpm test -- <pattern>`. Frontend: Vitest, `cd apps/frontend && pnpm test -- <pattern>`. Shell: POSIX sh for container scripts.
- Commit prefix: `feat(bootstrap-ssl): …` (or `fix`/`test`/`refactor` as appropriate).

## File Structure (locked in)

```
apps/backend/src/bootstrap/instance-config.ts            # MODIFY: v2 types, deriveKnobs, v2 instance.env keys
apps/backend/src/bootstrap/instance-config.spec.ts       # MODIFY: v2 + v1-forward-read tests
apps/backend/src/setup/setup.dto.ts                      # MODIFY: ApplyBootstrapDto v2, RealIpDto, servingMode, new DTOs
apps/backend/src/setup/bootstrap-setup.service.ts        # MODIFY: combo validation, X509 cert validation, path-aware SANs
apps/backend/src/setup/bootstrap-setup.service.spec.ts   # MODIFY
apps/backend/src/setup/bootstrap-setup.controller.ts     # MODIFY: apply v2 + 4 new endpoints
apps/backend/src/setup/bootstrap-setup.controller.spec.ts# MODIFY
apps/backend/src/setup/bootstrap-dns-preflight.service.ts     # NEW: A-record + webroot self-probe preflight
apps/backend/src/setup/bootstrap-dns-preflight.service.spec.ts# NEW
apps/backend/src/setup/setup.module.ts                   # MODIFY: register preflight + SslCertificateService provider
apps/backend/src/domains/ssl-certificate.service.ts      # MODIFY: requestPrimaryDomainCertificate, ACME_DIRECTORY_URL, contact-less account
apps/backend/src/domains/ssl-certificate.service.spec.ts # MODIFY (create if missing)
apps/backend/src/domains/ssl-renewal.service.ts          # MODIFY: primary-domain renewal, wildcard reminder email
apps/backend/src/domains/ssl-renewal.service.spec.ts     # MODIFY (create if missing)
docker/nginx/render-main-conf.sh                         # MODIFY: knob branches, overridable NGINX_ETC for tests
docker/nginx/sites-available/main.conf.template          # MODIFY: port-80 block with ${ACME_LOCATION}
docker/nginx/render-main-conf.test.sh                    # NEW: host-runnable render harness
apps/frontend/src/store/slices/setupSlice.ts             # MODIFY: servingMode/sslMode/port80/realIp/preflight state
apps/frontend/src/services/setupApi.ts                   # MODIFY: 4 new mutations, updated request types
apps/frontend/src/components/setup/DomainSslStep.tsx     # MODIFY: becomes 3-phase orchestrator
apps/frontend/src/components/setup/domain-ssl/ServingChoicePhase.tsx  # NEW
apps/frontend/src/components/setup/domain-ssl/DomainDnsPhase.tsx      # NEW (incl. LE preflight UI)
apps/frontend/src/components/setup/domain-ssl/PasteCertificateForm.tsx# NEW (CF/CDN/BYO variants)
apps/frontend/src/components/setup/domain-ssl/LetsEncryptForm.tsx     # NEW (issue + wildcard sub-step)
apps/frontend/src/components/setup/domain-ssl/CertificatePhase.tsx    # NEW (dispatches to the two forms)
apps/frontend/src/components/setup/ApplyStep.tsx         # MODIFY: summary, no radio, LE auto-confirm
apps/frontend/src/components/setup/__tests__/*           # MODIFY/NEW step tests
apps/frontend/src/pages/HomePage.tsx                     # MODIFY: expiring-wildcard banner state
test-bootstrap.sh                                        # MODIFY: LE-path + v1-regression smoke legs
docker-compose.pebble.yml                                # NEW: Pebble ACME test server overlay
```

Dependency order: Task 1 → 2 → 3 (backend config/validation) can proceed while 4 (nginx) is independent; 5 → 6 → 7 (ACME/preflight/endpoints) depend on 1–3; 8 depends on 5; 9 → 10 → 11 → 12 (frontend) depend on 7's response shapes; 13 last.

---

### Task 1: `instance-config` v2 — knobs + preset label

**Files:**
- Modify: `apps/backend/src/bootstrap/instance-config.ts`
- Test: `apps/backend/src/bootstrap/instance-config.spec.ts`

**Interfaces:**
- Consumes: nothing (pure Node module).
- Produces (later tasks rely on these exact names):
  - `type ProxyMode = 'cloudflare' | 'proxy' | 'none'`
  - `type SslMode = 'paste' | 'letsencrypt'`
  - `type Port80Mode = 'closed' | 'redirect'`
  - `type RealIpConfig = null | { preset: 'cloudflare' } | { header: string; ranges: string[] }`
  - `interface InstanceConfig { version: 1 | 2; state: 'unclaimed' | 'applied'; primaryDomain?: string; proxyMode?: ProxyMode; sslMode?: SslMode; port80?: Port80Mode; realIp?: RealIpConfig; platformIp?: string; }`
  - `interface ResolvedKnobs { port80: Port80Mode; realIp: RealIpConfig; }`
  - `deriveKnobs(cfg: InstanceConfig): ResolvedKnobs` — explicit knobs win; else preset defaults (`cloudflare` → `closed` + CF preset; `proxy`/`none`/absent → `redirect` + `null`)
  - `writeInstanceConfig` now always writes **resolved** knobs into `instance.env`: `SSL_MODE`, `PORT80`, `REALIP_MODE` (`cloudflare`|`custom`|`off`), and for custom: `REALIP_HEADER`, `REALIP_RANGES="<space-separated>"` (double-quoted — ranges contain spaces).
  - `loadInstanceConfig` accepts `version === 1 || version === 2`.
  - `deriveIdentityEnv` unchanged except it keeps mapping `proxyMode → PROXY_MODE` for all three values.

- [ ] **Step 1: Write the failing tests** (append to the existing describe block in `instance-config.spec.ts`)

```ts
describe('instance-config v2', () => {
  const v2Custom: InstanceConfig = {
    version: 2,
    state: 'applied',
    primaryDomain: 'example.com',
    proxyMode: 'proxy',
    sslMode: 'paste',
    port80: 'redirect',
    realIp: { header: 'X-Forwarded-For', ranges: ['151.101.0.0/16', '2a04:4e40::/32'] },
  };

  it('loads version 2 files', () => {
    writeInstanceConfig(v2Custom, dir);
    expect(loadInstanceConfig(dir)).toEqual(v2Custom);
  });

  it('derives knobs from a v1 cloudflare config (forward-read)', () => {
    const v1: InstanceConfig = {
      version: 1, state: 'applied', primaryDomain: 'example.com',
      proxyMode: 'cloudflare', sslMode: 'paste',
    };
    expect(deriveKnobs(v1)).toEqual({ port80: 'closed', realIp: { preset: 'cloudflare' } });
  });

  it('derives knobs from a v1 none config (forward-read)', () => {
    const v1: InstanceConfig = { version: 1, state: 'applied', primaryDomain: 'x.com', proxyMode: 'none' };
    expect(deriveKnobs(v1)).toEqual({ port80: 'redirect', realIp: null });
  });

  it('explicit knobs win over preset defaults', () => {
    expect(deriveKnobs({ ...v2Custom, proxyMode: 'cloudflare' }).port80).toBe('redirect');
  });

  it('writes resolved knobs into instance.env (custom realIp quoted)', () => {
    writeInstanceConfig(v2Custom, dir);
    const env = fs.readFileSync(path.join(dir, 'instance.env'), 'utf8');
    expect(env).toContain('SSL_MODE=paste');
    expect(env).toContain('PORT80=redirect');
    expect(env).toContain('REALIP_MODE=custom');
    expect(env).toContain('REALIP_HEADER=X-Forwarded-For');
    expect(env).toContain('REALIP_RANGES="151.101.0.0/16 2a04:4e40::/32"');
  });

  it('writes REALIP_MODE=cloudflare for the cloudflare preset', () => {
    writeInstanceConfig(
      { version: 2, state: 'applied', primaryDomain: 'x.com', proxyMode: 'cloudflare', sslMode: 'paste' },
      dir,
    );
    const env = fs.readFileSync(path.join(dir, 'instance.env'), 'utf8');
    expect(env).toContain('PORT80=closed');
    expect(env).toContain('REALIP_MODE=cloudflare');
    expect(env).not.toContain('REALIP_HEADER');
  });
});
```

(Import `deriveKnobs` in the spec's import list.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && pnpm test -- instance-config`
Expected: FAIL — `deriveKnobs` is not exported; v2 write assertions fail.

- [ ] **Step 3: Implement**

Replace the type block and extend `loadInstanceConfig`/`writeInstanceConfig` in `apps/backend/src/bootstrap/instance-config.ts`:

```ts
export type ProxyMode = 'cloudflare' | 'proxy' | 'none';
export type SslMode = 'paste' | 'letsencrypt';
export type Port80Mode = 'closed' | 'redirect';
export type RealIpConfig = null | { preset: 'cloudflare' } | { header: string; ranges: string[] };

// Reserved, never written by the wizard and rejected by ApplyBootstrapDto:
// proxyMode 'cloudflare-tunnel' and sslMode 'external' — held for the deferred
// Umbrel/tunnel profile so it can land without a schema version bump.
export interface InstanceConfig {
  version: 1 | 2;
  state: 'unclaimed' | 'applied';
  primaryDomain?: string;
  proxyMode?: ProxyMode;
  sslMode?: SslMode;
  port80?: Port80Mode;   // v2; derived from proxyMode when absent (v1 files)
  realIp?: RealIpConfig; // v2; derived from proxyMode when absent (v1 files)
  platformIp?: string;
}

export interface ResolvedKnobs {
  port80: Port80Mode;
  realIp: RealIpConfig;
}

// v1 files carry only proxyMode; the preset label determines the knobs. A v2
// file may still omit a knob (apply fills them in, but readers stay defensive).
export function deriveKnobs(cfg: InstanceConfig): ResolvedKnobs {
  const port80: Port80Mode =
    cfg.port80 ?? (cfg.proxyMode === 'cloudflare' ? 'closed' : 'redirect');
  const realIp: RealIpConfig =
    cfg.realIp !== undefined
      ? cfg.realIp
      : cfg.proxyMode === 'cloudflare'
        ? { preset: 'cloudflare' }
        : null;
  return { port80, realIp };
}
```

In `loadInstanceConfig`, change the version gate:

```ts
    if ((parsed?.version !== 1 && parsed?.version !== 2) || !parsed?.state) return null;
```

In `writeInstanceConfig`, replace the `lines` construction (the render script needs
resolved knobs — it has no JSON parser and must not re-implement the derivation):

```ts
  const knobs = deriveKnobs(cfg);
  const realIpMode =
    knobs.realIp === null ? 'off' : 'preset' in knobs.realIp ? 'cloudflare' : 'custom';
  const lines = [
    `STATE=${cfg.state}`,
    cfg.primaryDomain ? `PRIMARY_DOMAIN=${cfg.primaryDomain}` : '',
    cfg.proxyMode ? `PROXY_MODE=${cfg.proxyMode}` : '',
    cfg.sslMode ? `SSL_MODE=${cfg.sslMode}` : '',
    `PORT80=${knobs.port80}`,
    `REALIP_MODE=${realIpMode}`,
    realIpMode === 'custom' && knobs.realIp && 'header' in knobs.realIp
      ? `REALIP_HEADER=${knobs.realIp.header}`
      : '',
    realIpMode === 'custom' && knobs.realIp && 'ranges' in knobs.realIp
      ? `REALIP_RANGES="${knobs.realIp.ranges.join(' ')}"`
      : '',
  ].filter(Boolean);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && pnpm test -- instance-config`
Expected: PASS (including all pre-existing v1 tests — the forward-read guarantee).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/bootstrap/instance-config.ts apps/backend/src/bootstrap/instance-config.spec.ts
git commit -m "feat(bootstrap-ssl): instance.json v2 — explicit port80/realIp/sslMode knobs with v1 forward-read"
```

---

### Task 2: Apply v2 — DTO, combo validation, realIp validation, controller

**Files:**
- Modify: `apps/backend/src/setup/setup.dto.ts` (ApplyBootstrapDto + new RealIpDto)
- Modify: `apps/backend/src/setup/bootstrap-setup.service.ts` (add `validateApplyConfig`)
- Modify: `apps/backend/src/setup/bootstrap-setup.controller.ts` (apply writes v2)
- Tests: colocated specs

**Interfaces:**
- Consumes: `ProxyMode`, `SslMode`, `Port80Mode`, `RealIpConfig`, `deriveKnobs` from Task 1.
- Produces:
  - `class RealIpDto { header: string; ranges: string[] }`
  - `ApplyBootstrapDto` gains: `proxyMode: 'cloudflare'|'proxy'|'none'` (with the tunnel rejection message), `sslMode: 'paste'|'letsencrypt'`, `port80?: 'closed'|'redirect'`, `realIp?: RealIpDto`.
  - `interface AppliedConfig { proxyMode: ProxyMode; sslMode: SslMode; port80: Port80Mode; realIp: RealIpConfig }`
  - `BootstrapSetupService.validateApplyConfig(dto: ApplyBootstrapDto): AppliedConfig` — throws `BadRequestException` on any illegal combo/value; resolves omitted knobs via preset defaults.

- [ ] **Step 1: Write the failing service tests** (append to `bootstrap-setup.service.spec.ts`)

```ts
describe('validateApplyConfig', () => {
  const base = { domain: 'example.com', token: undefined };

  it('resolves cloudflare preset defaults', () => {
    const cfg = service.validateApplyConfig({ ...base, proxyMode: 'cloudflare', sslMode: 'paste' } as ApplyBootstrapDto);
    expect(cfg).toEqual({
      proxyMode: 'cloudflare', sslMode: 'paste', port80: 'closed', realIp: { preset: 'cloudflare' },
    });
  });

  it('resolves direct + letsencrypt', () => {
    const cfg = service.validateApplyConfig({ ...base, proxyMode: 'none', sslMode: 'letsencrypt' } as ApplyBootstrapDto);
    expect(cfg).toEqual({ proxyMode: 'none', sslMode: 'letsencrypt', port80: 'redirect', realIp: null });
  });

  it('rejects letsencrypt behind a proxy', () => {
    expect(() =>
      service.validateApplyConfig({ ...base, proxyMode: 'proxy', sslMode: 'letsencrypt' } as ApplyBootstrapDto),
    ).toThrow(BadRequestException);
  });

  it('rejects closed port 80 on a direct install', () => {
    expect(() =>
      service.validateApplyConfig({ ...base, proxyMode: 'none', sslMode: 'paste', port80: 'closed' } as ApplyBootstrapDto),
    ).toThrow(BadRequestException);
  });

  it('rejects custom realIp outside proxy mode', () => {
    expect(() =>
      service.validateApplyConfig({
        ...base, proxyMode: 'cloudflare', sslMode: 'paste',
        realIp: { header: 'X-Forwarded-For', ranges: ['1.2.3.0/24'] },
      } as ApplyBootstrapDto),
    ).toThrow(BadRequestException);
  });

  it('accepts valid custom realIp for proxy mode (v4 + v6 CIDRs)', () => {
    const cfg = service.validateApplyConfig({
      ...base, proxyMode: 'proxy', sslMode: 'paste',
      realIp: { header: 'True-Client-IP', ranges: ['151.101.0.0/16', '2a04:4e40::/32'] },
    } as ApplyBootstrapDto);
    expect(cfg.realIp).toEqual({ header: 'True-Client-IP', ranges: ['151.101.0.0/16', '2a04:4e40::/32'] });
    expect(cfg.port80).toBe('redirect');
  });

  it.each([
    ['not-a-cidr'], ['1.2.3.4'], ['1.2.3.0/33'], ['1.2.3.0/24; rm -rf /'], ['2a04:4e40::/129'],
  ])('rejects malformed CIDR %s', (range) => {
    expect(() =>
      service.validateApplyConfig({
        ...base, proxyMode: 'proxy', sslMode: 'paste',
        realIp: { header: 'X-Forwarded-For', ranges: [range] },
      } as ApplyBootstrapDto),
    ).toThrow(BadRequestException);
  });

  it('rejects a header that is not an HTTP token', () => {
    expect(() =>
      service.validateApplyConfig({
        ...base, proxyMode: 'proxy', sslMode: 'paste',
        realIp: { header: 'X-Forwarded-For\nset_real_ip_from 0.0.0.0/0', ranges: ['1.2.3.0/24'] },
      } as ApplyBootstrapDto),
    ).toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && pnpm test -- bootstrap-setup.service`
Expected: FAIL — `validateApplyConfig` does not exist.

- [ ] **Step 3: Implement DTOs** in `setup.dto.ts` (replace `ApplyBootstrapDto`; add `RealIpDto` above it; add `ValidateNested`, `IsArray`, `ArrayNotEmpty`, `IsIn` to the class-validator import and `Type` from `class-transformer`):

```ts
export class RealIpDto {
  @ApiProperty({ description: 'Header carrying the visitor IP (e.g. X-Forwarded-For)' })
  @IsString()
  @IsNotEmpty()
  header: string;

  @ApiProperty({ description: 'Trusted proxy egress ranges, CIDR notation', type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ranges: string[];
}

export class ApplyBootstrapDto {
  @ApiProperty({ description: 'Domain to adopt as the instance primary domain' })
  @IsString()
  @IsNotEmpty()
  domain: string;

  @ApiProperty({
    description: 'How traffic reaches this server',
    enum: ['cloudflare', 'proxy', 'none'],
  })
  @IsIn(['cloudflare', 'proxy', 'none'], {
    message:
      'proxyMode must be cloudflare, proxy, or none' +
      " (Cloudflare Tunnel setup isn't supported in the web wizard yet)",
  })
  proxyMode: 'cloudflare' | 'proxy' | 'none';

  @ApiProperty({ description: 'Where the certificate came from', enum: ['paste', 'letsencrypt'] })
  @IsIn(['paste', 'letsencrypt'])
  sslMode: 'paste' | 'letsencrypt';

  @ApiProperty({ required: false, enum: ['closed', 'redirect'], description: 'Port-80 behavior; defaults from proxyMode' })
  @IsOptional()
  @IsIn(['closed', 'redirect'])
  port80?: 'closed' | 'redirect';

  @ApiProperty({ required: false, type: RealIpDto, description: 'Custom real-IP trust (proxy mode only)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => RealIpDto)
  realIp?: RealIpDto;

  @ApiProperty({ required: false, description: 'Claim token (ONBOARDING_TOKEN) — session-less wizard auth' })
  @IsOptional()
  @IsString()
  token?: string;
}
```

- [ ] **Step 4: Implement `validateApplyConfig`** in `bootstrap-setup.service.ts` (imports: `import { isIP } from 'net';` and `AppliedConfig` types from `../bootstrap/instance-config`):

```ts
// RFC 9110 token characters — what nginx will accept after real_ip_header,
// and, more importantly, what can never break out of the generated config or
// the shell-sourced instance.env line it rides in on.
private static readonly HEADER_TOKEN_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

private isValidCidr(range: string): boolean {
  const parts = range.split('/');
  if (parts.length !== 2) return false;
  const [addr, prefixStr] = parts;
  const family = isIP(addr);
  if (family === 0) return false;
  if (!/^\d{1,3}$/.test(prefixStr)) return false;
  const prefix = parseInt(prefixStr, 10);
  return prefix >= 0 && prefix <= (family === 4 ? 32 : 128);
}

/**
 * Combo validation + knob resolution for apply (spec §3). Every rule exists
 * to prevent a config that "works today, dies later" from ever being written:
 * a closed-port-80 LE install passes its first render but fails its first
 * renewal; a realIp trust list on a direct install lets any client spoof
 * X-Forwarded-For into rate limiting and logs.
 */
validateApplyConfig(dto: ApplyBootstrapDto): AppliedConfig {
  if (dto.sslMode === 'letsencrypt') {
    if (dto.proxyMode !== 'none') {
      throw new BadRequestException(
        'Let\'s Encrypt requires direct serving (proxyMode "none") — a proxy in front should issue its own origin certificate',
      );
    }
    if (dto.port80 === 'closed') {
      throw new BadRequestException(
        'Port 80 must stay open (redirect) with Let\'s Encrypt — renewal uses HTTP-01 challenges',
      );
    }
  }
  if (dto.port80 === 'closed' && dto.proxyMode === 'none') {
    throw new BadRequestException('Closing port 80 requires a proxy/CDN in front');
  }
  if (dto.realIp) {
    if (dto.proxyMode !== 'proxy') {
      throw new BadRequestException('Custom real-IP trust is only valid with proxyMode "proxy"');
    }
    if (!BootstrapSetupService.HEADER_TOKEN_RE.test(dto.realIp.header)) {
      throw new BadRequestException('Real-IP header must be a valid HTTP header name');
    }
    for (const range of dto.realIp.ranges) {
      if (!this.isValidCidr(range)) {
        throw new BadRequestException(`Invalid CIDR range: ${range}`);
      }
    }
  }

  const port80: Port80Mode =
    dto.port80 ?? (dto.proxyMode === 'cloudflare' ? 'closed' : 'redirect');
  const realIp: RealIpConfig =
    dto.proxyMode === 'cloudflare'
      ? { preset: 'cloudflare' }
      : dto.proxyMode === 'proxy' && dto.realIp
        ? { header: dto.realIp.header, ranges: dto.realIp.ranges }
        : null;
  return { proxyMode: dto.proxyMode, sslMode: dto.sslMode, port80, realIp };
}
```

Add to `instance-config.ts` (Task 1 file — tiny follow-up export):

```ts
export interface AppliedConfig {
  proxyMode: ProxyMode;
  sslMode: SslMode;
  port80: Port80Mode;
  realIp: RealIpConfig;
}
```

- [ ] **Step 5: Update the controller's `apply()`** in `bootstrap-setup.controller.ts` — after `validateDomain`, before `finalizeSetup`:

```ts
    const applied = this.bootstrap.validateApplyConfig(dto);
    // ... finalizeSetup() unchanged ...
    writeInstanceConfig({
      version: 2,
      state: 'applied',
      primaryDomain: domain,
      proxyMode: applied.proxyMode,
      sslMode: applied.sslMode,
      port80: applied.port80,
      realIp: applied.realIp,
    });
```

Add a controller spec case: apply with `proxyMode:'proxy'`, `sslMode:'paste'`, custom realIp → `writeInstanceConfig` receives the v2 shape above (spy on the instance-config module as the existing controller spec already does).

- [ ] **Step 6: Run all backend setup tests**

Run: `cd apps/backend && pnpm test -- "bootstrap-setup|instance-config"`
Expected: PASS. Note: existing controller/service tests that send `proxyMode` without `sslMode` must be updated to include `sslMode: 'paste'` — do that as part of this step, it is the intended breaking change.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/setup/ apps/backend/src/bootstrap/instance-config.ts
git commit -m "feat(bootstrap-ssl): apply v2 — proxy/sslMode/port80/realIp combo validation, tunnel rejected"
```

---

### Task 3: Path-aware cert validation with ECDSA support (`node:crypto`)

**Files:**
- Modify: `apps/backend/src/setup/bootstrap-setup.service.ts` (rewrite `validateCertificatePair`, `assertSansCover`, `assertStagedCertificateCovers`, drop node-forge)
- Modify: `apps/backend/src/setup/setup.dto.ts` (`UploadCertificatesDto.servingMode`)
- Modify: `apps/backend/src/setup/bootstrap-setup.controller.ts` (pass servingMode, return `wildcardCovered`)
- Tests: colocated specs

**Interfaces:**
- Consumes: `ProxyMode` from Task 1.
- Produces:
  - `validateCertificatePair(certPem, keyPem, domain, servingMode: ProxyMode): { sans: string[]; wildcardCovered: boolean }`
  - `assertStagedCertificateCovers(domain: string, servingMode: ProxyMode): void` — same policy.
  - `UploadCertificatesDto.servingMode: 'cloudflare' | 'proxy' | 'none'` (required).
  - `POST /api/setup/certificates` response becomes `{ saved: true; sans: string[]; wildcardCovered: boolean }`.

- [ ] **Step 1: Write the failing tests.** Generate an ECDSA fixture pair once in the spec's setup (node:crypto can do it inline — no new dependency):

```ts
import { generateKeyPairSync, createPrivateKey } from 'crypto';
import * as forge from 'node-forge'; // still used to MINT RSA fixtures in tests

// Helper: self-signed cert via openssl is unavailable in jest; use node-forge
// for RSA fixtures (existing pattern) and accept that EC fixtures must be
// pre-generated PEM constants (forge cannot sign EC). Generate them once:
//   openssl ecparam -genkey -name prime256v1 -out /tmp/ec.key
//   openssl req -new -x509 -key /tmp/ec.key -days 365 \
//     -subj "/CN=example.com" \
//     -addext "subjectAltName=DNS:example.com,DNS:*.example.com" -out /tmp/ec.crt
// and paste the PEMs as constants EC_CERT_PEM / EC_KEY_PEM below.

describe('validateCertificatePair (path-aware, ECDSA)', () => {
  it('accepts an ECDSA pair covering apex + wildcard (cloudflare policy)', () => {
    const res = service.validateCertificatePair(EC_CERT_PEM, EC_KEY_PEM, 'example.com', 'cloudflare');
    expect(res.wildcardCovered).toBe(true);
    expect(res.sans).toEqual(expect.arrayContaining(['example.com', '*.example.com']));
  });

  it('hard-requires the wildcard SAN only on the cloudflare path', () => {
    // APEX_ONLY_* fixtures: same openssl commands with subjectAltName=DNS:example.com
    expect(() =>
      service.validateCertificatePair(APEX_ONLY_CERT_PEM, APEX_ONLY_KEY_PEM, 'example.com', 'cloudflare'),
    ).toThrow(/wildcard/);
    const res = service.validateCertificatePair(APEX_ONLY_CERT_PEM, APEX_ONLY_KEY_PEM, 'example.com', 'none');
    expect(res.wildcardCovered).toBe(false);
  });

  it('always hard-requires the apex', () => {
    expect(() =>
      service.validateCertificatePair(EC_CERT_PEM, EC_KEY_PEM, 'other.com', 'none'),
    ).toThrow(/does not cover other.com/);
  });

  it('rejects a mismatched key (EC cert, different EC key)', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const otherKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    expect(() =>
      service.validateCertificatePair(EC_CERT_PEM, otherKeyPem, 'example.com', 'none'),
    ).toThrow(/does not match/);
  });
});
```

Keep every existing RSA test green — RSA parses fine through `X509Certificate`.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && pnpm test -- bootstrap-setup.service`
Expected: FAIL — signature mismatch (3-arg call sites) and EC pair rejected by forge parse.

- [ ] **Step 3: Implement.** In `bootstrap-setup.service.ts` replace the forge-based methods (`import { X509Certificate, createPrivateKey } from 'crypto';` — drop the `node-forge` import entirely from this file):

```ts
validateCertificatePair(
  certPem: string,
  keyPem: string,
  domain: string,
  servingMode: ProxyMode,
): { sans: string[]; wildcardCovered: boolean } {
  const validatedDomain = this.assertValidDomain(domain);

  let cert: X509Certificate;
  let key: ReturnType<typeof createPrivateKey>;
  try {
    cert = new X509Certificate(certPem);
  } catch {
    throw new BadRequestException('Could not parse certificate PEM');
  }
  try {
    key = createPrivateKey(keyPem);
  } catch {
    throw new BadRequestException('Could not parse private key PEM');
  }

  // Works for RSA and EC alike — this replaces the old modulus comparison
  // (node-forge, RSA-only) so browser-trusted ECDSA certs stop being rejected.
  if (!cert.checkPrivateKey(key)) {
    throw new BadRequestException('Private key does not match the certificate');
  }

  const now = Date.now();
  if (now > new Date(cert.validTo).getTime()) {
    throw new BadRequestException('Certificate is expired');
  }
  if (now < new Date(cert.validFrom).getTime()) {
    throw new BadRequestException('Certificate is not yet valid');
  }

  const sans = this.dnsSans(cert);
  const wildcardCovered = this.checkSansCover(sans, validatedDomain, servingMode);
  return { sans, wildcardCovered };
}

/**
 * X509Certificate.subjectAltName is a comma-separated string like
 * "DNS:example.com, DNS:*.example.com, IP Address:1.2.3.4" — only DNS
 * entries are hostnames a policy check may match against.
 */
private dnsSans(cert: X509Certificate): string[] {
  return (cert.subjectAltName ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('DNS:'))
    .map((s) => s.slice(4));
}

/**
 * SAN policy (spec §4): apex always hard-required. The wildcard is
 * hard-required only on the Cloudflare path (Origin Certs include it for
 * free and the wizard copy demands it); on proxy/none paths a missing
 * wildcard degrades preview subdomains, which the UI explains — so it is
 * reported, not enforced. Returns whether the wildcard is covered.
 */
private checkSansCover(sans: string[], validatedDomain: string, servingMode: ProxyMode): boolean {
  const lowerSans = sans.map((s) => s.toLowerCase());
  if (!lowerSans.includes(validatedDomain)) {
    throw new BadRequestException(`Certificate does not cover ${validatedDomain}`);
  }
  const wildcardCovered = lowerSans.includes(`*.${validatedDomain}`);
  if (!wildcardCovered && servingMode === 'cloudflare') {
    throw new BadRequestException(
      `Certificate does not cover the wildcard *.${validatedDomain} — include it when creating the Origin Certificate`,
    );
  }
  return wildcardCovered;
}

assertStagedCertificateCovers(domain: string, servingMode: ProxyMode): void {
  const validatedDomain = this.assertValidDomain(domain);
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(fs.readFileSync(path.join(this.sslDir(), 'fullchain.pem')));
  } catch {
    throw new BadRequestException(
      'Installed certificate could not be read — re-install the certificate for this domain',
    );
  }
  this.checkSansCover(this.dnsSans(cert), validatedDomain, servingMode);
}
```

- [ ] **Step 4: DTO + controller.** `UploadCertificatesDto` gains:

```ts
  @ApiProperty({ description: 'Serving path — drives the SAN policy', enum: ['cloudflare', 'proxy', 'none'] })
  @IsIn(['cloudflare', 'proxy', 'none'])
  servingMode: 'cloudflare' | 'proxy' | 'none';
```

Controller `uploadCertificates` becomes:

```ts
    const { sans, wildcardCovered } = this.bootstrap.validateCertificatePair(
      dto.certificatePem,
      dto.privateKeyPem,
      dto.domain,
      dto.servingMode,
    );
    this.bootstrap.saveCertificates(dto.certificatePem, dto.privateKeyPem, dto.domain);
    return { saved: true, sans, wildcardCovered };
```

And `apply()`'s staged re-check becomes `this.bootstrap.assertStagedCertificateCovers(dto.domain, dto.proxyMode);`.

- [ ] **Step 5: Run the full setup suite; fix call sites**

Run: `cd apps/backend && pnpm test -- bootstrap-setup`
Expected: PASS after updating existing specs to pass `servingMode` (use `'cloudflare'` to preserve their current strict expectations).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/setup/
git commit -m "feat(bootstrap-ssl): path-aware SAN policy + ECDSA support via node:crypto X509Certificate"
```

---

### Task 4: nginx render script — branch on knobs, ACME location, test harness

**Files:**
- Modify: `docker/nginx/render-main-conf.sh`
- Modify: `docker/nginx/sites-available/main.conf.template`
- Create: `docker/nginx/render-main-conf.test.sh` (host-runnable harness)

**Interfaces:**
- Consumes: `instance.env` keys from Task 1 (`STATE`, `PRIMARY_DOMAIN`, `PROXY_MODE`, `SSL_MODE`, `PORT80`, `REALIP_MODE`, `REALIP_HEADER`, `REALIP_RANGES`).
- Produces: rendered `main.conf` + `cloudflare-realip.conf` driven ONLY by knobs. Env-only legacy installs (no `instance.env`) derive knobs from `PROXY_MODE` exactly as `deriveKnobs` does.

- [ ] **Step 1: Make the script paths overridable** (top of `render-main-conf.sh`, replacing the three hardcoded assignments — required for host testing, no container behavior change):

```sh
NGINX_ETC="${NGINX_ETC:-/etc/nginx}"
SSL_DIR="${NGINX_ETC}/ssl"
BOOTSTRAP_DIR="${NGINX_ETC}/bootstrap"
SITES_AVAILABLE="${NGINX_ETC}/sites-available"
REALIP_CONF="${NGINX_ETC}/cloudflare-realip.conf"
CERTBOT_ROOT="${CERTBOT_ROOT:-/var/www/certbot}"
```

Replace every literal `/etc/nginx/cloudflare-realip.conf` with `"${REALIP_CONF}"`, every `/etc/nginx/sites-available/...` with `"${SITES_AVAILABLE}/..."`, and `mkdir -p /var/www/certbot` with `mkdir -p "${CERTBOT_ROOT}"`.

- [ ] **Step 2: Write the failing test harness** — `docker/nginx/render-main-conf.test.sh`:

```sh
#!/bin/sh
# Host-runnable render harness: builds a fake NGINX_ETC in a temp dir, runs the
# renderer for each knob combination, and asserts on the generated files.
# Requires: envsubst (gettext), openssl. Run: sh docker/nginx/render-main-conf.test.sh
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
FAILURES=0

assert_contains() { # file needle label
    if grep -qF "$2" "$1"; then echo "ok: $3"; else echo "FAIL: $3 (missing '$2' in $1)"; FAILURES=$((FAILURES+1)); fi
}
assert_not_contains() {
    if grep -qF "$2" "$1"; then echo "FAIL: $3 (unexpected '$2' in $1)"; FAILURES=$((FAILURES+1)); else echo "ok: $3"; fi
}

setup_etc() { # $1 = instance.env content
    ETC="$(mktemp -d)"
    mkdir -p "$ETC/ssl" "$ETC/bootstrap" "$ETC/sites-available"
    cp "$HERE/sites-available/"*.template "$ETC/sites-available/"
    # Applied installs need certs + the bootstrap marker; mint throwaways.
    openssl req -x509 -nodes -days 2 -newkey rsa:2048 -keyout "$ETC/ssl/privkey.pem" \
        -out "$ETC/ssl/fullchain.pem" -subj "/CN=test" 2>/dev/null
    cp "$ETC/ssl/fullchain.pem" "$ETC/ssl/wildcard.example.com.crt"
    cp "$ETC/ssl/privkey.pem" "$ETC/ssl/wildcard.example.com.key"
    touch "$ETC/ssl/bootstrap-selfsigned.crt"
    printf '%s\n' "$1" > "$ETC/bootstrap/instance.env"
}

run_render() {
    ( unset PRIMARY_DOMAIN PROXY_MODE SSL_MODE PORT80 REALIP_MODE REALIP_HEADER REALIP_RANGES
      NGINX_ETC="$ETC" CERTBOT_ROOT="$ETC/certbot" sh "$HERE/render-main-conf.sh" >/dev/null )
}

# --- cloudflare preset: closed port 80, CF realip ---
setup_etc 'STATE=applied
PRIMARY_DOMAIN=example.com
PROXY_MODE=cloudflare
SSL_MODE=paste
PORT80=closed
REALIP_MODE=cloudflare'
run_render
assert_contains     "$ETC/sites-available/main.conf" 'return 444;'                    'cloudflare: port 80 closed'
assert_not_contains "$ETC/sites-available/main.conf" 'acme-challenge'                 'cloudflare: no ACME location'
assert_contains     "$ETC/cloudflare-realip.conf"    'real_ip_header CF-Connecting-IP;' 'cloudflare: CF realip header'
assert_contains     "$ETC/cloudflare-realip.conf"    'set_real_ip_from 173.245.48.0/20;' 'cloudflare: CF ranges'

# --- proxy + custom realip: redirect + ACME + generated ranges ---
setup_etc 'STATE=applied
PRIMARY_DOMAIN=example.com
PROXY_MODE=proxy
SSL_MODE=paste
PORT80=redirect
REALIP_MODE=custom
REALIP_HEADER=True-Client-IP
REALIP_RANGES="151.101.0.0/16 2a04:4e40::/32"'
run_render
assert_contains "$ETC/sites-available/main.conf" 'return 301 https://$host$request_uri;' 'proxy: port 80 redirects'
assert_contains "$ETC/sites-available/main.conf" '/.well-known/acme-challenge/'          'proxy: ACME location present'
assert_contains "$ETC/cloudflare-realip.conf"    'set_real_ip_from 151.101.0.0/16;'      'proxy: custom range 1'
assert_contains "$ETC/cloudflare-realip.conf"    'set_real_ip_from 2a04:4e40::/32;'      'proxy: custom range 2'
assert_contains "$ETC/cloudflare-realip.conf"    'real_ip_header True-Client-IP;'        'proxy: custom header'

# --- direct + letsencrypt: redirect + ACME + realip off ---
setup_etc 'STATE=applied
PRIMARY_DOMAIN=example.com
PROXY_MODE=none
SSL_MODE=letsencrypt
PORT80=redirect
REALIP_MODE=off'
run_render
assert_contains     "$ETC/sites-available/main.conf" '/.well-known/acme-challenge/' 'direct: ACME location present'
assert_not_contains "$ETC/cloudflare-realip.conf"    'set_real_ip_from'             'direct: realip inactive'

# --- legacy env-only install (no knobs in instance.env): derives from PROXY_MODE ---
setup_etc 'STATE=applied
PRIMARY_DOMAIN=example.com
PROXY_MODE=cloudflare'
run_render
assert_contains "$ETC/sites-available/main.conf" 'return 444;' 'legacy v1 env: cloudflare derives closed port 80'
assert_contains "$ETC/cloudflare-realip.conf" 'real_ip_header CF-Connecting-IP;' 'legacy v1 env: cloudflare derives CF realip'

[ "$FAILURES" -eq 0 ] && echo 'ALL RENDER TESTS PASSED' || { echo "$FAILURES FAILURES"; exit 1; }
```

Run: `sh docker/nginx/render-main-conf.test.sh`
Expected: FAIL — script still branches on `PROXY_MODE`, no ACME location, custom realip unsupported.

- [ ] **Step 3: Implement the knob branches.** In `render-main-conf.sh`, after the `PROXY_MODE` export block, add knob resolution (mirrors `deriveKnobs` for legacy env-only installs):

```sh
SSL_MODE="${SSL_MODE:-paste}"
PORT80="${PORT80:-}"
REALIP_MODE="${REALIP_MODE:-}"
REALIP_HEADER="${REALIP_HEADER:-X-Forwarded-For}"
REALIP_RANGES="${REALIP_RANGES:-}"
if [ -z "${PORT80}" ]; then
    [ "${PROXY_MODE}" = "cloudflare" ] && PORT80="closed" || PORT80="redirect"
fi
if [ -z "${REALIP_MODE}" ]; then
    [ "${PROXY_MODE}" = "cloudflare" ] && REALIP_MODE="cloudflare" || REALIP_MODE="off"
fi
```

Replace the entire `if [ "${PROXY_MODE}" = "cloudflare" ]` / `else` NORMAL-MODE branch pair with three knob-driven sections:

```sh
# --- certificates (path selection is file-driven, not vendor-driven) ---
if [ -f "${SSL_DIR}/fullchain.pem" ] && [ -f "${SSL_DIR}/privkey.pem" ]; then
    echo "✅ SSL certificates found (fullchain.pem, privkey.pem)"
else
    echo "❌ SSL certificates not found (fullchain.pem/privkey.pem required)"
    exit 1
fi
if [ -f "${SSL_DIR}/wildcard.${PRIMARY_DOMAIN}.crt" ] && [ -f "${SSL_DIR}/wildcard.${PRIMARY_DOMAIN}.key" ]; then
    WILDCARD_CERT="${SSL_DIR}/wildcard.${PRIMARY_DOMAIN}.crt"
    WILDCARD_KEY="${SSL_DIR}/wildcard.${PRIMARY_DOMAIN}.key"
elif [ "${PROXY_MODE}" = "cloudflare" ]; then
    # Legacy CF installs predating the wildcard.* copies: Origin Certs carry
    # the *.domain SAN, so the generic pair can serve the wildcard vhost.
    echo "ℹ️  No separate wildcard cert — using main certificate (Cloudflare Origin Cert)"
    WILDCARD_CERT="${SSL_DIR}/fullchain.pem"
    WILDCARD_KEY="${SSL_DIR}/privkey.pem"
else
    echo "❌ Wildcard certificate not found (wildcard.${PRIMARY_DOMAIN}.crt/.key)"
    exit 1
fi

# --- port 80 (knob: PORT80) ---
if [ "${PORT80}" = "closed" ]; then
    PORT80_ACTION="return 444;"
    ACME_LOCATION="# port 80 closed — no ACME location"
else
    PORT80_ACTION="return 301 https://\$host\$request_uri;"
    ACME_LOCATION="location /.well-known/acme-challenge/ { root ${CERTBOT_ROOT}; }"
fi

# --- real-IP (knob: REALIP_MODE) ---
case "${REALIP_MODE}" in
cloudflare)
    cat > "${REALIP_CONF}" <<'CFEOF'
# Cloudflare IP ranges (https://www.cloudflare.com/ips/)
# Last updated: 2026-02-02
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 131.0.72.0/22;
set_real_ip_from 2400:cb00::/32;
set_real_ip_from 2606:4700::/32;
set_real_ip_from 2803:f800::/32;
set_real_ip_from 2405:b500::/32;
set_real_ip_from 2405:8100::/32;
set_real_ip_from 2a06:98c0::/29;
set_real_ip_from 2c0f:f248::/32;
real_ip_header CF-Connecting-IP;
CFEOF
    ;;
custom)
    {
        echo "# Custom proxy real-IP trust (REALIP_MODE=custom, from instance.env)"
        for range in ${REALIP_RANGES}; do
            echo "set_real_ip_from ${range};"
        done
        echo "real_ip_header ${REALIP_HEADER};"
    } > "${REALIP_CONF}"
    ;;
*)
    echo "# real-IP trust inactive (REALIP_MODE=off)" > "${REALIP_CONF}"
    ;;
esac

export WILDCARD_CERT WILDCARD_KEY PORT80_ACTION ACME_LOCATION
```

And add `${ACME_LOCATION}` to the envsubst variable list:

```sh
envsubst '${PRIMARY_DOMAIN} ${WILDCARD_CERT} ${WILDCARD_KEY} ${PORT80_ACTION} ${ACME_LOCATION}' \
    < "${SITES_AVAILABLE}/main.conf.template" > "${SITES_AVAILABLE}/main.conf"
```

- [ ] **Step 4: Template.** In `main.conf.template`, replace the port-80 server block:

```
# HTTP server — behavior driven by the PORT80 knob (rendered by render-main-conf.sh):
#   closed   → return 444 (a proxy/CDN owns port 80 at its edge)
#   redirect → serve ACME challenges from the shared webroot, 301 everything else
server {
    listen 80;
    server_name _;

    ${ACME_LOCATION}

    location / {
        ${PORT80_ACTION}
    }
}
```

(`return 444;` inside `location /` behaves identically to server-level for every URI, since the closed variant renders no ACME location.)

- [ ] **Step 5: Run harness + shellcheck**

Run: `sh docker/nginx/render-main-conf.test.sh && shellcheck docker/nginx/render-main-conf.sh || true`
Expected: `ALL RENDER TESTS PASSED`; shellcheck clean of new warnings (the `for range in ${REALIP_RANGES}` word-split is intentional — annotate `# shellcheck disable=SC2086` on that line).

- [ ] **Step 6: Container sanity** — the compose nginx already mounts `acme-webroot:/var/www/certbot:ro`, so the new normal-mode ACME location serves the same volume the backend writes challenges into. Verify with:

Run: `docker compose build nginx`
Expected: builds clean (script + template are COPYd by the existing Dockerfile).

- [ ] **Step 7: Commit**

```bash
git add docker/nginx/
git commit -m "feat(bootstrap-ssl): render nginx from port80/realIp knobs, ACME location in redirect mode"
```

---

### Task 5: `requestPrimaryDomainCertificate` — the deferred primary-domain ACME method

**Files:**
- Modify: `apps/backend/src/domains/ssl-certificate.service.ts`
- Test: `apps/backend/src/domains/ssl-certificate.service.spec.ts` (create if missing)

**Interfaces:**
- Consumes: existing private helpers `writeHttpChallenge`, `removeHttpChallenge`, `getSslPath`, `parseCertificateExpiry`, the `acme-client` order flow (mirror `requestCustomDomainCertificate`).
- Produces:
  - `requestPrimaryDomainCertificate(domain: string): Promise<{ success: boolean; error?: string; expiresAt?: Date; sans?: string[] }>` — HTTP-01 order for `[domain, www.<domain>, admin.<domain>]`; saves `fullchain.pem`/`privkey.pem` (0644/0600) **and copies to `wildcard.<domain>.crt/.key`**; idempotent (reuses a staged cert that covers all three SANs with >30 days left); in `MOCK_SSL=true` mode writes a self-signed pair covering all SANs + the wildcard (powers Playwright E2E without any ACME server).
  - `getPrimaryCertificateExpiryDays(): number | null` — days until `fullchain.pem` expires, null if unreadable (used by Task 8's renewal).
  - `initialize()` honors `ACME_DIRECTORY_URL` env override (Pebble) and no longer throws when `CERTBOT_EMAIL` is unset (creates a contact-less ACME account — required for bootstrap installs, where no email exists yet).

- [ ] **Step 1: Write the failing tests** (mock `acme-client` at the module boundary — the existing codebase has no ACME service spec, so create one focused on the new method):

```ts
// apps/backend/src/domains/ssl-certificate.service.spec.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SslCertificateService } from './ssl-certificate.service';

describe('SslCertificateService.requestPrimaryDomainCertificate', () => {
  let sslDir: string;

  beforeEach(() => {
    sslDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bffless-ssl-'));
    process.env.SSL_CERT_PATH = sslDir;
    process.env.MOCK_SSL = 'true'; // exercise the mock path — no network
  });
  afterEach(() => {
    delete process.env.SSL_CERT_PATH;
    delete process.env.MOCK_SSL;
    fs.rmSync(sslDir, { recursive: true, force: true });
  });

  it('mock mode writes all four cert files and reports the SANs', async () => {
    const service = new SslCertificateService();
    const res = await service.requestPrimaryDomainCertificate('example.com');
    expect(res.success).toBe(true);
    expect(res.sans).toEqual(['example.com', 'www.example.com', 'admin.example.com']);
    for (const f of ['fullchain.pem', 'privkey.pem', 'wildcard.example.com.crt', 'wildcard.example.com.key']) {
      expect(fs.existsSync(path.join(sslDir, f))).toBe(true);
    }
  });

  it('primary renewal does not clobber a real DNS-01 wildcard', async () => {
    const service = new SslCertificateService();
    await service.requestPrimaryDomainCertificate('example.com');
    // Simulate a real wildcard install: overwrite the copies with a marker
    // cert carrying the *.example.com SAN (mint via the forge helper pattern).
    fs.writeFileSync(path.join(sslDir, 'wildcard.example.com.crt'), REAL_WILDCARD_CERT_PEM);
    fs.writeFileSync(path.join(sslDir, 'wildcard.example.com.key'), REAL_WILDCARD_KEY_PEM);
    fs.rmSync(path.join(sslDir, 'fullchain.pem')); // force re-issue
    await service.requestPrimaryDomainCertificate('example.com');
    expect(fs.readFileSync(path.join(sslDir, 'wildcard.example.com.crt'), 'utf8')).toBe(REAL_WILDCARD_CERT_PEM);
  });

  it('is idempotent — a second call reuses the staged cert', async () => {
    const service = new SslCertificateService();
    await service.requestPrimaryDomainCertificate('example.com');
    const firstCert = fs.readFileSync(path.join(sslDir, 'fullchain.pem'), 'utf8');
    const res = await service.requestPrimaryDomainCertificate('example.com');
    expect(res.success).toBe(true);
    expect(fs.readFileSync(path.join(sslDir, 'fullchain.pem'), 'utf8')).toBe(firstCert);
  });

  it('getPrimaryCertificateExpiryDays reads the staged cert', async () => {
    const service = new SslCertificateService();
    await service.requestPrimaryDomainCertificate('example.com');
    const days = service.getPrimaryCertificateExpiryDays();
    expect(days).toBeGreaterThan(80); // mock certs are minted for 90 days
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && pnpm test -- ssl-certificate.service`
Expected: FAIL — method does not exist.

- [ ] **Step 3: Implement** in `ssl-certificate.service.ts` (place after `requestCustomDomainCertificate`; `import { X509Certificate } from 'crypto';` at top):

```ts
  /**
   * Primary-domain issuance for the bootstrap wizard's direct + Let's Encrypt
   * path — the method the 2026-07-20 spec deferred. HTTP-01 only, so it covers
   * the fixed SAN set [apex, www, admin], NOT the wildcard (ACME requires
   * DNS-01 for wildcards); the cert is additionally copied to the
   * wildcard.<domain>.crt/.key filenames so the nginx render contract
   * (Task 4) holds — preview subdomains serve it with a hostname mismatch
   * until the optional DNS-01 wildcard flow replaces the copies.
   */
  async requestPrimaryDomainCertificate(domain: string): Promise<{
    success: boolean;
    error?: string;
    expiresAt?: Date;
    sans?: string[];
  }> {
    const sans = [domain, `www.${domain}`, `admin.${domain}`];

    // Idempotency: bootstrap wizard retries (and the renewal cron far from
    // expiry) must not burn LE rate limit re-issuing a cert we already hold.
    const staged = this.stagedPrimaryCertificate(sans);
    if (staged) {
      this.logger.log(`Primary cert already covers [${sans.join(', ')}] — reusing`);
      return { success: true, expiresAt: staged.expiresAt, sans };
    }

    if (this.mockMode) {
      return this.issueMockPrimaryCertificate(domain, sans);
    }
    if (!this.acmeClient) {
      return { success: false, error: 'ACME client not initialized' };
    }

    try {
      const order = await this.acmeClient.createOrder({
        identifiers: sans.map((d) => ({ type: 'dns', value: d })),
      });
      const authorizations = await this.acmeClient.getAuthorizations(order);
      for (const authz of authorizations) {
        const challenge = authz.challenges.find((c) => c.type === 'http-01');
        if (!challenge) {
          throw new Error(`HTTP-01 challenge not available for ${authz.identifier.value}`);
        }
        const keyAuth = await this.acmeClient.getChallengeKeyAuthorization(challenge);
        await this.writeHttpChallenge(challenge.token, keyAuth);
        await this.acmeClient.completeChallenge(challenge);
        await this.acmeClient.waitForValidStatus(challenge);
        await this.removeHttpChallenge(challenge.token);
      }

      const [key, csr] = await acme.crypto.createCsr({
        commonName: domain,
        altNames: [`www.${domain}`, `admin.${domain}`],
      });
      const finalizedOrder = await this.acmeClient.finalizeOrder(order, csr);
      let validOrder = finalizedOrder;
      let attempts = 0;
      while (validOrder.status === 'processing' && attempts < 30) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        validOrder = await this.acmeClient.getOrder(order);
        attempts++;
      }
      if (validOrder.status !== 'valid') {
        throw new Error(`Order did not become valid. Final status: ${validOrder.status}`);
      }
      const certificate = await this.acmeClient.getCertificate(validOrder);
      await this.savePrimaryCertificate(domain, certificate, key);
      const expiresAt = this.parseCertificateExpiry(certificate);
      this.logger.log(`Primary domain certificate issued for [${sans.join(', ')}]`);
      return { success: true, expiresAt, sans };
    } catch (error) {
      this.logger.error(`Primary domain issuance failed for ${domain}: ${error}`);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /** Days until fullchain.pem expires; null when absent/unparseable. */
  getPrimaryCertificateExpiryDays(): number | null {
    try {
      const pem = require('fs').readFileSync(join(this.getSslPath(), 'fullchain.pem'));
      const cert = new X509Certificate(pem);
      return Math.floor((new Date(cert.validTo).getTime() - Date.now()) / 86_400_000);
    } catch {
      return null;
    }
  }

  private stagedPrimaryCertificate(sans: string[]): { expiresAt: Date } | null {
    try {
      const pem = require('fs').readFileSync(join(this.getSslPath(), 'fullchain.pem'));
      const cert = new X509Certificate(pem);
      const certSans = (cert.subjectAltName ?? '')
        .split(',').map((s) => s.trim()).filter((s) => s.startsWith('DNS:')).map((s) => s.slice(4));
      const covers = sans.every((s) => certSans.includes(s));
      const expiresAt = new Date(cert.validTo);
      const daysLeft = (expiresAt.getTime() - Date.now()) / 86_400_000;
      return covers && daysLeft > 30 ? { expiresAt } : null;
    } catch {
      return null;
    }
  }

  private async savePrimaryCertificate(domain: string, certificate: string, key: Buffer): Promise<void> {
    const sslPath = this.getSslPath();
    await mkdir(sslPath, { recursive: true });
    await writeFile(join(sslPath, 'fullchain.pem'), certificate, { mode: 0o644 });
    await writeFile(join(sslPath, 'privkey.pem'), key, { mode: 0o600 });
    // The wildcard.* files are only a COPY of the primary cert (render-contract
    // filler). If a real DNS-01 wildcard is installed — its SANs include
    // *.<domain>, which an HTTP-01 primary cert can never carry — a primary
    // RENEWAL must not clobber it. Overwrite only when absent or when the
    // existing file is itself a wildcard-less copy.
    if (!this.installedWildcardIsReal(domain)) {
      await writeFile(join(sslPath, `wildcard.${domain}.crt`), certificate, { mode: 0o644 });
      await writeFile(join(sslPath, `wildcard.${domain}.key`), key, { mode: 0o600 });
    }
  }

  /** True when wildcard.<domain>.crt exists and genuinely covers *.<domain>. */
  private installedWildcardIsReal(domain: string): boolean {
    try {
      const pem = require('fs').readFileSync(join(this.getSslPath(), `wildcard.${domain}.crt`));
      const cert = new X509Certificate(pem);
      return (cert.subjectAltName ?? '').includes(`DNS:*.${domain}`);
    } catch {
      return false;
    }
  }

  /**
   * MOCK_SSL=true: mint a 90-day self-signed cert covering the SAN set plus
   * the wildcard, via acme.crypto (no openssl dependency in jest/Playwright).
   */
  private async issueMockPrimaryCertificate(domain: string, sans: string[]): Promise<{
    success: boolean; expiresAt?: Date; sans?: string[];
  }> {
    const [key, csr] = await acme.crypto.createCsr({ commonName: domain, altNames: [...sans.slice(1), `*.${domain}`] });
    const cert = await acme.crypto.createCertificate({ csr, notAfterDays: 90 } as never)
      .catch(() => null);
    // acme-client <5 has no createCertificate; fall back to node-forge, which
    // is already a dependency of this file, to self-sign the CSR equivalent.
    const pem = cert ?? this.selfSignWithForge(domain, [...sans, `*.${domain}`]);
    await this.savePrimaryCertificate(domain, typeof pem === 'string' ? pem : String(pem), key);
    this.mockCertificates.set(domain, new Date(Date.now() + 90 * 86_400_000));
    return { success: true, expiresAt: new Date(Date.now() + 90 * 86_400_000), sans };
  }

  private selfSignWithForge(domain: string, altNames: string[]): string {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date(Date.now() + 90 * 86_400_000);
    const attrs = [{ name: 'commonName', value: domain }];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([
      { name: 'subjectAltName', altNames: altNames.map((v) => ({ type: 2, value: v })) },
    ]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    // The mock must keep cert and key consistent: overwrite the key the caller
    // saved by returning both through savePrimaryCertificate in the caller.
    this.mockPrimaryKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
    return forge.pki.certificateToPem(cert);
  }
  private mockPrimaryKeyPem: string | null = null;
```

**Implementation note (mock + wildcard guard):** the MOCK_SSL cert deliberately carries the
`*.domain` SAN (so Playwright previews work), which `installedWildcardIsReal` would treat as a
real wildcard. In mock mode, skip the guard (always overwrite) — gate on `this.mockMode`.
`REAL_WILDCARD_CERT_PEM`/`REAL_WILDCARD_KEY_PEM` in the spec are minted with the same forge
helper as the other fixtures, SANs `['*.example.com', 'example.com']`.

**Implementation note for the executor:** the mock path above must save a *matching* key —
after `selfSignWithForge` runs, save `this.mockPrimaryKeyPem` (as `Buffer.from(...)`) instead
of the CSR key. Simplest correct shape: have `issueMockPrimaryCertificate` call
`selfSignWithForge` FIRST, then `savePrimaryCertificate(domain, certPem, Buffer.from(this.mockPrimaryKeyPem!))`,
and skip the `acme.crypto.createCsr` call entirely in mock mode. Write it that way; the
snippet above shows both pieces for completeness of names.

- [ ] **Step 4: `initialize()` changes** — replace the directoryUrl selection and the CERTBOT_EMAIL throw:

```ts
      const directoryUrl =
        process.env.ACME_DIRECTORY_URL ||
        (process.env.NODE_ENV === 'production'
          ? acme.directory.letsencrypt.production
          : acme.directory.letsencrypt.staging);
      // ...
      const email = process.env.CERTBOT_EMAIL;
      await this.acmeClient.createAccount({
        termsOfServiceAgreed: true,
        // Bootstrap installs have no email yet; LE permits contact-less accounts.
        ...(email ? { contact: [`mailto:${email}`] } : {}),
      });
```

- [ ] **Step 5: Run tests**

Run: `cd apps/backend && pnpm test -- ssl-certificate.service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/domains/ssl-certificate.service.ts apps/backend/src/domains/ssl-certificate.service.spec.ts
git commit -m "feat(bootstrap-ssl): primary-domain HTTP-01 issuance (apex+www+admin), ACME_DIRECTORY_URL override, contact-less account"
```

---

### Task 6: DNS preflight service (A-record check + webroot self-probe)

**Files:**
- Create: `apps/backend/src/setup/bootstrap-dns-preflight.service.ts`
- Test: `apps/backend/src/setup/bootstrap-dns-preflight.service.spec.ts`
- Modify: `apps/backend/src/setup/setup.module.ts` (register provider)

**Interfaces:**
- Consumes: nothing from other tasks (pure service; node `dns/promises`, global `fetch`, `CERTBOT_WEBROOT`).
- Produces:
  - `interface PreflightCheck { host: string; resolvedIps: string[]; probeOk: boolean; error?: string }`
  - `interface PreflightResult { ok: boolean; checks: PreflightCheck[] }`
  - `BootstrapDnsPreflightService.run(domain: string): Promise<PreflightResult>` — for each of `[domain, www.<domain>, admin.<domain>]`: resolve A records (diagnostic), then fetch `http://<host>/.well-known/acme-challenge/<random-token>` end-to-end and require the response body to equal the token content. `ok` = every `probeOk`. The probe is authoritative (it proves DNS + port 80 + nginx routing exactly as the LE validator sees them); the resolved IPs are for the UI's diagnostics only.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/backend/src/setup/bootstrap-dns-preflight.service.spec.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BootstrapDnsPreflightService } from './bootstrap-dns-preflight.service';

describe('BootstrapDnsPreflightService', () => {
  let webroot: string;
  let service: BootstrapDnsPreflightService;

  beforeEach(() => {
    webroot = fs.mkdtempSync(path.join(os.tmpdir(), 'bffless-webroot-'));
    process.env.CERTBOT_WEBROOT = webroot;
    service = new BootstrapDnsPreflightService();
  });
  afterEach(() => {
    delete process.env.CERTBOT_WEBROOT;
    fs.rmSync(webroot, { recursive: true, force: true });
  });

  it('passes when every host serves the probe token back', async () => {
    jest.spyOn(service as never, 'resolveA' as never).mockResolvedValue(['203.0.113.7'] as never);
    jest
      .spyOn(service as never, 'fetchProbe' as never)
      .mockImplementation((async (_host: string, _token: string, content: string) => content) as never);
    const res = await service.run('example.com');
    expect(res.ok).toBe(true);
    expect(res.checks.map((c) => c.host)).toEqual(['example.com', 'www.example.com', 'admin.example.com']);
    expect(res.checks.every((c) => c.probeOk)).toBe(true);
  });

  it('fails a host whose probe returns wrong content, keeps others green', async () => {
    jest.spyOn(service as never, 'resolveA' as never).mockResolvedValue([] as never);
    jest
      .spyOn(service as never, 'fetchProbe' as never)
      .mockImplementation((async (host: string, _t: string, content: string) =>
        host === 'www.example.com' ? 'someone else answered' : content) as never);
    const res = await service.run('example.com');
    expect(res.ok).toBe(false);
    expect(res.checks.find((c) => c.host === 'www.example.com')!.probeOk).toBe(false);
    expect(res.checks.find((c) => c.host === 'example.com')!.probeOk).toBe(true);
  });

  it('cleans up the probe file from the webroot', async () => {
    jest.spyOn(service as never, 'resolveA' as never).mockResolvedValue([] as never);
    jest.spyOn(service as never, 'fetchProbe' as never).mockRejectedValue(new Error('unreachable') as never);
    await service.run('example.com');
    expect(fs.readdirSync(path.join(webroot, '.well-known', 'acme-challenge'))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && pnpm test -- bootstrap-dns-preflight`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/backend/src/setup/bootstrap-dns-preflight.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { promises as dns } from 'dns';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface PreflightCheck {
  host: string;
  resolvedIps: string[];
  probeOk: boolean;
  error?: string;
}

export interface PreflightResult {
  ok: boolean;
  checks: PreflightCheck[];
}

/**
 * Preflight for the direct + Let's Encrypt path. The probe writes a token
 * into the ACME webroot and fetches it back over the PUBLIC internet
 * (http://<host>/.well-known/acme-challenge/<token>), so a green result
 * proves DNS + port 80 + nginx webroot routing end-to-end — exactly the path
 * the LE validator takes. This is what lets the wizard hard-gate issuance
 * without ever burning LE's 5-failures/hostname/hour validation limit.
 *
 * Caveat (documented for the manual droplet leg): the probe egresses from the
 * droplet and loops back through its own public IP — NAT hairpin. DigitalOcean
 * droplets hairpin fine; some home-lab NATs do not, which surfaces as a
 * probe failure even though an external validator would succeed.
 */
@Injectable()
export class BootstrapDnsPreflightService {
  private readonly logger = new Logger(BootstrapDnsPreflightService.name);

  async run(domain: string): Promise<PreflightResult> {
    const hosts = [domain, `www.${domain}`, `admin.${domain}`];
    const token = `preflight-${crypto.randomBytes(16).toString('hex')}`;
    const content = token; // body == token: cheap, unguessable, self-describing
    const filePath = path.join(this.webroot(), '.well-known', 'acme-challenge', token);

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
    try {
      const checks: PreflightCheck[] = [];
      for (const host of hosts) {
        const resolvedIps = await this.resolveA(host);
        let probeOk = false;
        let error: string | undefined;
        try {
          const body = await this.fetchProbe(host, token, content);
          probeOk = body === content;
          if (!probeOk) error = 'Another server answered on port 80 for this hostname';
        } catch (e) {
          error = e instanceof Error ? e.message : 'Unreachable over HTTP';
        }
        if (!probeOk && resolvedIps.length === 0 && !error) {
          error = 'Hostname does not resolve yet';
        }
        checks.push({ host, resolvedIps, probeOk, error: probeOk ? undefined : error });
      }
      return { ok: checks.every((c) => c.probeOk), checks };
    } finally {
      await fs.rm(filePath, { force: true });
    }
  }

  private webroot(): string {
    return process.env.CERTBOT_WEBROOT || '/var/www/certbot';
  }

  // Both mockable seams below are instance methods for exactly that reason.
  private async resolveA(host: string): Promise<string[]> {
    try {
      return await dns.resolve4(host);
    } catch {
      return [];
    }
  }

  private async fetchProbe(host: string, token: string, _content: string): Promise<string> {
    const res = await fetch(`http://${host}/.well-known/acme-challenge/${token}`, {
      redirect: 'manual', // a 301 means the ACME location is missing — that's a failure
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${host}`);
    return await res.text();
  }
}
```

Register in `setup.module.ts` providers (alongside `BootstrapSetupService`).

- [ ] **Step 4: Run tests**

Run: `cd apps/backend && pnpm test -- bootstrap-dns-preflight`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/setup/bootstrap-dns-preflight.service.ts apps/backend/src/setup/bootstrap-dns-preflight.service.spec.ts apps/backend/src/setup/setup.module.ts
git commit -m "feat(bootstrap-ssl): DNS preflight — A-record diagnostics + end-to-end webroot self-probe"
```

---

### Task 7: Bootstrap LE endpoints — preflight, issue, wildcard start/complete

**Files:**
- Modify: `apps/backend/src/setup/bootstrap-setup.controller.ts`
- Modify: `apps/backend/src/setup/setup.dto.ts` (3 small DTOs)
- Modify: `apps/backend/src/setup/setup.module.ts` (provide `SslCertificateService`)
- Test: `apps/backend/src/setup/bootstrap-setup.controller.spec.ts`

**Interfaces:**
- Consumes: `BootstrapDnsPreflightService.run` (Task 6), `SslCertificateService.requestPrimaryDomainCertificate` / `startWildcardCertificateRequest` / `completeWildcardCertificateRequest` (Task 5 + existing).
- Produces (the frontend consumes these exact shapes in Task 9):
  - `POST /api/setup/dns-preflight` `{domain, token?}` → `PreflightResult`
  - `POST /api/setup/issue-certificate` `{domain, token?}` → `{ issued: true; sans: string[] }` (400 with the ACME/preflight error otherwise)
  - `POST /api/setup/wildcard/start` `{domain, token?}` → `{ recordName: string; recordValues: string[]; expiresAt: string }`
  - `POST /api/setup/wildcard/complete` `{domain, token?}` → `{ success: boolean; error?: string }`

- [ ] **Step 1: DTO** in `setup.dto.ts` — one shared shape for all three new endpoints:

```ts
export class BootstrapDomainActionDto {
  @ApiProperty({ description: 'Primary domain' })
  @IsString()
  @IsNotEmpty()
  domain: string;

  @ApiProperty({ required: false, description: 'Claim token (ONBOARDING_TOKEN)' })
  @IsOptional()
  @IsString()
  token?: string;
}
```

(All three endpoints take the same body; per-endpoint DTO subclasses would add nothing.)

- [ ] **Step 2: Write the failing controller tests** (extend the existing spec's harness — it instantiates the controller with a mocked `BootstrapSetupService`; add mocks for the two new deps):

```ts
describe('LE endpoints', () => {
  it('dns-preflight gates then delegates', async () => {
    preflight.run.mockResolvedValue({ ok: true, checks: [] });
    const res = await controller.dnsPreflight({ domain: 'example.com', token: 't' });
    expect(bootstrap.assertBootstrapAllowed).toHaveBeenCalled();
    expect(bootstrap.validateClaimToken).toHaveBeenCalledWith('t');
    expect(bootstrap.validateDomain).toHaveBeenCalledWith('example.com');
    expect(res.ok).toBe(true);
  });

  it('issue-certificate re-runs preflight server-side and 400s when it fails', async () => {
    preflight.run.mockResolvedValue({ ok: false, checks: [] });
    await expect(
      controller.issueCertificate({ domain: 'example.com' }),
    ).rejects.toThrow(BadRequestException);
    expect(sslCert.requestPrimaryDomainCertificate).not.toHaveBeenCalled();
  });

  it('issue-certificate returns SANs on success', async () => {
    preflight.run.mockResolvedValue({ ok: true, checks: [] });
    sslCert.requestPrimaryDomainCertificate.mockResolvedValue({
      success: true, sans: ['example.com', 'www.example.com', 'admin.example.com'],
    });
    const res = await controller.issueCertificate({ domain: 'example.com' });
    expect(res).toEqual({ issued: true, sans: ['example.com', 'www.example.com', 'admin.example.com'] });
  });

  it('issue-certificate surfaces the ACME error as a 400', async () => {
    preflight.run.mockResolvedValue({ ok: true, checks: [] });
    sslCert.requestPrimaryDomainCertificate.mockResolvedValue({ success: false, error: 'rateLimited' });
    await expect(controller.issueCertificate({ domain: 'example.com' })).rejects.toThrow(/rateLimited/);
  });

  it('wildcard start/complete delegate with the validated domain', async () => {
    bootstrap.validateDomain.mockReturnValue('example.com');
    sslCert.startWildcardCertificateRequest.mockResolvedValue({
      domain: 'example.com', recordName: '_acme-challenge.example.com',
      recordValue: 'v1', recordValues: ['v1', 'v2'], token: 'tok', expiresAt: new Date('2026-08-01'),
    });
    const start = await controller.wildcardStart({ domain: 'Example.com' });
    expect(start.recordName).toBe('_acme-challenge.example.com');
    expect(start.recordValues).toEqual(['v1', 'v2']);
    sslCert.completeWildcardCertificateRequest.mockResolvedValue({ success: true });
    const done = await controller.wildcardComplete({ domain: 'example.com' });
    expect(done.success).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd apps/backend && pnpm test -- bootstrap-setup.controller`
Expected: FAIL — methods missing.

- [ ] **Step 4: Implement.** Controller constructor gains the two services; endpoints:

```ts
  constructor(
    private readonly bootstrap: BootstrapSetupService,
    private readonly preflight: BootstrapDnsPreflightService,
    private readonly sslCert: SslCertificateService,
  ) {}

  @Post('dns-preflight')
  @ApiOperation({ summary: 'Check DNS + port-80 reachability for the LE path (bootstrap mode)' })
  async dnsPreflight(@Body() dto: BootstrapDomainActionDto): Promise<PreflightResult> {
    await this.bootstrap.assertBootstrapAllowed();
    this.bootstrap.validateClaimToken(dto.token);
    const domain = this.bootstrap.validateDomain(dto.domain);
    return this.preflight.run(domain);
  }

  @Post('issue-certificate')
  @ApiOperation({ summary: "Issue the primary-domain Let's Encrypt certificate (bootstrap mode)" })
  async issueCertificate(
    @Body() dto: BootstrapDomainActionDto,
  ): Promise<{ issued: true; sans: string[] }> {
    await this.bootstrap.assertBootstrapAllowed();
    this.bootstrap.validateClaimToken(dto.token);
    const domain = this.bootstrap.validateDomain(dto.domain);
    // Server-side re-check — the client's claim that preflight passed is
    // advisory only. Cheap (one token write + three HTTP GETs) relative to
    // burning an LE validation failure.
    const check = await this.preflight.run(domain);
    if (!check.ok) {
      throw new BadRequestException(
        'DNS preflight failed — the domain does not route to this server yet',
      );
    }
    await this.sslCert.initialize();
    const result = await this.sslCert.requestPrimaryDomainCertificate(domain);
    if (!result.success) {
      throw new BadRequestException(`Certificate issuance failed: ${result.error}`);
    }
    return { issued: true, sans: result.sans ?? [] };
  }

  @Post('wildcard/start')
  @ApiOperation({ summary: 'Start the optional DNS-01 wildcard (bootstrap mode)' })
  async wildcardStart(
    @Body() dto: BootstrapDomainActionDto,
  ): Promise<{ recordName: string; recordValues: string[]; expiresAt: string }> {
    await this.bootstrap.assertBootstrapAllowed();
    this.bootstrap.validateClaimToken(dto.token);
    const domain = this.bootstrap.validateDomain(dto.domain);
    await this.sslCert.initialize();
    const challenge = await this.sslCert.startWildcardCertificateRequest(domain);
    return {
      recordName: challenge.recordName,
      recordValues: challenge.recordValues,
      expiresAt: challenge.expiresAt.toISOString(),
    };
  }

  @Post('wildcard/complete')
  @ApiOperation({ summary: 'Verify TXT records and issue the wildcard (bootstrap mode)' })
  async wildcardComplete(
    @Body() dto: BootstrapDomainActionDto,
  ): Promise<{ success: boolean; error?: string }> {
    await this.bootstrap.assertBootstrapAllowed();
    this.bootstrap.validateClaimToken(dto.token);
    const domain = this.bootstrap.validateDomain(dto.domain);
    await this.sslCert.initialize();
    const result = await this.sslCert.completeWildcardCertificateRequest(domain);
    return { success: result.success, error: result.error };
  }
```

**Module wiring:** `SslCertificateService` has a zero-dependency constructor. Register it
directly in `setup.module.ts`'s `providers` array (a second instance alongside the domains
module's own) rather than importing `DomainsModule` — the domains module carries heavy
transitive deps and the two instances share all durable state through the filesystem
(`acme-account.key`, certs) and the `ssl_challenges` DB table. Add a comment saying exactly
that at the provider line.

- [ ] **Step 5: Run tests**

Run: `cd apps/backend && pnpm test -- bootstrap-setup.controller`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/setup/
git commit -m "feat(bootstrap-ssl): LE bootstrap endpoints — dns-preflight, issue-certificate, wildcard start/complete"
```

---

### Task 8: Renewal wiring — LE primary renewal, wildcard reminder banner + email

**Files:**
- Modify: `apps/backend/src/domains/ssl-renewal.service.ts`
- Modify: `apps/frontend/src/pages/HomePage.tsx` (expiring-wildcard banner state)
- Tests: `apps/backend/src/domains/ssl-renewal.service.spec.ts`, HomePage test if present

**Interfaces:**
- Consumes: `loadInstanceConfig` (Task 1), `requestPrimaryDomainCertificate` + `getPrimaryCertificateExpiryDays` (Task 5), existing `sslInfoService.getWildcardCertInfo()`, `EmailService.sendEmail` (globally provided by `EmailModule`), `sslSettings` keys (`notification_email`, `renewal_threshold_days`).
- Produces:
  - `checkAndRenewCertificates()` additionally: (a) renews the primary cert via HTTP-01 when `instance.json` has `state:'applied'` + `sslMode:'letsencrypt'` and it is within threshold — the `ssl/` write triggers the nginx watcher's re-render+reload automatically; (b) when the wildcard is within threshold and `renewWildcardCertificate()` fails with the DNS-API error, sends a reminder email (at most once per 7 days, tracked in `sslSettings` key `wildcard_reminder_last_sent`).
  - Reminder recipient resolution: `notification_email` setting → else the first admin user's email (`db.select().from(users).where(eq(users.role, 'admin')).limit(1)`) → else log-only.
  - `sendFailureNotifications` finally implements its TODO through `EmailService`.
  - HomePage banner: shows for `certStatus.exists === false` (today's behavior) **or** `certStatus.exists && certStatus.daysUntilExpiry <= 30`, with distinct copy ("Wildcard certificate expires in N days — renew it in Settings → SSL") and an expiry-scoped dismissal key (`ssl-banner-expiry-dismissed-${certStatus.expiresAt}`) so each new cert re-arms the banner.

- [ ] **Step 1: Write the failing renewal tests** (mock `SslCertificateService`, `EmailService`, `sslInfoService`; mock `loadInstanceConfig` via `jest.mock('../bootstrap/instance-config')`):

```ts
describe('primary-domain LE renewal', () => {
  it('renews the primary cert when sslMode is letsencrypt and within threshold', async () => {
    (loadInstanceConfig as jest.Mock).mockReturnValue({
      version: 2, state: 'applied', primaryDomain: 'example.com', proxyMode: 'none', sslMode: 'letsencrypt',
    });
    sslCert.getPrimaryCertificateExpiryDays.mockReturnValue(20);
    sslCert.requestPrimaryDomainCertificate.mockResolvedValue({ success: true, expiresAt: new Date() });
    await service.checkAndRenewCertificates();
    expect(sslCert.requestPrimaryDomainCertificate).toHaveBeenCalledWith('example.com');
  });

  it('skips primary renewal when sslMode is paste', async () => {
    (loadInstanceConfig as jest.Mock).mockReturnValue({
      version: 2, state: 'applied', primaryDomain: 'example.com', proxyMode: 'cloudflare', sslMode: 'paste',
    });
    await service.checkAndRenewCertificates();
    expect(sslCert.requestPrimaryDomainCertificate).not.toHaveBeenCalled();
  });
});

describe('wildcard expiry reminder', () => {
  it('emails when the wildcard cannot auto-renew', async () => {
    sslInfo.getWildcardCertInfo.mockResolvedValue({ exists: true, daysUntilExpiry: 15, expiresAt: new Date() });
    sslCert.renewWildcardCertificate.mockResolvedValue({
      success: false,
      error: 'Automatic wildcard renewal requires DNS API integration. Please renew manually via the DNS challenge flow.',
    });
    settingsStore['notification_email'] = 'admin@example.com';
    await service.checkAndRenewCertificates();
    expect(email.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'admin@example.com', subject: expect.stringMatching(/wildcard/i) }),
    );
  });

  it('does not re-email within 7 days', async () => {
    settingsStore['wildcard_reminder_last_sent'] = new Date().toISOString();
    // ... same arrangement as above ...
    await service.checkAndRenewCertificates();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**, then **Step 3: Implement.** In `ssl-renewal.service.ts`: inject `EmailService`; add to `checkAndRenewCertificates()` after the wildcard step:

```ts
      // 1b. Primary-domain LE cert (bootstrap direct + Let's Encrypt installs)
      const primaryResult = await this.checkAndRenewPrimary(thresholdDays);
      if (primaryResult) results.push(primaryResult);
```

```ts
  /**
   * Renews the primary cert issued by the bootstrap wizard's LE path. Only
   * active when instance.json says sslMode=letsencrypt — paste installs renew
   * by re-pasting, and env-only legacy installs have no instance.json at all.
   * The cert write lands in ssl/, which the nginx watcher observes → automatic
   * re-render + reload; this service never touches nginx for the primary cert.
   */
  private async checkAndRenewPrimary(thresholdDays: number): Promise<RenewalResult | null> {
    const cfg = loadInstanceConfig();
    if (cfg?.state !== 'applied' || cfg.sslMode !== 'letsencrypt' || !cfg.primaryDomain) return null;
    const daysLeft = this.sslCertificateService.getPrimaryCertificateExpiryDays();
    if (daysLeft === null || daysLeft > thresholdDays) {
      return { domain: cfg.primaryDomain, status: 'skipped' };
    }
    this.logger.log(`Primary LE cert expires in ${daysLeft} days, renewing…`);
    const result = await this.sslCertificateService.requestPrimaryDomainCertificate(cfg.primaryDomain);
    await this.logRenewal({
      certificateType: 'individual',
      domain: cfg.primaryDomain,
      status: result.success ? 'success' : 'failed',
      errorMessage: result.error,
      newExpiresAt: result.expiresAt,
      triggeredBy: 'auto',
    });
    return {
      domain: cfg.primaryDomain,
      status: result.success ? 'success' : 'failed',
      error: result.error,
      newExpiresAt: result.expiresAt,
    };
  }
```

In `checkAndRenewWildcard`, when `renewWildcardCertificate()` fails AND the error mentions DNS API integration, call:

```ts
  private async sendWildcardExpiryReminder(daysUntilExpiry: number): Promise<void> {
    const last = await this.getSetting('wildcard_reminder_last_sent');
    if (last && Date.now() - new Date(last).getTime() < 7 * 86_400_000) return;
    const to = await this.getReminderRecipient();
    if (!to) {
      this.logger.warn('Wildcard cert expiring but no reminder recipient (no notification_email, no admin user)');
      return;
    }
    const baseDomain = process.env.PRIMARY_DOMAIN || '';
    const result = await this.emailService.sendEmail({
      to,
      subject: `Action needed: wildcard certificate for *.${baseDomain} expires in ${daysUntilExpiry} days`,
      html:
        `<p>The wildcard certificate for <strong>*.${baseDomain}</strong> expires in ` +
        `<strong>${daysUntilExpiry} days</strong> and cannot renew automatically ` +
        `(DNS-01 wildcards need manual TXT records).</p>` +
        `<p>Renew it in <strong>Settings → SSL → Wildcard certificate</strong> on ` +
        `<a href="https://admin.${baseDomain}">admin.${baseDomain}</a> — the flow shows the ` +
        `TXT records to add and verifies them for you.</p>` +
        `<p>Until renewed, preview subdomains will show certificate warnings after expiry.</p>`,
    });
    if (result.success) {
      await this.updateSetting('wildcard_reminder_last_sent', new Date().toISOString());
    }
  }

  private async getReminderRecipient(): Promise<string | null> {
    const configured = await this.getSetting('notification_email');
    if (configured) return configured;
    const [admin] = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
    return admin?.email ?? null;
  }

  private async updateSetting(key: string, value: string): Promise<void> {
    await db
      .insert(sslSettings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: sslSettings.key, set: { value, updatedAt: new Date() } });
  }
```

(`users` joins the schema import list.) Implement `sendFailureNotifications`'s TODO with the same `EmailService` + recipient helper (subject "SSL renewal failures", one line per failed domain).

- [ ] **Step 4: HomePage banner.** Extend the banner condition + copy:

```tsx
  const wildcardExpiring =
    certStatus?.exists === true &&
    typeof certStatus.daysUntilExpiry === 'number' &&
    certStatus.daysUntilExpiry <= 30;
  const expiryDismissKey = `ssl-banner-expiry-dismissed-${certStatus?.expiresAt ?? ''}`;
  // showSslBanner: existing "missing wildcard" condition OR (wildcardExpiring
  // && localStorage.getItem(expiryDismissKey) !== 'true'); the expiring
  // variant renders "Wildcard certificate expires in {n} days — renew it in
  // Settings → SSL" with the dismiss handler writing expiryDismissKey.
```

- [ ] **Step 5: Run backend + frontend tests**

Run: `cd apps/backend && pnpm test -- ssl-renewal` then `cd apps/frontend && pnpm test -- HomePage`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/domains/ssl-renewal.service.ts apps/backend/src/domains/ssl-renewal.service.spec.ts apps/frontend/src/pages/HomePage.tsx
git commit -m "feat(bootstrap-ssl): renew LE primary cert in cron; wildcard expiry banner + email reminder"
```

---

### Task 9: Frontend state + API surface

**Files:**
- Modify: `apps/frontend/src/store/slices/setupSlice.ts`
- Modify: `apps/frontend/src/services/setupApi.ts`
- Tests: existing slice test file (extend), typecheck

**Interfaces:**
- Consumes: endpoint shapes from Tasks 3 and 7.
- Produces (Tasks 10–12 rely on these exact names):
  - Slice types: `type ServingMode = 'cloudflare' | 'proxy' | 'none'`, `type BootstrapSslMode = 'paste' | 'letsencrypt'`.
  - Wizard state additions: `servingMode: ServingMode | null`, `bootstrapSslMode: BootstrapSslMode | null`, `bootstrapPort80: 'closed' | 'redirect' | null`, `bootstrapRealIp: { header: string; ranges: string[] } | null`, `dnsPreflightPassed: boolean`, `wildcardIssued: boolean`.
  - Reducers: `setServingMode` (also resets `bootstrapSslMode` to `'paste'` for `cloudflare`/`proxy`, `null` for `none`; clears `bootstrapPort80`/`bootstrapRealIp`/`dnsPreflightPassed`/`wildcardIssued`), `setBootstrapSslMode`, `setBootstrapPort80`, `setBootstrapRealIp`, `setDnsPreflightPassed`, `setWildcardIssued`.
  - setupApi types: `UploadCertificatesRequest` gains `servingMode: ServingMode`; `UploadCertificatesResponse` gains `wildcardCovered: boolean`; `ApplyBootstrapRequest` becomes `{ domain; proxyMode: ServingMode; sslMode: BootstrapSslMode; port80?: 'closed' | 'redirect'; realIp?: { header: string; ranges: string[] }; token? }`.
  - New request/response pairs + mutations: `dnsPreflight` (`DnsPreflightRequest {domain; token?}` → `DnsPreflightResponse { ok: boolean; checks: { host: string; resolvedIps: string[]; probeOk: boolean; error?: string }[] }`), `issueCertificate` (→ `{ issued: boolean; sans: string[] }`), `startWildcard` (→ `{ recordName: string; recordValues: string[]; expiresAt: string }`), `completeWildcard` (→ `{ success: boolean; error?: string }`). Exported hooks: `useDnsPreflightMutation`, `useIssueCertificateMutation`, `useStartWildcardMutation`, `useCompleteWildcardMutation`. None invalidate `Setup` (same rationale as `uploadCertificates`).

- [ ] **Step 1: Write failing slice tests** (extend the slice's existing spec; if none exists, create `setupSlice.spec.ts` beside it):

```ts
it('setServingMode presets sslMode and clears downstream choices', () => {
  let state = reducer(undefined, setServingMode('cloudflare'));
  expect(state.wizard.servingMode).toBe('cloudflare');
  expect(state.wizard.bootstrapSslMode).toBe('paste');
  state = reducer(state, setBootstrapRealIp({ header: 'X-Forwarded-For', ranges: ['1.2.3.0/24'] }));
  state = reducer(state, setDnsPreflightPassed(true));
  state = reducer(state, setServingMode('none'));
  expect(state.wizard.bootstrapSslMode).toBeNull(); // direct: user must pick LE vs BYO
  expect(state.wizard.bootstrapRealIp).toBeNull();
  expect(state.wizard.dnsPreflightPassed).toBe(false);
});
```

- [ ] **Step 2: Implement** slice fields (initial values: all `null`/`false`), reducers exactly per the Interfaces block, and the setupApi types + 4 mutations:

```ts
    dnsPreflight: builder.mutation<DnsPreflightResponse, DnsPreflightRequest>({
      query: (body) => ({ url: '/api/setup/dns-preflight', method: 'POST', body }),
    }),
    issueCertificate: builder.mutation<IssueCertificateResponse, IssueCertificateRequest>({
      query: (body) => ({ url: '/api/setup/issue-certificate', method: 'POST', body }),
    }),
    startWildcard: builder.mutation<WildcardStartResponse, WildcardStartRequest>({
      query: (body) => ({ url: '/api/setup/wildcard/start', method: 'POST', body }),
    }),
    completeWildcard: builder.mutation<WildcardCompleteResponse, WildcardCompleteRequest>({
      query: (body) => ({ url: '/api/setup/wildcard/complete', method: 'POST', body }),
    }),
```

- [ ] **Step 3: Run** `cd apps/frontend && pnpm test -- setupSlice && pnpm exec tsc --noEmit`
Expected: slice tests PASS; typecheck will FAIL in `DomainSslStep`/`ApplyStep` (old call shapes) — acceptable until Tasks 10–12; note the exact errors in the task report.

- [ ] **Step 4: Commit** `git add apps/frontend/src/store apps/frontend/src/services && git commit -m "feat(bootstrap-ssl): wizard state + API surface for the four serving paths"`

---

### Task 10: Domain & SSL phases 1–2 — serving choice + domain/DNS (with LE preflight)

**Files:**
- Create: `apps/frontend/src/components/setup/domain-ssl/ServingChoicePhase.tsx`
- Create: `apps/frontend/src/components/setup/domain-ssl/DomainDnsPhase.tsx`
- Modify: `apps/frontend/src/components/setup/DomainSslStep.tsx` (becomes the 3-phase orchestrator; move `guessDomain`/`serverIpHint` here unchanged)
- Tests: `apps/frontend/src/components/setup/__tests__/DomainSslStep.test.tsx` (rewrite)

**Interfaces:**
- Consumes: slice reducers + `useDnsPreflightMutation` (Task 9).
- Produces:
  - `DomainSslStep` orchestrator with local `phase: 'serving' | 'dns' | 'cert'` state and shared `domain` state (lifted from the old component); renders `SetupProgress`-compatible single step.
  - `ServingChoicePhase({ onNext })` — three radio cards (Cloudflare recommended / Another CDN or WAF / Directly) + LE-vs-BYO sub-choice when Directly; dispatches `setServingMode` / `setBootstrapSslMode`; Next disabled until a complete choice exists.
  - `DomainDnsPhase({ domain, setDomain, onBack, onNext })` — domain input + per-path DNS copy; on the LE path renders the preflight checklist and hard-gates Next on `preflight.ok` (dispatching `setDnsPreflightPassed(true)`).

- [ ] **Step 1: Write the failing tests** (rewrite `DomainSslStep.test.tsx` around the new flow; representative cases):

```tsx
it('starts on the serving choice and requires a selection', () => {
  renderWithStore(<DomainSslStep />);
  expect(screen.getByText(/how does traffic reach this server/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
});

it('direct requires the cert sub-choice before advancing', async () => {
  renderWithStore(<DomainSslStep />);
  await user.click(screen.getByLabelText(/directly/i));
  expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  await user.click(screen.getByLabelText(/let's encrypt/i));
  expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();
});

it('cloudflare path shows orange-cloud DNS copy; direct path shows gray-cloud copy', async () => {
  renderWithStore(<DomainSslStep />);
  await user.click(screen.getByLabelText(/cloudflare/i));
  await user.click(screen.getByRole('button', { name: /next/i }));
  expect(screen.getByText(/proxied/i)).toBeInTheDocument();
});

it('LE path gates Next on a passing preflight', async () => {
  server.use(
    http.post('/api/setup/dns-preflight', () =>
      HttpResponse.json({ ok: false, checks: [
        { host: 'example.com', resolvedIps: [], probeOk: false, error: 'Hostname does not resolve yet' },
      ]}),
    ),
  );
  renderWithStore(<DomainSslStep />, { servingMode: 'none', bootstrapSslMode: 'letsencrypt' });
  // (helper preloads the store so the test starts on the dns phase)
  await user.type(screen.getByLabelText(/domain/i), 'example.com');
  await user.click(screen.getByRole('button', { name: /check dns/i }));
  expect(await screen.findByText(/does not resolve yet/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
});
```

(Follow the existing test file's MSW/renderWithStore conventions — it already wraps the store + RTK Query.)

- [ ] **Step 2: Implement `ServingChoicePhase.tsx`:**

```tsx
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '@/store';
import { setServingMode, setBootstrapSslMode, ServingMode } from '@/store/slices/setupSlice';
import { Button } from '@/components/ui/button';

const CHOICES: { mode: ServingMode; title: string; body: string }[] = [
  {
    mode: 'cloudflare',
    title: 'Through Cloudflare (recommended)',
    body: 'Cloudflare proxies your traffic and terminates TLS at its edge. You paste a free Origin Certificate; port 80 stays closed.',
  },
  {
    mode: 'proxy',
    title: 'Through another CDN or WAF',
    body: "Fastly, Bunny, a corporate WAF — anything that terminates TLS in front of this server. You paste that service's origin certificate.",
  },
  {
    mode: 'none',
    title: 'Directly',
    body: 'Your domain points straight at this server with an A record. The server holds a browser-trusted certificate itself.',
  },
];

export function ServingChoicePhase({ onNext }: { onNext: () => void }) {
  const dispatch = useDispatch();
  const { servingMode, bootstrapSslMode } = useSelector((s: RootState) => s.setup.wizard);
  const complete = servingMode !== null && (servingMode !== 'none' || bootstrapSslMode !== null);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground">How does traffic reach this server?</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          This choice drives the DNS setup, the certificate step, and how nginx is configured.
          You can go back and change it any time before the final Apply.
        </p>
      </div>

      <div className="space-y-3">
        {CHOICES.map((c) => (
          <label
            key={c.mode}
            className={`flex items-start p-4 border rounded-lg cursor-pointer transition-colors ${
              servingMode === c.mode ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
            }`}
          >
            <input
              type="radio"
              name="servingMode"
              checked={servingMode === c.mode}
              onChange={() => dispatch(setServingMode(c.mode))}
              className="mt-1 mr-3"
              aria-label={c.title}
            />
            <div className="flex-1">
              <span className="font-medium">{c.title}</span>
              <p className="mt-1 text-sm text-muted-foreground">{c.body}</p>
            </div>
          </label>
        ))}
      </div>

      {servingMode === 'none' && (
        <div className="ml-6 space-y-3">
          <p className="text-sm font-medium text-foreground">Where will the certificate come from?</p>
          <label className="flex items-start p-3 border border-border rounded-lg cursor-pointer hover:bg-muted/50">
            <input
              type="radio"
              name="bootstrapSslMode"
              checked={bootstrapSslMode === 'letsencrypt'}
              onChange={() => dispatch(setBootstrapSslMode('letsencrypt'))}
              className="mt-1 mr-3"
              aria-label="Auto-issue with Let's Encrypt (recommended)"
            />
            <div className="flex-1">
              <span className="font-medium">Auto-issue with Let&apos;s Encrypt (recommended)</span>
              <p className="mt-1 text-sm text-muted-foreground">
                Free, issued right here, renews automatically. Needs your DNS pointing at this
                server and port 80 reachable — the next step checks both for you.
              </p>
            </div>
          </label>
          <label className="flex items-start p-3 border border-border rounded-lg cursor-pointer hover:bg-muted/50">
            <input
              type="radio"
              name="bootstrapSslMode"
              checked={bootstrapSslMode === 'paste'}
              onChange={() => dispatch(setBootstrapSslMode('paste'))}
              className="mt-1 mr-3"
              aria-label="Paste my own certificate"
            />
            <div className="flex-1">
              <span className="font-medium">Paste my own certificate</span>
              <p className="mt-1 text-sm text-muted-foreground">
                A browser-trusted certificate from any CA. You&apos;ll paste the full chain and
                private key, and re-paste when you renew it.
              </p>
            </div>
          </label>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={onNext} disabled={!complete}>Next</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement `DomainDnsPhase.tsx`** — per-path copy + LE preflight checklist:

```tsx
import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '@/store';
import { useDnsPreflightMutation, DnsPreflightResponse } from '@/services/setupApi';
import { setDnsPreflightPassed } from '@/store/slices/setupSlice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

interface Props {
  domain: string;
  setDomain: (d: string) => void;
  serverIp: string | null;
  onBack: () => void;
  onNext: () => void;
}

export function DomainDnsPhase({ domain, setDomain, serverIp, onBack, onNext }: Props) {
  const dispatch = useDispatch();
  const { servingMode, bootstrapSslMode, claimToken, dnsPreflightPassed } = useSelector(
    (s: RootState) => s.setup.wizard,
  );
  const isLetsEncrypt = servingMode === 'none' && bootstrapSslMode === 'letsencrypt';
  const [preflight, { isLoading: checking }] = useDnsPreflightMutation();
  const [result, setResult] = useState<DnsPreflightResponse | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  const runCheck = async () => {
    setCheckError(null);
    try {
      const res = await preflight({ domain: domain.trim(), token: claimToken ?? undefined }).unwrap();
      setResult(res);
      dispatch(setDnsPreflightPassed(res.ok));
    } catch (err: unknown) {
      const apiError = err as { data?: { message?: string } };
      setCheckError(apiError?.data?.message ?? 'Check failed — is the domain spelled correctly?');
    }
  };

  const ipText = serverIp ?? "this server's public IP";
  const canNext = domain.trim().length > 0 && (!isLetsEncrypt || dnsPreflightPassed);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground">Point your domain at {servingMode === 'none' ? 'this server' : 'your proxy'}</h3>
        {servingMode === 'cloudflare' && (
          <p className="mt-2 text-sm text-muted-foreground">
            In Cloudflare DNS, create two <strong>A records</strong> — <code className="bg-muted px-1 rounded">@</code> and{' '}
            <code className="bg-muted px-1 rounded">*</code> — pointing at <code className="bg-muted px-1 rounded">{ipText}</code>,
            both set to <strong>Proxied</strong> (orange cloud). Set the zone&apos;s SSL/TLS mode to{' '}
            <strong>Full</strong> now; the wizard reminds you to switch to <strong>Full (strict)</strong> at the end.
          </p>
        )}
        {servingMode === 'proxy' && (
          <p className="mt-2 text-sm text-muted-foreground">
            Point your apex domain and wildcard at your CDN/WAF following its docs, and set{' '}
            <code className="bg-muted px-1 rounded">{ipText}</code> as its <strong>origin</strong>. Preview subdomains
            need the wildcard routed too.
          </p>
        )}
        {servingMode === 'none' && (
          <p className="mt-2 text-sm text-muted-foreground">
            At your DNS provider, create two <strong>A records</strong> — <code className="bg-muted px-1 rounded">@</code>{' '}
            and <code className="bg-muted px-1 rounded">*</code> (wildcard: makes <code className="bg-muted px-1 rounded">admin.</code>,{' '}
            <code className="bg-muted px-1 rounded">www.</code> and previews resolve) — pointing at{' '}
            <code className="bg-muted px-1 rounded">{ipText}</code>. If your DNS host can proxy traffic (e.g.
            Cloudflare), turn that <strong>off</strong> for these records (gray cloud).
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="bootstrap-domain">Domain</Label>
        <Input
          id="bootstrap-domain"
          value={domain}
          onChange={(e) => { setDomain(e.target.value); setResult(null); dispatch(setDnsPreflightPassed(false)); }}
          placeholder="example.com"
          className="mt-1"
          autoComplete="off"
        />
      </div>

      {isLetsEncrypt && (
        <div className="rounded-md border border-border bg-muted/40 p-4 space-y-3">
          <p className="text-sm font-medium text-foreground">
            DNS check <span className="font-normal text-muted-foreground">— required before a certificate can be issued</span>
          </p>
          {result?.checks.map((c) => (
            <div key={c.host} className="flex items-start text-sm">
              {c.probeOk ? (
                <CheckCircle2 className="w-4 h-4 mt-0.5 mr-2 text-green-600 flex-shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 mt-0.5 mr-2 text-destructive flex-shrink-0" />
              )}
              <span>
                <code className="bg-muted px-1 rounded">{c.host}</code>{' '}
                {c.probeOk
                  ? <>→ {c.resolvedIps.join(', ') || 'reachable'}</>
                  : <span className="text-muted-foreground">{c.error ?? 'not reachable yet'}{c.resolvedIps.length > 0 && <> (resolves to {c.resolvedIps.join(', ')})</>}</span>}
              </span>
            </div>
          ))}
          {checkError && <p className="text-sm text-destructive">{checkError}</p>}
          {result && !result.ok && (
            <p className="text-sm text-muted-foreground">
              DNS changes can take a few minutes to propagate — check again shortly.
            </p>
          )}
          <Button variant="outline" size="sm" onClick={runCheck} disabled={checking || !domain.trim()}>
            {checking ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />Checking…</>) : result ? 'Check again' : 'Check DNS'}
          </Button>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>Back</Button>
        <Button onClick={onNext} disabled={!canNext}>Next</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `DomainSslStep.tsx` as the orchestrator:**

```tsx
import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '@/store';
import { prevWizardStep } from '@/store/slices/setupSlice';
import { ServingChoicePhase } from './domain-ssl/ServingChoicePhase';
import { DomainDnsPhase } from './domain-ssl/DomainDnsPhase';
import { CertificatePhase } from './domain-ssl/CertificatePhase';

// guessDomain() and serverIpHint() move here unchanged from the old file.

type Phase = 'serving' | 'dns' | 'cert';

export function DomainSslStep() {
  const dispatch = useDispatch();
  const servingMode = useSelector((s: RootState) => s.setup.wizard.servingMode);
  const [phase, setPhase] = useState<Phase>(() => (servingMode ? 'dns' : 'serving'));
  const [domain, setDomain] = useState(() => guessDomain());
  const serverIp = serverIpHint();

  if (phase === 'serving') {
    return <ServingChoicePhase onNext={() => setPhase('dns')} />;
  }
  if (phase === 'dns') {
    return (
      <DomainDnsPhase
        domain={domain}
        setDomain={setDomain}
        serverIp={serverIp}
        onBack={() => setPhase('serving')}
        onNext={() => setPhase('cert')}
      />
    );
  }
  return <CertificatePhase domain={domain} onBack={() => setPhase('dns')} />;
}
```

(Note: the wizard-level Back from phase 1 to the previous wizard step stays available via
`prevWizardStep` — add a Back button in `ServingChoicePhase` dispatching it, mirroring the
old component's Back.)

- [ ] **Step 5: Run** `cd apps/frontend && pnpm test -- DomainSslStep`
Expected: PASS (CertificatePhase can be a stub `export function CertificatePhase(){return null}` until Task 11 — mark it clearly `// implemented in the next task`).

- [ ] **Step 6: Commit** `git add apps/frontend/src/components/setup && git commit -m "feat(bootstrap-ssl): 3-phase Domain & SSL — serving choice + adaptive DNS with LE preflight gate"`

---

### Task 11: Certificate phase — paste variants, realIp/port80 options, LE issue + wildcard

**Files:**
- Create: `apps/frontend/src/components/setup/domain-ssl/PasteCertificateForm.tsx`
- Create: `apps/frontend/src/components/setup/domain-ssl/LetsEncryptForm.tsx`
- Create: `apps/frontend/src/components/setup/domain-ssl/CertificatePhase.tsx` (replace stub)
- Tests: `apps/frontend/src/components/setup/__tests__/CertificatePhase.test.tsx`

**Interfaces:**
- Consumes: Task 9 mutations/reducers; `setBootstrapDomain` + `nextWizardStep` (existing).
- Produces:
  - `CertificatePhase({ domain, onBack })` — dispatches to `LetsEncryptForm` when `servingMode==='none' && bootstrapSslMode==='letsencrypt'`, else `PasteCertificateForm`.
  - `PasteCertificateForm` — copy varies by servingMode (CF: today's Origin Cert copy verbatim; proxy: vendor-neutral origin-cert copy + collapsed "Restore visitor IPs" (header input + CIDR textarea → `setBootstrapRealIp`) + "close port 80" checkbox (→ `setBootstrapPort80('closed')`); none: browser-trusted copy). Submits `uploadCertificates({ …, servingMode })`; on `wildcardCovered:false` shows the preview-subdomain warning inline (non-blocking) before advancing on the user's confirm click; on success dispatches `setBootstrapDomain(domain)` + `nextWizardStep()`.
  - `LetsEncryptForm` — "Issue certificate" button → `issueCertificate`; success reveals the optional wildcard sub-step (`startWildcard` → shows `_acme-challenge` TXT records → "I've added the records — verify" → `completeWildcard`, retryable on failure; "Skip for now" advances with the stated preview-subdomain warning). On any completed path: `setBootstrapDomain(domain)`, `setWildcardIssued(bool)`, `nextWizardStep()`.

- [ ] **Step 1: Write failing tests** (representative):

```tsx
it('proxy path renders neutral copy and the visitor-IP option', () => {
  renderWithStore(<CertificatePhase domain="example.com" onBack={noop} />, { servingMode: 'proxy', bootstrapSslMode: 'paste' });
  expect(screen.getByText(/your cdn's origin certificate/i)).toBeInTheDocument();
  expect(screen.getByText(/restore visitor ips/i)).toBeInTheDocument();
  expect(screen.queryByText(/cloudflare dashboard/i)).not.toBeInTheDocument();
});

it('BYO path warns but proceeds without a wildcard SAN', async () => {
  server.use(http.post('/api/setup/certificates', () =>
    HttpResponse.json({ saved: true, sans: ['example.com'], wildcardCovered: false })));
  renderWithStore(<CertificatePhase domain="example.com" onBack={noop} />, { servingMode: 'none', bootstrapSslMode: 'paste' });
  await fillAndSubmitPasteForm();
  expect(await screen.findByText(/preview subdomains will show a certificate warning/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /continue anyway/i }));
  expect(store.getState().setup.wizard.bootstrapDomain).toBe('example.com');
});

it('LE path issues then offers the wildcard sub-step with TXT records', async () => {
  server.use(
    http.post('/api/setup/issue-certificate', () =>
      HttpResponse.json({ issued: true, sans: ['example.com', 'www.example.com', 'admin.example.com'] })),
    http.post('/api/setup/wildcard/start', () =>
      HttpResponse.json({ recordName: '_acme-challenge.example.com', recordValues: ['abc', 'def'], expiresAt: '2026-08-01T00:00:00Z' })),
  );
  renderWithStore(<CertificatePhase domain="example.com" onBack={noop} />, { servingMode: 'none', bootstrapSslMode: 'letsencrypt', dnsPreflightPassed: true });
  await user.click(screen.getByRole('button', { name: /issue certificate/i }));
  expect(await screen.findByText(/certificate issued/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /add a wildcard/i }));
  expect(await screen.findByText('_acme-challenge.example.com')).toBeInTheDocument();
  expect(screen.getByText('abc')).toBeInTheDocument();
});

it('LE wildcard skip advances with wildcardIssued=false', async () => {
  server.use(http.post('/api/setup/issue-certificate', () =>
    HttpResponse.json({ issued: true, sans: ['example.com', 'www.example.com', 'admin.example.com'] })));
  renderWithStore(<CertificatePhase domain="example.com" onBack={noop} />, {
    servingMode: 'none', bootstrapSslMode: 'letsencrypt', dnsPreflightPassed: true,
  });
  await user.click(screen.getByRole('button', { name: /issue certificate/i }));
  await user.click(await screen.findByRole('button', { name: /skip for now/i }));
  expect(store.getState().setup.wizard.wildcardIssued).toBe(false);
  expect(store.getState().setup.wizard.bootstrapDomain).toBe('example.com');
});
```

- [ ] **Step 2: Implement the three components.** Structure and copy blocks (write complete JSX following the DomainSslStep patterns; key fragments):

`PasteCertificateForm` copy switch:

```tsx
const COPY: Record<ServingMode, { title: string; body: JSX.Element; certLabel: string }> = {
  cloudflare: {
    title: 'Provide your Cloudflare Origin Certificate',
    certLabel: 'Origin Certificate (PEM)',
    body: (
      <>Paste a <strong>Cloudflare Origin Certificate</strong> for your domain. In the Cloudflare
      dashboard: <strong>SSL/TLS → Origin Server → Create Certificate</strong>; include{' '}
      <code className="bg-muted px-1 rounded">*.yourdomain</code> alongside the apex. Keep the
      zone&apos;s SSL/TLS mode on <strong>Full</strong> until the wizard finishes.</>
    ),
  },
  proxy: {
    title: 'Provide your origin certificate',
    certLabel: 'Origin Certificate (PEM)',
    body: (
      <>Paste <strong>your CDN&apos;s origin certificate</strong> — issued from its dashboard for{' '}
      <code className="bg-muted px-1 rounded">yourdomain</code>, and ideally{' '}
      <code className="bg-muted px-1 rounded">*.yourdomain</code> so preview subdomains work. Your
      CDN must be configured to connect to this origin over HTTPS.</>
    ),
  },
  none: {
    title: 'Provide your certificate',
    certLabel: 'Certificate — full chain (PEM)',
    body: (
      <>Paste a <strong>browser-trusted certificate</strong> from any CA covering{' '}
      <code className="bg-muted px-1 rounded">yourdomain</code> (include{' '}
      <code className="bg-muted px-1 rounded">*.yourdomain</code> if you can). You&apos;ll re-paste
      here when you renew it.</>
    ),
  },
};
```

Proxy-only options block (collapsed `<details>`):

```tsx
{servingMode === 'proxy' && (
  <details className="rounded-md border border-border p-3">
    <summary className="text-sm font-medium cursor-pointer">Restore visitor IPs (optional)</summary>
    <div className="mt-3 space-y-3">
      <p className="text-sm text-muted-foreground">
        Skip this and everything works — logs and rate limiting will just see your CDN&apos;s IPs
        instead of visitors&apos;. To restore real IPs, paste your CDN&apos;s egress ranges.
      </p>
      <div>
        <Label htmlFor="realip-ranges">Trusted ranges (CIDR, one per line)</Label>
        <Textarea id="realip-ranges" value={rangesText} onChange={(e) => setRangesText(e.target.value)}
          placeholder={'151.101.0.0/16\n2a04:4e40::/32'} rows={4} className="mt-1 font-mono text-xs" />
      </div>
      <div>
        <Label htmlFor="realip-header">Header carrying the visitor IP</Label>
        <Input id="realip-header" value={header} onChange={(e) => setHeader(e.target.value)}
          placeholder="X-Forwarded-For" className="mt-1" />
      </div>
    </div>
  </details>
)}
{servingMode === 'proxy' && (
  <label className="flex items-start text-sm cursor-pointer">
    <input type="checkbox" checked={closePort80} onChange={(e) => setClosePort80(e.target.checked)} className="mt-0.5 mr-2" />
    <span>Close port 80 — my CDN connects to this origin over HTTPS only</span>
  </label>
)}
```

On submit: `dispatch(setBootstrapRealIp(rangesText.trim() ? { header: header.trim() || 'X-Forwarded-For', ranges: rangesText.split('\n').map(r => r.trim()).filter(Boolean) } : null))` and `dispatch(setBootstrapPort80(closePort80 ? 'closed' : null))` **before** the upload call, so Apply reads them from the store.

`LetsEncryptForm` states: `idle → issuing → issued → (wildcard: offering → started(records shown) → verifying → done|failed-retryable)`; every terminal advance dispatches `setBootstrapDomain(domain)` and `nextWizardStep()`. The wildcard warning copy: "Renews manually every ~90 days — we'll warn you in the admin panel and by email before it expires." The skip copy: "Preview subdomains will show a certificate warning. You can add a wildcard later in Settings → SSL."

- [ ] **Step 3: Run** `cd apps/frontend && pnpm test -- CertificatePhase && pnpm exec tsc --noEmit`
Expected: tests PASS; typecheck now clean except `ApplyStep` (Task 12).

- [ ] **Step 4: Commit** `git add apps/frontend/src/components/setup && git commit -m "feat(bootstrap-ssl): adaptive certificate phase — CF/CDN/BYO paste + LE issue with optional DNS-01 wildcard"`

---

### Task 12: Apply step — summary instead of radio

**Files:**
- Modify: `apps/frontend/src/components/setup/ApplyStep.tsx`
- Test: `apps/frontend/src/components/setup/__tests__/ApplyStep.test.tsx` (rewrite affected cases)

**Interfaces:**
- Consumes: slice fields from Task 9; `ApplyBootstrapRequest` v2 shape.
- Produces: Apply reads `servingMode`/`bootstrapSslMode`/`bootstrapPort80`/`bootstrapRealIp`/`dnsPreflightPassed`/`wildcardIssued` from the store; no proxyMode radio; `finish()` sends `{ domain, proxyMode: servingMode, sslMode: bootstrapSslMode ?? 'paste', port80: bootstrapPort80 ?? undefined, realIp: bootstrapRealIp ?? undefined, token }`.

- [ ] **Step 1: Failing tests** (representative):

```tsx
it('shows a summary of the serving choice, no radio', () => {
  renderWithStore(<ApplyStep />, { bootstrapDomain: 'example.com', servingMode: 'proxy', bootstrapSslMode: 'paste' });
  expect(screen.getByText(/another cdn or waf/i)).toBeInTheDocument();
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
});

it('LE path pre-satisfies the DNS confirmation', () => {
  renderWithStore(<ApplyStep />, {
    bootstrapDomain: 'example.com', servingMode: 'none', bootstrapSslMode: 'letsencrypt', dnsPreflightPassed: true,
  });
  expect(screen.getByRole('button', { name: /finish setup/i })).toBeEnabled();
  expect(screen.getByText(/verified during the dns check/i)).toBeInTheDocument();
});

it('sends the v2 apply body', async () => {
  let body: unknown;
  server.use(http.post('/api/setup/apply', async ({ request }) => {
    body = await request.json();
    return HttpResponse.json({ applying: true, adminUrl: 'https://admin.example.com' });
  }));
  renderWithStore(<ApplyStep />, {
    bootstrapDomain: 'example.com', servingMode: 'proxy', bootstrapSslMode: 'paste',
    bootstrapPort80: 'closed', bootstrapRealIp: { header: 'True-Client-IP', ranges: ['1.2.3.0/24'] },
  });
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: /finish setup/i }));
  expect(body).toMatchObject({
    domain: 'example.com', proxyMode: 'proxy', sslMode: 'paste',
    port80: 'closed', realIp: { header: 'True-Client-IP', ranges: ['1.2.3.0/24'] },
  });
});

it('keeps the Full (strict) hint cloudflare-only', async () => {
  server.use(http.post('/api/setup/apply', () =>
    HttpResponse.json({ applying: true, adminUrl: 'https://admin.example.com' })));
  renderWithStore(<ApplyStep />, {
    bootstrapDomain: 'example.com', servingMode: 'none', bootstrapSslMode: 'paste',
  });
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: /finish setup/i }));
  expect(await screen.findByText(/switching to/i)).toBeInTheDocument();
  expect(screen.queryByText(/full \(strict\)/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Implement.** Remove the radio block and `proxyMode` local state; add:

```tsx
const SERVING_LABELS: Record<ServingMode, string> = {
  cloudflare: 'Through Cloudflare',
  proxy: 'Through another CDN or WAF',
  none: 'Directly (A record to this server)',
};
const SSL_LABELS = { paste: 'Pasted certificate', letsencrypt: "Let's Encrypt (auto-renews)" };
```

Summary card lists: serving mode, certificate source, port-80 behavior (`closed`/`redirect`, resolved with the same defaulting the server applies), visitor-IP restore (on/off), and — LE only — "Wildcard: issued ✓" or "Wildcard: skipped (previews will warn)". `dnsConfirmed` initial state: `useState(isLetsEncrypt && dnsPreflightPassed)`; when pre-satisfied render the confirmation as static text "DNS was verified during the DNS check ✓" instead of the checkbox. Post-apply hint stays keyed on the applied serving mode `=== 'cloudflare'`.

- [ ] **Step 3: Run** `cd apps/frontend && pnpm test -- ApplyStep && pnpm exec tsc --noEmit && pnpm test`
Expected: all frontend suites PASS, typecheck clean.

- [ ] **Step 4: Commit** `git add apps/frontend/src && git commit -m "feat(bootstrap-ssl): Apply step becomes a summary — proxy choice made up front"`

---

### Task 13: End-to-end — Pebble overlay, wizard E2E, smoke script, legacy regression

**Files:**
- Create: `docker-compose.pebble.yml`
- Modify: `test-bootstrap.sh` (LE leg + v1-regression leg)
- Modify: `apps/frontend/e2e` bootstrap spec (path coverage; follow the repo's existing Playwright layout)

**Interfaces:** consumes everything above; produces the verification evidence for the PR.

- [ ] **Step 1: Pebble overlay** — `docker-compose.pebble.yml`:

```yaml
# ACME test server for the direct + Let's Encrypt path. Usage:
#   docker compose -f docker-compose.yml -f docker-compose.pebble.yml up -d
# Backend must run with:
#   ACME_DIRECTORY_URL=https://pebble:14000/dir
#   NODE_TLS_REJECT_UNAUTHORIZED=0   # Pebble's directory cert is self-signed (test-only!)
# Pebble resolves challenge hostnames via its -dnsserver flag → challtestsrv,
# whose default A record is set to the nginx container so HTTP-01 loops back
# through the real bootstrap port-80 server block.
services:
  pebble:
    image: ghcr.io/letsencrypt/pebble:latest
    command: -config /test/config/pebble-config.json -dnsserver challtestsrv:8053
    environment:
      PEBBLE_VA_NOSLEEP: '1'
    ports:
      - '14000:14000'
    depends_on:
      - challtestsrv
  challtestsrv:
    image: ghcr.io/letsencrypt/pebble-challtestsrv:latest
    command: -defaultIPv4 "" -defaultIPv6 ""
    ports:
      - '8055:8055'
```

Plus a helper note in the file: before an LE test run, point the test domain at nginx:
`curl -X POST http://localhost:8055/set-default-ipv4 -d '{"ip":"<nginx container IP>"}'`.

- [ ] **Step 2: Backend integration spec (Pebble-gated).** Add to `ssl-certificate.service.spec.ts`:

```ts
// Runs only when a Pebble is up: PEBBLE=1 ACME_DIRECTORY_URL=https://localhost:14000/dir pnpm test -- ssl-certificate
const maybe = process.env.PEBBLE === '1' ? describe : describe.skip;
maybe('requestPrimaryDomainCertificate against Pebble', () => {
  it('issues a real cert for the fixed SAN set', async () => {
    delete process.env.MOCK_SSL;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    const service = new SslCertificateService();
    await service.initialize();
    const res = await service.requestPrimaryDomainCertificate('bootstrap-test.example');
    expect(res.success).toBe(true);
  }, 120_000);
});
```

- [ ] **Step 3: Playwright wizard paths.** With the stack in `MOCK_SSL=true` (mock issuance writes real files — Task 5), extend the existing bootstrap E2E spec with one scenario per path: Cloudflare paste (existing, now via the serving choice), CDN paste with realIp filled, direct+BYO with apex-only cert (asserts the warning + continue), direct+LE (preflight → issue → skip wildcard → apply). Assert each Apply summary matches the choice.

- [ ] **Step 4: Smoke script legs** — extend `test-bootstrap.sh`:
  - After the existing paste-path leg: a **v1 regression leg** — write a v1 `bootstrap/instance.env` (`STATE=applied`, `PRIMARY_DOMAIN`, `PROXY_MODE=cloudflare`, no knob keys), run the render script, assert `return 444` + CF realip rendered (proves legacy derivation inside the container image, not just the host harness).
  - An **LE-path leg** (MOCK_SSL): drive `dns-preflight` (expect failure on an unresolvable domain → still exits 0 for the leg), `issue-certificate` against a hosts-file-pinned domain, `apply` with `{proxyMode:'none', sslMode:'letsencrypt'}`, assert nginx renders with the ACME location present.
  - A **restart-in-bootstrap-mode leg** (memory-note lesson): `docker compose restart nginx` while still unclaimed; assert the container comes back healthy (this crash class is masked by first-boot-clean runs).

- [ ] **Step 5: Run everything**

```bash
cd apps/backend && pnpm test
cd ../frontend && pnpm test && pnpm exec tsc --noEmit
sh ../../docker/nginx/render-main-conf.test.sh
./test-bootstrap.sh
```

Expected: all PASS. Record outputs in the task report.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.pebble.yml test-bootstrap.sh apps/
git commit -m "test(bootstrap-ssl): Pebble overlay, four-path wizard E2E, v1-regression + LE smoke legs"
```

---

## Manual droplet verification (post-implementation, pre-merge)

Not tasks — the checklist for the live droplet pass (the #508 lesson: every functional bug
lived here, not in unit tests). Use branch images (`BACKEND_TAG=bootstrap`/`FRONTEND_TAG=bootstrap`,
`docker compose build nginx`) per the memory note.

1. **Cloudflare path** (existing regression): full wizard via `https://admin.<domain>` on Full mode → apply → Full (strict).
2. **Direct + LE path**: fresh droplet, bare-IP wizard, real domain with gray-cloud A records; preflight goes green only after DNS propagates; issue against LE **staging** first (`ACME_DIRECTORY_URL=https://acme-staging-v02.api.letsencrypt.org/directory`), then production; verify hairpin-NAT probe works on DO; apply; confirm `https://admin.<domain>` serves the LE cert and port 80 redirects with the ACME location live.
3. **In-wizard wildcard**: run the DNS-01 sub-step with real TXT records; verify previews serve the wildcard; then delete `wildcard_reminder_last_sent`, set the threshold high, run `triggerRenewalCheck()` and confirm the banner + email fire.
4. **Direct + BYO**: paste an ECDSA cert (this was impossible before Task 3) with apex-only SANs; confirm the warning, apply, verify previews show the expected cert warning.
5. **CDN path** (no real second CDN needed): pick `proxy`, paste ranges + `True-Client-IP`, close port 80; verify rendered `cloudflare-realip.conf` and `return 444`; `curl` with spoofed headers from a non-trusted IP to confirm real-IP is NOT applied.
6. **Recovery**: `rm -rf bootstrap/instance.json bootstrap/instance.env && docker compose restart backend nginx` re-enters bootstrap mode (unchanged escape hatch).

## Execution notes

- Tasks 1–3 and 4 can run in parallel; 5–8 after 1–3; 9–12 after 7; 13 last.
- Anything that surprises you (an API that doesn't exist as described, a test convention that
  differs) — stop and re-read the actual file before improvising; this plan was written from
  the code on branch `specs/do-one-click-and-web-bootstrap` as of commit `555342e`.
