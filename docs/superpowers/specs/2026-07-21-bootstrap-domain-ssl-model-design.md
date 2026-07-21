# Bootstrap Wizard — Full Domain/SSL Model — Design Spec

**Date:** 2026-07-21
**Status:** Draft for review
**Scope:** `repos/ce` only (frontend wizard, setup endpoints, `instance.json`, nginx render script, ACME service, renewal cron)
**Issue:** bffless/ce#509 (blocks PR #508)
**Builds on:** `2026-07-20-web-bootstrap-setup-design.md` — this spec designs the primary-domain ACME method that spec deferred, and generalizes its Cloudflare-only Domain & SSL step.

## Goal

The bootstrap wizard's Domain & SSL step currently serves one point in the design space: "behind Cloudflare, paste an Origin Certificate" — and the proxy choice (`cloudflare` | `none`) is asked at the very end, on the Apply step, after the cert is already installed. A non-Cloudflare user is told to paste a Cloudflare Origin Cert, which is useless for a direct A-record setup.

This design moves the **"how does traffic reach this server?"** choice to the front of the Domain & SSL step and makes everything downstream adapt to it: cert step, DNS guidance, `proxyMode`, port-80 behavior, and real-IP configuration. Four paths are supported (issue #509's matrix):

| Path | TLS terminated by | Cert | Port 80 | Real-IP | DNS |
|---|---|---|---|---|---|
| Cloudflare (today's flow) | Cloudflare | paste CF Origin Cert | closed (444) | CF ranges (built-in) | proxied A `@`/`*` |
| Other CDN/WAF | that CDN | paste its origin cert | redirect (toggleable to closed) | optional user-pasted ranges | per-CDN |
| Direct + Let's Encrypt | droplet | auto-issued (HTTP-01) | open (redirect + ACME) | none | direct A `@`/`*` |
| Direct + own cert | droplet | paste browser-trusted cert | open (redirect) | none | direct A `@`/`*` |

## Key decisions (made during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Choice shape | **3-way + conditional**: "How does traffic reach this server?" → Cloudflare / another CDN or WAF / directly; "directly" reveals a cert sub-choice (Let's Encrypt auto-issue, recommended, vs bring-your-own paste) | Mirrors how users think ("I'm behind Cloudflare") while keeping issue #509's two axes clean underneath; the matrix doesn't fill evenly (both proxy paths are origin-cert paste) |
| Wizard IA | **Sub-steps inside the single "Domain & SSL" slot**: (1) serving choice → (2) domain + DNS (with live preflight on the LE path) → (3) certificate. The `proxyMode` radio is removed from Apply | Progress bar stays stable across all four paths; the LE path's hard ordering (DNS verified *before* issuance) gets a real sequence instead of one static screen |
| Config model | **Knobs + preset label** (`instance.json` v2): explicit `port80`, `realIp`, `sslMode` knobs plus `proxyMode` kept as a preset label. The nginx render script branches **only on knobs**, never on vendor names | Adding a CDN preset later is a new label + knob values with zero render-script changes; `proxyMode` back-compat preserves the existing `nginx-config.service` predicates and v1 files |
| Real-IP for generic CDN | **Optional paste, default off**: collapsed "Restore visitor IPs" section (CIDR-per-line textarea + header field defaulting to `X-Forwarded-For`); empty ⇒ `realIp: null` | No vendor IP lists to maintain beyond Cloudflare's; skipping degrades only logs/rate-limit granularity, which the copy states; a wrong trust list is worse than none |
| LE wildcard | **Offer in-wizard DNS-01 wildcard** as an optional sub-step after the HTTP-01 fixed-SAN cert (show TXT records, poll DNS, complete). Skippable; skipping means preview subdomains show cert warnings (stated in-line) | Fills the preview-subdomain coverage gap on day 1. The ~90-day manual-renewal reality is stated up front and mitigated by the renewal decision below |
| LE wildcard renewal cliff | **Banner + email reminder**: the daily renewal cron, on detecting an expiring wildcard it cannot auto-renew (DNS-01, no DNS API), raises the existing wildcard-SSL admin banner *and* emails the admin via the wizard-collected SMTP config, linking to the existing Settings → SSL DNS-01 flow | Manual, but never a surprise. DNS-provider API integration (true auto-renew) remains explicitly deferred |
| LE preflight | **Hard gate + self-probe**: "Issue certificate" stays disabled until (a) apex/www/admin A records resolve to the server's detected public IP and (b) an end-to-end self-probe passes — backend writes a token into the ACME webroot and fetches `http://<domain>/.well-known/acme-challenge/<token>` over the public internet. Auto-repoll while propagating | Proves DNS + port 80 + nginx routing exactly as the LE validator will see them; burns zero LE rate limit (5 failed validations/hostname/hour would otherwise lock users out) |
| Issuance orchestration | **Synchronous endpoints** (no job queue): issuance completes in seconds over HTTP-01; generous client timeout + idempotent retry | Matches the existing custom-domain and two-phase wildcard patterns; no background-job infrastructure exists to lean on |
| Scope | Wizard + setup endpoints + `instance.json` + render script + **renewal-cron/banner/email wiring**. Out: MOTD/getting-started copy, `setup.sh` SSH-wizard parity, day-2 SSL panel copy rework (the banner/email links to the existing flow as-is) | Renewal wiring is inseparable from shipping LE at all — without it, wizard-issued certs die at day 90. Everything else can follow #508's merge |
| `cloudflare-tunnel` | **Reserved, never selectable.** v2 schema documents `proxyMode: 'cloudflare-tunnel'` and `sslMode: 'external'` as reserved values; the wizard never emits them; apply rejects them with a clear "not yet supported in the web wizard" error | The value already exists in `feature-flags.definitions.ts` and `nginx-config.service.isExternalSslProxy()`; the deferred Umbrel profile picks it up without a schema bump. Env-configured tunnel installs (no `instance.json`) are untouched |

## Background — current state (explored 2026-07-21, branch `specs/do-one-click-and-web-bootstrap`)

**What actually varies by `proxyMode` today** is small and centralized in `docker/nginx/render-main-conf.sh`:

- `cloudflare` branch: `PORT80_ACTION="return 444;"`; writes Cloudflare's IP ranges + `real_ip_header CF-Connecting-IP` into `/etc/nginx/cloudflare-realip.conf`; wildcard vhost falls back to `fullchain.pem`/`privkey.pem` (Origin Certs carry the `*.domain` SAN).
- `none` branch: `PORT80_ACTION="return 301 …"`; empty realip placeholder; **hard-requires** separate `wildcard.<domain>.crt/.key` files.
- Everything else (admin/API/public server blocks) is identical. `nginx.conf` includes `/etc/nginx/cloudflare-realip.conf` unconditionally as the generic realip hook.

**Where the enum lives:** `ApplyBootstrapDto.proxyMode` `@IsIn(['cloudflare','none'])` (`setup.dto.ts`), `InstanceConfig` (`bootstrap/instance-config.ts`, with `sslMode: 'paste'|'letsencrypt'` already in the type but `letsencrypt` never written), the render script's vendor branch, the `ApplyStep.tsx` radio, and the `nginx-config.service.ts` predicates (`isCloudflareOriginCertMode()`, `isExternalSslProxy()`).

**ACME facts that constrain the LE path:**

1. HTTP-01 cannot issue wildcards. The existing wildcard flow (`startWildcardCertificateRequest` / `completeWildcardCertificateRequest` in `ssl-certificate.service.ts`) is user-driven DNS-01 (manual TXT records), and wildcard auto-renewal is explicitly unimplemented (`renewWildcardCertificate()` returns "requires DNS API integration").
2. The legacy SSH path (`setup.sh` certbot) already lives with fixed SANs (apex, `www`, `admin`, `minio`) and no wildcard — preview subdomains get warnings on that path today.
3. In normal (`none`) mode, port 80 301-redirects **everything** — `main.conf.template` has no ACME-challenge location, so even renewal of an LE cert would break post-apply. This gap gets fixed here regardless of path.
4. Custom-domain HTTP-01 issuance works end-to-end (webroot `/var/www/certbot`, challenges written by `writeHttpChallenge`, renewal via the daily 3 AM cron in `ssl-renewal.service.ts`) — but nothing issues the **primary** domain; that is the method the 2026-07-20 spec deferred and this spec designs.

**Cert paste validation today** (`bootstrap-setup.service.ts`): node-forge, **RSA-only** (ECDSA certs fail to parse), hard-requires both apex and `*.domain` SANs — which an LE HTTP-01 cert can never satisfy, so validation must become path-aware.

## Design

### 1. User-facing model

One up-front question in the Domain & SSL step: **"How does traffic reach this server?"** — three cards: **Through Cloudflare** (recommended) / **Through another CDN or WAF** / **Directly**. Picking "Directly" reveals the cert sub-choice: **Auto-issue with Let's Encrypt** (recommended) or **Paste my own certificate**. The four paths map onto config:

| Path | `proxyMode` | `sslMode` | `port80` | `realIp` |
|---|---|---|---|---|
| Cloudflare | `cloudflare` | `paste` | `closed` (fixed) | `{preset: "cloudflare"}` |
| Other CDN/WAF | `proxy` | `paste` | `redirect` default; advanced toggle → `closed` | `null` or `{header, ranges}` |
| Direct + Let's Encrypt | `none` | `letsencrypt` | `redirect` (locked — renewal needs it) | `null` |
| Direct + own cert | `none` | `paste` | `redirect` | `null` |

`cloudflare` vs `proxy` is preset-vs-exposed-knobs over the same rendering pipeline: a `proxy` user who pasted Cloudflare's exact ranges, set the header to `CF-Connecting-IP`, and closed port 80 would render a byte-identical nginx config. The label additionally buys: CF-specific copy and the Full (strict) hint, the hard wildcard-SAN requirement (below), CE-maintained CF ranges (updated in one place, the render script, rather than frozen into `instance.json`), and back-compat with existing `PROXY_MODE` consumers.

**Apply step changes:** the `proxyMode` radio is removed. Apply shows a read-only summary of the serving choice, keeps the DNS-confirmed checkbox (auto-satisfied on the LE path — preflight already *proved* DNS), and shows the "flip zone to Full (strict)" hint only on the Cloudflare path.

### 2. Wizard IA — Domain & SSL becomes a 3-phase sub-flow

One "Domain & SSL" slot in the progress bar (`SetupProgress` unchanged); internally three phases with back/next navigation:

**Phase 1 — Serving choice.** The 3 cards + direct sub-choice. Selection stored in the setup slice (it drives phases 2–3 and the Apply summary).

**Phase 2 — Domain + DNS**, adapted per path. Domain pre-fills from the Host header when the user arrived via their domain (the Cloudflare Full-mode trick), else empty with the server's detected public IP surfaced (existing `serverIpHint` machinery).

- *Cloudflare:* proxied A `@` + `*` records (orange cloud), zone SSL **Full** — today's copy, unchanged.
- *Other CDN:* vendor-neutral — "point your apex and wildcard at your CDN per its docs; set this server's IP (`<ip>`) as the origin."
- *Direct (both):* plain A `@` + `*` records to the shown IP; "if your DNS host proxies traffic (e.g. Cloudflare), disable it (gray cloud) for these records."
- *Direct + LE only:* this phase is the **hard preflight gate**. Live per-record check (apex/`www`/`admin` resolve to the server's public IP) plus the end-to-end self-probe (backend writes a token into the ACME webroot, then fetches `http://<domain>/.well-known/acme-challenge/<token>` out through the public internet — proving DNS + port 80 + nginx routing exactly as the LE validator will see them). Auto-repoll every ~30 s with a "still propagating" state; **Next is disabled until green**. Rationale: LE rate-limits failed validations (5/hostname/hour); this gate burns zero rate limit until success is near-certain, and a soft "issue anyway" override would realistically end in an hour-long lockout with no way forward.

**Phase 3 — Certificate**, adapted:

- *Cloudflare:* Origin Certificate paste — current copy and behavior preserved.
- *Other CDN:* the same paste UI with vendor-neutral copy ("your CDN's **origin certificate** — issued from its dashboard for `<domain>` and ideally `*.<domain>`"), plus a collapsed optional **"Restore visitor IPs"** section: CIDR-per-line textarea + trusted-header field (default `X-Forwarded-For`). Empty ⇒ `realIp: null`; copy states logs will show the CDN's IPs and this is fixable later. Also the advanced **"close port 80"** toggle ("my CDN connects to the origin over HTTPS only").
- *Direct + LE:* an **"Issue certificate"** action (enabled by the phase-2 gate) issuing apex + `www` + `admin` via HTTP-01, with inline progress and error surface. On success, an **optional wildcard sub-step**: show the `_acme-challenge.<domain>` TXT record value(s), poll DNS, complete DNS-01 issuance. Skippable ("Skip — previews will show a certificate warning"); the ~90-day manual-renewal reality is stated in-line ("we'll warn you in the admin panel and by email before it expires").
- *Direct + BYO:* fullchain + private key paste, vendor-neutral copy ("a browser-trusted certificate from any CA, covering `<domain>` — include `*.<domain>` if you can").

### 3. Config model — `instance.json` v2 (knobs + preset label)

```json
{
  "version": 2,
  "state": "applied",
  "primaryDomain": "example.com",
  "proxyMode": "cloudflare" | "proxy" | "none",
  "sslMode": "paste" | "letsencrypt",
  "port80": "closed" | "redirect",
  "realIp": null
           | { "preset": "cloudflare" }
           | { "header": "X-Forwarded-For", "ranges": ["151.101.0.0/16", "…"] }
}
```

- `realIp.preset: "cloudflare"` means "the render script's maintained built-in CF list" — one place to update when Cloudflare's ranges change. A custom `{header, ranges}` emits generated `set_real_ip_from` lines + `real_ip_header`.
- **Shell bridge:** `instance.env` gains `PORT80`, `REALIP_MODE` (`cloudflare` | `custom` | `off`), `REALIP_HEADER`, `REALIP_RANGES` (space-separated). All values are validated server-side before write (CIDR syntax per range; header must be a valid HTTP token) — nothing user-controlled reaches the shell unvalidated, and the watcher's `nginx -t` gate remains the last line of defense.
- **v1 files read forward without migration:** `readInstanceConfig` derives missing knobs from `proxyMode` (`cloudflare` → `closed` + CF preset; `none` → `redirect` + `null`). Existing applied installs behave byte-identically. Legacy env-only installs (no `instance.json`) are untouched.
- **Combo validation at apply (server-side):** `letsencrypt` requires `proxyMode: none` and `port80: redirect`; custom `realIp` only with `proxy`; `{preset: cloudflare}` only with `cloudflare`; `port80: closed` requires a proxy in front (`proxyMode: cloudflare | proxy`). Omitted knobs default from the `proxyMode` preset (the same derivation used for v1 forward-reads). A hand-crafted apply cannot produce e.g. a closed-port-80 LE install that dies at first renewal.
- **Reserved — `cloudflare-tunnel`:** the schema documents `proxyMode: "cloudflare-tunnel"` and `sslMode: "external"` as reserved values for the deferred Umbrel/tunnel profile (no certs on box, nginx listens plain HTTP for the local `cloudflared`, real-IP from the tunnel client via `CF-Connecting-IP`). The wizard never emits them; `ApplyBootstrapDto` rejects them with "Cloudflare Tunnel setup isn't supported in the web wizard yet." Existing env-configured tunnel behavior (`isExternalSslProxy()`) is unchanged.

**Render script (`render-main-conf.sh`):** the vendor-name branch is deleted; the script branches only on knobs:

- `PORT80=closed` → port-80 server block `return 444` (as today's CF branch).
- `PORT80=redirect` → port-80 block with an explicit `/.well-known/acme-challenge/` webroot location **plus** 301-redirect for everything else (fixing the pre-existing renewal gap).
- `REALIP_MODE=cloudflare` → the built-in CF block (ranges + `CF-Connecting-IP`); `custom` → generated `set_real_ip_from` lines from `REALIP_RANGES` + `real_ip_header $REALIP_HEADER`; `off` → empty placeholder.
- Wildcard-vhost cert selection becomes **file-driven**: use `wildcard.<domain>.crt/.key`, which every path now writes (see §4). The current CF fallback to `fullchain.pem` is kept for legacy installs whose `wildcard.*` files don't exist.

### 4. Backend surface

All new/changed endpoints follow the existing bootstrap contract: `assertBootstrapAllowed()` (bootstrap-active, `PLATFORM_MODE`/`SSL_MANAGED_EXTERNALLY` refused, feature-flag-gated) → claim-token validation (rate-limited) → work. All are **synchronous**.

- **`POST /api/setup/dns-preflight`** `{domain, token?}` → per-check results: for each of apex/`www`/`admin`, resolved A records vs the server's detected public IP; plus the webroot self-probe result. Lightly rate-limited (it's cheap but outbound-fetching).
- **`POST /api/setup/issue-certificate`** `{domain, token?}` → server re-runs the preflight cheaply (never trusts the client's claim that it passed), then calls the new **`SslCertificateService.requestPrimaryDomainCertificate(domain)`** — the method the 2026-07-20 spec deferred: one HTTP-01 order for `[apex, www.<domain>, admin.<domain>]`, challenges served through the existing webroot (bootstrap port-80 already serves it), cert saved as `fullchain.pem`/`privkey.pem` **and copied to `wildcard.<domain>.crt/.key`** so the render contract holds on every path. Returns the covered SANs. Idempotent: re-invocation while a valid staged cert exists re-uses it.
- **`POST /api/setup/wildcard/start`** and **`POST /api/setup/wildcard/complete`** `{domain, token?}` → thin bootstrap-scoped wrappers delegating to the existing `startWildcardCertificateRequest` / `completeWildcardCertificateRequest` (which are session-guarded in the domains controller and thus unreachable from the session-less wizard). On completion, the real wildcard cert replaces the copied `wildcard.*` files.
- **`POST /api/setup/certificates`** (paste) becomes **path-aware**: gains a `servingMode` field using the same values as `proxyMode` (`cloudflare` | `proxy` | `none`). SAN policy: apex always hard-required; `*.<domain>` hard-required **only** on the Cloudflare path (free there; the copy demands it); on `proxy`/`none` paths a missing wildcard SAN is a **warning** — the response reports `wildcardCovered: false`, the UI explains preview-subdomain degradation, and the user proceeds. Parsing moves from node-forge (RSA-only) to `node:crypto`'s `X509Certificate` so **ECDSA certs validate** — browser-trusted BYO certs (and modern LE-issued certs) are commonly EC and are rejected today.
- **`POST /api/setup/apply`** DTO extends to `{domain, proxyMode: 'cloudflare'|'proxy'|'none', sslMode: 'paste'|'letsencrypt', port80?, realIp?, token?}` with §3's combo validation. Writes `instance.json` v2. The existing staged-cert re-check (SANs must cover the applied domain) stays, relaxed per the same path-aware policy.

### 5. Renewal + day-2 obligations (in scope)

- `main.conf.template`'s port-80 redirect mode gains the explicit ACME-challenge location (§3) — prerequisite for **any** post-apply HTTP-01 activity, including the custom-domain renewals that exist today.
- The daily renewal cron (`ssl-renewal.service.ts`) registers the **primary domain** when `sslMode: "letsencrypt"` and renews it via `requestPrimaryDomainCertificate` at the existing 30-day threshold, re-copying to the `wildcard.*` files **unless** a real DNS-01 wildcard is installed (detected by SAN inspection of the wildcard files).
- For an installed LE DNS-01 wildcard (auto-renewal impossible): at threshold, the cron raises the existing wildcard-SSL admin banner (`ENABLE_WILDCARD_SSL_BANNER` machinery) **and sends an email** via the configured SMTP settings, linking to the existing Settings → SSL DNS-01 renewal flow. The wizard's wildcard sub-step promises exactly this. No SMTP configured → banner only (the wizard's email step encourages configuring it).

### 6. Security & error handling

- **Transport posture unchanged** from the accepted 2026-07-20 model: the CF path pastes over CF-Full-mode TLS end-to-end; direct paths run over the self-signed bootstrap cert at `https://<ip>` (accepted residual: unauthenticated first connect). The LE path **generates keys server-side — no private material is pasted at all**, making the recommended direct path also the safest one.
- New endpoints inherit claim-token gating + rate limiting; preflight/issue get their own modest limits. The preflight gate itself protects the ACME account from validation-failure lockouts.
- User-supplied `realIp` values are syntax-validated (CIDR, header token) before touching `instance.env`; the render output passes `nginx -t` before reload (existing watcher behavior), so a bad config never goes live.
- ACME errors surface in the wizard with the ACME problem detail plus a "what to check" hint (DNS TTL, firewall/UFW on port 80, provider load balancer). The preflight makes these rare.
- `PLATFORM_MODE` / `SSL_MANAGED_EXTERNALLY` continue to hard-disable every bootstrap endpoint server-side.

### 7. Testing

- **Unit:** combo-validation matrix (incl. reserved-value rejection); path-aware SAN policy incl. ECDSA fixtures; CIDR/header validation; v1→v2 knob derivation; preflight logic with mocked DNS/HTTP; renewal registration per `sslMode`; render-script knob branches (bats or golden-file, matching existing script tests if any).
- **E2E (Playwright):** all four wizard paths against the cert-less compose stack, with the ACME client pointed at **Pebble** (Let's Encrypt's test server, added as a compose test service) so the LE path — preflight, issuance, and the DNS-01 wildcard via Pebble's challenge test server — is exercised for real without staging rate limits. Legacy regression: a v1 `instance.json` install renders identically. Apply-step summary per path.
- **Manual droplet legs** (the #508 lesson: every functional bug lived in real HTTP/browser testing, not unit tests): one leg per path; a **restart-nginx-in-bootstrap-mode** leg (first-boot-clean masks a crash class); a renewal dry-run on the LE droplet; a `proxy`-path leg behind a real non-CF CDN if available (else curl-simulated headers).

## Out of scope

- MOTD / DO getting-started copy rework (still Cloudflare-first; follow-up).
- `setup.sh` SSH-wizard parity with the four-path model (it works today and is the fallback path).
- Day-2 Settings → SSL panel copy rework (the banner/email links to the existing flow as-is).
- DNS-provider API integration for wildcard auto-renewal (explicitly deferred, again).
- The Umbrel / `cloudflare-tunnel` wizard profile (reserved values only; own design later).
- Day-2 serving-mode change UI (same stance as the 2026-07-20 spec's day-2 domain change).

## Open items

- Whether `minio.<domain>` belongs in the LE fixed-SAN set (setup.sh's certbot includes it; the compose stack may or may not expose the MinIO console through nginx on this branch) — resolve during planning by checking the rendered vhosts.
- Pebble wiring details (challenge-test-server DNS mocking for the wildcard E2E leg) — feasibility check early in the plan; fall back to mocking the ACME client at the service boundary if Pebble's DNS-01 harness fights the compose network.
- Exact copy for the four DNS-guidance variants (draft during implementation; review with the same care as the existing CF copy).
