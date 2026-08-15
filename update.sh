#!/bin/bash
# Update this BFFless install: git pull + docker compose pull + restart.
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# shellcheck disable=SC1091
source scripts/channel.sh

usage() {
    cat <<'EOF'
Usage: ./update.sh [--channel stable|preview]

Updates this BFFless install:
  1. Aborts if the git tree has local changes (commit or stash them first)
  2. Moves the git tree to what the release channel tracks:
       stable  (default)  newest vX.Y.Z tag, images :latest
       preview            main branch, images :preview (rebuilt on every merge)
  3. docker compose pull (only the profiles this install has enabled)
  4. ./restart.sh — start.sh rebuilds the local nginx image from the pulled tree
  5. docker image prune -f — reclaims disk from superseded (dangling) images

  --channel <name>  Switch this install to another channel (persisted in .env),
                    then update. Without it the channel recorded in .env is used.
EOF
}

NEW_CHANNEL=""
while [ $# -gt 0 ]; do
    case "$1" in
        --help|-h) usage; exit 0 ;;
        --channel) NEW_CHANNEL="${2:-}"; shift ;;
        --channel=*) NEW_CHANNEL="${1#--channel=}" ;;
        *) echo -e "${RED}✗ Unknown argument: $1${NC}"; usage; exit 1 ;;
    esac
    shift
done
if [ -n "$NEW_CHANNEL" ] && ! channel_valid "$NEW_CHANNEL"; then
    echo -e "${RED}✗ Unknown channel '$NEW_CHANNEL' (stable|preview)${NC}"
    exit 1
fi

current_version() {
    local pkg_version sha preview_tag
    pkg_version=$(sed -nE 's/.*"version": *"([^"]+)".*/\1/p' package.json | head -1)
    sha=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    preview_tag=$(channel_head_preview_tag)
    echo "v${pkg_version} (${sha})${preview_tag:+ [${preview_tag}]}"
}

CHANNEL=$(channel_read .env)
echo -e "Current version: ${GREEN}$(current_version)${NC} — channel: ${CHANNEL}"

if [ -n "$(git status --porcelain)" ]; then
    echo -e "${RED}✗ Local changes detected in $(pwd) — update.sh only fast-forwards a clean tree.${NC}"
    echo "  Review with:   git status"
    echo "  Then commit them, or stash/discard:  git stash"
    exit 1
fi

if [ -n "$NEW_CHANNEL" ] && [ "$NEW_CHANNEL" != "$CHANNEL" ]; then
    echo "Switching channel: ${CHANNEL} → ${NEW_CHANNEL}"
    channel_write "$NEW_CHANNEL" .env
    CHANNEL="$NEW_CHANNEL"
fi

echo "Pulling latest code (${CHANNEL} channel)..."
git fetch --tags origin
TARGET=$(channel_ref "$CHANNEL" origin)
if [ "$CHANNEL" = "stable" ] && [ "$TARGET" != "$CHANNEL_MAIN_BRANCH" ]; then
    # Stable: pin the tree to the newest release tag so scripts / compose files
    # match the :latest images (main can be ahead between releases).
    if [ "$(git rev-parse HEAD)" != "$(git rev-parse "${TARGET}^{commit}")" ]; then
        echo "Checking out ${TARGET}..."
        git checkout -q --detach "$TARGET"
    else
        echo "Already at ${TARGET}."
    fi
else
    # Preview (or a repo with no release tags yet): track main.
    if [ "$(git symbolic-ref -q --short HEAD 2>/dev/null)" != "$CHANNEL_MAIN_BRANCH" ] \
        && git show-ref -q --verify "refs/remotes/origin/$CHANNEL_MAIN_BRANCH"; then
        echo "Checking out ${CHANNEL_MAIN_BRANCH}..."
        git checkout -q -B "$CHANNEL_MAIN_BRANCH" "origin/$CHANNEL_MAIN_BRANCH"
    fi
    git pull --ff-only
fi

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
