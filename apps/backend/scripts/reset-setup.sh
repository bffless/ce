#!/bin/bash
# Reset platform to fresh state (auto-detects environment)
# Clears all application data to allow re-running setup wizard
#
# Usage:
#   ./scripts/reset-setup.sh           # Interactive reset with confirmation
#   ./scripts/reset-setup.sh --force   # Skip confirmation (for CI/CD)
#   ./scripts/reset-setup.sh --help    # Show help message
#
# Works with:
#   - Production Docker (assethost-postgres, assethost-minio)
#   - Development Docker (assethost-postgres-dev, assethost-minio-dev)
#   - Local PostgreSQL
#
# This script will:
#   1. Clear all data from PostgreSQL (all application tables)
#   2. Delete all objects from MinIO storage bucket
#   3. Clear SuperTokens session/user data
#   4. Clean up nginx config files (domain-*.conf, redirect-*.conf, primary-content.conf)
#   5. Re-run database migrations

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Database configuration
DB_NAME="${DB_NAME:-assethost}"
DB_USER="${DB_USER:-postgres}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_PASSWORD="${DB_PASSWORD:-devpassword}"

# Container names (will be auto-detected)
POSTGRES_CONTAINER=""
MINIO_CONTAINER=""
NGINX_CONTAINER=""

# Parse arguments
FORCE=false
while [[ "$#" -gt 0 ]]; do
  case $1 in
    --force) FORCE=true ;;
    --help|-h)
      echo "Usage: ./scripts/reset-setup.sh [OPTIONS]"
      echo ""
      echo "Reset the Static Asset Hosting Platform to a fresh state."
      echo ""
      echo "Options:"
      echo "  --force    Skip confirmation prompt (for CI/CD)"
      echo "  --help     Show this help message"
      echo ""
      echo "This script will:"
      echo "  - Clear all data from PostgreSQL (users, projects, deployments, etc.)"
      echo "  - Delete all objects from MinIO storage"
      echo "  - Clear SuperTokens session/user data"
      echo "  - Re-run database migrations"
      echo ""
      echo "After reset, visit your app to complete the setup wizard again."
      exit 0
      ;;
    *) echo "Unknown parameter: $1"; exit 1 ;;
  esac
  shift
done

# Print warning banner
print_warning() {
  echo -e "${RED}"
  echo "==============================================================================="
  echo "                              ⚠️  WARNING ⚠️"
  echo ""
  echo "  This will DELETE ALL DATA from the platform:"
  echo ""
  echo "    • All users and admin accounts"
  echo "    • All projects and repositories"
  echo "    • All deployments and aliases"
  echo "    • All stored assets and files"
  echo "    • All API keys"
  echo "    • All proxy rules and domain mappings"
  echo "    • All nginx config files (domain/redirect configs)"
  echo "    • All system configuration"
  echo ""
  echo "  This action CANNOT be undone."
  echo ""
  echo "==============================================================================="
  echo -e "${NC}"
}

# Detect which containers are running
detect_containers() {
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^assethost-postgres$"; then
    POSTGRES_CONTAINER="assethost-postgres"
  elif docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^assethost-postgres-dev$"; then
    POSTGRES_CONTAINER="assethost-postgres-dev"
  fi

  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^assethost-minio$"; then
    MINIO_CONTAINER="assethost-minio"
  elif docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^assethost-minio-dev$"; then
    MINIO_CONTAINER="assethost-minio-dev"
  fi

  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^assethost-nginx$"; then
    NGINX_CONTAINER="assethost-nginx"
  fi
}

# Reset PostgreSQL using Docker
reset_postgres_docker() {
  echo -e "${YELLOW}[1/5] Resetting PostgreSQL...${NC}"
  echo "  Using Docker container: $POSTGRES_CONTAINER"

  docker exec "$POSTGRES_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "
    -- Clear all application tables (order matters due to foreign keys)
    TRUNCATE TABLE proxy_rules CASCADE;
    TRUNCATE TABLE domain_mappings CASCADE;
    TRUNCATE TABLE ssl_challenges CASCADE;
    TRUNCATE TABLE primary_content CASCADE;
    TRUNCATE TABLE deployment_aliases CASCADE;
    TRUNCATE TABLE assets CASCADE;
    TRUNCATE TABLE api_keys CASCADE;
    TRUNCATE TABLE project_permissions CASCADE;
    TRUNCATE TABLE user_groups CASCADE;
    TRUNCATE TABLE projects CASCADE;
    TRUNCATE TABLE users CASCADE;
    TRUNCATE TABLE system_config CASCADE;
  " 2>/dev/null || {
    # Some tables might not exist yet, try individual deletes
    echo "  (Some tables may not exist yet, continuing...)"
    docker exec "$POSTGRES_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "
      DELETE FROM proxy_rules;
      DELETE FROM domain_mappings;
      DELETE FROM ssl_challenges;
      DELETE FROM primary_content;
      DELETE FROM deployment_aliases;
      DELETE FROM assets;
      DELETE FROM api_keys;
      DELETE FROM project_permissions;
      DELETE FROM user_groups;
      DELETE FROM projects;
      DELETE FROM users;
      DELETE FROM system_config;
    " 2>/dev/null || true
  }

  echo -e "${GREEN}  ✓ PostgreSQL data cleared${NC}"
}

# Reset PostgreSQL using local psql
reset_postgres_local() {
  echo -e "${YELLOW}[1/5] Resetting PostgreSQL...${NC}"
  echo "  Using local PostgreSQL: $DB_HOST:$DB_PORT"

  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" << EOF
    -- Clear all application tables (order matters due to foreign keys)
    TRUNCATE TABLE proxy_rules CASCADE;
    TRUNCATE TABLE domain_mappings CASCADE;
    TRUNCATE TABLE ssl_challenges CASCADE;
    TRUNCATE TABLE primary_content CASCADE;
    TRUNCATE TABLE deployment_aliases CASCADE;
    TRUNCATE TABLE assets CASCADE;
    TRUNCATE TABLE api_keys CASCADE;
    TRUNCATE TABLE project_permissions CASCADE;
    TRUNCATE TABLE user_groups CASCADE;
    TRUNCATE TABLE projects CASCADE;
    TRUNCATE TABLE users CASCADE;
    TRUNCATE TABLE system_config CASCADE;
EOF

  echo -e "${GREEN}  ✓ PostgreSQL data cleared${NC}"
}

# Reset SuperTokens data
reset_supertokens() {
  echo -e "${YELLOW}[2/5] Resetting SuperTokens...${NC}"

  if [ -n "$POSTGRES_CONTAINER" ]; then
    docker exec -i "$POSTGRES_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$SCRIPT_DIR/reset-supertokens-users.sql" 2>/dev/null || true
  elif command -v psql &> /dev/null; then
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$SCRIPT_DIR/reset-supertokens-users.sql" 2>/dev/null || true
  fi

  echo -e "${GREEN}  ✓ SuperTokens data cleared${NC}"
}

# Reset MinIO storage
reset_minio() {
  echo -e "${YELLOW}[3/5] Resetting MinIO storage...${NC}"

  if [ -n "$MINIO_CONTAINER" ]; then
    echo "  Using Docker container: $MINIO_CONTAINER"

    docker exec "$MINIO_CONTAINER" sh -c '
      # Configure mc alias
      mc alias set local http://localhost:9000 ${MINIO_ROOT_USER} ${MINIO_ROOT_PASSWORD} 2>/dev/null || true

      # Remove all objects from the assets bucket
      mc rm --recursive --force local/assets 2>/dev/null || true

      # Recreate the bucket if it was deleted
      mc mb local/assets 2>/dev/null || true

      # Set bucket policy to allow downloads
      mc anonymous set download local/assets 2>/dev/null || true
    ' 2>/dev/null || {
      echo -e "${YELLOW}  (MinIO reset skipped - bucket may not exist yet)${NC}"
    }

    echo -e "${GREEN}  ✓ MinIO storage cleared${NC}"
  else
    echo -e "${YELLOW}  (MinIO container not found - skipping storage reset)${NC}"
  fi
}

# Reset nginx config files
reset_nginx_configs() {
  echo -e "${YELLOW}[4/5] Resetting nginx configs...${NC}"

  if [ -n "$NGINX_CONTAINER" ]; then
    echo "  Using Docker container: $NGINX_CONTAINER"

    # Remove domain-*.conf, redirect-*.conf, and primary-content.conf from sites-enabled
    docker exec "$NGINX_CONTAINER" sh -c '
      cd /etc/nginx/sites-enabled 2>/dev/null || exit 0
      rm -f domain-*.conf redirect-*.conf primary-content.conf 2>/dev/null
      echo "  Removed nginx config files"
    ' 2>/dev/null || {
      echo -e "${YELLOW}  (nginx config cleanup skipped - container may not be ready)${NC}"
    }

    # Reload nginx to pick up changes
    docker exec "$NGINX_CONTAINER" nginx -s reload 2>/dev/null || {
      echo -e "${YELLOW}  (nginx reload skipped)${NC}"
    }

    echo -e "${GREEN}  ✓ Nginx configs cleared${NC}"
  else
    echo -e "${YELLOW}  (Nginx container not found - skipping nginx cleanup)${NC}"
  fi
}

# Run database migrations
run_migrations() {
  echo -e "${YELLOW}[5/5] Running database migrations...${NC}"

  cd "$PROJECT_ROOT"
  if pnpm db:migrate 2>/dev/null; then
    echo -e "${GREEN}  ✓ Database migrations complete${NC}"
  else
    echo -e "${YELLOW}  (Migrations may have warnings but reset is complete)${NC}"
  fi
}

# Main execution
main() {
  # Print warning unless --force
  if [ "$FORCE" != true ]; then
    print_warning

    echo -n "Type 'RESET' to confirm: "
    read -r confirmation

    if [ "$confirmation" != "RESET" ]; then
      echo -e "${YELLOW}Reset cancelled.${NC}"
      exit 0
    fi
    echo ""
  fi

  # Detect containers
  detect_containers

  echo -e "${BLUE}Starting reset...${NC}"
  echo ""

  # Reset PostgreSQL
  if [ -n "$POSTGRES_CONTAINER" ]; then
    reset_postgres_docker
  elif command -v psql &> /dev/null; then
    reset_postgres_local
  else
    echo -e "${RED}❌ No database found!${NC}"
    echo ""
    echo "Options:"
    echo "  - Start production Docker: pnpm docker:up"
    echo "  - Start development Docker: pnpm dev:services"
    echo "  - Install PostgreSQL locally"
    echo "  - Set DB_* environment variables for custom connection"
    exit 1
  fi

  # Reset SuperTokens
  reset_supertokens

  # Reset MinIO
  reset_minio

  # Reset nginx configs
  reset_nginx_configs

  # Run migrations
  run_migrations

  echo ""
  echo -e "${GREEN}===============================================================================${NC}"
  echo -e "${GREEN}                          ✅ Reset Complete!${NC}"
  echo -e "${GREEN}"
  echo -e "  The platform has been reset to a fresh state."
  echo -e ""
  echo -e "  Next steps:"
  echo -e "    1. Open your browser to your domain"
  echo -e "    2. Complete the setup wizard"
  echo -e "${GREEN}"
  echo -e "===============================================================================${NC}"
}

main

