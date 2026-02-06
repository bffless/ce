#!/bin/bash
# Sync production database to local development environment
# This script will:
# 1. Create an SSH tunnel to production
# 2. Dump the production database
# 3. Restore it to your local database (WARNING: overwrites local data)

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration - can be overridden via parameters
LOCAL_DB_USER="${LOCAL_DB_USER:-postgres}"
LOCAL_DB_PASSWORD="${LOCAL_DB_PASSWORD:-devpassword}"
LOCAL_DB_NAME="${LOCAL_DB_NAME:-assethost}"
LOCAL_DB_HOST="${LOCAL_DB_HOST:-localhost}"
LOCAL_DB_PORT="${LOCAL_DB_PORT:-5432}"

PROD_DB_USER="postgres"
PROD_DB_NAME="assethost"
TUNNEL_LOCAL_PORT="5433"
TUNNEL_REMOTE_PORT="5432"

DUMP_FILE="/tmp/production-db-dump-$(date +%Y%m%d-%H%M%S).sql"
TUNNEL_PID=""

# Detect if running on macOS (Docker needs host.docker.internal instead of localhost)
if [[ "$OSTYPE" == "darwin"* ]]; then
  DOCKER_HOST="host.docker.internal"
else
  DOCKER_HOST="localhost"
fi

# PostgreSQL client wrappers - use Docker instead of requiring local installation
pg_dump() {
  # Replace localhost with Docker host for macOS compatibility
  local args=("$@")
  for i in "${!args[@]}"; do
    if [[ "${args[$i]}" == "localhost" ]]; then
      args[$i]="$DOCKER_HOST"
    fi
  done

  docker run --rm --network host \
    --add-host=host.docker.internal:host-gateway \
    -e PGPASSWORD="${PGPASSWORD}" \
    -v "/tmp:/tmp" \
    postgres:15-alpine pg_dump "${args[@]}"
}

psql() {
  # Replace localhost with Docker host for macOS compatibility
  local args=("$@")
  for i in "${!args[@]}"; do
    if [[ "${args[$i]}" == "localhost" ]]; then
      args[$i]="$DOCKER_HOST"
    fi
  done

  docker run --rm --network host \
    --add-host=host.docker.internal:host-gateway \
    -e PGPASSWORD="${PGPASSWORD}" \
    -v "/tmp:/tmp" \
    postgres:15-alpine psql "${args[@]}"
}

dropdb() {
  # Replace localhost with Docker host for macOS compatibility
  local args=("$@")
  for i in "${!args[@]}"; do
    if [[ "${args[$i]}" == "localhost" ]]; then
      args[$i]="$DOCKER_HOST"
    fi
  done

  docker run --rm --network host \
    --add-host=host.docker.internal:host-gateway \
    -e PGPASSWORD="${PGPASSWORD}" \
    postgres:15-alpine dropdb "${args[@]}"
}

createdb() {
  # Replace localhost with Docker host for macOS compatibility
  local args=("$@")
  for i in "${!args[@]}"; do
    if [[ "${args[$i]}" == "localhost" ]]; then
      args[$i]="$DOCKER_HOST"
    fi
  done

  docker run --rm --network host \
    --add-host=host.docker.internal:host-gateway \
    -e PGPASSWORD="${PGPASSWORD}" \
    postgres:15-alpine createdb "${args[@]}"
}

# Cleanup function
cleanup() {
  if [ -n "$TUNNEL_PID" ] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
    echo -e "\n${YELLOW}Closing SSH tunnel...${NC}"
    kill "$TUNNEL_PID" 2>/dev/null || true
  fi

  # Optionally remove dump file
  if [ -f "$DUMP_FILE" ] && [ "$KEEP_DUMP" != "true" ]; then
    echo -e "${YELLOW}Removing temporary dump file...${NC}"
    rm -f "$DUMP_FILE"
  elif [ -f "$DUMP_FILE" ]; then
    echo -e "${GREEN}Dump file saved at: ${DUMP_FILE}${NC}"
  fi
}

trap cleanup EXIT

# Usage
show_usage() {
  echo "Usage: bash scripts/sync-production-to-local.sh [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  -h, --host HOSTNAME              Production droplet IP or hostname (required)"
  echo "  -p, --password PASSWORD          Production database password (required)"
  echo "  --local-password PASSWORD        Local database password (default: devpassword)"
  echo "  --local-user USER                Local database user (default: postgres)"
  echo "  --local-db NAME                  Local database name (default: assethost)"
  echo "  --local-host HOST                Local database host (default: localhost)"
  echo "  --local-port PORT                Local database port (default: 5432)"
  echo "  -k, --keep-dump                  Keep the dump file after import"
  echo "  -y, --yes                        Skip confirmation prompt"
  echo "  --help                           Show this help message"
  echo ""
  echo "Examples:"
  echo "  # Sync to dev environment (default)"
  echo "  bash scripts/sync-production-to-local.sh --host 142.93.123.45 --password mypassword"
  echo ""
  echo "  # Sync to Docker production environment"
  echo "  bash scripts/sync-production-to-local.sh \\"
  echo "    --host 142.93.123.45 \\"
  echo "    --password prod_password \\"
  echo "    --local-password test_secure_password_123"
  echo ""
  echo "Note: This script uses PostgreSQL client via Docker - no installation required!"
  echo ""
  echo "Environment variables:"
  echo "  DROPLET_HOST, POSTGRES_PASSWORD_PROD"
  echo "  LOCAL_DB_PASSWORD, LOCAL_DB_USER, LOCAL_DB_NAME, LOCAL_DB_HOST, LOCAL_DB_PORT"
  exit 1
}

# Parse arguments
SKIP_CONFIRMATION=false
KEEP_DUMP=false
DROPLET_HOST="${DROPLET_HOST:-}"
PROD_DB_PASSWORD="${POSTGRES_PASSWORD_PROD:-}"

while [[ $# -gt 0 ]]; do
  case $1 in
    -h|--host)
      DROPLET_HOST="$2"
      shift 2
      ;;
    -p|--password)
      PROD_DB_PASSWORD="$2"
      shift 2
      ;;
    --local-password)
      LOCAL_DB_PASSWORD="$2"
      shift 2
      ;;
    --local-user)
      LOCAL_DB_USER="$2"
      shift 2
      ;;
    --local-db)
      LOCAL_DB_NAME="$2"
      shift 2
      ;;
    --local-host)
      LOCAL_DB_HOST="$2"
      shift 2
      ;;
    --local-port)
      LOCAL_DB_PORT="$2"
      shift 2
      ;;
    -k|--keep-dump)
      KEEP_DUMP=true
      shift
      ;;
    -y|--yes)
      SKIP_CONFIRMATION=true
      shift
      ;;
    --help)
      show_usage
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      show_usage
      ;;
  esac
done

# Check required parameters
if [ -z "$DROPLET_HOST" ]; then
  echo -e "${RED}Error: Production droplet host is required${NC}"
  show_usage
fi

if [ -z "$PROD_DB_PASSWORD" ]; then
  echo -e "${RED}Error: Production database password is required${NC}"
  show_usage
fi

echo -e "${GREEN}=== Production to Local Database Sync ===${NC}"
echo -e "${BLUE}Using PostgreSQL client via Docker (no installation required)${NC}\n"

# Step 1: Check if local postgres is running
echo -e "${YELLOW}Checking if local PostgreSQL is running...${NC}"
if docker ps | grep -q assethost-postgres-dev; then
  echo -e "${GREEN}✓ Local PostgreSQL (dev) is running${NC}\n"
  LOCAL_CONTAINER="assethost-postgres-dev"
elif docker ps --filter "name=assethost-postgres" --format "{{.Names}}" | grep -q "^assethost-postgres$"; then
  echo -e "${GREEN}✓ Local PostgreSQL (production) is running${NC}\n"
  LOCAL_CONTAINER="assethost-postgres"
else
  echo -e "${RED}Error: Local PostgreSQL container is not running${NC}"
  echo "Please start it with either:"
  echo "  docker compose -f docker-compose.dev.yml up -d postgres  (dev)"
  echo "  docker compose up -d postgres  (production)"
  exit 1
fi

# Step 2: Warning and confirmation
echo -e "${RED}⚠️  WARNING: This will completely replace your local database!${NC}"
echo -e "${YELLOW}All local data in the '${LOCAL_DB_NAME}' database will be lost.${NC}\n"

if [ "$SKIP_CONFIRMATION" = false ]; then
  read -p "Are you sure you want to continue? (yes/no): " -r
  echo
  if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "Sync cancelled."
    exit 0
  fi
fi

# Step 3: Create SSH tunnel to production
echo -e "${YELLOW}Creating SSH tunnel to production database...${NC}"
echo "Tunnel: localhost:${TUNNEL_LOCAL_PORT} -> ${DROPLET_HOST}:${TUNNEL_REMOTE_PORT}"

# Simple SSH tunnel (revert to original working version)
ssh -f -N -L ${TUNNEL_LOCAL_PORT}:localhost:${TUNNEL_REMOTE_PORT} root@${DROPLET_HOST}

# Get the PID of the SSH tunnel
TUNNEL_PID=$(pgrep -f "ssh -f -N -L ${TUNNEL_LOCAL_PORT}:localhost:${TUNNEL_REMOTE_PORT}")

if [ -z "$TUNNEL_PID" ]; then
  echo -e "${RED}Error: Failed to create SSH tunnel${NC}"
  exit 1
fi

echo -e "${GREEN}✓ SSH tunnel created (PID: ${TUNNEL_PID})${NC}\n"

# Wait a moment for tunnel to establish
sleep 2

# Step 4: Dump production database
echo -e "${YELLOW}Dumping production database...${NC}"
echo "This may take a few minutes depending on the database size..."

export PGPASSWORD="${PROD_DB_PASSWORD}"

if pg_dump -h localhost -p ${TUNNEL_LOCAL_PORT} -U ${PROD_DB_USER} -d ${PROD_DB_NAME} \
  --no-owner --no-acl --clean --if-exists -f "${DUMP_FILE}"; then
  echo -e "${GREEN}✓ Production database dumped to: ${DUMP_FILE}${NC}"

  # Show dump file size
  DUMP_SIZE=$(ls -lh "${DUMP_FILE}" | awk '{print $5}')
  echo -e "${GREEN}  Dump file size: ${DUMP_SIZE}${NC}\n"
else
  echo -e "${RED}Error: Failed to dump production database${NC}"
  exit 1
fi

unset PGPASSWORD

# Step 5: Stop local services that might be using the database
echo -e "${YELLOW}Stopping services that might be using the database...${NC}"
if docker ps | grep -q assethost-supertokens-dev; then
  docker stop assethost-supertokens-dev > /dev/null 2>&1 || true
  echo -e "${GREEN}✓ Stopped SuperTokens${NC}"
fi

# Wait for connections to close
sleep 2

# Step 6: Drop and recreate local database
echo -e "\n${YELLOW}Dropping and recreating local database...${NC}"

export PGPASSWORD="${LOCAL_DB_PASSWORD}"

# Terminate existing connections
psql -h ${LOCAL_DB_HOST} -p ${LOCAL_DB_PORT} -U ${LOCAL_DB_USER} -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${LOCAL_DB_NAME}' AND pid <> pg_backend_pid();" \
  > /dev/null 2>&1 || true

# Drop database (if exists)
dropdb -h ${LOCAL_DB_HOST} -p ${LOCAL_DB_PORT} -U ${LOCAL_DB_USER} --if-exists ${LOCAL_DB_NAME}

# Create fresh database
createdb -h ${LOCAL_DB_HOST} -p ${LOCAL_DB_PORT} -U ${LOCAL_DB_USER} ${LOCAL_DB_NAME}

echo -e "${GREEN}✓ Local database recreated${NC}\n"

# Step 7: Import production dump into local database
echo -e "${YELLOW}Importing production data into local database...${NC}"
echo "This may take a few minutes..."

if psql -h ${LOCAL_DB_HOST} -p ${LOCAL_DB_PORT} -U ${LOCAL_DB_USER} -d ${LOCAL_DB_NAME} \
  -f "${DUMP_FILE}" > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Production data imported successfully${NC}\n"
else
  echo -e "${RED}Error: Failed to import production data${NC}"
  echo "The dump file is preserved at: ${DUMP_FILE}"
  KEEP_DUMP=true
  exit 1
fi

unset PGPASSWORD

# Step 8: Restart services
echo -e "${YELLOW}Restarting services...${NC}"
# Find project root (where docker-compose.dev.yml is)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
(cd "${PROJECT_ROOT}" && docker compose -f docker-compose.dev.yml up -d supertokens > /dev/null 2>&1) || true
echo -e "${GREEN}✓ Services restarted${NC}\n"

# Summary
echo -e "${GREEN}=== Sync Complete ===${NC}"
echo -e "${GREEN}✓ Production data has been synced to your local database${NC}"
echo -e "${GREEN}✓ Database: ${LOCAL_DB_NAME}${NC}"
echo -e "${GREEN}✓ Connection: postgresql://${LOCAL_DB_USER}:${LOCAL_DB_PASSWORD}@${LOCAL_DB_HOST}:${LOCAL_DB_PORT}/${LOCAL_DB_NAME}${NC}\n"

echo -e "${YELLOW}Next steps:${NC}"
echo "1. Restart your backend server if it's running"
echo "2. Run any pending migrations if needed"
echo "3. Test your application with production data"

# Explicit success exit
exit 0
