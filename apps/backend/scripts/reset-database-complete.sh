#!/bin/bash
# Complete database reset with automatic migration and SuperTokens restart
# This is a convenience script that does everything in one go
#
# Usage:
#   ./scripts/reset-database-complete.sh
#   OR
#   pnpm db:reset:complete

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo -e "${BLUE}🔄 Complete Database Reset${NC}"
echo ""

# Step 1: Reset database
echo -e "${YELLOW}Step 1: Resetting database...${NC}"
cd "$BACKEND_DIR"
pnpm db:reset

# Step 2: Run migrations
echo ""
echo -e "${YELLOW}Step 2: Running migrations...${NC}"
pnpm db:migrate

# Step 3: Restart SuperTokens
echo ""
echo -e "${YELLOW}Step 3: Restarting SuperTokens...${NC}"
cd "$(cd "$BACKEND_DIR/../.." && pwd)"
docker-compose -f docker-compose.dev.yml restart supertokens || docker-compose restart supertokens

echo ""
echo -e "${GREEN}✅ Complete reset finished!${NC}"
echo ""
echo "Your database is now:"
echo "  ✅ Fresh and clean"
echo "  ✅ Migrations applied"
echo "  ✅ SuperTokens will create prefixed tables on next request"
echo ""
echo "You can now:"
echo "  - Set up your application via /api/setup/initialize"
echo "  - Create users via /api/auth/signup"

