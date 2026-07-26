#!/bin/bash
# Packer provisioner: warm-cache BFFless install at /opt/bffless.
# The image bakes NO .env, NO secrets, NO certs — per-droplet configuration
# happens at first boot (002-bffless-first-boot) and in the browser wizard.
set -euo pipefail

INSTALL_DIR=/opt/bffless
MARKETPLACE_DIR="$INSTALL_DIR/marketplace/digitalocean"

git clone https://github.com/bffless/ce.git "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Pre-pull every profile's images so a droplet's first boot only fetches deltas.
docker compose --profile postgres --profile minio --profile redis --profile supertokens pull
# Warm the local nginx build cache (start.sh rebuilds it at first boot).
docker compose build nginx

# MOTD (dynamic: shows the wizard claim link until setup completes)
install -m 0755 "$MARKETPLACE_DIR/files/etc/update-motd.d/99-bffless-readme" /etc/update-motd.d/99-bffless-readme

# First-boot (cloud-init per-instance) scripts: swap, then bootstrap + start.
mkdir -p /var/lib/cloud/scripts/per-instance
install -m 0755 "$MARKETPLACE_DIR/files/var/lib/cloud/scripts/per-instance/001-swap" /var/lib/cloud/scripts/per-instance/001-swap
install -m 0755 "$MARKETPLACE_DIR/files/var/lib/cloud/scripts/per-instance/002-bffless-first-boot" /var/lib/cloud/scripts/per-instance/002-bffless-first-boot

# First-login hook (DO convention) + always-available resume command.
chmod +x "$MARKETPLACE_DIR/files/first-login.sh"
ln -sf "$MARKETPLACE_DIR/files/first-login.sh" /usr/local/bin/bffless-setup
echo "/usr/local/bin/bffless-setup" >> /root/.bashrc
