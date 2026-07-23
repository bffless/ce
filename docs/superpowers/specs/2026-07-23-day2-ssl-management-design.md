# Day-2 SSL / Certificate Management — Design Spec

**Date:** 2026-07-23
**Status:** Draft for review
**Scope:** `repos/ce` (frontend admin settings, new session-guarded setup/SSL endpoints, `instance.json`, nginx re-render/reload, a durable pending-revert record + interval)
**Follow-up to:** `2026-07-22-cert-source-decoupling-and-expiry-reminder-design.md`, which deliberately deferred this: *"Part B shape: Trimmed to a notify-only reminder. No dashboard cert-management UI, no admin replace endpoint, no switch-to-LE."* This spec builds that deferred day-2 surface. Also builds on `2026-07-21-bootstrap-domain-ssl-model-design.md` (the four-path domain/SSL model + `instance.json` v2 knobs).

## Problem

The onboarding wizard lets an admin pick how the box serves TLS — Cloudflare origin-cert paste, another CDN/WAF (keep self-signed / Let's Encrypt / paste), direct + Let's Encrypt (auto), or direct + bring-your-own paste. But **after** setup there is no way to change any of it from the dashboard:

- The wizard's paste-cert warning (`PasteCertificateForm.tsx:141-142`) tells the user they can *"paste a wildcard-covering certificate later in Settings → SSL"*, and the wildcard expiry-reminder email points at *"Settings → SSL → Wildcard certificate"* — **but no such paste screen or admin endpoint exists.** The wizard makes a promise the app can't keep.
- The only day-2 SSL surfaces that exist are pre-existing (not part of the bootstrap PR): the **"SSL Certificate Auto-Renewal"** card in Admin → Infrastructure (renewal *config* only — threshold days, notification email, wildcard auto-renew toggle, history; **no cert action**), and the **wildcard DNS-01 issuance** flow in the per-domain SSL tab (`ssl/wildcard/*`; issuance-via-TXT-record, not paste, and scoped to `*.baseDomain`).
- The primary-domain cert-paste and HTTP-01 Let's Encrypt machinery **exists** (`validateCertificatePair`, `requestPrimaryDomainCertificate`, `writeInstanceConfig`) but is **claim-token-gated and only reachable inside bootstrap mode**. Once setup completes, it's inert.

So an admin who chose "paste" and later needs to rotate the cert, or chose self-signed and now wants Let's Encrypt, or pasted a cert that doesn't cover the wildcard, has **no in-dashboard path** — only SSH + `reset-setup.sh` + re-run the wizard.

The goal: a day-2 admin surface that mirrors the onboarding Domain & SSL flow, **without ever letting the admin take an action they can't undo**.

## Scope decisions (made during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| What it manages | **The primary instance-domain cert + serving model** (apex/www/admin/wildcard) | This is exactly what onboarding configured. Per-custom-domain certs (the existing DNS-01 wildcard tab) are out of scope. |
| Placement | **A new dedicated "SSL / Certificates" admin page/route**, separate from the existing "SSL Certificate Auto-Renewal" card | User chose a dedicated page over cramming into the Infrastructure tab — room for current status, serving-model editor, cert source, and rollback in one place. |
| Editable scope | **The full re-runnable Domain & SSL flow** — serving model (proxyMode) + port-80 + real-IP + cert source (LE / paste / self-signed). Primary **domain is fixed** here | User chose "cert source + serving model." Changing the domain itself means a `COOKIE_DOMAIN` change + backend restart + admin-URL move — a separate, separately-flagged operation, not this page. |
| Platform-mode gating | **Invisible and inert on k8s / PaaS.** Reuse the existing signal | User: *"if you are running on k8s / platform mode then this wouldn't be applicable — that's why the other ssl settings had feature flags."* Reuse the `shouldNginxHandleSsl()` = `!PLATFORM_MODE && !isExternalSslProxy()` gate + a client feature flag like `ENABLE_WILDCARD_SSL`. |
| Cert-change safety | **Snapshot + issue-then-swap + one-click rollback** | Never tear down the working cert first. |
| Serving-model-change safety | **Provisional apply + auto-revert timer** (only on reachability-affecting changes) | User's explicit choice. Rollback can't help if the change severs the admin's own connection before they can click it, so reachability changes apply provisionally and auto-revert unless re-confirmed. |
| Backend restart on apply | **No `process.exit` bounce** day-2 | Bootstrap's apply self-exits because it changes the box's identity. Day-2 the identity (domain, `COOKIE_DOMAIN`) is unchanged, so a nginx re-render + reload is sufficient and far less disruptive. |

## Background — current state (branch `specs/do-one-click-and-web-bootstrap`)

- **Primary cert on disk:** `/etc/nginx/ssl/fullchain.pem` + `privkey.pem`, plus `wildcard.<domain>.crt/.key` copies. `render-main-conf.sh` reads `instance.env` (`SSL_MODE`, `PROXY_MODE`, `PORT80_ACTION`, `REALIP_*`) to emit the primary/subdomain vhosts.
- **`instance.json` v2** records `sslMode` (`cloudflare`-paste / `paste` / `letsencrypt` / `selfsigned`), `proxyMode` (`cloudflare`/`proxy`/`none`), `port80`, `realIp`, `state`.
- **Reload path:** the nginx reload-watcher watches `ssl/` and the rendered-config dirs; a cert write or an `instance.env` re-render triggers a debounced reload. No backend restart needed for cert/serving changes.
- **Reusable services (currently bootstrap-only):**
  - `bootstrap-setup.service.ts` — `validateCertificatePair` (PEM parse, `cert.checkPrivateKey` RSA+ECDSA, expiry both directions, SAN coverage), `assertStagedCertificateCovers`, `saveCertificates`, `writeInstanceConfig`.
  - `ssl-certificate.service.ts` — `requestPrimaryDomainCertificate` (HTTP-01 apex+www+admin), `savePrimaryCertificate` (private).
  - `bootstrap-dns-preflight.service.ts` — DNS + port-80 + webroot self-probe (fresh-token, fail-closed).
- **Platform-mode signals:** `isPlatformMode()` (`PLATFORM_MODE==='true'`), `isExternalSslProxy()`, `shouldNginxHandleSsl()` (`nginx-config.service.ts:794-832`); `setup.service.ts:240` also honours `SSL_MANAGED_EXTERNALLY`.

## Architecture

### Component map

```
Admin UI: /settings/ssl  (new dedicated page, feature-flag + platform gated)
  ├─ CurrentSslStatus        (reads instance.json + cert info: mode, expiry, wildcard coverage)
  ├─ ServingModelEditor      (reuses wizard domain-ssl/ components, prefilled from instance.json)
  │     └─ ServingChoicePhase · ProxyOptions · CertificatePhase
  │         └─ LetsEncryptForm · PasteCertificateForm · SelfSignedConfirm
  │     (DomainDnsPhase's domain field is shown READ-ONLY — domain is fixed day-2 —
  │      but its DNS-guidance + preflight step is retained for the Let's Encrypt path)
  ├─ ApplyPanel              (change classification → cert-swap vs provisional serving change)
  └─ RollbackPanel           ("Restore previous SSL configuration" + pending auto-revert countdown)
         │  RTK Query (domainsApi / new sslAdminApi)
         ▼
Backend: SslAdminController  (@Roles admin; hard-refuses in platform/external-SSL mode)
  ├─ GET  /api/settings/ssl/status          current instance.json + parsed cert info
  ├─ POST /api/settings/ssl/preflight       DNS/port-80 self-probe (reuses preflight service)
  ├─ POST /api/settings/ssl/certificate     validate + stage a pasted cert (reuses validateCertificatePair)
  ├─ POST /api/settings/ssl/letsencrypt     issue-then-swap via requestPrimaryDomainCertificate
  ├─ POST /api/settings/ssl/apply           write instance.json + re-render + reload (NO process.exit)
  ├─ POST /api/settings/ssl/confirm         cancel the pending auto-revert (reachability changes)
  └─ POST /api/settings/ssl/rollback        restore the snapshot (config + certs) + re-render
         │
         ▼
Day2SslService  (new; orchestrates snapshot → apply → revert, wraps the bootstrap services)
  └─ SslSnapshotStore     (snapshot instance.json + cert files; pending-serving-revert.json + deadline)
```

### Change classification (the safety fork)

On apply, the requested change is diffed against the current `instance.json` + cert:

1. **Cert-only change** — `sslMode`/cert bytes change, but `proxyMode` + `port80` + `realIp` are unchanged (i.e. reachability is unaffected). → **issue-then-swap + rollback**, no timer.
2. **Serving-model change** — any of `proxyMode` / `port80` / `realIp` changes (reachability *may* change). → **provisional apply + auto-revert timer**, regardless of whether the cert also changed.

### Cert-only flow (issue-then-swap)

- **Paste:** `validateCertificatePair` (pair match, SAN covers apex/www/admin/wildcard, not expired) **before** touching the live cert. On pass, snapshot the current cert files, write the new cert, reload. On any failure, nothing is swapped.
- **Let's Encrypt:** run `preflight` first (DNS points here + port-80 reachable + webroot writable). Only on a green preflight call `requestPrimaryDomainCertificate`; only on validated issuance snapshot + swap. The **old cert keeps serving** through the whole attempt — a failed issuance never leaves the box cert-less.
- **Rollback:** `POST /rollback` restores the snapshotted cert files (and instance.json if it changed) and re-renders. Available until the admin makes another change (snapshot is single-depth: "previous").

### Serving-model flow (provisional + auto-revert)

1. Snapshot current `instance.json` + cert files.
2. Write a **durable** `bootstrap/pending-serving-revert.json`: `{ snapshotRef, deadline, appliedAt }`. Durable so an unexpected crash/restart during the window still reverts.
3. Apply the new `instance.json`, re-render, reload.
4. The admin's browser must **re-establish a connection** (possibly new scheme/port) and `POST /confirm` within **N minutes (default 5, configurable via env, e.g. `SSL_SERVING_CONFIRM_TIMEOUT`)**.
5. A backend interval (runs every ~15s) checks `pending-serving-revert.json`: if `now > deadline` and unconfirmed → restore the snapshot (instance.json + certs), re-render, reload, delete the pending file. On `POST /confirm` → delete the pending file (change committed).
6. The UI shows a live countdown + a prominent "Keep these changes" button (netplan-`try` / "keep display settings?" pattern). If the admin lost connectivity, doing nothing restores the working config automatically.

### Platform / external-SSL gating (hard requirement)

- **Frontend:** the page and its nav entry render only when a new client-exposed flag (default `true`, e.g. `ENABLE_PRIMARY_SSL_MANAGEMENT`) is enabled *and* the box isn't external-SSL. Mirrors how `SslSettings`/`SslTab` already self-hide on PaaS.
- **Backend:** every `SslAdminController` route guards `if (isPlatformMode() || SSL_MANAGED_EXTERNALLY) throw ForbiddenException`. The gate lives server-side so a client flag flip can't reach the endpoints on a Traefik-edge deployment.

## Error handling

- **Paste invalid** (bad pair / SAN gap / expired) → 422 with the specific reason; live cert untouched.
- **LE preflight red** → 422 with which check failed (DNS/port-80/webroot); no issuance attempted.
- **LE issuance fails after green preflight** → 502-ish error; old cert still serving; nothing swapped.
- **Apply write fails** (disk/perms) → error; because instance.json is written and *then* rendered, a failed render leaves the previous rendered config in place; rollback still available from the snapshot.
- **Auto-revert restore itself fails** → logged loudly; SSH `reset-setup.sh` is the documented last resort (unchanged).
- **Concurrent changes** → single-depth snapshot; a second apply while a pending-serving-revert is unconfirmed is rejected until the first is confirmed or reverted.

## Testing

**Backend**
- Every `SslAdminController` route: rejects unauthenticated / non-admin; **refuses with 403 when `PLATFORM_MODE`/`SSL_MANAGED_EXTERNALLY`**.
- Cert-only: paste-invalid rejected without swapping; paste-valid swaps + snapshot captured; LE failure leaves old cert serving; rollback restores prior cert bytes.
- Serving-model: apply writes `pending-serving-revert.json` with a deadline; `confirm` deletes it (committed); the interval reverts on timeout (snapshot restored, file deleted); durable file survives a simulated restart and still reverts.
- Change classification: cert-only vs serving-model diff picks the right safety path.

**Frontend**
- Page + nav hidden when the flag is off / external-SSL; visible + prefilled from `instance.json` otherwise.
- Countdown + "Keep these changes" for serving-model changes; rollback button for cert changes.
- Reuse existing `domain-ssl/` component tests; add day-2-prefill cases.

**Also fix the misleading copy** that motivated this (so it's true once shipped): `PasteCertificateForm.tsx` wildcard warning and the wildcard/paste expiry-reminder email now correctly point at the new **Settings → SSL** page.

## Out of scope / deferred

- Changing the **primary domain** itself (COOKIE_DOMAIN + restart + admin-URL move) — separate flagged operation.
- Per-custom-domain cert paste/LE (the existing DNS-01 wildcard tab stays as-is).
- Multi-depth snapshot history (single "previous" is enough).
- Umbrel / `cloudflare-tunnel` (`sslMode:'external'`) — remains reserved/unselectable.
- DNS-provider API auto-renew for wildcards (unchanged; existing reminder-only).

## Resolved decisions (reviewer, 2026-07-23)

- **Feature flag:** new dedicated **`ENABLE_PRIMARY_SSL_MANAGEMENT`**, `exposeToClient: true`, default `true`. Backend endpoints additionally hard-refuse on `PLATFORM_MODE`/`SSL_MANAGED_EXTERNALLY` regardless of the flag.
- **Auto-revert window:** default **5 minutes** (env-overridable via `SSL_SERVING_CONFIRM_TIMEOUT`).
- **Lands in PR #508** (same branch `specs/do-one-click-and-web-bootstrap`), not a stacked follow-up.
