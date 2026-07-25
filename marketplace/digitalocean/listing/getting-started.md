# Getting started with BFFless CE

After you create your droplet from the 1-Click image:

## 1. Wait ~2 minutes for first boot

The droplet configures itself on first boot: swap (on 1–2 GB droplets),
per-droplet secrets, and all services. No SSH needed.

## 2. Get your setup link

The setup wizard is claim-protected by a one-time token. Get your personal
setup link either way:

- **SSH (or the DO web console):** `ssh root@<your-droplet-ip>` — the welcome
  banner prints your setup link (`https://<ip>/?token=...`). This works in the
  DigitalOcean control panel's Droplet Console too.

## 3. Finish setup in the browser

Open the setup link. Your browser warns about a self-signed certificate —
that's expected before a domain is configured; proceed. The wizard walks you
through: create your admin account → set your domain (Cloudflare recommended,
free) → SSL → done. Your admin panel lands at `https://admin.<your-domain>`.

Prefer the terminal? The SSH welcome banner offers a full interactive setup
instead (`bffless-setup`).

## Managing your instance

All from `/opt/bffless`:

| Command | What it does |
| --- | --- |
| `./status.sh` | Health, versions (with restart-pending warning), RAM/swap/disk, SSL expiry |
| `./update.sh` | Upgrade BFFless: git pull + image pull + restart |
| `./logs.sh [service]` | Follow logs for all services or one |
| `./backup.sh` | Backup database + assets + config to `backups/` |
| `./restart.sh` | Restart all services |
| `./stop.sh` / `./start.sh` | Stop / start services |

## Resources

- Documentation: https://docs.bffless.dev
- Deployment guide: https://docs.bffless.dev/deployment/digitalocean
- Community & issues: https://github.com/bffless/ce
