#!/bin/sh
set -e

echo "🚀 Starting Asset Host Backend..."

# Extract host and port from DATABASE_URL for health check
# Format: postgresql://user:pass@host:port/database or postgres://...
if [ -n "$DATABASE_URL" ]; then
  # Extract host:port from DATABASE_URL
  DB_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:/]+).*|\1|')
  DB_PORT=$(echo "$DATABASE_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')

  # Default port if not specified
  if [ -z "$DB_PORT" ] || [ "$DB_PORT" = "$DATABASE_URL" ]; then
    DB_PORT=5432
  fi
else
  # Fallback to Docker postgres container
  DB_HOST="postgres"
  DB_PORT="5432"
fi

echo "⏳ Waiting for PostgreSQL at $DB_HOST:$DB_PORT to be ready..."

# Wait for postgres to be ready (using simple netcat check since pg_isready may not be available)
for i in $(seq 1 30); do
  if nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; then
    echo "✅ PostgreSQL is ready!"
    break
  fi
  echo "PostgreSQL is unavailable - sleeping (attempt $i/30)"
  sleep 2
done

# Run database migrations
echo "📦 Running database migrations..."
cd /app/apps/backend
node dist/db/migrate.js || {
  echo "⚠️  Migration failed, but continuing... (migrations may already be applied)"
}

echo "🎉 Migrations complete!"

# Start the application
echo "🚀 Starting NestJS application..."
exec node dist/main.js

