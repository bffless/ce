#!/bin/bash
# Packer provisioner: base OS prep for the DO Marketplace image.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# The base image runs cloud-init + unattended-upgrades on first boot. A
# point-in-time lock check races (the lock can be re-taken between apt calls):
# block until first-boot provisioning is completely done, and make apt itself
# wait out any remaining lock holders.
cloud-init status --wait || true
APT="apt-get -o DPkg::Lock::Timeout=600"

$APT update
$APT -o Dpkg::Options::="--force-confold" upgrade -y
$APT install -y git ufw curl openssl

# img_check requires an enabled firewall. Docker publishes 80/443 via iptables
# directly (bypassing ufw), but the explicit allows document intent and cover
# any host-level services.
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
