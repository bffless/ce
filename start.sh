#!/bin/bash
#
# Asset Host Platform - Docker Compose Startup Script
#
# This script reads configuration from .env and starts Docker Compose
# with the appropriate profiles enabled.
#
# Usage:
#   ./start.sh              # Start with configured profiles
#   ./start.sh --all        # Start with all services
#   ./start.sh --minimal    # Start without optional services
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Asset Host Platform - Starting Services${NC}"
echo ""

# Load environment variables if .env exists
if [ -f ".env" ]; then
    set -a
    source .env
    set +a
    echo -e "Loaded configuration from .env"
else
    echo -e "${YELLOW}Warning: .env file not found, using defaults${NC}"
fi

# Parse command line arguments
FORCE_ALL=false
FORCE_MINIMAL=false
FRESH_FRONTEND=false

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --all) FORCE_ALL=true ;;
        --minimal) FORCE_MINIMAL=true ;;
        --fresh) FRESH_FRONTEND=true ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --all       Start all services (PostgreSQL + MinIO + Redis + SuperTokens)"
            echo "  --minimal   Start without optional services"
            echo "  --fresh     [Deprecated] Clear frontend cache - no longer needed, frontend"
            echo "              now auto-syncs fresh files on every container start"
            echo "  --help      Show this help message"
            echo ""
            echo "Without options, reads from .env:"
            echo "  ENABLE_POSTGRES    - Enable local PostgreSQL container (default: true)"
            echo "  ENABLE_MINIO       - Enable local MinIO container (default: true)"
            echo "  ENABLE_REDIS       - Enable local Redis container (default: true)"
            echo "  SUPERTOKENS_MODE   - 'local' for local container, 'platform' for external (default: local)"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
    shift
done

# Clear frontend cache if --fresh flag is set (deprecated - kept for backwards compatibility)
if [ "$FRESH_FRONTEND" = true ]; then
    echo -e "${YELLOW}Note: --fresh is deprecated. Frontend now auto-syncs fresh files on every start.${NC}"
    echo -e "${YELLOW}Clearing frontend cache anyway...${NC}"
    # Stop frontend container if running (it locks the volume)
    docker compose stop frontend 2>/dev/null || true
    # Remove the frontend-dist volume using docker compose's project name
    # This handles custom COMPOSE_PROJECT_NAME and different directory names
    VOLUME_NAME=$(docker volume ls --filter "name=frontend-dist" --format "{{.Name}}" | head -1)
    if [ -n "$VOLUME_NAME" ]; then
        docker volume rm "$VOLUME_NAME" 2>/dev/null || true
        echo -e "${GREEN}Frontend cache cleared ($VOLUME_NAME)${NC}"
    else
        echo -e "${YELLOW}No frontend-dist volume found${NC}"
    fi
    echo ""
fi

# Build profile arguments
PROFILES=""

if [ "$FORCE_ALL" = true ]; then
    PROFILES="--profile postgres --profile minio --profile redis --profile supertokens"
    echo -e "Mode: ${GREEN}All services${NC} (--all flag)"
elif [ "$FORCE_MINIMAL" = true ]; then
    PROFILES=""
    echo -e "Mode: ${YELLOW}Minimal${NC} (--minimal flag)"
else
    # Read from environment (default to true for first-time users)

    # PostgreSQL: Default to running Docker postgres
    if [ "${ENABLE_POSTGRES:-true}" = "true" ]; then
        PROFILES="$PROFILES --profile postgres"
        echo -e "PostgreSQL: ${GREEN}Enabled${NC} (Docker container)"
    else
        # Validate external DATABASE_URL is set
        if [ -z "$DATABASE_URL" ]; then
            echo -e "${RED}Error: ENABLE_POSTGRES=false but DATABASE_URL is not set${NC}"
            echo "   Please set DATABASE_URL in your .env file"
            exit 1
        fi
        # Mask password in DATABASE_URL for display (show protocol://user:***@host:port/db)
        MASKED_URL=$(echo "$DATABASE_URL" | sed -E 's|(://[^:]+:)[^@]+(@)|\1***\2|')
        echo -e "PostgreSQL: ${YELLOW}Disabled${NC} (using external: ${MASKED_URL})"
    fi

    if [ "${ENABLE_MINIO:-true}" = "true" ]; then
        PROFILES="$PROFILES --profile minio"
        echo -e "MinIO: ${GREEN}Enabled${NC}"
    else
        echo -e "MinIO: ${YELLOW}Disabled${NC} (ENABLE_MINIO=false)"
    fi

    if [ "${ENABLE_REDIS:-true}" = "true" ]; then
        PROFILES="$PROFILES --profile redis"
        echo -e "Redis: ${GREEN}Enabled${NC}"
    else
        echo -e "Redis: ${YELLOW}Disabled${NC} (ENABLE_REDIS=false)"
    fi

    # SuperTokens: Include local container unless in platform mode
    if [ "${SUPERTOKENS_MODE:-local}" = "local" ]; then
        PROFILES="$PROFILES --profile supertokens"
        # Check database configuration for SuperTokens
        if [ -n "$SUPERTOKENS_DATABASE_URL" ]; then
            # Mask password in SUPERTOKENS_DATABASE_URL for display
            MASKED_ST_URL=$(echo "$SUPERTOKENS_DATABASE_URL" | sed -E 's|(://[^:]+:)[^@]+(@)|\1***\2|')
            echo -e "SuperTokens: ${GREEN}Enabled${NC} (external DB: ${MASKED_ST_URL})"
        elif [ "${ENABLE_POSTGRES:-true}" = "false" ]; then
            echo -e "SuperTokens: ${RED}Warning${NC} - ENABLE_POSTGRES=false but SUPERTOKENS_DATABASE_URL not set"
            echo -e "           Set SUPERTOKENS_DATABASE_URL in .env for SuperTokens to work"
        else
            echo -e "SuperTokens: ${GREEN}Enabled${NC} (local container + Docker PostgreSQL)"
        fi
    else
        echo -e "SuperTokens: ${YELLOW}Platform mode${NC} (using external: ${SUPERTOKENS_CONNECTION_URI})"
    fi
fi

echo ""

# Calculate memory savings
SAVED_MB=0
if [[ ! "$PROFILES" =~ "postgres" ]]; then
    SAVED_MB=$((SAVED_MB + 256))
fi
if [[ ! "$PROFILES" =~ "minio" ]]; then
    SAVED_MB=$((SAVED_MB + 128))
fi
if [[ ! "$PROFILES" =~ "redis" ]]; then
    SAVED_MB=$((SAVED_MB + 96))
fi
if [[ ! "$PROFILES" =~ "supertokens" ]]; then
    SAVED_MB=$((SAVED_MB + 200))
fi

if [ $SAVED_MB -gt 0 ]; then
    echo -e "${GREEN}Memory savings: ~${SAVED_MB}MB${NC}"
    echo ""
fi

# Build nginx (it's built locally, not pulled from registry)
echo "Building nginx image..."
docker compose build nginx

# Start Docker Compose
echo ""
echo "Starting services..."
echo -e "Command: docker compose${PROFILES} up -d"
echo ""

docker compose $PROFILES up -d

echo ""
echo -e "${GREEN}Services started successfully!${NC}"
echo ""
echo "View logs: docker compose logs -f"
echo "Stop:      ./stop.sh"
