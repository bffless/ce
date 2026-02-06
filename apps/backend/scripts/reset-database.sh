#!/bin/bash
# Completely reset the database - drops and recreates everything
# This will delete ALL data including:
#   - All application tables (users, assets, etc.)
#   - All SuperTokens tables
#   - All data
#
# Usage:
#   ./scripts/reset-database.sh
#   OR
#   pnpm db:reset

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${RED}⚠️  ⚠️  ⚠️  DANGER ZONE ⚠️  ⚠️  ⚠️${NC}"
echo -e "${YELLOW}This will COMPLETELY DELETE the database and ALL its data!${NC}"
echo ""
echo "This includes:"
echo "  - All application tables (users, assets, api_keys, system_config)"
echo "  - All SuperTokens tables"
echo "  - ALL DATA - this cannot be undone!"
echo ""
echo "After reset:"
echo "  - Database will be recreated"
echo "  - Migrations will run automatically"
echo "  - SuperTokens will create fresh tables with prefix"
echo ""

read -p "Type 'DELETE EVERYTHING' to confirm: " confirm

if [ "$confirm" != "DELETE EVERYTHING" ]; then
  echo "Aborted. Database unchanged."
  exit 0
fi

echo ""
echo -e "${YELLOW}Dropping and recreating database...${NC}"

# Detect environment
if docker ps --format '{{.Names}}' | grep -q '^assethost-postgres-dev$'; then
  # Development Docker container
  echo "Using development Docker container..."
  CONTAINER="assethost-postgres-dev"
  DB_NAME="assethost"
  DB_USER="postgres"
  DB_PASSWORD="devpassword"
elif docker ps --format '{{.Names}}' | grep -q '^assethost-postgres$'; then
  # Production Docker container
  echo "Using production Docker container..."
  CONTAINER="assethost-postgres"
  DB_NAME="assethost"
  DB_USER="postgres"
  DB_PASSWORD="${POSTGRES_PASSWORD:-changeme}"
else
  echo -e "${RED}❌ No PostgreSQL container found!${NC}"
  echo "Make sure Docker containers are running:"
  echo "  docker-compose -f docker-compose.dev.yml up -d"
  exit 1
fi

# Drop and recreate database
echo "1. Dropping database..."
docker exec -i "$CONTAINER" psql -U "$DB_USER" -c "DROP DATABASE IF EXISTS $DB_NAME;" postgres || true

echo "2. Creating fresh database..."
docker exec -i "$CONTAINER" psql -U "$DB_USER" -c "CREATE DATABASE $DB_NAME;" postgres

echo "3. Database reset complete!"
echo ""
echo -e "${GREEN}✅ Database has been completely reset!${NC}"
echo ""
echo "Next steps:"
echo "  1. Run migrations: cd apps/backend && pnpm db:migrate"
echo "  2. Restart SuperTokens: docker-compose -f docker-compose.dev.yml restart supertokens"
echo "  3. SuperTokens will create fresh tables with 'supertokens_' prefix"
echo "  4. Set up your application via /api/setup/initialize"

