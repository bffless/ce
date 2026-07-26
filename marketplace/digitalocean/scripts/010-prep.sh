#!/bin/bash
# Packer provisioner: base OS prep for the DO Marketplace image.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# The base image runs unattended-upgrades on first boot — wait for apt locks.
while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 \
   || fuser /var/lib/apt/lists/lock >/dev/null 2>&1; do
    echo "Waiting for apt locks..."
    sleep 5
done

apt-get update
apt-get -o Dpkg::Options::="--force-confold" upgrade -y
apt-get install -y git ufw curl openssl

# img_check requires an enabled firewall. Docker publishes 80/443 via iptables
# directly (bypassing ufw), but the explicit allows document intent and cover
# any host-level services.
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
