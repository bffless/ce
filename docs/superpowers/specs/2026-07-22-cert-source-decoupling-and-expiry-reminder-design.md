# Cert Source Decoupling + Paste-Cert Expiry Reminder — Design Spec

**Date:** 2026-07-22
**Status:** Draft for review
**Scope:** `repos/ce` (frontend wizard, setup endpoints, `instance.json`, nginx render script, renewal cron)
**Follow-up to:** `2026-07-21-bootstrap-domain-ssl-model-design.md` (the four-path domain/SSL model). Builds directly on its `instance.json` v2 knobs + `sslMode` model.

## Problem

Two gaps surfaced testing the domain/SSL wizard against a real non-Cloudflare CDN (Bunny.net):

1. **The "another CDN/WAF" (proxy) path assumes a Cloudflare-style origin CA that almost no CDN has.** It forces the user to *paste an origin certificate "issued from its dashboard"* — but Bunny, Fastly, Akamai, and most WAFs don't issue origin certs (Cloudflare's Origin CA is the outlier). So a Bunny user hits a dead-end: the wizard demands a cert they can't get.

   The deeper truth: a CDN's origin connection **doesn't validate the origin cert by default** (Bunny's "Verify origin SSL certificate" is off by default — confirmed in-product; it opens an encrypted connection but checks nothing, not even expiry). So behind such a CDN the origin can keep serving its **self-signed bootstrap cert forever** — no real cert, no renewal, nothing to maintain. The cert source is genuinely independent of what's in front of the origin.

2. **A pasted primary cert can expire with no warning.** The renewal cron auto-renews Let's Encrypt and reminds about the wildcard, but does *nothing* for a pasted primary cert (`sslMode: 'paste'`) nearing expiry. A direct-serving user with a bring-your-own commercial cert (or, far out, a Cloudflare Origin Cert) gets no signal before the site breaks.

## Scope decisions (made during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Part A shape | **Decouple the cert source from the proxy choice.** The proxy path gains a cert sub-choice: **Keep the built-in self-signed cert (default)** / Auto-issue Let's Encrypt / Paste my own. New `sslMode: 'selfsigned'` | The cert the origin serves is about the *origin*, not what's in front. "Keep self-signed" is the zero-maintenance fit for a CDN that doesn't verify the origin (the common case) and un-breaks the proxy path for Bunny et al. |
| Self-signed default | **Yes — preselected on the proxy path** | Zero maintenance; matches Bunny's (and most CDNs') default of not verifying the origin. Auto-LE / paste are the "I enabled origin verification" alternatives |
| Let's Encrypt on the proxy path | **Newly allowed** (was `none`-only) | Bunny (and others) pass ACME `/.well-known/acme-challenge/` through to the origin, so the origin can auto-renew its own LE cert *behind* the CDN. Reuses the existing primary-domain HTTP-01 machinery |
| Part B shape | **Trimmed to a notify-only reminder.** No dashboard cert-management UI, no admin replace endpoint, no switch-to-LE | Behind a verify-off CDN nothing needs renewing; direct installs use auto-renewing LE. The only cert that expires *and* can't self-renew is a pasted cert on a direct box — a rare choice. A full day-2 management surface would be over-engineered for that audience |
| Reminder mechanism | **Email only**, throttled (once/7 days), threshold-driven, `sslMode: 'paste'` only | Reuses the existing wildcard-reminder machinery wholesale (`EmailService`, `getReminderRecipient`, `getPrimaryCertificateExpiryDays`, `renewal_threshold_days`). Turns a silent expiry into a warned one; the actual replace stays manual (SSH a new cert into `ssl/`, or reset + re-run the wizard) |
| Reserved values | `proxyMode: 'cloudflare-tunnel'`, `sslMode: 'external'` remain reserved/unselectable, unchanged | Deferred Umbrel/tunnel profile |

## Background — current state (explored 2026-07-22, branch `specs/do-one-click-and-web-bootstrap`)

- `SSL_MODE` is written into `instance.env` and **read by `render-main-conf.sh` (line 44) but never branched on** — cert-path selection is currently file-driven. This is the exact hook Part A uses.
- The render script's normal-mode cert block (`render-main-conf.sh:125-143`) **hard-exits if `fullchain.pem` is absent**, and (except for the `PROXY_MODE=cloudflare` fallback) also if the `wildcard.<domain>.*` pair is absent. The Cloudflare `elif` — "reuse the generic pair instead of requiring a wildcard file" — is the precedent Part A mirrors.
- The bootstrap self-signed cert (`bootstrap-selfsigned.crt/.key`, `CN=bffless-bootstrap`, 825 days) is generated at first boot and **kept** across resets (it doubles as the `have_bootstrap_marker`).
- `validateApplyConfig` (`bootstrap-setup.service.ts`) currently requires `letsencrypt` ⇒ `proxyMode: 'none'`.
- `apply()` calls `certificatesPresent(domain)` + `assertStagedCertificateCovers(domain, proxyMode)` — both assume real staged certs.
- The renewal cron's `checkAndRenewPrimary()` returns immediately for `sslMode !== 'letsencrypt'`; `getPrimaryCertificateExpiryDays()` and the throttled `sendWildcardExpiryReminder()` (via `EmailService` + `getReminderRecipient`, `sslSettings` k/v throttle) already exist and are reusable.
- Wizard cert forms: `PasteCertificateForm` (holds the proxy-only "Restore visitor IPs" + "Close port 80" controls today), `LetsEncryptForm`, and `CertificatePhase` which dispatches between them by `servingMode`/`bootstrapSslMode`.

## Design

### Part A — decouple the cert source from the proxy choice

**1. `sslMode` model (`instance-config.ts`, DTO, combo-validation).**
- `SslMode = 'paste' | 'letsencrypt' | 'selfsigned'`. `writeInstanceConfig` already emits `SSL_MODE=<value>`; no other change to the knob writer.
- `ApplyBootstrapDto.sslMode` `@IsIn` gains `'selfsigned'`.
- `validateApplyConfig` combo matrix becomes:

  | `proxyMode` | allowed `sslMode` | notes |
  |---|---|---|
  | `cloudflare` | `paste` | unchanged preset (Origin Cert) |
  | `proxy` | `selfsigned` \| `letsencrypt` \| `paste` | `selfsigned` default |
  | `none` | `letsencrypt` \| `paste` | unchanged |

  Rules: `selfsigned` ⇒ `proxyMode: 'proxy'` only (a browser hitting a direct box would get a warning; Cloudflare uses its Origin-Cert preset). `letsencrypt` ⇒ `proxyMode ∈ {none, proxy}` **and** `port80: 'redirect'` (HTTP-01 needs port 80 open; through a CDN via ACME pass-through). Custom `realIp` still `proxy`-only, independent of `sslMode`.

**2. nginx render script (`render-main-conf.sh` + `main.conf.template`).**
- A new `SSL_MODE=selfsigned` branch in the normal-mode cert-selection block serves the existing `bootstrap-selfsigned.crt/.key` for **both** the admin vhost and the wildcard vhost, instead of requiring `fullchain.pem`/`wildcard.<domain>.*`. This mirrors the Cloudflare fallback `elif`. Implementation parameterizes the admin vhost's cert paths (today hardcoded to `fullchain.pem`/`privkey.pem`) the same way `${WILDCARD_CERT}`/`${WILDCARD_KEY}` already are, so both blocks point at the self-signed pair when `SSL_MODE=selfsigned`.
- `PORT80`/`REALIP_MODE` behavior is unchanged (knob-driven, as in the parent spec). For `selfsigned` there is no ACME need, so port 80 may be closed via the existing toggle, but defaults to `redirect` like the rest of the proxy path.

**3. `apply()` (backend).**
- When `sslMode === 'selfsigned'`, `apply()` **skips** `certificatesPresent` + `assertStagedCertificateCovers` (no real cert is staged — the box keeps serving `bootstrap-selfsigned.*`, which is present since first boot). It writes `instance.json` with `sslMode: 'selfsigned'` as usual. All other gating (claim token, `PLATFORM_MODE`, domain validation) is unchanged.

**4. Wizard UI (frontend).**
- `setupSlice`: `BootstrapSslMode = 'paste' | 'letsencrypt' | 'selfsigned'`. `setServingMode` presets: `cloudflare → 'paste'`, `proxy → 'selfsigned'` (new default), `none → null` (user still picks LE/paste).
- `ServingChoicePhase`: the `proxy` path gains a three-option cert sub-choice (Keep built-in self-signed [default] / Auto-issue Let's Encrypt / Paste my own), the same shape the `none` path already uses. `cloudflare` keeps no sub-choice; `none` unchanged. Next-enable: `proxy` and `cloudflare` always have a default, so they're complete once the serving mode is chosen.
- The proxy-only **"Restore visitor IPs" + "Close port 80"** controls move out of `PasteCertificateForm` into a small shared **`ProxyOptions`** section shown on the proxy path for *all three* cert modes (they're cert-independent and must be settable for self-signed and LE too). They dispatch `setBootstrapRealIp`/`setBootstrapPort80` exactly as today.
- `CertificatePhase` dispatch for the proxy path renders `ProxyOptions` + one of: a new **self-signed confirmation view** (no cert form — a short explanation + security note + Continue, which dispatches `setBootstrapDomain` and advances), the existing `LetsEncryptForm`, or the existing `PasteCertificateForm`. The `none`/`cloudflare` paths are unchanged.
- **Copy** for the self-signed option states the tradeoff plainly: the origin leg is encrypted but *not authenticated* unless you enable your CDN's origin verification — and if you do, choose Auto-LE or Paste. No mention of a "CDN origin certificate to paste" as the only option.

### Part B — paste-cert expiry reminder (notify-only)

- `ssl-renewal.service.ts` gains `checkAndRemindPrimaryPaste(thresholdDays)`, called from `checkAndRenewCertificates()` alongside the existing checks. It acts only when `loadInstanceConfig()` reports `state: 'applied'` **and** `sslMode: 'paste'` **and** `getPrimaryCertificateExpiryDays() <= thresholdDays`. It sends the throttled reminder email (new `sslSettings` key `primary_cert_reminder_last_sent`, once per 7 days) via the existing `EmailService` + `getReminderRecipient` (`notification_email` → first admin → log-only). Body: the domain, days remaining, and that the fix is manual (replace the cert in `ssl/` or reset + re-run setup).
- **Explicitly not** fired for `letsencrypt` (auto-renews) or `selfsigned` (behind a verify-off proxy; its `fullchain` is the long-lived self-signed and irrelevant). No endpoint, no dashboard UI, no banner.

## Security summary

- Self-signed behind a proxy is the same posture as Cloudflare "Full" (not strict): browser→CDN is real TLS (the CDN's edge cert), CDN→origin is encrypted but unauthenticated. Acceptable (backbone-only exposure) and it *is* the CDN's own default; the wizard copy states it and points to origin verification + LE/paste for hardening.
- No new unauthenticated surface: `apply()` keeps its claim-token + `PLATFORM_MODE` gating; the self-signed path removes only the *cert-presence* checks (there is deliberately no staged cert), not any auth gate.
- The reminder is server-side only (cron + email), no new endpoint.

## Testing

- **Unit (backend):** combo-validation matrix (`selfsigned` ⇒ proxy-only; `letsencrypt` now allowed for proxy with `port80: redirect`; `selfsigned` rejected for `none`/`cloudflare`); `apply()` skips cert-presence when `sslMode: 'selfsigned'` and writes the v2 config; `checkAndRemindPrimaryPaste` (fires for paste-within-threshold; silent for LE/selfsigned/paste-not-near; 7-day throttle honored; recipient fallback).
- **Render script (harness):** a `SSL_MODE=selfsigned` case asserting the admin + wildcard vhosts reference `bootstrap-selfsigned.crt/.key` and the script does **not** `exit 1` with no `fullchain.pem` present.
- **Unit (frontend):** `ServingChoicePhase` proxy three-option sub-choice with self-signed default; `CertificatePhase` self-signed path renders no upload form and advances on Continue; `ProxyOptions` visible for all three proxy cert modes and dispatches realIp/port80.
- **E2E (Playwright):** a proxy + self-signed wizard leg — pick "another CDN/WAF" → keep built-in cert → apply with no cert upload → summary reflects `selfsigned`.

## Out of scope

- Day-2 dashboard cert-management UI (status view, replace-cert endpoint, switch-to-LE) — deferred; the trimmed reminder covers the silent-expiry risk. Reopen if a real audience for pasted-direct-cert management appears.
- Self-signed cert rotation (the 825-day bootstrap cert) — behind a verify-off proxy its expiry is irrelevant; not worth automating now.
- `cloudflare-tunnel` / Umbrel profile — still reserved.
- Any change to Cloudflare's path (still the Origin-Cert paste preset).
