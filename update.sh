#!/bin/bash
# Update this BFFless install: git pull + docker compose pull + restart.
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    cat <<'EOF'
Usage: ./update.sh

Updates this BFFless install:
  1. Aborts if the git tree has local changes (commit or stash them first)
  2. git pull --ff-only
  3. docker compose pull (only the profiles this install has enabled)
  4. ./restart.sh — start.sh rebuilds the local nginx image from the pulled tree
  5. docker image prune -f — reclaims disk from superseded (dangling) images
EOF
    exit 0
fi

current_version() {
    local pkg_version sha
    pkg_version=$(sed -nE 's/.*"version": *"([^"]+)".*/\1/p' package.json | head -1)
    sha=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    echo "v${pkg_version} (${sha})"
}

echo -e "Current version: ${GREEN}$(current_version)${NC}"

if [ -n "$(git status --porcelain)" ]; then
    echo -e "${RED}✗ Local changes detected in $(pwd) — update.sh only fast-forwards a clean tree.${NC}"
    echo "  Review with:   git status"
    echo "  Then commit them, or stash/discard:  git stash"
    exit 1
fi

echo "Pulling latest code..."
git pull --ff-only

if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
fi
# shellcheck disable=SC1091
source scripts/compose-profiles.sh
PROFILES=$(compose_profiles)

echo "Pulling latest images..."
# shellcheck disable=SC2086  # PROFILES is an arg list by design
docker compose $PROFILES pull

./restart.sh

# Reclaim disk from superseded images: after the restart nothing references
# the previous pulls/builds, and prune -f only touches dangling (untagged)
# images — pinned tags are never removed.
echo "Pruning superseded images..."
docker image prune -f || true

echo -e "Updated to: ${GREEN}$(current_version)${NC}"
