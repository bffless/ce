# Legacy Install Adoption & `.env` Re-Sync — Design

**Date:** 2026-07-24
**Status:** Approved design, awaiting implementation plan
**Depends on:** the web-bootstrap feature (PR #508) and the domain/SSL model rework (`2026-07-21-bootstrap-domain-ssl-model-design.md`)
**Follow-up of:** the deferred "`setup.sh` parity" item in the 2026-07-21 spec (§Out of scope)

## Problem

The web-bootstrap wizard and the legacy interactive `./setup.sh` produce different
state:

| Resource | Legacy `./setup.sh` | `--bootstrap` + web wizard |
| --- | --- | --- |
| Identity (`PRIMARY_DOMAIN`, `FRONTEND_URL`, `COOKIE_*`, `PROXY_MODE`) | written into `.env` | `.env` left blank; lives in `bootstrap/instance.json` |
| `bootstrap/instance.json` / `instance.env` | never created | created (v2, with knobs) |
| SSL certs | host `certbot --standalone` (LE) or hand-pasted CF origin certs in `ssl/` | issued/pasted in-app via cert staging |
| LE renewal | **broken by default**: one-time copy into `ssl/`, no deploy-hook; certbot's timer can't re-bind port 80 | in-app `ssl-renewal.service` cron |
| Paste-cert expiry reminders | none (`loadInstanceConfig()` returns null) | reminder emails |

Consequences of the divergence:

1. **Day-2 features silently skip legacy installs.** `ssl-renewal.service.ts`
   gates both primary-cert auto-renewal and paste-expiry reminders on
   `instance.json` having `state: 'applied'`. Legacy installs have no file, so
   they get neither — and their host-side certbot renewal is broken anyway
   (standalone authenticator can't bind port 80 while nginx holds it).
2. **Duplicate code paths.** `render-main-conf.sh` re-implements `deriveKnobs()`
   in sh solely because legacy installs lack `instance.env`;
   `should_bootstrap()` carries a bootstrap-marker special case solely to detect
   "genuine legacy install".
3. **Future identity features must be written twice** (`.env` for legacy,
   `instance.json` for wizard installs).

## Goal

Every non-localhost, self-hosted CE install converges on
`bootstrap/instance.json` + `bootstrap/instance.env` as the uniform state that
day-2 features read — regardless of how it was set up — **without breaking the
legacy operator workflow**: editing `PRIMARY_DOMAIN` (etc.) in `.env` and
restarting must keep working on adopted installs.

## Out of scope

- The `setup.sh` rework (interactive setup becoming a client of the wizard's
  `/api/setup/*` endpoints). That is **spec 2**, a separate follow-up; this spec
  is its prerequisite and also protects installs that upgraded before spec 2
  ships.
- Umbrel installs (own entrypoint + config-file model, untouched).
- `localhost` / dev installs (stay env-only; `deriveIdentityEnv` would produce
  `https://www.localhost`).
- Platform-mode workspaces: `PLATFORM_MODE` or `SSL_MANAGED_EXTERNALLY` set →
  never adopt. Their identity and nginx config are platform-managed.
- MOTD / docs copy beyond a short upgrade note.

## Design

### 1. Schema: `origin` field

`InstanceConfig` gains an optional field:

```ts
origin?: 'wizard' | 'env';
```

- **Absent ⇒ `'wizard'`.** All existing wizard-written files keep today's
  semantics with zero migration.
- `version` stays `2` — the field is purely additive; v1 forward-read rules are
  unchanged.
- `instance.env` format is unchanged (nginx has no use for origin).

### 2. Adoption (first boot on an upgraded image)

Runs in the existing pre-Nest hydrate path (`instance-config.ts`, executed as
`main.ts`'s first import — see `hydrate.ts` for why ordering matters).

Preconditions (all must hold, otherwise do nothing):

- No `instance.json` exists. A **present-but-unparseable** file is logged and
  left alone — never clobber a possibly-wizard file.
- `process.env.PRIMARY_DOMAIN` is set and ≠ `localhost`.
- Not platform mode (`PLATFORM_MODE` / `SSL_MANAGED_EXTERNALLY` unset).

Adopted config:

| Field | Value |
| --- | --- |
| `version` | `2` |
| `state` | `'applied'` |
| `origin` | `'env'` |
| `primaryDomain` | `process.env.PRIMARY_DOMAIN` |
| `proxyMode` | `process.env.PROXY_MODE` **only if** it is a known `ProxyMode` value; otherwise omitted. This mirrors the render script's env-fallback defaults (unset ⇒ non-cloudflare knobs), so adoption is byte-parity with what sh derives today. |
| `port80` / `realIp` | **omitted** (v1-style; derived by `deriveKnobs`) |
| `sslMode` | issuer sniff, below |

**sslMode inference:** parse `ssl/fullchain.pem` with `node:crypto`
`X509Certificate`. Issuer organization is Let's Encrypt **and** env
`PROXY_MODE` is not `'cloudflare'` (unset counts as not-cloudflare, matching
the render script's derivation; legacy setup.sh only ever writes `cloudflare`
or `none`) → `'letsencrypt'` (in-app renewal takes over, fixing the day-90
breakage). Anything else — Cloudflare origin certs, unknown issuers,
missing/unreadable cert — → `'paste'`.

Files are written via the existing `writeInstanceConfig()` (single writer;
shell-safety validation included).

### 3. Precedence & re-sync

- **`origin: 'env'` → `.env` is truth; the bootstrap files are derived caches.**
  - On **every** boot, re-derive the adopted config from env (including
    re-running the sslMode sniff — if the operator swaps certs, the mode
    follows) and rewrite `instance.json`/`instance.env` **only if the content
    changed** (avoids rewrite churn and nginx-watcher re-render storms).
  - `hydrateProcessEnv()` does **not** `Object.assign` over `process.env` for
    these files — env already carries the identity, and overriding would
    resurrect stale values on the first boot after an `.env` edit.
- **`origin: 'wizard'` (or absent) → exactly today's behavior**: files are
  truth, hydration overrides `process.env`.
- **Graduation:** any identity/SSL write through the wizard or a future admin
  UI goes via `writeInstanceConfig()` and stamps `origin: 'wizard'`. From then
  on `.env` identity is ignored; if a later boot finds `.env` identity that
  diverges from a wizard-origin file, log a loud warning naming both values and
  which one wins.

### 4. Renewal takeover

- Adopted `sslMode: 'letsencrypt'` installs enter the existing
  `checkAndRenewPrimary` cron.
  - **Hard requirement:** renewal must never *drop* SANs present in the
    current cert. Legacy certbot certs carry `apex, www, admin, minio`; the
    wizard's fixed SAN set may differ. Verify during planning; if it differs,
    renew adopted certs with the existing cert's SAN list.
  - **Verify during planning:** the ACME HTTP-01 challenge location must be
    reachable on a legacy env-rendered nginx config (legacy installs derive
    `PORT80=redirect`; confirm the rendered port-80 block serves the webroot).
- Adopted `sslMode: 'paste'` installs get the existing expiry-reminder emails
  (they gain `state: 'applied'`, which is the gate today).
- Double-renewal risk with a host certbot timer is acceptable: the standalone
  renewal fails while nginx holds port 80, and even a success never reaches
  `ssl/`. The upgrade note tells operators they can remove host certbot.

### 5. Backwards-compatibility guarantees (upgrade matrix)

| Scenario | Behavior |
| --- | --- |
| Legacy env-only install, upgraded image + current compose file | Adopted on first boot; renewal/reminders activate; `.env` edits keep working via re-sync. |
| Legacy install, upgraded image but **old `docker-compose.yml`** (no `./bootstrap` mount / `BOOTSTRAP_DIR`) | Backend writes inside the container FS: ephemeral, invisible to nginx. Nginx keeps rendering from env with identical values. Degraded but correct; log an info line. |
| Existing wizard install | No `origin` field ⇒ `'wizard'` default ⇒ zero behavior change. |
| **Rollback** to a pre-adoption image | Adoption never touches `.env`; old images ignore `bootstrap/` files entirely. Fully reversible. |
| Corrupt `instance.json` | Logged, untouched, install runs env-only for the boot (as today). |
| `localhost` / Umbrel / platform mode | Never adopted; unchanged. |

### 6. Error handling

- Unwritable/missing bootstrap dir: log and continue env-only — every consumer
  already tolerates `loadInstanceConfig()` returning null.
- Cert sniff failures (missing file, parse error): fall back to `'paste'`,
  never throw — adoption must not be able to prevent boot.
- All adoption/re-sync work is wrapped so that **no failure in it can crash the
  backend**; worst case is today's env-only behavior plus a log line.

### 7. Testing

- `instance-config.spec.ts`: adoption happy path; skip rules (localhost,
  platform mode, existing file, corrupt file); re-sync rewrites on env change;
  no rewrite when unchanged; `origin:'env'` hydration does not override
  `process.env`; `origin` absent defaults to wizard semantics; issuer sniff
  against LE / Cloudflare-origin / self-signed fixture certs.
- `ssl-renewal.service.spec.ts`: adopted-letsencrypt install renews; adopted
  paste install gets reminders; SAN-preservation rule.
- `test-bootstrap.sh`: a **legacy-upgrade smoke leg** — simulate an env-only
  install (`.env` with identity, certs in `ssl/`, no `bootstrap/` files), boot,
  assert files appear with `origin:'env'`; edit `.env` domain, reboot, assert
  state follows; perform a wizard-style write, assert `.env` stops mattering.
- `render-main-conf.test.sh`: render case with an adopted (`origin:'env'`)
  `instance.env` matches the pure-env render byte-for-byte.

## Sequencing

1. This spec (adoption + re-sync) ships first — it protects every upgrading
   user regardless of later work.
2. Spec 2 (setup.sh as a wizard-API client) follows; with adoption in place it
   only has to handle *new* installs.
3. Later cleanup (not this spec): once adoption has been out for a while,
   `render-main-conf.sh` can drop its sh-side knob derivation and
   `should_bootstrap()`'s bootstrap-marker special case.
