# Getting started with BFFless CE

After you create your droplet from the 1-Click image:

## 1. Wait ~2 minutes for first boot

The droplet configures itself on first boot: swap (on 1–2 GB droplets),
per-droplet secrets, and all services. No SSH needed.

## 2. Get your claim token

The setup wizard is claim-protected by a one-time token. Get it either way:

- **SSH (or the DO web console):** `ssh root@<your-droplet-ip>` — the welcome
  banner prints both your setup link (`https://<ip>/?token=...`) and the bare
  claim token on its own line, ready to copy. This works in the DigitalOcean
  control panel's Droplet Console too.

## 3. Finish setup in the browser

Copy your claim token, open `https://<your-droplet-ip>/`, and proceed past
the self-signed certificate warning — that's expected before a domain is
configured. Paste the token into the setup wizard's claim field, then it
walks you through: create your admin account → set your domain (Cloudflare
recommended, free) → SSL → done. Your admin panel lands at
`https://admin.<your-domain>`.

**Note:** browsers can drop the `?token=...` part of the link when you click
through the certificate warning, so the wizard may not show your token
prefilled — if that happens, just paste it manually from the banner.

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

- Website: https://bffless.dev
- Documentation: https://docs.bffless.dev
- Deployment guide: https://docs.bffless.dev/deployment/digitalocean
- Community & issues: https://github.com/bffless/ce
