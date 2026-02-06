#!/bin/bash
# Complete production sync - Database AND Storage
# This script syncs both the database and MinIO storage from production to local

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Usage
show_usage() {
  echo "Usage: bash scripts/sync-production-complete.sh [OPTIONS]"
  echo ""
  echo "This script syncs BOTH database and storage from production to local."
  echo ""
  echo "Options:"
  echo "  -h, --host HOSTNAME              Production droplet IP or hostname (required)"
  echo "  -p, --db-password PASSWORD       Production database password (required)"
  echo "  -a, --minio-access-key KEY       Production MinIO access key (required)"
  echo "  -s, --minio-secret-key KEY       Production MinIO secret key (required)"
  echo "  -u, --ssh-user USER              SSH username (default: root)"
  echo "  -b, --bucket BUCKET              Bucket name (default: assets)"
  echo "  --local-db-password PASSWORD     Local database password (default: devpassword)"
  echo "  --local-minio-access-key KEY     Local MinIO access key (default: minioadmin)"
  echo "  --local-minio-secret-key KEY     Local MinIO secret key (default: minioadmin)"
  echo "  --db-only                        Sync only the database"
  echo "  --storage-only                   Sync only the storage"
  echo "  --keep-dump                      Keep database dump file"
  echo "  --storage-dry-run                Preview storage sync without copying"
  echo "  -y, --yes                        Skip all confirmation prompts"
  echo "  --help                           Show this help message"
  echo ""
  echo "Examples:"
  echo "  # Sync both database and storage to dev environment (default)"
  echo "  bash scripts/sync-production-complete.sh \\"
  echo "    --host 142.93.123.45 \\"
  echo "    --db-password dbpass123 \\"
  echo "    --minio-access-key minioadmin \\"
  echo "    --minio-secret-key miniosecret"
  echo ""
  echo "  # Sync to Docker production environment"
  echo "  bash scripts/sync-production-complete.sh \\"
  echo "    --host 142.93.123.45 \\"
  echo "    --db-password prod_db_pass \\"
  echo "    --minio-access-key prod_minio_key \\"
  echo "    --minio-secret-key prod_minio_secret \\"
  echo "    --local-db-password test_secure_password_123"
  echo ""
  echo "  # Sync only database"
  echo "  bash scripts/sync-production-complete.sh \\"
  echo "    --host 142.93.123.45 \\"
  echo "    --db-password dbpass123 \\"
  echo "    --db-only"
  echo ""
  echo "Environment variables:"
  echo "  DROPLET_HOST, SSH_USER, POSTGRES_PASSWORD_PROD"
  echo "  PROD_MINIO_ACCESS_KEY, PROD_MINIO_SECRET_KEY, MINIO_BUCKET"
  echo "  LOCAL_DB_PASSWORD, LOCAL_MINIO_ACCESS_KEY, LOCAL_MINIO_SECRET_KEY"
  exit 1
}

# Parse arguments
SYNC_DB=true
SYNC_STORAGE=true
SKIP_CONFIRMATION=false
KEEP_DUMP=false
STORAGE_DRY_RUN=false

DROPLET_HOST="${DROPLET_HOST:-}"
SSH_USER="${SSH_USER:-root}"
DB_PASSWORD="${POSTGRES_PASSWORD_PROD:-}"
MINIO_ACCESS_KEY="${PROD_MINIO_ACCESS_KEY:-}"
MINIO_SECRET_KEY="${PROD_MINIO_SECRET_KEY:-}"
MINIO_BUCKET="${MINIO_BUCKET:-assets}"

# Local environment credentials
LOCAL_DB_PASSWORD="${LOCAL_DB_PASSWORD:-}"
LOCAL_MINIO_ACCESS_KEY="${LOCAL_MINIO_ACCESS_KEY:-}"
LOCAL_MINIO_SECRET_KEY="${LOCAL_MINIO_SECRET_KEY:-}"

while [[ $# -gt 0 ]]; do
  case $1 in
    -h|--host)
      DROPLET_HOST="$2"
      shift 2
      ;;
    -p|--db-password)
      DB_PASSWORD="$2"
      shift 2
      ;;
    -a|--minio-access-key)
      MINIO_ACCESS_KEY="$2"
      shift 2
      ;;
    -s|--minio-secret-key)
      MINIO_SECRET_KEY="$2"
      shift 2
      ;;
    -u|--ssh-user)
      SSH_USER="$2"
      shift 2
      ;;
    -b|--bucket)
      MINIO_BUCKET="$2"
      shift 2
      ;;
    --local-db-password)
      LOCAL_DB_PASSWORD="$2"
      shift 2
      ;;
    --local-minio-access-key)
      LOCAL_MINIO_ACCESS_KEY="$2"
      shift 2
      ;;
    --local-minio-secret-key)
      LOCAL_MINIO_SECRET_KEY="$2"
      shift 2
      ;;
    --db-only)
      SYNC_STORAGE=false
      shift
      ;;
    --storage-only)
      SYNC_DB=false
      shift
      ;;
    --keep-dump)
      KEEP_DUMP=true
      shift
      ;;
    --storage-dry-run)
      STORAGE_DRY_RUN=true
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

# Validate required parameters
if [ -z "$DROPLET_HOST" ]; then
  echo -e "${RED}Error: Production droplet host is required${NC}"
  show_usage
fi

if [ "$SYNC_DB" = true ] && [ -z "$DB_PASSWORD" ]; then
  echo -e "${RED}Error: Database password is required for database sync${NC}"
  show_usage
fi

if [ "$SYNC_STORAGE" = true ]; then
  if [ -z "$MINIO_ACCESS_KEY" ] || [ -z "$MINIO_SECRET_KEY" ]; then
    echo -e "${RED}Error: MinIO credentials are required for storage sync${NC}"
    show_usage
  fi
fi

# Display sync plan
echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Production to Local Complete Sync                   ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}\n"

echo -e "${YELLOW}Sync Plan:${NC}"
if [ "$SYNC_DB" = true ]; then
  echo -e "  ${GREEN}✓${NC} Database sync enabled"
else
  echo -e "  ${YELLOW}○${NC} Database sync skipped"
fi

if [ "$SYNC_STORAGE" = true ]; then
  if [ "$STORAGE_DRY_RUN" = true ]; then
    echo -e "  ${BLUE}○${NC} Storage sync (dry run only)"
  else
    echo -e "  ${GREEN}✓${NC} Storage sync enabled"
  fi
else
  echo -e "  ${YELLOW}○${NC} Storage sync skipped"
fi

echo ""
echo -e "${YELLOW}Production Server:${NC} ${DROPLET_HOST}"
echo -e "${YELLOW}SSH User:${NC} ${SSH_USER}"
if [ "$SYNC_STORAGE" = true ]; then
  echo -e "${YELLOW}MinIO Bucket:${NC} ${MINIO_BUCKET}"
fi
echo ""

# Confirmation
if [ "$SKIP_CONFIRMATION" = false ]; then
  echo -e "${RED}⚠️  WARNING: This will replace local data with production data!${NC}\n"
  read -p "Continue with sync? (yes/no): " -r
  echo
  if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "Sync cancelled."
    exit 0
  fi
fi

# Export environment variables for subscripts
export DROPLET_HOST
export SSH_USER
export POSTGRES_PASSWORD_PROD="${DB_PASSWORD}"
export PROD_MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY}"
export PROD_MINIO_SECRET_KEY="${MINIO_SECRET_KEY}"
export MINIO_BUCKET

# Export local credentials if provided
if [ -n "$LOCAL_DB_PASSWORD" ]; then
  export LOCAL_DB_PASSWORD
fi
if [ -n "$LOCAL_MINIO_ACCESS_KEY" ]; then
  export LOCAL_MINIO_ACCESS_KEY
fi
if [ -n "$LOCAL_MINIO_SECRET_KEY" ]; then
  export LOCAL_MINIO_SECRET_KEY
fi

START_TIME=$(date +%s)

# Step 1: Sync Database
if [ "$SYNC_DB" = true ]; then
  echo -e "\n${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║   Step 1/2: Syncing Database                           ║${NC}"
  echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}\n"

  DB_ARGS="--host ${DROPLET_HOST} --password ${DB_PASSWORD} --yes"
  if [ "$KEEP_DUMP" = true ]; then
    DB_ARGS="${DB_ARGS} --keep-dump"
  fi
  if [ -n "$LOCAL_DB_PASSWORD" ]; then
    DB_ARGS="${DB_ARGS} --local-password ${LOCAL_DB_PASSWORD}"
  fi

  if bash "${SCRIPT_DIR}/sync-production-to-local.sh" ${DB_ARGS}; then
    echo -e "\n${GREEN}✓ Database sync completed successfully${NC}"
  else
    echo -e "\n${RED}✗ Database sync failed${NC}"
    exit 1
  fi
fi

# Step 2: Sync Storage
if [ "$SYNC_STORAGE" = true ]; then
  echo -e "\n${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║   Step 2/2: Syncing Storage                            ║${NC}"
  echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}\n"

  STORAGE_ARGS="--host ${DROPLET_HOST} --username ${SSH_USER} --access-key ${MINIO_ACCESS_KEY} --secret-key ${MINIO_SECRET_KEY} --bucket ${MINIO_BUCKET} --yes"
  if [ "$STORAGE_DRY_RUN" = true ]; then
    STORAGE_ARGS="${STORAGE_ARGS} --dry-run"
  fi
  if [ -n "$LOCAL_MINIO_ACCESS_KEY" ]; then
    STORAGE_ARGS="${STORAGE_ARGS} --local-access-key ${LOCAL_MINIO_ACCESS_KEY}"
  fi
  if [ -n "$LOCAL_MINIO_SECRET_KEY" ]; then
    STORAGE_ARGS="${STORAGE_ARGS} --local-secret-key ${LOCAL_MINIO_SECRET_KEY}"
  fi

  if bash "${SCRIPT_DIR}/sync-production-storage.sh" ${STORAGE_ARGS}; then
    echo -e "\n${GREEN}✓ Storage sync completed successfully${NC}"
  else
    echo -e "\n${RED}✗ Storage sync failed${NC}"
    exit 1
  fi
fi

# Calculate duration
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

# Final summary
echo -e "\n${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Sync Complete!                                       ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}\n"

if [ "$SYNC_DB" = true ]; then
  echo -e "${GREEN}✓ Database: Production data synced to local${NC}"
fi

if [ "$SYNC_STORAGE" = true ]; then
  if [ "$STORAGE_DRY_RUN" = true ]; then
    echo -e "${BLUE}○ Storage: Dry run completed (no files copied)${NC}"
  else
    echo -e "${GREEN}✓ Storage: Production files synced to local MinIO${NC}"
  fi
fi

echo -e "\n${YELLOW}Duration:${NC} ${MINUTES}m ${SECONDS}s\n"

echo -e "${YELLOW}Next steps:${NC}"
echo "1. Update storage config for local development:"
echo "   node scripts/update-local-storage-config.js"
echo "2. Restart your backend server if it's running"
echo "3. Verify data in your application"
echo "4. Check MinIO console: http://localhost:9001 (minioadmin/minioadmin)"
echo "5. Run any necessary migrations if your schema differs"
