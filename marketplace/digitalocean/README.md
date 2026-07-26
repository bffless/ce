# DigitalOcean Marketplace image

Build tooling for the BFFless CE 1-Click droplet image.

## Layout

- `template.pkr.hcl` — Packer HCL2 template (DO builder, `ubuntu-24-04-x64`, builds on `s-1vcpu-1gb`)
- `scripts/010-prep.sh` — apt upgrade, ufw 22/80/443
- `scripts/020-docker.sh` — Docker CE + compose plugin (mirrors `setup.sh`'s installer)
- `scripts/030-bffless.sh` — clone to `/opt/bffless`, pre-pull all profile images, warm nginx build cache, install MOTD + first-boot scripts + first-login hook
- `scripts/900-cleanup.sh`, `scripts/999-img_check.sh` — vendored unmodified from [digitalocean/marketplace-partners](https://github.com/digitalocean/marketplace-partners) (`scripts/90-cleanup.sh`, `scripts/99-img-check.sh`); `img_check` failing fails the build
- `files/first-login.sh` — SSH login banner/fallback setup (also `bffless-setup`); `files/first-login.test.sh` unit-tests it
- `files/etc/update-motd.d/99-bffless-readme` — dynamic MOTD
- `files/var/lib/cloud/scripts/per-instance/` — first-boot: `001-swap`, `002-bffless-first-boot`
- `listing/` — version-controlled Vendor Portal listing copy

## How a droplet boots (image → running wizard)

1. cloud-init per-instance: `001-swap` (2G swap on <4 GB droplets), then
   `002-bffless-first-boot`: best-effort self-update (`git pull` + compose pull),
   `setup.sh --bootstrap` (per-droplet secrets + `ONBOARDING_TOKEN`), `start.sh`.
   Log: `/var/log/bffless-first-boot.log`.
2. The web wizard is live at `https://<droplet-ip>/` (self-signed cert until a
   domain is applied). The claim link with token is shown by the MOTD and the
   first-login banner.
3. First SSH login runs `first-login.sh`: points at the wizard, offers terminal
   setup, and removes its own `.bashrc` hook once the instance is configured.

The image is a **warm cache**, never a pinned release: no `.env`, secrets, or
certs are baked (DO `img_check` enforces this), and droplets self-update at
first boot and via `update.sh`, so frequent CE releases never require an image
rebuild. A monthly CI rebuild keeps the base OS fresh.

## Build

Locally:

```bash
export DIGITALOCEAN_API_TOKEN=...   # write-scoped token
cd marketplace/digitalocean
packer init template.pkr.hcl
packer build template.pkr.hcl       # ~15 min; snapshot bffless-ce-<timestamp>
```

Or run the **Build DO Marketplace Image** GitHub Actions workflow
(`workflow_dispatch`; also runs monthly). Requires the `DIGITALOCEAN_API_TOKEN`
repo secret.

## Test a snapshot

Create a droplet from the snapshot (Images → Snapshots → More → Create droplet;
test 1 GB AND 4 GB sizes), then verify:

- [ ] `swapon --show` — 2G swapfile on the 1 GB droplet; none on 4 GB
- [ ] `https://<droplet-ip>/` serves the claim wizard (self-signed cert warning)
- [ ] MOTD + first SSH login show the claim link with token
- [ ] Complete the wizard with a real Cloudflare-managed test domain → `https://admin.<domain>` works
- [ ] Second SSH login after setup does NOT re-prompt (bashrc hook removed)
- [ ] `./status.sh` `./update.sh` `./backup.sh` `./restart.sh` `./logs.sh` behave
- [ ] `ufw status` is active; `/var/log/bffless-first-boot.log` shows a clean run

## Submit

Vendor Portal (manual; no API): https://cloud.digitalocean.com/vendorportal —
attach the snapshot, paste `listing/description.md` and
`listing/getting-started.md`. Listing: min 1 GB / recommended 2 GB droplet.
