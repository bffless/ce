# Zero-SSH Web Setup ("Bootstrap Mode") — Design Spec

**Date:** 2026-07-20
**Status:** Draft for review
**Scope:** `repos/ce` (backend, frontend, nginx image, setup.sh), small `repos/platform` follow-up PR
**Sequencing:** Built **before** the DO 1-Click image (see `2026-07-20-do-one-click-image-design.md`); the image's SSH first-login flow becomes a fallback once this ships.

## Goal

A fresh CE install with no certs and no domain boots into **bootstrap mode**: services auto-start HTTP(S)-on-bare-IP, and the user completes *everything* in the browser — claim → admin account → domain → SSL (Cloudflare origin-cert paste or Let's Encrypt) → apply — ending authenticated on `https://admin.<domain>`. SSH is never required. This is generic CE behavior (any provider, Umbrel, home lab); the DO 1-Click rides on it.

## Key decisions (made during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Ambition | Zero-SSH onboarding; SSH wizard remains as fallback | The true 1-Click; DO web console covers the one secret hand-off |
| Claim model | **Claim token**, reusing the existing `ONBOARDING_TOKEN` mechanism; read by the user from the DO web console login banner (browser-based, no SSH keys). Claim requirement is **packaging-configurable**: required on publicly-reachable bootstraps (DO image), off on LAN-only ones (Umbrel) | A fresh droplet IP is port-scanned within minutes; first-visitor-wins is unacceptable on a bare IP. Platform already uses this exact mechanism. An Umbrel app is LAN-only until its Cloudflare Tunnel exists, so a token adds friction without threat |
| Wizard SSL paths | **Both**: Cloudflare origin-cert paste AND Let's Encrypt (existing in-app ACME service, HTTP-01 through the bootstrap server) | Cloudflare-first strategically, but LE keeps the wizard complete for non-CF users |
| Apply mechanism | **CE-native**: shared-volume `bootstrap/instance.json` + re-runnable nginx render triggered by the existing watcher + backend self-exit (Docker restart policy revives it with the new identity) | Works on ANY compose install, no host agent, no docker socket. Rejected: host systemd agent (DO-only), docker socket mount (root-equivalent container) |
| Sensitive paste transport | **Domain-first via Cloudflare "Full" mode.** Getting-started copy: add domain to Cloudflare → A records → set zone SSL to **Full** → open `https://admin.<domain>`. The bootstrap's self-signed cert on 443 is what Cloudflare's Full mode handshakes against — it is never shown to a human. The wizard's final step flips the zone to **Full (strict)** once the origin cert is installed. Bootstrap port 80 serves *only* the ACME challenge path and 301-redirects everything else to HTTPS; cert-upload and claim endpoints reject non-TLS (`X-Forwarded-Proto`). `https://<ip>` (browser warning) remains the fallback for the Let's Encrypt / non-Cloudflare path | Every leg is encrypted from the first byte — browser→CF with a real cert (zero interstitials), CF→origin against the self-signed cert — so the pasted private key and claim token never transit cleartext anywhere. Flexible mode still works (wizard warns; CF→origin cleartext is backbone-only, low risk); the flexible→strict dance has project precedent (bffless.app cutover). Arriving via the domain also lets the wizard auto-detect it from the Host header. LE keys are generated server-side and the Umbrel/tunnel profile has no cert material |
| Platform guard | `PLATFORM_MODE=true` (already set by the workspace chart) hard-disables bootstrap, cert upload, and apply — server-side | Explicit, existing signal; not inferred from flag combinations |

## Background — what exists vs. missing (explored 2026-07-20)

**Exists, reusable:**

- DB-backed setup wizard: admin → storage → cache → email → complete; `systemConfig.isSetupComplete` gating (`apps/backend/src/setup/setup.service.ts`, frontend `components/setup/`). Setup endpoints are public until claimed (`initialize` 409s once an admin exists).
- `ONBOARDING_TOKEN` (`SetupService.validateOnboardingToken`) — built for Platform; the Platform relay is `https://admin.<ws>.<domain>/setup?token=<TOKEN>` (documented in `deployment-docs/src/pages/tutorial/console-workspace.mdx`), token stored in the workspace k8s secret.
- Nginx hot-reload: backend writes to shared `sites-enabled/` + `ssl/` volumes; inotify watcher sidecar (`docker/nginx/nginx-reload-watcher.sh`) validates (`nginx -t`) and reloads. Per-domain Handlebars templates already model HTTP-only operation.
- ACME service (`domains/ssl-certificate.service.ts`, 1154 lines): wildcard DNS-01 + custom-domain HTTP-01, renewal cron, `acme-webroot` volume.

**Missing (the feature):**

1. **Cert upload API + UI** — no endpoint or panel accepts caller-supplied PEM anywhere; the SSL panel only drives ACME.
2. **HTTP bootstrap boot** — `docker/nginx/docker-entrypoint.sh` hard-exits when certs are missing; admin/wildcard server blocks (`sites-available/main.conf.template`) are HTTPS-only and rendered once at container start by `envsubst`.
3. **Runtime domain identity** — `PRIMARY_DOMAIN` / `FRONTEND_URL` / `COOKIE_DOMAIN` / `API_DOMAIN` are env-only; SuperTokens (`auth/supertokens.config.ts`) and CORS (`main.ts`) capture them once at boot. The backend has no way to restart anything (no docker socket — deliberately).

## Architecture

### 1. Bootstrap mode (boot path)

- **Nginx entrypoint change** (`docker/nginx/docker-entrypoint.sh`): when certs are absent AND no domain is configured, render a **bootstrap server block** instead of exiting. At container start the entrypoint mints a throwaway **self-signed cert** (one `openssl` command, no user involvement) — this resolves the "HTTPS before we have HTTPS" chicken-and-egg: the box serves encrypted 443 from first boot. Port 443 serves the admin SPA + `/api` proxy for **any** hostname/IP (so it answers both via the Cloudflare-proxied domain and via bare IP); port 80 serves *only* the ACME webroot location and 301-redirects everything else to HTTPS — the wizard (and any secret: cert paste, claim token) is unreachable over plain HTTP. In the recommended flow the self-signed cert is only ever presented to Cloudflare (Full mode); a human sees the browser warning only on the bare-IP/LE fallback path.
- **`main.conf` rendering becomes a re-runnable script** (invoked by the entrypoint at start and by the watcher on config change) rather than one-shot entrypoint inline code.
- **`setup.sh --bootstrap`** (new non-interactive mode): generate secrets, write `.env` with no domain, start services. Used by the DO image's first-boot script; usable by anyone.
- Bootstrap state lives in `bootstrap/instance.json` (shared volume): `{version, state: "unclaimed"|"claimed"|"applied", primaryDomain?, proxyMode?, sslMode?, platformIp?}`. Absent file + env-configured domain = normal (legacy) operation, completely unchanged.

### 2. Claim flow

- First boot generates the claim token (root-only file + login banner, so the DO **web console** displays it without SSH keys).
- Token semantics extend the existing `ONBOARDING_TOKEN`:
  - **Token supplied via `?token=` URL** (Platform relay): implicit claim, no manual screen — existing Platform UX byte-identical.
  - **No token in URL** (bare-IP bootstrap): wizard shows a claim screen; user enters the token.
  - Until an admin exists, **all** setup mutations require the token (today only `initialize` checks it); failed attempts are rate-limited; token is invalidated once the admin account is created.

### 3. Wizard (frontend)

Existing step framework gains two steps, shown only in bootstrap mode (driven by `GET /api/setup/status` reporting bootstrap state):

- **Claim** (see above).
- **Domain & SSL**: in the recommended domain-first flow the user *arrives via* `https://admin.<domain>` (having already added the domain to Cloudflare with SSL mode **Full** per the getting-started copy), so the wizard pre-fills the domain from the Host header and the DNS step is a confirmation, not instructions from scratch. Arriving via bare IP instead → domain entry + live DNS guidance (existing DNS-instruction machinery + detected public IP). Then method choice:
  - **Cloudflare** (recommended, default): paste Origin Certificate + Private Key textareas → backend validates before accepting (key↔cert match, SAN covers apex + wildcard, expiry sanity). After apply, the final step instructs flipping the zone to **Full (strict)** and verifies the origin's 443 serves the new cert (wizard warns, without blocking, if the zone appears to still be on Flexible — detectable from `CF-Visitor`/`X-Forwarded-Proto` on incoming requests).
  - **Let's Encrypt**: uses the existing ACME service via HTTP-01 through the bootstrap server (port 80 open by definition). Wizard explains DNS must point at the server ("gray cloud" during issuance if the user is also on Cloudflare DNS); issued cert registers with the existing renewal cron.
  - **Cloudflare Tunnel** (Umbrel profile, §5): domain + tunnel-routing instructions, no certs.
- Then existing steps (storage → cache → email) and **Apply & Finish**.

New backend surface: `POST /api/setup/certificates` (accept + validate + store PEM to the `ssl/` volume: `fullchain.pem`/`privkey.pem` + wildcard copies) and `POST /api/setup/apply` (write `instance.json`, schedule self-exit). Both: bootstrap-state-gated, token/session-gated, and hard-disabled in `PLATFORM_MODE`.

### 4. Apply

1. Backend validates + writes certs and `instance.json` (`state: "applied"`, domain, proxy mode).
2. Watcher (extended to watch `bootstrap/` + `ssl/`) re-renders `main.conf` via the render script → `nginx -t` → reload. **Nginx never restarts.**
3. Backend responds to the wizard, flushes, then `process.exit(0)`; `restart: unless-stopped` revives it. At boot, domain identity resolves **`instance.json` → env fallback**; derived values (`FRONTEND_URL`, `COOKIE_DOMAIN`, `API_DOMAIN`, `COOKIE_SECURE`) computed exactly as `setup.sh` derives them today. SuperTokens/CORS/cookies re-init with the new identity.
4. Wizard shows "Switching to `https://admin.<domain>`…", polls health there, redirects. Remaining wizard state is in the DB, so the session continues (user logs in with the admin account just created).
- `.env` stays authoritative for infra secrets (Postgres/MinIO/Redis passwords, encryption keys). Domain values in `.env` become the fallback layer. `status.sh` (DO-image spec) reads `instance.json` when present.
- The SSH wizard (`setup.sh` interactive) is unchanged and keeps writing `.env`; env-fallback keeps that path working.

### 5. Umbrel alignment (third bootstrap profile)

Umbrel today is the crudest version of this exact design: both umbrel entrypoints (`umbrel/umbrel-entrypoint.sh`, `docker/nginx-umbrel-entrypoint.sh`) read `/app/config/domain.txt` at container start and derive `PRIMARY_DOMAIN` / `FRONTEND_URL` / `COOKIE_DOMAIN` / `COOKIE_SECURE` from it; unconfigured installs serve a static `umbrel/setup/domain-not-configured.html` catch-all instructing the user to **SSH in, write `domain.txt`, and restart the app**. Bootstrap mode eliminates both manual steps:

- **Profile**: `proxyMode: "cloudflare-tunnel"`, no certs on the box (the tunnel terminates TLS; no open ports). The wizard's Domain & SSL step becomes a **domain + Cloudflare Tunnel instructions** variant (route `<domain>`, `admin.<domain>`, and the wildcard to the app's internal address) — no cert paste, no ACME.
- **Entry point**: the user opens the app from the Umbrel dashboard (`http://umbrel.local:5537`, via `DEVICE_DOMAIN_NAME`); the nginx catch-all serves the bootstrap wizard instead of the static instructions page (the static page is retired).
- **Claim**: skipped (`claim: off` in the umbrel packaging) — the app is LAN-only until the tunnel exists, and creating the tunnel is itself the user's authenticated act. `COOKIE_SECURE=false` pre-domain is acceptable on LAN.
- **Transport**: the Umbrel wizard runs over plain HTTP on the LAN (`umbrel.local:5537`) — this is the deliberate exception to the HTTPS-only bootstrap rule, and it is safe because this profile transports no secrets (no cert paste, no claim token) and LAN HTTP is Umbrel's own platform convention (its dashboard works the same way).
- **Apply**: identical mechanism — backend writes `instance.json` into the already-mounted `/app/config/` (and keeps writing `domain.txt` for back-compat with existing installs), self-exits (exit code chosen to satisfy Umbrel's compose restart policy — verify during implementation), and the umbrel-nginx inline watcher gets the same extension as the compose watcher: watch the config file, re-render, reload. No manual app restart.
- **Convergence payoff**: the backend's native `instance.json` → env precedence supersedes the umbrel wrapper's env derivation, which shrinks to a fallback for pre-existing `domain.txt` installs. Secrets remain APP_SEED-derived (untouched).

### 6. Platform / k8s behavior (must be inert)

- **Guard**: `PLATFORM_MODE=true` (already set by `charts/workspace/templates/deployment-workspace.yaml`) server-side-disables bootstrap mode, `POST /api/setup/certificates`, and `POST /api/setup/apply` (403), and hides the Domain & SSL step + cert panel. Belt-and-braces: `SSL_MANAGED_EXTERNALLY=true` also disables cert upload/apply for non-Platform users running behind their own TLS terminator.
- **Nginx**: k8s workspace pods run stock `nginx:alpine` with a read-only ConfigMap (`configmap-nginx.yaml`) and a busybox md5sum/`kill -HUP` reloader — **not** the CE `docker/nginx` image. The entrypoint/render-script changes are structurally compose-only. (Implementation still includes a verify step against a workspace pod.)
- **`instance.json`**: workspace pods mount no bootstrap volume → file absent → env precedence, zero chart changes.
- **Claim token**: the `?token=` relay is preserved as implicit claim (§2); control-plane automation unaffected (rate limiting hits failed attempts only). Extending token coverage to all pre-admin setup mutations *hardens* Platform too.
- **New feature flag** (e.g. `FEATURE_BOOTSTRAP_SETUP`): default on in CE compose, set **off** in the workspace chart's `configmap-features.yaml` — same pattern as `sslToggle: false`.
- **`repos/platform` follow-up PR**: the flag default in `values.yaml`/`configmap-features.yaml` + a note in `platform/docs/auth-architecture.md` about claim semantics.

### 7. DO 1-Click image deltas (applied to the other spec)

- First-boot per-instance script additionally runs `setup.sh --bootstrap` + `start.sh` → services live before any login.
- Marketplace getting-started copy centers the domain-first flow: add domain to Cloudflare → A records (`@`, `*`) → SSL mode **Full** → open `https://admin.<domain>` → enter the claim token. MOTD/login banner (readable via DO web console) shows the claim token plus both URLs — the domain form and the `https://<ip>` fallback (browser warning expected) for non-Cloudflare/LE users.
- SSH first-login hook remains but demotes to fallback: if unclaimed, it prints the wizard URL + token and offers "press Enter to set up in the terminal instead".

## Security summary

- Claim token gates every setup mutation pre-admin; rate-limited; invalidated on claim; never baked into the image (generated at first boot).
- HTTPS-only bootstrap wizard: in the recommended domain-first flow (Cloudflare **Full** mode against the auto-generated self-signed cert), every leg is encrypted from the first byte and no human ever sees a certificate warning; pasted private keys and the claim token never transit cleartext. Port 80 exists solely for ACME challenges + redirect; cert-upload and claim endpoints reject non-TLS (`X-Forwarded-Proto`) as defense in depth. Residual, accepted risks: on the bare-IP/LE fallback, self-signed TLS is unauthenticated on first connect (active on-path attacker); if a user is on Flexible instead of Full, the CF→origin leg is cleartext until apply (backbone-only exposure, wizard warns) — passive interception near the user, the realistic threat, is defeated in all flows.
- Cert uploads validated server-side (key↔cert match, SAN coverage, parseable PEM) before touching disk; files written with the same permissions `setup.sh` uses (644 cert / 600 key).
- `PLATFORM_MODE` / `SSL_MANAGED_EXTERNALLY` guards are in controllers/services, not just UI.
- No docker socket, no host agent, no new privileges anywhere.

## Testing

**No DigitalOcean marketplace dependency.** This feature is validated entirely without a published (or even built) 1-Click image: layer 1 below runs locally/CI against a cert-less compose stack; layer 2 (manual) uses a plain droplet where `setup.sh --bootstrap && ./start.sh` is run by hand — exactly what the image's first-boot script will later automate — with a spare test domain on Cloudflare for the real Full → paste → Full (strict) flow. The DO image itself is later testable privately too (Packer snapshots in our own account launch droplets directly); Vendor Portal submission is purely a distribution step at the end.

- **Unit**: identity precedence (`instance.json` → env), cert/key validation matrix, token gating incl. rate limit + invalidation, `PLATFORM_MODE` 403s.
- **E2E (Playwright)**: full bootstrap wizard against a cert-less compose stack (self-signed + fixture certs); legacy regression (env-configured install with no `instance.json` behaves byte-identically); Platform-relay simulation (`/setup?token=` skips the claim screen).
- **Manual**: real droplet — both SSL paths, console-token flow, post-apply redirect, backend identity after self-restart, SSH-fallback path; one k8s workspace pod sanity check; Umbrel device run — wizard from `umbrel.local:5537`, tunnel profile end-to-end, and a legacy `domain.txt` install upgrading cleanly.

**Recovery (final review, Important-2):** Apply is one-way — a typo'd domain or DNS that isn't
pointed at the box yet leaves it reachable only at an identity you can't reach. The escape hatch
is SSH (still not required for the happy path): `rm -rf bootstrap/instance.json
bootstrap/instance.env && docker compose restart backend nginx` drops the applied identity and
re-enters bootstrap mode (the self-signed marker in `ssl/` from the original first boot is never
deleted, so `wasEverBootstrapProvisioned()`/`have_bootstrap_marker` still hold). Documented
prominently in the README's bootstrap subsection.

## Out of scope

- **Day-2 domain change via UI** — the apply mechanism technically enables it, but v1 targets initial bootstrap only; changing an established instance's domain stays documented-manual (data/cookie/cert implications deserve their own design).
- **Cert replacement UI for established installs** (day-2 origin-cert renewal in admin settings) — natural follow-up reusing `POST /api/setup/certificates` plumbing, but not in v1.
- Cloudflare API integration (auto-creating DNS records / origin certs via CF token) — attractive future step, explicitly not now.
- Any change to the k8s workspace chart's nginx ConfigMap or Traefik path.

## Open items

- Exact `instance.json` schema versioning + where the shared `bootstrap/` volume mounts in `docker-compose.yml`.
- Whether `GET /api/setup/status` needs a bootstrap-specific unauthenticated shape review (it's public today; it will additionally reveal "bootstrap mode, unclaimed" — acceptable, but confirm nothing sensitive rides along).
