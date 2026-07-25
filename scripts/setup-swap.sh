#!/bin/bash
# Create a 2G swapfile on low-RAM hosts so the OOM killer doesn't take out
# containers. Idempotent: no-ops when swap is already active, when the
# swapfile is already in fstab, or when the host has >= 4 GB RAM.
# Replaces the manual instructions that previously lived in docker-compose.yml.
#
# Usage: sudo ./scripts/setup-swap.sh
#
# Env seams (used by setup-swap.test.sh; production uses the defaults):
#   SWAPFILE FSTAB MEMINFO SYSCTL_DIR SWAP_SIZE SETUP_SWAP_ALLOW_NONROOT
set -euo pipefail

SWAPFILE="${SWAPFILE:-/swapfile}"
FSTAB="${FSTAB:-/etc/fstab}"
MEMINFO="${MEMINFO:-/proc/meminfo}"
SYSCTL_DIR="${SYSCTL_DIR:-/etc/sysctl.d}"
SWAP_SIZE="${SWAP_SIZE:-2G}"
# A "4 GB" VM reports ~3.8 GB MemTotal, a "2 GB" VM ~1.9 GB — 3584 MB splits them.
RAM_SKIP_THRESHOLD_KB=$((3584 * 1024))

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: sudo ./scripts/setup-swap.sh"
    echo ""
    echo "Creates a ${SWAP_SIZE} swapfile at ${SWAPFILE} on hosts with < 3.5 GB RAM,"
    echo "persists it in ${FSTAB}, and sets vm.swappiness=10."
    echo "Idempotent: safe to re-run; no-ops on hosts with >= 4 GB RAM."
    exit 0
fi

if [ "$(id -u)" -ne 0 ] && [ -z "${SETUP_SWAP_ALLOW_NONROOT:-}" ]; then
    echo "Run as root: sudo $0" >&2
    exit 1
fi

if [ -n "$(swapon --show 2>/dev/null)" ]; then
    echo "Swap is already active — nothing to do."
    swapon --show
    exit 0
fi

if grep -qF "$SWAPFILE none swap" "$FSTAB" 2>/dev/null; then
    echo "$SWAPFILE already configured in $FSTAB — nothing to do."
    exit 0
fi

ram_kb=$(awk '/^MemTotal:/ {print $2}' "$MEMINFO")
if [ "$ram_kb" -ge "$RAM_SKIP_THRESHOLD_KB" ]; then
    echo "Host has $((ram_kb / 1024)) MB RAM (4 GB class) — swap not needed, skipping."
    exit 0
fi

echo "Host has $((ram_kb / 1024)) MB RAM — creating ${SWAP_SIZE} swapfile at ${SWAPFILE}..."
fallocate -l "$SWAP_SIZE" "$SWAPFILE"
chmod 600 "$SWAPFILE"
mkswap "$SWAPFILE"
swapon "$SWAPFILE"
echo "$SWAPFILE none swap sw 0 0" >> "$FSTAB"

echo 'vm.swappiness=10' > "${SYSCTL_DIR}/99-bffless-swappiness.conf"
sysctl -w vm.swappiness=10 >/dev/null 2>&1 || true

echo "Swap enabled:"
swapon --show
