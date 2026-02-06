#!/bin/bash
# Run database migrations in production Docker container
# 
# Usage:
#   ./scripts/run-migrations-production.sh
#   OR
#   pnpm db:migrate:prod

set -e

echo "🔄 Running database migrations in production..."

# Check if running in Docker
if docker ps | grep -q assethost-backend; then
  echo "Running migrations in Docker container..."
  docker exec assethost-backend node /app/apps/backend/dist/db/migrate.js
elif docker ps | grep -q assethost-postgres; then
  echo "Running migrations locally against production database..."
  cd "$(dirname "$0")/.."
  DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD:-changeme}@localhost:5432/assethost" \
    tsx src/db/migrate.ts
else
  echo "❌ No production containers found. Make sure Docker containers are running."
  echo "   Start with: docker-compose up -d"
  exit 1
fi

echo "✅ Migrations complete!"

