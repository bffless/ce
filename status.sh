#!/bin/bash
# Show the health of this BFFless install: versions, services, resources,
# domain/SSL, and a backend health check. Always exits 0 — it reports
# problems, it doesn't fail on them (hence no `set -e`).
set -uo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC2164
cd "$SCRIPT_DIR"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: ./status.sh"
    echo ""
    echo "Reports: repo vs running image versions (with restart-pending warning),"
    echo "service status, RAM/swap/disk, configured domain, SSL cert expiry, and"
    echo "a backend health check."
    exit 0
fi

section() {
    echo ""
    echo -e "${BOLD}$1${NC}"
    echo "────────────────────────────────────────────────"
}

section "Version"
PKG_VERSION=$(sed -nE 's/.*"version": *"([^"]+)".*/\1/p' package.json | head -1)
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
echo "Checked-out repo:  v${PKG_VERSION} (${GIT_SHA})"

restart_pending=false
for svc in backend frontend; do
    container="assethost-${svc}"
    running_id=$(docker inspect --format '{{.Image}}' "$container" 2>/dev/null | head -1)
    if [ -z "$running_id" ]; then
        echo -e "${svc}: ${YELLOW}not running${NC}"
        continue
    fi
    image_ref=$(docker inspect --format '{{.Config.Image}}' "$container" 2>/dev/null | head -1)
    version_label=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$image_ref" 2>/dev/null | head -1)
    echo "${svc}: ${image_ref}${version_label:+ (${version_label})}"
    tag_id=$(docker image inspect --format '{{.Id}}' "$image_ref" 2>/dev/null | head -1)
    if [ -n "$tag_id" ] && [ "$running_id" != "$tag_id" ]; then
        restart_pending=true
    fi
done
if [ "$restart_pending" = true ]; then
    echo -e "${YELLOW}⚠ A newer image has been pulled but is not running — run ./restart.sh${NC}"
fi

section "Services"
ALL_PROFILES="--profile postgres --profile minio --profile redis --profile supertokens"
# shellcheck disable=SC2086
docker compose $ALL_PROFILES ps 2>/dev/null || echo -e "${RED}✗ docker compose unavailable${NC}"

section "Resources"
free -h 2>/dev/null || true
echo ""
swapon --show 2>/dev/null | grep -q . && swapon --show || echo -e "${YELLOW}No swap configured — consider: sudo ./scripts/setup-swap.sh${NC}"
echo ""
df -h / 2>/dev/null || true

section "Domain & SSL"
domain=""
if [ -f bootstrap/instance.env ]; then
    domain=$( ( STATE=""; PRIMARY_DOMAIN=""
                # shellcheck disable=SC1091
                . bootstrap/instance.env
                [ "$STATE" = "applied" ] && echo "$PRIMARY_DOMAIN" ) 2>/dev/null )
fi
if [ -z "$domain" ] && [ -f .env ]; then
    domain=$(grep '^PRIMARY_DOMAIN=' .env 2>/dev/null | head -1 | cut -d= -f2-)
fi
if [ -n "$domain" ]; then
    echo -e "Configured domain: ${GREEN}${domain}${NC}  (admin: https://admin.${domain})"
else
    echo -e "${YELLOW}No domain configured yet — instance is in bootstrap mode.${NC}"
fi
for cert in ssl/fullchain.pem ssl/bootstrap-selfsigned.crt; do
    [ -f "$cert" ] || continue
    enddate=$(openssl x509 -enddate -noout -in "$cert" 2>/dev/null | cut -d= -f2-)
    echo "${cert}: expires ${enddate:-unreadable}"
done

section "Backend health"
if response=$(curl -fs -m 5 http://localhost:3000/api/health 2>/dev/null); then
    echo -e "${GREEN}✓ Backend healthy:${NC} ${response}"
else
    echo -e "${RED}✗ Backend health check failed (http://localhost:3000/api/health)${NC}"
    echo "  Check logs: ./logs.sh backend"
fi

exit 0
