#!/bin/bash
# Reset SuperTokens user data
# Clears all SuperTokens authentication data while keeping your application's users table

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}⚠️  WARNING: This will delete ALL SuperTokens user data!${NC}"
echo "This includes:"
echo "  - All user accounts in SuperTokens"
echo "  - All active sessions"
echo "  - All password reset tokens"
echo ""
echo "Your application's users table will NOT be affected."
echo ""

read -p "Are you sure you want to continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

# Detect if running in Docker or locally
if [ -f /.dockerenv ] || [ -n "$DOCKER_CONTAINER" ]; then
  # Running in Docker
  echo "Detected Docker environment..."
  DB_URL="${DATABASE_URL:-postgresql://postgres:${POSTGRES_PASSWORD:-changeme}@postgres:5432/assethost}"
  psql "$DB_URL" -f /app/apps/backend/scripts/reset-supertokens-users.sql
elif docker ps --format '{{.Names}}' | grep -q '^assethost-postgres-dev$'; then
  # Development Docker container (check this first as it's more common)
  echo "Using development Docker container..."
  docker exec -i assethost-postgres-dev psql -U postgres -d assethost < "$(dirname "$0")/reset-supertokens-users.sql"
elif docker ps --format '{{.Names}}' | grep -q '^assethost-postgres$'; then
  # Production Docker container
  echo "Using production Docker container..."
  docker exec -i assethost-postgres psql -U postgres -d assethost < "$(dirname "$0")/reset-supertokens-users.sql"
else
  # Local PostgreSQL
  echo "Using local PostgreSQL..."
  DB_URL="${DATABASE_URL:-postgresql://postgres:devpassword@localhost:5432/assethost}"
  psql "$DB_URL" -f "$(dirname "$0")/reset-supertokens-users.sql"
fi

echo -e "${GREEN}✅ SuperTokens user data cleared!${NC}"
echo ""
echo "Next steps:"
echo "  1. Users can now sign up fresh via /api/auth/signup"
echo "  2. Your application's users table is unchanged"
echo "  3. If you also want to clear your users table, run:"
echo "     TRUNCATE TABLE users CASCADE;"

