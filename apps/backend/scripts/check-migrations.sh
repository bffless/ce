#!/bin/bash
# Check database migration status
#
# Usage:
#   ./scripts/check-migrations.sh
#   OR
#   pnpm db:check

set -e

echo "🔍 Checking database migration status..."
echo ""

# Determine which postgres to use
if docker ps | grep -q assethost-postgres; then
  PSQL_CMD="docker exec assethost-postgres psql -U postgres -d assethost"
else
  echo "❌ No PostgreSQL container found"
  exit 1
fi

# Count migrations in journal
JOURNAL_COUNT=$(ls -1 "$(dirname "$0")/../drizzle"/*.sql 2>/dev/null | wc -l | tr -d ' ')
echo "📁 Migration files in drizzle/: $JOURNAL_COUNT"

# Count migrations in database
DB_COUNT=$($PSQL_CMD -t -c "SELECT COUNT(*) FROM drizzle.\"__drizzle_migrations\";" 2>/dev/null | tr -d ' ' || echo "0")
echo "🗄️  Migrations in database: $DB_COUNT"

if [ "$JOURNAL_COUNT" != "$DB_COUNT" ]; then
  echo ""
  echo "⚠️  MISMATCH: $JOURNAL_COUNT files vs $DB_COUNT applied"
  echo ""
  echo "Missing migrations:"

  # List applied migrations
  echo "Applied:"
  $PSQL_CMD -t -c "SELECT id FROM drizzle.\"__drizzle_migrations\" ORDER BY id;" 2>/dev/null || echo "  (none)"

  echo ""
  echo "Run: pnpm db:migrate:prod"
else
  echo ""
  echo "✅ All migrations applied"
fi

echo ""
echo "📊 Key tables:"
$PSQL_CMD -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('users', 'api_keys', 'assets', 'deployment_aliases', 'system_config') ORDER BY tablename;"

echo ""
echo "📈 Asset indexes:"
$PSQL_CMD -c "SELECT indexname FROM pg_indexes WHERE tablename = 'assets' ORDER BY indexname;"