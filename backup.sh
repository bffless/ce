#!/bin/bash
# Back up this BFFless install: database dump + asset storage + config/identity.
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    cat <<'EOF'
Usage: ./backup.sh

Writes backups/bffless-backup-<timestamp>.tar.gz containing:
  database.sql      pg_dump of the bundled Postgres (skipped for external DBs)
  uploads/          local asset storage (or minio-data/ when ENABLE_MINIO=true)
  .env bootstrap/ ssl/   config, instance identity, certificates

The archive contains secrets — store it securely.
Restore guide: https://docs.bffless.dev/deployment/digitalocean#restoring-a-backup
EOF
    exit 0
fi

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT
mkdir -p backups

# 1. Database
if [ "$(docker inspect --format '{{.State.Running}}' assethost-postgres 2>/dev/null)" = "true" ]; then
    echo "Dumping PostgreSQL database..."
    docker exec assethost-postgres pg_dump -U postgres assethost > "$WORK_DIR/database.sql"
else
    echo -e "${YELLOW}⚠ Postgres container not running — skipping database dump.${NC}"
    echo "  (External DATABASE_URL installs: back that database up with your provider's tools.)"
fi

# 2. Asset storage
if grep -q '^ENABLE_MINIO=true' .env 2>/dev/null; then
    echo "Copying MinIO data..."
    docker cp assethost-minio:/data "$WORK_DIR/minio-data"
else
    echo "Copying local asset storage..."
    docker cp assethost-backend:/app/apps/backend/uploads "$WORK_DIR/uploads"
fi

# 3. Config + identity (small but essential for restore: secrets, domain, certs)
[ -f .env ] && cp .env "$WORK_DIR/"
[ -d bootstrap ] && cp -r bootstrap "$WORK_DIR/"
[ -d ssl ] && cp -r ssl "$WORK_DIR/"

ARCHIVE="backups/bffless-backup-${TIMESTAMP}.tar.gz"
tar czf "$ARCHIVE" -C "$WORK_DIR" .
chmod 600 "$ARCHIVE"

echo -e "${GREEN}✓ Backup written to ${ARCHIVE}${NC}"
echo -e "${YELLOW}⚠ The archive contains secrets (.env, certificates) — store it securely.${NC}"
echo "  Restore guide: https://docs.bffless.dev/deployment/digitalocean#restoring-a-backup"
