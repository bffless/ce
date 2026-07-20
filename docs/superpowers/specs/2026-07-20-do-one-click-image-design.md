# DigitalOcean 1-Click Image for BFFless CE — Design Spec

**Date:** 2026-07-20
**Status:** Draft for review
**Scope:** `repos/ce` (build tooling, first-login flow, lifecycle scripts), `repos/docs-public` (docs)
**Depends on:** `2026-07-20-web-bootstrap-setup-design.md` (zero-SSH web setup) — built **first**. Once it ships, the primary onboarding path for this image is the browser wizard at `https://<droplet-ip>` (claim token shown in the DO web console); the SSH first-login flow described below remains fully specified but demotes to the fallback path. First boot additionally runs `setup.sh --bootstrap` + `start.sh` so services are live before any login.

## Goal

Publish BFFless CE as an official **DigitalOcean Marketplace droplet 1-Click app**, with:

1. A Coolify-style first-login experience: SSH in → interactive setup auto-runs (domain → Cloudflare origin-cert paste → services live).
2. Cloudflare as the recommended, default CDN/WAF/SSL path (already the default in `setup.sh`).
3. A documented set of lifecycle scripts (`restart.sh`, `update.sh`, `logs.sh`, `status.sh`, `backup.sh`) listed Coolify-style in the marketplace listing and README — these benefit every CE install, not just DO.

## Key decisions (made during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Distribution | Full DO Marketplace listing (vendor portal, Packer image, `img_check` validation) | Real 1-Click button + marketplace discovery; tooling also works for lighter paths |
| First-login UX | Auto-run interactive setup via root `.bashrc` hook | DO's documented convention; exactly the Coolify pattern; reuses existing `setup.sh` |
| Image content | **Warm cache**: CE repo at `/opt/bffless` (main) + Docker images pre-pulled; first login self-updates (`git pull` + `docker compose pull`) before configuring | Instant-ish first login (delta pulls only), robust to registry hiccups, and **decoupled from CE's frequent release cadence** — the image never needs a rebuild per release |
| Secrets/certs | **Never baked.** Cloudflare Origin Certificate pasted by the user at first login; Postgres password, `ENCRYPTION_KEY`, `JWT_SECRET`, `API_KEY_SALT` generated per-droplet by `setup.sh` | DO `img_check` forbids baked secrets; per-droplet security |
| Image rebuild cadence | Manual dispatch + monthly cron CI job | OS security freshness + small delta pulls; DO expects periodic refreshes |
| Swap | Not baked into the image; created at **first boot** by a per-instance cloud-init script calling a new shared `scripts/setup-swap.sh` | DO droplets have no swap by default and the listing allows 1 GB droplets — without swap the OOM killer kills containers (today this is only a manual comment block in `docker-compose.yml`). First boot (not first login) so swap exists before any container runs, sized to the droplet actually chosen; a baked swapfile would bloat the snapshot and couldn't adapt to droplet size |

## Background / current state

- `setup.sh` (repo root) is already an interactive, Cloudflare-first wizard: domain prompt, `PROXY_MODE=cloudflare` default, public-IP auto-detection, origin-cert paste flow into `ssl/`, secret generation, `.env` creation from `.env.example`, optional SMTP, Let's Encrypt fallback with DNS verification. It is not wired to any first-login mechanism.
- `install.sh` is a curl-pipe bootstrapper (clone → `setup.sh`), used by the current manual droplet flow in `docs-public/docs/deployment/digitalocean.md`.
- `start.sh` (profile-aware: postgres/minio/redis/supertokens, low-memory warnings, builds nginx image) and `stop.sh` (`--volumes` option) exist; no restart/update/logs/status/backup scripts.
- Swap setup exists only as a comment block in `docker-compose.yml` (manual `fallocate` instructions; 2G recommended for 1–2 GB VMs, skip at 4 GB+, `vm.swappiness=10`). Nothing automates it.
- Precedent for platform packaging dirs in the repo: `umbrel/`.

DO Marketplace requirements (from [digitalocean/marketplace-partners](https://github.com/digitalocean/marketplace-partners)):

- Packer-built snapshot; build on the smallest ($6/1 GB) droplet for compatibility.
- `cleanup.sh` + `img_check.sh` must pass: ufw enabled, no SSH keys in root, cleared logs/bash history, no baked secrets, cloud-init functional, no pending security updates.
- First-login hook: line in `/root/.bashrc`; script restores default `.bashrc` on completion (`cp -f /etc/skel/.bashrc /root/.bashrc`).
- MOTD docs via `/etc/update-motd.d/99-*`.
- Submission via the Vendor Portal (`cloud.digitalocean.com/vendorportal`); no API — manual step.

## Architecture

### 1. Build tooling — `repos/ce/marketplace/digitalocean/`

```
marketplace/digitalocean/
├── template.pkr.hcl          # Packer HCL2, DO builder, base ubuntu-24-04-x64, $6 build droplet
├── scripts/
│   ├── 010-prep.sh           # apt upgrade; ufw allow 22,80,443 + enable
│   ├── 020-docker.sh         # Docker CE + compose plugin (mirrors setup.sh's installer steps)
│   ├── 030-bffless.sh        # clone bffless/ce → /opt/bffless; docker compose pull (all profile
│   │                         #   services: postgres, supertokens, minio, redis, backend, frontend);
│   │                         #   docker compose build nginx; install first-login hook + MOTD +
│   │                         #   /usr/local/bin/bffless-setup symlink
│   ├── 900-cleanup.sh        # vendored from marketplace-partners
│   └── 999-img_check.sh      # vendored from marketplace-partners (build fails if it fails)
├── files/
│   ├── etc/update-motd.d/99-bffless-readme   # what this droplet is, script table, docs link,
│   │                                         #   "setup resumes on next login" note
│   ├── var/lib/cloud/scripts/per-instance/001-swap   # first boot: calls scripts/setup-swap.sh
│   └── first-login.sh        # installed to /opt/bffless/marketplace/digitalocean/ (via repo clone)
├── listing/                  # version-controlled marketplace listing copy
│   ├── description.md
│   └── getting-started.md    # includes the Coolify-style script table
└── README.md                 # build, test, submit instructions
```

The only first-boot (`/var/lib/cloud/scripts/per-instance`) script is `001-swap` (below) — it is non-interactive, finishes in seconds, and touches nothing the first-login flow uses, so there is no race. Everything else stays first-login to keep the image simple.

### Swap (first boot)

New shared script `scripts/setup-swap.sh` in the CE repo — the automated replacement for the manual swap comment block in `docker-compose.yml`:

- Idempotent: exits cleanly if any swap is already active or `/swapfile` exists in `/etc/fstab`.
- Total RAM ≤ ~3 GB → create 2G swapfile (`fallocate` → `chmod 600` → `mkswap` → `swapon`), persist in `/etc/fstab`, set `vm.swappiness=10` via `/etc/sysctl.d/`. RAM ≥ 4 GB → no-op (matching the existing guidance).
- Not DO-specific: manual installs can run it directly, and it is a candidate for `setup.sh` to offer during interactive setup (kept optional there to avoid surprising existing flows).

The DO image installs `files/var/lib/cloud/scripts/per-instance/001-swap`, a thin wrapper that runs `/opt/bffless/scripts/setup-swap.sh` on the droplet's first boot — before any container starts, sized to whatever droplet size the user picked. The swapfile is deliberately **not** baked into the image (snapshot bloat; cannot adapt to droplet size). The `docker-compose.yml` comment block gets trimmed to point at the script.

### 2. First-login flow

> **Note (post web-bootstrap):** with the zero-SSH spec shipped, this becomes the fallback path. `first-login.sh` first checks bootstrap state: if the instance is unclaimed, it prints the wizard URL + claim token and offers "press Enter to set up here in the terminal instead"; the flow below runs only if the user opts into terminal setup (or the web wizard is unavailable).

Baked line in `/root/.bashrc` runs `first-login.sh`:

1. **Banner** — "BFFless — let's get you set up (~3 minutes). Have your domain on Cloudflare ready," with a link to the Cloudflare setup guide.
2. **Self-update** — `git -C /opt/bffless pull --ff-only` and profile-aware `docker compose pull`, each with a timeout; on network failure, warn and continue with the cached versions.
3. **Setup** — run `./setup.sh` (unchanged interactive flow).
4. **On success** (`.env` exists, ssl certs present or explicitly skipped, setup exited 0):
   run `./start.sh`, print admin URL (`https://admin.<domain>`) + next steps (browser setup wizard), then restore `.bashrc` from `/etc/skel` so the hook never fires again.
5. **On Ctrl-C / skip / failure** — hook stays; MOTD and the `bffless-setup` command (symlink to `first-login.sh` in `/usr/local/bin`) let the user resume; re-prompts on next login.

`setup.sh` itself needs no or minimal changes (it already handles re-runs via the `.env` overwrite prompt). Any marketplace-specific messaging lives in `first-login.sh`, not `setup.sh`.

### 3. Lifecycle scripts (repo root, alongside `start.sh` / `stop.sh`)

| Script | Behavior |
|---|---|
| `restart.sh` | `./stop.sh && ./start.sh`, passing flags through to `start.sh` |
| `update.sh` | Show current version → abort with guidance if the git tree is dirty → `git pull --ff-only` → profile-aware `docker compose pull` → `./restart.sh` → show new version |
| `logs.sh [service]` | `docker compose logs -f --tail=100` across all profiles, optional service filter |
| `status.sh` | **Version**: checked-out repo version (`package.json` + git SHA) and the running backend/frontend image versions (`docker inspect`), with a "restart pending" warning when they differ; `docker compose ps`, RAM/disk/swap usage, configured domain from `.env`, SSL cert presence + expiry (`openssl x509 -enddate`), backend health-check curl |
| `backup.sh` | `pg_dump` via `docker exec` + tar of asset storage (local-storage volume, or MinIO data dir when `ENABLE_MINIO=true`) → `backups/bffless-backup-<timestamp>.tar.gz`; prints pointer to restore docs. Restore remains documented-manual (no `restore.sh` in this iteration). |

All scripts: bash, `set -e`, colored output consistent with `start.sh`, `--help` flags, shellcheck-clean.

### 4. Documentation

- **CE README**: new "Managing your instance" section documenting all seven scripts (`start`, `stop`, `restart`, `update`, `logs`, `status`, `backup`).
- **`docs-public/docs/deployment/digitalocean.md`**: "1-Click Deploy" section at the top (Deploy button + what first login does) once the listing is live; existing manual flow kept below as the alternative.
- **Marketplace listing copy** (in `listing/`): description + getting-started with the script table; kept in git so listing updates are reviewable.
- MOTD links to docs and lists the scripts.

### 5. CI

GitHub Actions workflow in `repos/ce` (`.github/workflows/marketplace-image.yml`):

- Triggers: `workflow_dispatch` + monthly cron.
- Runs Packer with `DIGITALOCEAN_API_TOKEN` secret; output is a snapshot in the DO team account; job summary includes the snapshot ID/name.
- Vendor Portal submission remains a manual step (no DO API for it).
- **Not** tied to CE releases: first-login self-update + `update.sh` keep droplets current.

## Testing

- **Static:** shellcheck on all new/changed shell scripts.
- **Build-time:** `img_check.sh` runs as the final Packer provisioner — the build fails if validation fails.
- **End-to-end (manual, once per meaningful change):** Packer build → create droplet from snapshot → first SSH login with a real test domain on Cloudflare → verify: swap active before login (`swapon --show` on a 1 GB droplet shows the 2G swapfile; absent on a 4 GB droplet), self-update ran, cert paste worked, `https://admin.<domain>` serves the setup wizard, second SSH login does not re-prompt, `update.sh` / `status.sh` / `backup.sh` / `restart.sh` / `logs.sh` behave, ufw active.
- **Regression guard for non-DO installs:** the new lifecycle scripts must work in a plain `install.sh` deployment too (nothing may assume `/opt/bffless` or DO).

## Out of scope

- ~~Web-based setup finish (HTTP-only boot + cert upload in admin UI)~~ — **promoted to its own spec** (`2026-07-20-web-bootstrap-setup-design.md`), sequenced before this one; see "Depends on" above.
- `restore.sh` — restore stays documented-manual this iteration.
- Other marketplaces (AWS/Azure/Linode 1-clicks) — the `marketplace/` directory layout leaves room.
- Automated Vendor Portal submission (DO has no API for it).

## Open items

- DO vendor account sign-up (user action; portal access via `cloud.digitalocean.com/vendorportal` or one-clicks-team@digitalocean.com).
- Minimum droplet size to declare on the listing: recommend **1 GB min / 2 GB recommended**, matching existing docs.
