#!/bin/bash
# Reset a web-bootstrap install back to a fresh browser setup wizard, wiping the
# database — using ONLY docker + shell. No node / npm / pnpm required (unlike
# `pnpm docker:reset`), so it runs on a bare droplet where the app only exists
# as containers.
#
# Usage:
#   ./reset-bootstrap.sh           # interactive (asks to confirm)
#   ./reset-bootstrap.sh --force   # skip the confirmation
#
# What it does:
#   1. Stops the stack (keeps volumes so the frontend bundle survives — removing
#      it is what causes nginx to serve 404s on restart).
#   2. Removes the DATA volumes (Postgres — which also holds SuperTokens — plus
#      MinIO, Redis and uploads). Deliberately KEEPS frontend-dist so nginx
#      always has the admin UI to serve.
#   3. Clears the bind-mounted host state that `docker compose down -v` never
#      touches: nginx per-domain configs, staged certs, and the applied
#      bootstrap identity (bootstrap/instance.*). Keeps bootstrap-selfsigned.*
#      (the marker + the cert nginx serves on 443 in bootstrap mode).
#   4. Starts the stack via ./start.sh. The backend re-runs migrations on boot
#      (inside the container), and the frontend re-syncs its bundle — so no host
#      tooling and no 404.
#
# .env is left untouched, except that a claim token is minted if none exists.

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

# Run from the repo root (where docker-compose.yml, ssl/ and bootstrap/ live),
# regardless of where the script was invoked from.
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

FORCE=false
for arg in "$@"; do
  case "$arg" in
    --force|-f) FORCE=true ;;
    --help|-h)
      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unknown option: $arg (see --help)"; exit 1 ;;
  esac
done

# Same profiles start.sh brings up, so `down` stops every service including the
# profile-gated ones (postgres/minio/redis/supertokens).
PROFILES="--profile postgres --profile minio --profile redis --profile supertokens"

# Data volumes to wipe. frontend-dist and acme-webroot are intentionally absent.
DATA_VOLUMES="postgres-data minio-data redis-data backend-uploads"

echo -e "${GREEN}BFFless — reset to a fresh setup wizard${NC}"
echo ""
echo -e "${YELLOW}This DELETES ALL DATA${NC} in this install:"
echo "  • the database (users, admin account, system config — and SuperTokens)"
echo "  • object storage (MinIO) and uploaded deployments"
echo "  • the applied domain identity and installed certificates"
echo ""
echo "It KEEPS: the frontend bundle (no 404), your .env (secrets + claim token)."
echo ""

if [ "$FORCE" != true ]; then
  read -r -p "Type 'reset' to continue: " reply
  if [ "$reply" != "reset" ]; then
    echo "Aborted."
    exit 0
  fi
  echo ""
fi

# 1. Stop the stack (keep volumes for now; we remove specific ones next).
echo -e "${YELLOW}[1/5] Stopping the stack...${NC}"
# shellcheck disable=SC2086 # word-splitting of $PROFILES is intentional
docker compose $PROFILES down --remove-orphans

# 2. Remove the data volumes (by their compose-project-prefixed names).
echo -e "${YELLOW}[2/5] Wiping data volumes...${NC}"
project="${COMPOSE_PROJECT_NAME:-$(basename "$(pwd)")}"
removed_any=false
for v in $DATA_VOLUMES; do
  # Try the exact project-prefixed name first (Docker's default), then fall
  # back to a name filter in case the project name was customised.
  vol="${project}_${v}"
  if ! docker volume inspect "$vol" >/dev/null 2>&1; then
    vol="$(docker volume ls --filter "name=${v}" --format '{{.Name}}' | head -1)"
  fi
  if [ -n "$vol" ] && docker volume rm "$vol" >/dev/null 2>&1; then
    echo "  removed $vol"
    removed_any=true
  fi
done
[ "$removed_any" = true ] || echo "  (no data volumes found — already clean)"

# 3. Clear bind-mounted host state (survives `docker compose down -v`).
echo -e "${YELLOW}[3/5] Clearing bootstrap state on disk...${NC}"
# Applied identity — removing these drops the instance back to bootstrap mode.
rm -f bootstrap/instance.json bootstrap/instance.env 2>/dev/null || true
# Wizard-staged certs. Keep bootstrap-selfsigned.* and acme-account.key.
rm -f ssl/fullchain.pem ssl/privkey.pem 2>/dev/null || true
rm -f ssl/wildcard.*.crt ssl/wildcard.*.key 2>/dev/null || true
# Per-domain / welcome nginx configs (regenerated on boot).
rm -f docker/nginx/sites-enabled/*.conf 2>/dev/null || true
mkdir -p bootstrap ssl
echo "  cleared instance.*, staged certs, and per-domain nginx configs"

# 4. A claim token must exist before the wizard comes back up: a formerly
#    classic (non-bootstrap) install's .env has none, and without it the
#    relaunched wizard is claim-ungated on a public IP (v0.2.18 review, m3).
echo -e "${YELLOW}[4/5] Ensuring a claim token exists...${NC}"
if ! grep -q '^ONBOARDING_TOKEN=..*' .env 2>/dev/null; then
  CLAIM_TOKEN=$(openssl rand -hex 16)
  {
    echo ""
    echo "# Web-bootstrap claim token (shown in the server's login banner)"
    echo "ONBOARDING_TOKEN=${CLAIM_TOKEN}"
  } >> .env
  echo "  minted a new claim token (none was set)"
else
  CLAIM_TOKEN="$(grep '^ONBOARDING_TOKEN=' .env | head -1 | cut -d= -f2-)"
  echo "  keeping the existing claim token"
fi

# 5. Bring it back up. Backend migrates on boot; frontend re-syncs its bundle.
echo -e "${YELLOW}[5/5] Starting the stack...${NC}"
./start.sh

echo ""
echo -e "${GREEN}Done — reset to a fresh setup wizard.${NC}"
echo "Claim token for the wizard: ${CLAIM_TOKEN}"
echo ""
echo "Give it ~45s, then check it's healthy and back in bootstrap mode:"
echo "  curl -sk https://localhost/api/setup/status    # want bootstrapMode:true, claimRequired:true"
echo ""
echo "Then open the wizard (use a fresh/incognito tab):"
echo "  https://admin.<your-domain>   (or https://<server-ip> — expect a cert warning)"
