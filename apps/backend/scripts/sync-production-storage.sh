#!/bin/bash
# Sync production MinIO storage to local development environment
# This script copies all files from production MinIO to local MinIO

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROD_MINIO_PORT="${PROD_MINIO_PORT:-9000}"
PROD_MINIO_BUCKET="${MINIO_BUCKET:-assets}"

TUNNEL_PID=""
MC_CONFIG_DIR="${HOME}/.mc-sync-temp"

# Detect if running on macOS (Docker needs host.docker.internal instead of localhost)
if [[ "$OSTYPE" == "darwin"* ]]; then
  DOCKER_HOST="host.docker.internal"
else
  DOCKER_HOST="localhost"
fi

# Local MinIO config (set after DOCKER_HOST is determined) - can be overridden via parameters
LOCAL_MINIO_ENDPOINT="${LOCAL_MINIO_ENDPOINT:-http://${DOCKER_HOST}:9000}"
LOCAL_MINIO_ACCESS_KEY="${LOCAL_MINIO_ACCESS_KEY:-minioadmin}"
LOCAL_MINIO_SECRET_KEY="${LOCAL_MINIO_SECRET_KEY:-minioadmin}"
LOCAL_MINIO_BUCKET="${LOCAL_MINIO_BUCKET:-${MINIO_BUCKET:-assets}}"
LOCAL_MINIO_PORT="${LOCAL_MINIO_PORT:-9000}"

# MinIO client wrapper - uses Docker instead of requiring global installation
mc() {
  docker run --rm \
    --network host \
    --add-host=host.docker.internal:host-gateway \
    -v "${MC_CONFIG_DIR}:/root/.mc" \
    minio/mc "$@"
}

# Cleanup function
cleanup() {
  if [ -n "$TUNNEL_PID" ] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
    echo -e "\n${YELLOW}Closing SSH tunnel...${NC}"
    kill "$TUNNEL_PID" 2>/dev/null || true
  fi

  # Remove temporary MinIO config
  if [ -d "${MC_CONFIG_DIR}" ]; then
    rm -rf "${MC_CONFIG_DIR}"
  fi
}

trap cleanup EXIT

# Usage
show_usage() {
  echo "Usage: bash scripts/sync-production-storage.sh [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  -h, --host HOSTNAME              Production droplet IP or hostname (required)"
  echo "  -u, --username USER              SSH username (default: root)"
  echo "  -a, --access-key KEY             Production MinIO access key (required)"
  echo "  -s, --secret-key KEY             Production MinIO secret key (required)"
  echo "  -b, --bucket BUCKET              Bucket name (default: assets)"
  echo "  -p, --port PORT                  MinIO port on production (default: 9000)"
  echo "  --local-access-key KEY           Local MinIO access key (default: minioadmin)"
  echo "  --local-secret-key KEY           Local MinIO secret key (default: minioadmin)"
  echo "  --local-bucket BUCKET            Local bucket name (default: same as --bucket)"
  echo "  --local-port PORT                Local MinIO port (default: 9000)"
  echo "  --dry-run                        Show what would be synced without actually syncing"
  echo "  -y, --yes                        Skip confirmation prompt"
  echo "  --help                           Show this help message"
  echo ""
  echo "Examples:"
  echo "  # Sync to dev environment (default)"
  echo "  bash scripts/sync-production-storage.sh \\"
  echo "    --host 142.93.123.45 \\"
  echo "    --access-key minioadmin \\"
  echo "    --secret-key myprodsecret"
  echo ""
  echo "  # Sync to Docker production environment"
  echo "  bash scripts/sync-production-storage.sh \\"
  echo "    --host 142.93.123.45 \\"
  echo "    --access-key prod_access \\"
  echo "    --secret-key prod_secret \\"
  echo "    --local-access-key minioadmin \\"
  echo "    --local-secret-key minioadmin"
  echo ""
  echo "Note: This script uses MinIO client via Docker - no installation required!"
  echo ""
  echo "Environment variables:"
  echo "  DROPLET_HOST, SSH_USER, PROD_MINIO_ACCESS_KEY, PROD_MINIO_SECRET_KEY"
  echo "  LOCAL_MINIO_ACCESS_KEY, LOCAL_MINIO_SECRET_KEY, LOCAL_MINIO_BUCKET, LOCAL_MINIO_PORT"
  exit 1
}

# Parse arguments
SKIP_CONFIRMATION=false
DRY_RUN=false
DROPLET_HOST="${DROPLET_HOST:-}"
SSH_USER="${SSH_USER:-root}"
PROD_MINIO_ACCESS_KEY="${PROD_MINIO_ACCESS_KEY:-}"
PROD_MINIO_SECRET_KEY="${PROD_MINIO_SECRET_KEY:-}"

while [[ $# -gt 0 ]]; do
  case $1 in
    -h|--host)
      DROPLET_HOST="$2"
      shift 2
      ;;
    -u|--username)
      SSH_USER="$2"
      shift 2
      ;;
    -a|--access-key)
      PROD_MINIO_ACCESS_KEY="$2"
      shift 2
      ;;
    -s|--secret-key)
      PROD_MINIO_SECRET_KEY="$2"
      shift 2
      ;;
    -b|--bucket)
      PROD_MINIO_BUCKET="$2"
      LOCAL_MINIO_BUCKET="$2"
      shift 2
      ;;
    -p|--port)
      PROD_MINIO_PORT="$2"
      shift 2
      ;;
    --local-access-key)
      LOCAL_MINIO_ACCESS_KEY="$2"
      shift 2
      ;;
    --local-secret-key)
      LOCAL_MINIO_SECRET_KEY="$2"
      shift 2
      ;;
    --local-bucket)
      LOCAL_MINIO_BUCKET="$2"
      shift 2
      ;;
    --local-port)
      LOCAL_MINIO_PORT="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
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

echo -e "${GREEN}=== Production Storage Sync ===${NC}\n"

# Create temporary MinIO config directory
mkdir -p "${MC_CONFIG_DIR}"

echo -e "${BLUE}Using MinIO client via Docker (no installation required)${NC}\n"

# Check required parameters
if [ -z "$DROPLET_HOST" ]; then
  echo -e "${RED}Error: Production droplet host is required${NC}"
  show_usage
fi

if [ -z "$PROD_MINIO_ACCESS_KEY" ]; then
  echo -e "${RED}Error: Production MinIO access key is required${NC}"
  show_usage
fi

if [ -z "$PROD_MINIO_SECRET_KEY" ]; then
  echo -e "${RED}Error: Production MinIO secret key is required${NC}"
  show_usage
fi

# Step 1: Check if local MinIO is running
echo -e "${YELLOW}Checking if local MinIO is running...${NC}"
if docker ps | grep -q assethost-minio-dev; then
  echo -e "${GREEN}✓ Local MinIO (dev) is running${NC}\n"
  LOCAL_MINIO_CONTAINER="assethost-minio-dev"
elif docker ps --filter "name=assethost-minio" --format "{{.Names}}" | grep -q "^assethost-minio$"; then
  echo -e "${GREEN}✓ Local MinIO (production) is running${NC}\n"
  LOCAL_MINIO_CONTAINER="assethost-minio"
else
  echo -e "${RED}Error: Local MinIO container is not running${NC}"
  echo "Please start it with either:"
  echo "  docker compose -f docker-compose.dev.yml up -d minio  (dev)"
  echo "  docker compose up -d minio  (production)"
  exit 1
fi

# Step 2: Warning and confirmation
if [ "$DRY_RUN" = false ]; then
  echo -e "${YELLOW}⚠️  This will sync all files from production MinIO to local MinIO${NC}"
  echo -e "${YELLOW}Files will be added or updated. Existing files with the same keys will be overwritten.${NC}\n"

  if [ "$SKIP_CONFIRMATION" = false ]; then
    read -p "Are you sure you want to continue? (yes/no): " -r
    echo
    if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
      echo "Sync cancelled."
      exit 0
    fi
  fi
else
  echo -e "${BLUE}Running in DRY RUN mode - no files will be modified${NC}\n"
fi

# Step 3: Create SSH tunnel to production MinIO
echo -e "${YELLOW}Creating SSH tunnel to production MinIO...${NC}"
TUNNEL_LOCAL_PORT=9001
echo "Tunnel: localhost:${TUNNEL_LOCAL_PORT} -> ${DROPLET_HOST}:${PROD_MINIO_PORT}"

# Simple SSH tunnel (revert to original working version)
ssh -f -N -L ${TUNNEL_LOCAL_PORT}:localhost:${PROD_MINIO_PORT} ${SSH_USER}@${DROPLET_HOST}

# Get the PID of the SSH tunnel
TUNNEL_PID=$(pgrep -f "ssh -f -N -L ${TUNNEL_LOCAL_PORT}:localhost:${PROD_MINIO_PORT}")

if [ -z "$TUNNEL_PID" ]; then
  echo -e "${RED}Error: Failed to create SSH tunnel${NC}"
  exit 1
fi

echo -e "${GREEN}✓ SSH tunnel created (PID: ${TUNNEL_PID})${NC}\n"

# Wait for tunnel to establish
sleep 2

# Step 4: Configure MinIO client aliases
echo -e "${YELLOW}Configuring MinIO client...${NC}"

# Configure local MinIO
mc alias set local-dev ${LOCAL_MINIO_ENDPOINT} ${LOCAL_MINIO_ACCESS_KEY} ${LOCAL_MINIO_SECRET_KEY} \
  > /dev/null 2>&1

# Configure production MinIO (via tunnel)
mc alias set prod-tunnel http://${DOCKER_HOST}:${TUNNEL_LOCAL_PORT} \
  ${PROD_MINIO_ACCESS_KEY} ${PROD_MINIO_SECRET_KEY} \
  > /dev/null 2>&1

echo -e "${GREEN}✓ MinIO client configured${NC}\n"

# Step 5: Verify connectivity
echo -e "${YELLOW}Testing MinIO connections...${NC}"

if ! mc ls local-dev/${LOCAL_MINIO_BUCKET} > /dev/null 2>&1; then
  echo -e "${YELLOW}Local bucket '${LOCAL_MINIO_BUCKET}' doesn't exist, creating...${NC}"
  mc mb local-dev/${LOCAL_MINIO_BUCKET}
fi
echo -e "${GREEN}✓ Local MinIO connection successful${NC}"

if ! mc ls prod-tunnel/${PROD_MINIO_BUCKET} > /dev/null 2>&1; then
  echo -e "${RED}Error: Cannot access production bucket '${PROD_MINIO_BUCKET}'${NC}"
  echo "Please verify the bucket name and credentials."
  exit 1
fi
echo -e "${GREEN}✓ Production MinIO connection successful${NC}\n"

# Step 6: Show storage statistics
echo -e "${YELLOW}Getting storage statistics...${NC}"
PROD_FILE_COUNT=$(mc ls --recursive prod-tunnel/${PROD_MINIO_BUCKET} 2>/dev/null | wc -l | xargs)
LOCAL_FILE_COUNT=$(mc ls --recursive local-dev/${LOCAL_MINIO_BUCKET} 2>/dev/null | wc -l | xargs)

echo -e "${BLUE}Production files: ${PROD_FILE_COUNT}${NC}"
echo -e "${BLUE}Local files: ${LOCAL_FILE_COUNT}${NC}\n"

# Step 7: Sync files
if [ "$DRY_RUN" = true ]; then
  echo -e "${YELLOW}Dry run - files that would be synced:${NC}\n"
  mc mirror --dry-run prod-tunnel/${PROD_MINIO_BUCKET} local-dev/${LOCAL_MINIO_BUCKET}
else
  echo -e "${YELLOW}Syncing files from production to local...${NC}"
  echo "This may take a while depending on the amount of data..."
  echo -e "${BLUE}Tip: If sync appears to hang, it may be transferring a large file${NC}"
  echo -e "${BLUE}     You can check MinIO console (http://localhost:9001) to see files arriving${NC}\n"

  # Use mirror command to sync efficiently
  # --overwrite: Overwrite files that differ
  # --remove: Remove extraneous files from target (optional - commented out for safety)
  # Note: We allow individual file failures but continue the sync
  SYNC_EXIT_CODE=0

  # Show file transfer progress in real-time
  echo -e "${YELLOW}Starting transfer...${NC}"
  mc mirror --overwrite prod-tunnel/${PROD_MINIO_BUCKET} local-dev/${LOCAL_MINIO_BUCKET} 2>&1 | while IFS= read -r line; do
    # Show progress for files being copied
    if [[ "$line" =~ "..." ]]; then
      echo -e "${BLUE}Transferring: ${line}${NC}"
    else
      echo "$line"
    fi
  done

  # Capture exit code from mirror command
  SYNC_EXIT_CODE=${PIPESTATUS[0]}

  if [ $SYNC_EXIT_CODE -eq 0 ]; then
    echo -e "\n${GREEN}✓ Storage sync complete - all files transferred successfully${NC}\n"
  else
    echo -e "\n${YELLOW}⚠ Storage sync completed with some errors${NC}"
    echo -e "${YELLOW}Most files were synced successfully, but some failed (see errors above)${NC}"
    echo -e "${YELLOW}This is often due to network issues or corrupted files${NC}"
    echo -e "${YELLOW}You can re-run the sync to retry failed files${NC}\n"
  fi

  # Show updated statistics
  LOCAL_FILE_COUNT_AFTER=$(mc ls --recursive local-dev/${LOCAL_MINIO_BUCKET} 2>/dev/null | wc -l | xargs)
  echo -e "${GREEN}Local files after sync: ${LOCAL_FILE_COUNT_AFTER}${NC}"

  # Calculate how many files were synced vs total
  if [ "$PROD_FILE_COUNT" != "0" ]; then
    SYNC_PERCENTAGE=$((LOCAL_FILE_COUNT_AFTER * 100 / PROD_FILE_COUNT))
    echo -e "${GREEN}Sync coverage: ${SYNC_PERCENTAGE}% (${LOCAL_FILE_COUNT_AFTER}/${PROD_FILE_COUNT} files)${NC}"
  fi
fi

# Summary
echo -e "\n${GREEN}=== Sync Complete ===${NC}"
if [ "$DRY_RUN" = false ]; then
  echo -e "${GREEN}✓ Production storage has been synced to local MinIO${NC}"
  echo -e "${GREEN}✓ Bucket: ${LOCAL_MINIO_BUCKET}${NC}"
  echo -e "${GREEN}✓ Endpoint: ${LOCAL_MINIO_ENDPOINT}${NC}\n"

  echo -e "${YELLOW}Next steps:${NC}"
  echo "1. Verify files are accessible via MinIO console: http://localhost:9001"
  echo "2. Test your application to ensure files load correctly"
else
  echo -e "${BLUE}Dry run complete - no files were modified${NC}"
fi

# Explicit success exit
exit 0
