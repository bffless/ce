# Cert Source Decoupling + Paste-Cert Expiry Reminder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the bootstrap wizard's "another CDN/WAF" path keep the built-in self-signed cert (default), auto-issue Let's Encrypt, or paste a cert — decoupling the cert source from the proxy choice — and add a notify-only email reminder for an expiring pasted primary cert.

**Architecture:** A new `sslMode: 'selfsigned'` flows through the existing v2 `instance.json` model. The nginx render script gains a `SSL_MODE=selfsigned` branch that serves the existing `bootstrap-selfsigned.crt/.key` for the domain vhosts (no real cert required), mirroring the current Cloudflare fallback. `validateApplyConfig` gains the new combo and relaxes Let's Encrypt to also allow the proxy path. The wizard's proxy path gains a three-option cert sub-choice; the proxy-only real-IP/port-80 controls move into a shared component so all three cert modes can set them. The renewal cron gains one throttled reminder for `sslMode: 'paste'` primary certs.

**Tech Stack:** NestJS 10 + Jest (backend), React + RTK + Vitest (frontend), nginx + POSIX sh (docker/nginx).

**Spec:** `docs/superpowers/specs/2026-07-22-cert-source-decoupling-and-expiry-reminder-design.md` (committed). Read it first. Builds on `2026-07-21-bootstrap-domain-ssl-model-design.md`.

## Global Constraints

- **Combo matrix:** `cloudflare` → `paste` only. `proxy` → `selfsigned` (default) | `letsencrypt` | `paste`. `none` → `letsencrypt` | `paste`. Rules: `selfsigned` ⇒ `proxyMode: 'proxy'` only; `letsencrypt` ⇒ `proxyMode ∈ {none, proxy}` **and** `port80 !== 'closed'`; custom `realIp` ⇒ `proxyMode: 'proxy'`.
- **Self-signed serves the existing `bootstrap-selfsigned.crt/.key`** for both admin and wildcard vhosts — never requires `fullchain.pem`/`wildcard.<domain>.*`. It is generated at first boot and always present in an applied selfsigned install.
- **Reminder fires only for `sslMode: 'paste'`** primary certs within the threshold, email-only, throttled once per 7 days (`sslSettings` key `primary_cert_reminder_last_sent`). Never for `letsencrypt` (auto-renews) or `selfsigned`.
- **Reserved values** (`proxyMode: 'cloudflare-tunnel'`, `sslMode: 'external'`) stay rejected/unselectable — do not add them anywhere.
- Backend: 2-space indent, Jest `*.spec.ts`, run `cd apps/backend && pnpm test -- <pattern>`. Frontend: Vitest, `cd apps/frontend && pnpm test -- <pattern>`. Shell: POSIX sh, `sh docker/nginx/render-main-conf.test.sh`.
- Commit prefix: `feat(cert-source): …` / `feat(cert-reminder): …` (or `fix`/`test`).

## File Structure

```
apps/backend/src/bootstrap/instance-config.ts               # MODIFY: SslMode += 'selfsigned'
apps/backend/src/setup/setup.dto.ts                         # MODIFY: ApplyBootstrapDto.sslMode @IsIn
apps/backend/src/setup/bootstrap-setup.service.ts           # MODIFY: validateApplyConfig (selfsigned + LE-on-proxy)
apps/backend/src/setup/bootstrap-setup.service.spec.ts      # MODIFY
apps/backend/src/setup/bootstrap-setup.controller.ts        # MODIFY: apply() skips cert-presence for selfsigned
apps/backend/src/setup/bootstrap-setup.controller.spec.ts   # MODIFY
docker/nginx/sites-available/main.conf.template             # MODIFY: admin vhost cert → ${PRIMARY_CERT}/${PRIMARY_KEY}
docker/nginx/render-main-conf.sh                            # MODIFY: SSL_MODE=selfsigned branch + envsubst vars
docker/nginx/render-main-conf.test.sh                       # MODIFY: selfsigned harness case
apps/backend/src/domains/ssl-renewal.service.ts             # MODIFY: checkAndRemindPrimaryPaste
apps/backend/src/domains/ssl-renewal.service.spec.ts        # MODIFY
apps/frontend/src/store/slices/setupSlice.ts                # MODIFY: BootstrapSslMode += 'selfsigned'; proxy preset
apps/frontend/src/store/slices/setupSlice.test.ts           # MODIFY
apps/frontend/src/components/setup/domain-ssl/ServingChoicePhase.tsx    # MODIFY: proxy sub-choice + copy
apps/frontend/src/components/setup/domain-ssl/ProxyOptions.tsx          # NEW: shared realIp/port80 controls
apps/frontend/src/components/setup/domain-ssl/SelfSignedConfirm.tsx     # NEW: no-upload confirm view
apps/frontend/src/components/setup/domain-ssl/PasteCertificateForm.tsx  # MODIFY: drop inline proxy options
apps/frontend/src/components/setup/domain-ssl/CertificatePhase.tsx      # MODIFY: proxy renders ProxyOptions + cert view
apps/frontend/src/components/setup/__tests__/*                          # MODIFY/NEW
apps/frontend/e2e/bootstrap-wizard.spec.ts                  # MODIFY: proxy+selfsigned leg
```

Dependency order: Task 1 → 2 (backend selfsigned) → 3 (nginx) independent; Task 4 (reminder) independent; Task 5 → 6 (frontend) depend on 1's DTO shape; Task 7 last.

---

### Task 1: Backend accepts `sslMode: 'selfsigned'` (type, DTO, combo-validation)

**Files:**
- Modify: `apps/backend/src/bootstrap/instance-config.ts` (SslMode union)
- Modify: `apps/backend/src/setup/setup.dto.ts` (ApplyBootstrapDto.sslMode)
- Modify: `apps/backend/src/setup/bootstrap-setup.service.ts` (`validateApplyConfig`)
- Test: `apps/backend/src/setup/bootstrap-setup.service.spec.ts`

**Interfaces:**
- Produces: `SslMode = 'paste' | 'letsencrypt' | 'selfsigned'`; `validateApplyConfig(dto)` accepting the new combos per the matrix.

- [ ] **Step 1: Write the failing tests** (append to the `validateApplyConfig` describe in `bootstrap-setup.service.spec.ts`):

```ts
it('resolves proxy + selfsigned (the default CDN case)', () => {
  const cfg = service.validateApplyConfig({
    domain: 'example.com', proxyMode: 'proxy', sslMode: 'selfsigned',
  } as ApplyBootstrapDto);
  expect(cfg).toEqual({ proxyMode: 'proxy', sslMode: 'selfsigned', port80: 'redirect', realIp: null });
});

it('allows letsencrypt on the proxy path (CDN ACME pass-through)', () => {
  const cfg = service.validateApplyConfig({
    domain: 'example.com', proxyMode: 'proxy', sslMode: 'letsencrypt',
  } as ApplyBootstrapDto);
  expect(cfg.sslMode).toBe('letsencrypt');
  expect(cfg.port80).toBe('redirect');
});

it('rejects selfsigned on the direct path (browser would see the warning)', () => {
  expect(() => service.validateApplyConfig({
    domain: 'example.com', proxyMode: 'none', sslMode: 'selfsigned',
  } as ApplyBootstrapDto)).toThrow(BadRequestException);
});

it('rejects selfsigned on the cloudflare path', () => {
  expect(() => service.validateApplyConfig({
    domain: 'example.com', proxyMode: 'cloudflare', sslMode: 'selfsigned',
  } as ApplyBootstrapDto)).toThrow(BadRequestException);
});

it('rejects letsencrypt with port 80 closed even on the proxy path', () => {
  expect(() => service.validateApplyConfig({
    domain: 'example.com', proxyMode: 'proxy', sslMode: 'letsencrypt', port80: 'closed',
  } as ApplyBootstrapDto)).toThrow(/Port 80 must stay open/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && pnpm test -- bootstrap-setup.service`
Expected: FAIL — `selfsigned` rejected by the DTO/validation; the LE-on-proxy test throws the old "requires direct serving" error.

- [ ] **Step 3: Implement.** In `instance-config.ts`:

```ts
export type SslMode = 'paste' | 'letsencrypt' | 'selfsigned';
```

In `setup.dto.ts`, `ApplyBootstrapDto.sslMode`:

```ts
  @ApiProperty({ description: 'Where the certificate came from', enum: ['paste', 'letsencrypt', 'selfsigned'] })
  @IsIn(['paste', 'letsencrypt', 'selfsigned'])
  sslMode: 'paste' | 'letsencrypt' | 'selfsigned';
```

In `bootstrap-setup.service.ts` `validateApplyConfig`, replace the `letsencrypt` block and add the `selfsigned` rule (keep the rest of the method unchanged):

```ts
    if (dto.sslMode === 'letsencrypt') {
      // LE is HTTP-01, so it needs port 80 reachable — directly (proxyMode
      // 'none') or through a CDN that passes ACME challenges to the origin
      // (proxyMode 'proxy', e.g. Bunny). Not on Cloudflare, which terminates
      // TLS and expects its own Origin Certificate.
      if (dto.proxyMode !== 'none' && dto.proxyMode !== 'proxy') {
        throw new BadRequestException(
          'Let\'s Encrypt needs direct serving or a CDN that passes ACME through — not Cloudflare (use its Origin Certificate)',
        );
      }
      if (dto.port80 === 'closed') {
        throw new BadRequestException(
          'Port 80 must stay open (redirect) with Let\'s Encrypt — renewal uses HTTP-01 challenges',
        );
      }
    }
    if (dto.sslMode === 'selfsigned' && dto.proxyMode !== 'proxy') {
      // The box keeps serving its self-signed cert; only valid behind a proxy
      // that terminates browser TLS. A browser hitting a direct box, or
      // Cloudflare's Origin-Cert flow, would not accept it.
      throw new BadRequestException(
        'Keeping the self-signed certificate is only valid behind another CDN/WAF (proxyMode "proxy")',
      );
    }
```

(The rest — `port80 === 'closed' && proxyMode === 'none'`, the `realIp` checks, and the `port80`/`realIp` resolution — stays exactly as-is.)

- [ ] **Step 4: Run tests + tsc**

Run: `cd apps/backend && pnpm test -- bootstrap-setup.service && pnpm exec tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/bootstrap/instance-config.ts apps/backend/src/setup/setup.dto.ts apps/backend/src/setup/bootstrap-setup.service.ts apps/backend/src/setup/bootstrap-setup.service.spec.ts
git commit -m "feat(cert-source): accept sslMode 'selfsigned'; allow Let's Encrypt on the proxy path"
```

---

### Task 2: `apply()` skips cert-presence for self-signed

**Files:**
- Modify: `apps/backend/src/setup/bootstrap-setup.controller.ts` (`apply()`)
- Test: `apps/backend/src/setup/bootstrap-setup.controller.spec.ts`

**Interfaces:**
- Consumes: Task 1's DTO. Produces: an `apply()` that writes `instance.json` with `sslMode: 'selfsigned'` without requiring staged cert files.

- [ ] **Step 1: Write the failing test** (append to the controller spec's apply describe):

```ts
it('applies a selfsigned proxy install without requiring staged certs', async () => {
  bootstrap.validateDomain.mockReturnValue('example.com');
  bootstrap.validateApplyConfig.mockReturnValue({
    proxyMode: 'proxy', sslMode: 'selfsigned', port80: 'redirect', realIp: null,
  });
  const res = await controller.apply({
    domain: 'example.com', proxyMode: 'proxy', sslMode: 'selfsigned',
  } as ApplyBootstrapDto);
  expect(bootstrap.certificatesPresent).not.toHaveBeenCalled();
  expect(bootstrap.assertStagedCertificateCovers).not.toHaveBeenCalled();
  expect(writeInstanceConfig).toHaveBeenCalledWith(
    expect.objectContaining({ version: 2, state: 'applied', sslMode: 'selfsigned', proxyMode: 'proxy' }),
  );
  expect(res.adminUrl).toBe('https://admin.example.com');
});
```

(Mirror the existing apply-spec harness: `writeInstanceConfig` is spied via the instance-config module mock, `bootstrap` is the mocked `BootstrapSetupService`.)

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && pnpm test -- bootstrap-setup.controller`
Expected: FAIL — `certificatesPresent` is called (and throws "Install certificates before applying") for selfsigned.

- [ ] **Step 3: Implement.** In `bootstrap-setup.controller.ts` `apply()`, gate the two cert-presence checks on `sslMode !== 'selfsigned'`:

```ts
    // Self-signed keeps serving the built-in bootstrap cert (behind a
    // TLS-terminating proxy) — there is deliberately no staged fullchain to
    // check. Every other mode stages a real cert (paste) or has one issued
    // (letsencrypt, via issue-certificate) before apply.
    if (dto.sslMode !== 'selfsigned') {
      if (!this.bootstrap.certificatesPresent(dto.domain)) {
        throw new BadRequestException('Install certificates before applying');
      }
      this.bootstrap.assertStagedCertificateCovers(dto.domain, dto.proxyMode);
    }
    const domain = this.bootstrap.validateDomain(dto.domain);
    const applied = this.bootstrap.validateApplyConfig(dto);
```

(The `validateDomain` + `validateApplyConfig` + `finalizeSetup` + `writeInstanceConfig` + `scheduleExit` sequence below is unchanged.)

- [ ] **Step 4: Run tests + full backend suite**

Run: `cd apps/backend && pnpm test -- bootstrap-setup.controller && pnpm test && pnpm exec tsc --noEmit`
Expected: PASS (full suite green — the change is additive; existing paste/LE apply tests still exercise the cert checks).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/setup/bootstrap-setup.controller.ts apps/backend/src/setup/bootstrap-setup.controller.spec.ts
git commit -m "feat(cert-source): apply() serves the built-in cert for sslMode 'selfsigned' (no staged cert required)"
```

---

### Task 3: nginx render script serves the self-signed cert for `SSL_MODE=selfsigned`

**Files:**
- Modify: `docker/nginx/sites-available/main.conf.template` (admin vhost cert paths)
- Modify: `docker/nginx/render-main-conf.sh` (selfsigned branch + envsubst vars)
- Modify: `docker/nginx/render-main-conf.test.sh` (harness case)

**Interfaces:**
- Consumes: `SSL_MODE=selfsigned` from `instance.env` (Task 1's model, written by `writeInstanceConfig`).
- Produces: a rendered `main.conf` whose admin + wildcard vhosts serve `bootstrap-selfsigned.crt/.key` when `SSL_MODE=selfsigned`, without requiring `fullchain.pem`.

- [ ] **Step 1: Template — parameterize the admin vhost cert.** In `main.conf.template`, replace the admin block's hardcoded cert lines (currently `ssl_certificate /etc/nginx/ssl/fullchain.pem;` / `ssl_certificate_key /etc/nginx/ssl/privkey.pem;`):

```
    ssl_certificate ${PRIMARY_CERT};
    ssl_certificate_key ${PRIMARY_KEY};
```

- [ ] **Step 2: Write the failing harness case.** In `render-main-conf.test.sh`, add after the existing cases:

```sh
# --- proxy + selfsigned: serves the built-in self-signed cert, no fullchain ---
setup_etc 'STATE=applied
PRIMARY_DOMAIN=example.com
PROXY_MODE=proxy
SSL_MODE=selfsigned
PORT80=redirect
REALIP_MODE=off'
# setup_etc mints fullchain.pem/wildcard.* by default — remove them so this
# genuinely proves selfsigned does NOT require a real cert.
rm -f "$ETC/ssl/fullchain.pem" "$ETC/ssl/privkey.pem" \
      "$ETC/ssl/wildcard.example.com.crt" "$ETC/ssl/wildcard.example.com.key"
run_render
assert_contains "$ETC/sites-available/main.conf" 'ssl_certificate /etc/nginx/ssl/bootstrap-selfsigned.crt;' 'selfsigned: admin vhost uses self-signed cert'
assert_contains "$ETC/sites-available/main.conf" 'bootstrap-selfsigned.key' 'selfsigned: self-signed key referenced'
assert_not_contains "$ETC/sites-available/main.conf" '/etc/nginx/ssl/fullchain.pem' 'selfsigned: no fullchain reference'
```

(The `setup_etc` helper already `touch`es `bootstrap-selfsigned.crt`; ensure the harness also creates `bootstrap-selfsigned.key` — add `touch "$ETC/ssl/bootstrap-selfsigned.key"` to `setup_etc` if absent.)

Run: `sh docker/nginx/render-main-conf.test.sh`
Expected: FAIL — the script `exit 1`s on the missing `fullchain.pem`, and the admin vhost still says `fullchain.pem`.

- [ ] **Step 3: Implement the selfsigned branch.** In `render-main-conf.sh`, replace the cert-selection block (the `if [ -f "${SSL_DIR}/fullchain.pem" ] …` through the wildcard `else … exit 1; fi`) with:

```sh
# --- certificates (path selection is knob/file-driven, not vendor-driven) ---
PRIMARY_CERT="${SSL_DIR}/fullchain.pem"
PRIMARY_KEY="${SSL_DIR}/privkey.pem"
if [ "${SSL_MODE}" = "selfsigned" ]; then
    # Behind a proxy/CDN that terminates browser TLS and does not validate the
    # origin certificate (e.g. Bunny's default), the origin keeps serving the
    # built-in self-signed cert — no real cert is ever pasted or issued. Serve
    # it for both the admin and wildcard vhosts.
    if [ ! -f "${SSL_DIR}/bootstrap-selfsigned.crt" ] || [ ! -f "${SSL_DIR}/bootstrap-selfsigned.key" ]; then
        echo "❌ SSL_MODE=selfsigned but bootstrap-selfsigned.crt/.key is missing"
        exit 1
    fi
    echo "✅ Serving the built-in self-signed certificate (a proxy terminates browser TLS)"
    PRIMARY_CERT="${SSL_DIR}/bootstrap-selfsigned.crt"
    PRIMARY_KEY="${SSL_DIR}/bootstrap-selfsigned.key"
    WILDCARD_CERT="${SSL_DIR}/bootstrap-selfsigned.crt"
    WILDCARD_KEY="${SSL_DIR}/bootstrap-selfsigned.key"
else
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
        echo "ℹ️  No separate wildcard cert — using main certificate (Cloudflare Origin Cert)"
        WILDCARD_CERT="${SSL_DIR}/fullchain.pem"
        WILDCARD_KEY="${SSL_DIR}/privkey.pem"
    else
        echo "❌ Wildcard certificate not found (wildcard.${PRIMARY_DOMAIN}.crt/.key)"
        exit 1
    fi
fi
export PRIMARY_CERT PRIMARY_KEY
```

Then add `${PRIMARY_CERT} ${PRIMARY_KEY}` to the main-conf `envsubst` variable list:

```sh
envsubst '${PRIMARY_DOMAIN} ${PRIMARY_CERT} ${PRIMARY_KEY} ${WILDCARD_CERT} ${WILDCARD_KEY} ${PORT80_ACTION} ${ACME_LOCATION}' \
    < "${SITES_AVAILABLE}/main.conf.template" > "${SITES_AVAILABLE}/main.conf"
```

- [ ] **Step 4: Run harness + shellcheck + nginx build**

Run: `sh docker/nginx/render-main-conf.test.sh && shellcheck docker/nginx/render-main-conf.sh`
Expected: `ALL RENDER TESTS PASSED`; shellcheck clean. Also verify the non-selfsigned cases still pass (the paste/LE/cloudflare/legacy cases now render `${PRIMARY_CERT}` = `fullchain.pem` for the admin vhost — assert one existing case still contains `/etc/nginx/ssl/fullchain.pem` in the admin block).
Then: `docker compose build nginx` (if docker available; else note skipped).

- [ ] **Step 5: Commit**

```bash
git add docker/nginx/
git commit -m "feat(cert-source): render script serves the built-in self-signed cert for SSL_MODE=selfsigned"
```

**Open item for the executor:** an *applied* install with primary-content configured has its www/apex vhosts generated by `nginx-config.service.ts`, which references `fullchain.pem` for non-Cloudflare modes. For a fresh selfsigned install with no primary content set, those vhosts don't exist (requests fall through to the wildcard catch-all, which now serves self-signed), so the common path is fine. If primary content is later configured on a selfsigned install, that generator needs the same self-signed awareness — **verify nginx comes up cleanly on the selfsigned droplet leg (Task 7); if `nginx-config.service` emits a `fullchain.pem` reference, extend it to honor selfsigned in a follow-up.** Do not expand this task to cover it.

---

### Task 4: Paste-cert expiry reminder (Part B)

**Files:**
- Modify: `apps/backend/src/domains/ssl-renewal.service.ts`
- Test: `apps/backend/src/domains/ssl-renewal.service.spec.ts`

**Interfaces:**
- Consumes: existing `loadInstanceConfig`, `getPrimaryCertificateExpiryDays()`, `getReminderRecipient()`, `getSetting`/`updateSetting`, `EmailService`.
- Produces: `checkAndRemindPrimaryPaste(thresholdDays)` called from `checkAndRenewCertificates()`.

- [ ] **Step 1: Write the failing tests** (append to `ssl-renewal.service.spec.ts`):

```ts
describe('paste primary-cert expiry reminder', () => {
  it('emails when a pasted primary cert is within the threshold', async () => {
    (loadInstanceConfig as jest.Mock).mockReturnValue({
      version: 2, state: 'applied', primaryDomain: 'example.com', proxyMode: 'none', sslMode: 'paste',
    });
    sslCert.getPrimaryCertificateExpiryDays.mockReturnValue(12);
    settingsStore['notification_email'] = 'admin@example.com';
    await service.checkAndRenewCertificates();
    expect(email.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'admin@example.com', subject: expect.stringMatching(/certificate .* expires/i) }),
    );
  });

  it('does not remind for a letsencrypt primary cert (it auto-renews)', async () => {
    (loadInstanceConfig as jest.Mock).mockReturnValue({
      version: 2, state: 'applied', primaryDomain: 'example.com', proxyMode: 'none', sslMode: 'letsencrypt',
    });
    sslCert.getPrimaryCertificateExpiryDays.mockReturnValue(12);
    await service.checkAndRenewCertificates();
    // the LE path renews; it must not ALSO send the paste reminder
    expect(email.sendEmail).not.toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringMatching(/certificate .* expires/i) }),
    );
  });

  it('does not remind for a selfsigned install', async () => {
    (loadInstanceConfig as jest.Mock).mockReturnValue({
      version: 2, state: 'applied', primaryDomain: 'example.com', proxyMode: 'proxy', sslMode: 'selfsigned',
    });
    sslCert.getPrimaryCertificateExpiryDays.mockReturnValue(5);
    await service.checkAndRenewCertificates();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('does not re-send within 7 days', async () => {
    (loadInstanceConfig as jest.Mock).mockReturnValue({
      version: 2, state: 'applied', primaryDomain: 'example.com', proxyMode: 'none', sslMode: 'paste',
    });
    sslCert.getPrimaryCertificateExpiryDays.mockReturnValue(12);
    settingsStore['notification_email'] = 'admin@example.com';
    settingsStore['primary_cert_reminder_last_sent'] = new Date().toISOString();
    await service.checkAndRenewCertificates();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });
});
```

(Use the spec's existing harness: `loadInstanceConfig` mocked via `jest.mock('../bootstrap/instance-config')`, `sslCert`/`email` mocked, `settingsStore` backing `getSetting`/`updateSetting`.)

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && pnpm test -- ssl-renewal.service`
Expected: FAIL — no reminder is sent for the paste case.

- [ ] **Step 3: Implement.** In `checkAndRenewCertificates()`, add after the primary-LE check (step "1b"):

```ts
      // 1c. Pasted primary cert — cannot auto-renew (the box can't re-fetch a
      // CDN origin cert or a BYO cert). Warn before it silently expires.
      await this.checkAndRemindPrimaryPaste(thresholdDays);
```

Add the method (place near `checkAndRenewPrimary`), mirroring `sendWildcardExpiryReminder`:

```ts
  /**
   * A pasted primary cert (Cloudflare Origin, another CDN's origin cert, or a
   * BYO cert on a direct box) can't auto-renew — the box has nothing to
   * re-fetch. Send a throttled reminder so it doesn't expire silently.
   * Explicitly skips 'letsencrypt' (auto-renews via checkAndRenewPrimary) and
   * 'selfsigned' (behind a verify-off proxy; its expiry is irrelevant).
   */
  private async checkAndRemindPrimaryPaste(thresholdDays: number): Promise<void> {
    const cfg = loadInstanceConfig();
    if (cfg?.state !== 'applied' || cfg.sslMode !== 'paste' || !cfg.primaryDomain) return;
    const daysLeft = this.sslCertificateService.getPrimaryCertificateExpiryDays();
    if (daysLeft === null || daysLeft > thresholdDays) return;

    const last = await this.getSetting('primary_cert_reminder_last_sent');
    if (last && Date.now() - new Date(last).getTime() < 7 * 86_400_000) return;
    const to = await this.getReminderRecipient();
    if (!to) {
      this.logger.warn('Primary cert expiring but no reminder recipient (no notification_email, no admin user)');
      return;
    }
    const domain = cfg.primaryDomain;
    const result = await this.emailService.sendEmail({
      to,
      subject: `Action needed: the certificate for ${domain} expires in ${daysLeft} days`,
      html:
        `<p>The certificate for <strong>${domain}</strong> expires in <strong>${daysLeft} days</strong> ` +
        `and cannot renew automatically (it was pasted in, not issued here).</p>` +
        `<p>Replace it before then: copy a fresh certificate into the server's <code>ssl/</code> ` +
        `directory, or re-run setup. If your server is reachable for Let's Encrypt, switching to ` +
        `an auto-renewing certificate avoids this in future.</p>`,
    });
    if (result.success) {
      await this.updateSetting('primary_cert_reminder_last_sent', new Date().toISOString());
    } else {
      this.logger.error(`Failed to send primary cert expiry reminder for ${domain}: ${result.error}`);
    }
  }
```

- [ ] **Step 4: Run tests + full backend suite**

Run: `cd apps/backend && pnpm test -- ssl-renewal.service && pnpm test && pnpm exec tsc --noEmit`
Expected: PASS, full suite green, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/domains/ssl-renewal.service.ts apps/backend/src/domains/ssl-renewal.service.spec.ts
git commit -m "feat(cert-reminder): warn by email before a pasted primary cert expires"
```

---

### Task 5: Frontend state + ServingChoicePhase proxy sub-choice

**Files:**
- Modify: `apps/frontend/src/store/slices/setupSlice.ts`
- Modify: `apps/frontend/src/store/slices/setupSlice.test.ts`
- Modify: `apps/frontend/src/components/setup/domain-ssl/ServingChoicePhase.tsx`
- Test: `apps/frontend/src/components/setup/__tests__/DomainSslStep.test.tsx`

**Interfaces:**
- Produces: `BootstrapSslMode = 'paste' | 'letsencrypt' | 'selfsigned'`; `setServingMode('proxy')` presets `bootstrapSslMode` to `'selfsigned'`; a three-option proxy sub-choice.

- [ ] **Step 1: Write the failing slice test** (in `setupSlice.test.ts`):

```ts
it('setServingMode presets the proxy path to selfsigned', () => {
  const state = reducer(undefined, setServingMode('proxy'));
  expect(state.wizard.servingMode).toBe('proxy');
  expect(state.wizard.bootstrapSslMode).toBe('selfsigned');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/frontend && pnpm test -- setupSlice`
Expected: FAIL — proxy presets `'paste'`, and `'selfsigned'` isn't in the `BootstrapSslMode` type.

- [ ] **Step 3: Implement slice.** In `setupSlice.ts`:

```ts
export type BootstrapSslMode = 'paste' | 'letsencrypt' | 'selfsigned';
```

`setServingMode` reducer — preset by mode:

```ts
    setServingMode: (state, action: PayloadAction<ServingMode>) => {
      state.wizard.servingMode = action.payload;
      state.wizard.bootstrapSslMode =
        action.payload === 'proxy' ? 'selfsigned'
        : action.payload === 'cloudflare' ? 'paste'
        : null; // 'none' — user picks LE or paste
      state.wizard.bootstrapPort80 = null;
      state.wizard.bootstrapRealIp = null;
      state.wizard.dnsPreflightPassed = false;
      state.wizard.wildcardIssued = false;
    },
```

- [ ] **Step 4: Implement ServingChoicePhase.** Update the `proxy` CHOICES copy (drop "You paste that service's origin certificate"):

```ts
  {
    mode: 'proxy',
    title: 'Through another CDN or WAF',
    body: "Fastly, Bunny, a corporate WAF — anything that terminates TLS in front of this server. Most don't validate the origin, so this server can keep its built-in certificate with nothing to maintain.",
  },
```

Add a proxy sub-choice block (mirroring the `none` block), rendered when `servingMode === 'proxy'`, with three radios dispatching `setBootstrapSslMode`:

```tsx
      {servingMode === 'proxy' && (
        <div className="ml-6 space-y-3">
          <p className="text-sm font-medium text-foreground">Certificate for the origin</p>
          {([
            ['selfsigned', 'Keep the built-in certificate (recommended)',
              "Zero maintenance. Works with CDNs that don't validate the origin certificate (the common default). The link from your CDN to this server is encrypted but unauthenticated — if you turn on your CDN's origin verification, pick one of the options below instead."],
            ['letsencrypt', 'Auto-issue with Let\'s Encrypt',
              'A real auto-renewing certificate on this server. Needs your CDN to pass ACME challenges through to the origin (or the origin reachable on port 80).'],
            ['paste', 'Paste my own certificate',
              "Paste your CDN's origin certificate or any browser-trusted cert. You'll re-paste when it expires."],
          ] as const).map(([mode, title, body]) => (
            <label key={mode} className="flex items-start p-3 border border-border rounded-lg cursor-pointer hover:bg-muted/50">
              <input
                type="radio"
                name="bootstrapSslMode"
                checked={bootstrapSslMode === mode}
                onChange={() => dispatch(setBootstrapSslMode(mode))}
                className="mt-1 mr-3"
                aria-label={title}
              />
              <div className="flex-1">
                <span className="font-medium">{title}</span>
                <p className="mt-1 text-sm text-muted-foreground">{body}</p>
              </div>
            </label>
          ))}
        </div>
      )}
```

`complete` already treats `proxy` as complete once a serving mode is chosen (it's only `none` that requires a non-null sub-choice, and `setServingMode('proxy')` presets `'selfsigned'` so it's non-null anyway) — no change needed to the `complete` computation.

- [ ] **Step 5: Write + run the component test** (in `DomainSslStep.test.tsx`):

```tsx
it('proxy path offers three cert options, defaulting to keep-self-signed', async () => {
  const user = userEvent.setup();
  renderWithStore(<DomainSslStep />);
  await user.click(screen.getByLabelText(/another cdn or waf/i));
  expect(screen.getByLabelText(/keep the built-in certificate/i)).toBeChecked();
  expect(screen.getByLabelText(/auto-issue with let's encrypt/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/paste my own certificate/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();
});
```

Run: `cd apps/frontend && pnpm test -- setupSlice DomainSslStep && pnpm exec tsc --noEmit`
Expected: PASS. tsc will flag `CertificatePhase`/`PasteCertificateForm` only if they don't yet handle `'selfsigned'` — that's Task 6; confirm any error is confined to those two files.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/store apps/frontend/src/components/setup/domain-ssl/ServingChoicePhase.tsx apps/frontend/src/components/setup/__tests__/DomainSslStep.test.tsx
git commit -m "feat(cert-source): proxy path offers keep-self-signed (default) / LE / paste"
```

---

### Task 6: ProxyOptions + SelfSignedConfirm + CertificatePhase wiring

**Files:**
- Create: `apps/frontend/src/components/setup/domain-ssl/ProxyOptions.tsx`
- Create: `apps/frontend/src/components/setup/domain-ssl/SelfSignedConfirm.tsx`
- Modify: `apps/frontend/src/components/setup/domain-ssl/PasteCertificateForm.tsx` (remove inline proxy options)
- Modify: `apps/frontend/src/components/setup/domain-ssl/CertificatePhase.tsx`
- Test: `apps/frontend/src/components/setup/__tests__/CertificatePhase.test.tsx`

**Interfaces:**
- Consumes: Task 5's `bootstrapSslMode`; `setBootstrapRealIp`/`setBootstrapPort80`/`setBootstrapDomain`/`nextWizardStep`; `validateRealIp`.
- Produces: `ProxyOptions` (dispatches realIp/port80 on change), `SelfSignedConfirm` (no upload → advances), a `CertificatePhase` that renders `ProxyOptions` for the proxy path plus the cert-mode view.

- [ ] **Step 1: Write the failing tests** (in `CertificatePhase.test.tsx`):

```tsx
it('proxy + selfsigned shows a confirm view (no cert upload) and advances', async () => {
  const user = userEvent.setup();
  const { store } = renderWithStore(<CertificatePhase domain="example.com" onBack={noop} />, {
    servingMode: 'proxy', bootstrapSslMode: 'selfsigned',
  });
  expect(screen.queryByLabelText(/certificate.*pem/i)).not.toBeInTheDocument();
  expect(screen.getByText(/built-in certificate/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /continue/i }));
  expect(store.getState().setup.wizard.bootstrapDomain).toBe('example.com');
});

it('proxy path shows the visitor-IP / port-80 options for the self-signed mode too', () => {
  renderWithStore(<CertificatePhase domain="example.com" onBack={noop} />, {
    servingMode: 'proxy', bootstrapSslMode: 'selfsigned',
  });
  expect(screen.getByText(/restore visitor ips/i)).toBeInTheDocument();
  expect(screen.getByText(/close port 80/i)).toBeInTheDocument();
});

it('proxy options dispatch a valid realIp to the store', async () => {
  const user = userEvent.setup();
  const { store } = renderWithStore(<CertificatePhase domain="example.com" onBack={noop} />, {
    servingMode: 'proxy', bootstrapSslMode: 'selfsigned',
  });
  await user.type(screen.getByLabelText(/trusted ranges/i), '151.101.0.0/16');
  await user.type(screen.getByLabelText(/header carrying/i), 'True-Client-IP');
  await waitFor(() =>
    expect(store.getState().setup.wizard.bootstrapRealIp).toEqual({ header: 'True-Client-IP', ranges: ['151.101.0.0/16'] }),
  );
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/frontend && pnpm test -- CertificatePhase`
Expected: FAIL — proxy+selfsigned currently falls to `PasteCertificateForm` (shows the cert textarea).

- [ ] **Step 3: Implement `ProxyOptions.tsx`** (the realIp/port80 controls, extracted from PasteCertificateForm, dispatching on change):

```tsx
import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { setBootstrapRealIp, setBootstrapPort80 } from '@/store/slices/setupSlice';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { validateRealIp } from '@/lib/validateRealIp';

// Proxy-only origin knobs, shared by all three proxy cert modes (self-signed,
// Let's Encrypt, paste). Dispatches to the store on change so the Apply step
// reads them back. The realIp fields are OPTIONAL — invalid input shows an
// inline error and simply isn't applied (dispatched as null), rather than
// hard-blocking; the backend combo-validation is the authoritative gate.
export function ProxyOptions() {
  const dispatch = useDispatch();
  const [rangesText, setRangesText] = useState('');
  const [header, setHeader] = useState('');
  const [closePort80, setClosePort80] = useState(false);
  const [rangesError, setRangesError] = useState<string | null>(null);
  const [headerError, setHeaderError] = useState<string | null>(null);

  const applyRealIp = (nextRanges: string, nextHeader: string) => {
    setRangesError(null);
    setHeaderError(null);
    if (!nextRanges.trim()) {
      dispatch(setBootstrapRealIp(null));
      return;
    }
    const result = validateRealIp(nextRanges, nextHeader);
    if (result.rangesError || result.headerError) {
      setRangesError(result.rangesError);
      setHeaderError(result.headerError);
      dispatch(setBootstrapRealIp(null)); // don't apply invalid input
      return;
    }
    dispatch(setBootstrapRealIp({ header: result.header, ranges: result.ranges }));
  };

  return (
    <div className="space-y-4">
      <details className="rounded-md border border-border p-3">
        <summary className="text-sm font-medium cursor-pointer">Restore visitor IPs (optional)</summary>
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted-foreground">
            Skip this and everything works — logs and rate limiting will just see your CDN&apos;s IPs
            instead of visitors&apos;. To restore real IPs, paste your CDN&apos;s egress ranges.
          </p>
          <div>
            <Label htmlFor="realip-ranges">Trusted ranges (CIDR, one per line)</Label>
            <Textarea
              id="realip-ranges"
              value={rangesText}
              onChange={(e) => { setRangesText(e.target.value); applyRealIp(e.target.value, header); }}
              placeholder={'151.101.0.0/16\n2a04:4e40::/32'}
              rows={4}
              className="mt-1 font-mono text-xs"
              aria-invalid={rangesError ? true : undefined}
            />
            {rangesError && <p className="mt-1 text-sm text-destructive">{rangesError}</p>}
          </div>
          <div>
            <Label htmlFor="realip-header">Header carrying the visitor IP</Label>
            <Input
              id="realip-header"
              value={header}
              onChange={(e) => { setHeader(e.target.value); applyRealIp(rangesText, e.target.value); }}
              placeholder="X-Forwarded-For"
              className="mt-1"
              aria-invalid={headerError ? true : undefined}
            />
            {headerError && <p className="mt-1 text-sm text-destructive">{headerError}</p>}
          </div>
        </div>
      </details>
      <label className="flex items-start text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={closePort80}
          onChange={(e) => { setClosePort80(e.target.checked); dispatch(setBootstrapPort80(e.target.checked ? 'closed' : null)); }}
          className="mt-0.5 mr-2"
        />
        <span>Close port 80 — my CDN connects to this origin over HTTPS only</span>
      </label>
    </div>
  );
}
```

- [ ] **Step 4: Implement `SelfSignedConfirm.tsx`:**

```tsx
import { useDispatch } from 'react-redux';
import { setBootstrapDomain, nextWizardStep } from '@/store/slices/setupSlice';
import { Button } from '@/components/ui/button';

export function SelfSignedConfirm({ domain, onBack }: { domain: string; onBack: () => void }) {
  const dispatch = useDispatch();
  const confirm = () => {
    dispatch(setBootstrapDomain(domain));
    dispatch(nextWizardStep());
  };
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground">Keep the built-in certificate</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          This server will keep serving its built-in self-signed certificate. Your CDN terminates
          browser TLS in front of it, so visitors never see it — there&apos;s nothing to paste and
          nothing to renew. The link from your CDN to this server is encrypted but not authenticated;
          if you turn on your CDN&apos;s origin verification, go back and choose Let&apos;s Encrypt or
          paste a certificate.
        </p>
      </div>
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>Back</Button>
        <Button onClick={confirm}>Continue</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Remove the inline proxy options from `PasteCertificateForm.tsx`.** Delete the two `{mode === 'proxy' && (…)}` blocks (the `<details>Restore visitor IPs</details>` and the `Close port 80` label) and the now-unused `rangesText`/`header`/`closePort80`/`rangesError`/`headerError` state and the realIp/port80 dispatch inside `submit()` (the `if (mode === 'proxy') { … }` block). `PasteCertificateForm` keeps only the cert/key textareas + wildcard-warning flow; the proxy options now come from `ProxyOptions` rendered by `CertificatePhase`. Keep the `validateRealIp` import only if still used (it isn't after this — remove it).

- [ ] **Step 6: Wire `CertificatePhase.tsx`:**

```tsx
import { useSelector } from 'react-redux';
import { RootState } from '@/store';
import { PasteCertificateForm } from './PasteCertificateForm';
import { LetsEncryptForm } from './LetsEncryptForm';
import { SelfSignedConfirm } from './SelfSignedConfirm';
import { ProxyOptions } from './ProxyOptions';

interface CertificatePhaseProps {
  domain: string;
  onBack: () => void;
}

export function CertificatePhase({ domain, onBack }: CertificatePhaseProps) {
  const { servingMode, bootstrapSslMode } = useSelector((s: RootState) => s.setup.wizard);

  const certView =
    bootstrapSslMode === 'selfsigned' ? <SelfSignedConfirm domain={domain} onBack={onBack} />
    : bootstrapSslMode === 'letsencrypt' ? <LetsEncryptForm domain={domain} onBack={onBack} />
    : <PasteCertificateForm domain={domain} onBack={onBack} />;

  // The proxy path's real-IP / port-80 knobs apply to all three cert modes, so
  // they render above the cert-specific view (not inside the paste form).
  if (servingMode === 'proxy') {
    return (
      <div className="space-y-6">
        <ProxyOptions />
        {certView}
      </div>
    );
  }
  return certView;
}
```

(For `none`/`cloudflare`, no `ProxyOptions`; the `bootstrapSslMode`-driven `certView` gives `none+letsencrypt` → LetsEncryptForm, `none+paste`/`cloudflare+paste` → PasteCertificateForm — unchanged behavior. `selfsigned` only ever occurs under `proxy` per the combo rules, so the `certView` self-signed branch is reached only inside the proxy wrapper.)

- [ ] **Step 7: Run tests + tsc**

Run: `cd apps/frontend && pnpm test -- CertificatePhase DomainSslStep && pnpm exec tsc --noEmit`
Expected: PASS, tsc fully clean.

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/components/setup/domain-ssl/
git commit -m "feat(cert-source): shared ProxyOptions + self-signed confirm view; proxy cert modes wired"
```

---

### Task 7: E2E (proxy + self-signed) + full verification

**Files:**
- Modify: `apps/frontend/e2e/bootstrap-wizard.spec.ts`

- [ ] **Step 1: Add the Playwright leg.** Extend the bootstrap wizard spec with a proxy + self-signed scenario: pick "another CDN or WAF" on the serving choice (self-signed preselected), Next through the domain step, on the certificate phase click **Continue** (no cert upload), proceed through storage/cache/email to Apply, and assert the Apply summary shows the proxy serving mode and a self-signed / built-in certificate line (mock `/api/setup/apply` to capture the body and assert `{ proxyMode: 'proxy', sslMode: 'selfsigned' }`). Follow the existing spec's mock-api + step-through helpers.

- [ ] **Step 2: Run the frontend E2E + full suites**

Run: `cd apps/frontend && pnpm test && pnpm exec tsc --noEmit`
Expected: all green, tsc clean.

- [ ] **Step 3: Backend full suite + render harness (regression sweep)**

Run: `cd apps/backend && pnpm test` then `sh docker/nginx/render-main-conf.test.sh`
Expected: backend green; `ALL RENDER TESTS PASSED`.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/e2e/bootstrap-wizard.spec.ts
git commit -m "test(cert-source): proxy + self-signed wizard E2E leg"
```

---

## Manual droplet verification (post-implementation, pre-merge)

Not tasks — the live checklist (rebuild `frontend`/`backend`/`nginx` `bootstrap` images first):

1. **Proxy + self-signed** (the Bunny case): wizard as "another CDN/WAF" → keep built-in cert → apply with no cert paste → box restarts, nginx serves the self-signed cert on 443 for `admin.<domain>` and the wildcard, and a Bunny pull zone with **Verify origin SSL certificate OFF** reaches it. Confirm nginx comes up clean (watch for any `nginx-config.service` `fullchain.pem` reference on a selfsigned install — the Task 3 open item).
2. **Proxy + Let's Encrypt**: same serving choice → auto-issue LE → apply; confirm the LE cert issues (needs port 80 / ACME reachable) and the cron will renew it.
3. **Regression**: Cloudflare (paste Origin Cert) and Direct + LE / Direct + paste still work unchanged.
4. **Reminder**: on a paste install, set `renewal_threshold_days` high, delete `primary_cert_reminder_last_sent`, run the renewal trigger, confirm the email fires once (and not again within 7 days), and that LE / self-signed installs send nothing.

## Open items

- `nginx-config.service.ts` primary-content generation for a selfsigned install (Task 3 open item) — verify on the droplet; extend in a follow-up only if it emits a `fullchain.pem` reference that breaks nginx.
