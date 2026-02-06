#!/bin/bash
#
# Asset Host Platform - Docker Compose Stop Script
#
# This script stops all services including those started with profiles.
#
# Usage:
#   ./stop.sh              # Stop all services
#   ./stop.sh --volumes    # Stop and remove volumes (data loss!)
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Asset Host Platform - Stopping Services${NC}"
echo ""

# Parse command line arguments
REMOVE_VOLUMES=false

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --volumes|-v)
            REMOVE_VOLUMES=true
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --volumes, -v   Remove volumes (WARNING: deletes all data)"
            echo "  --help          Show this help message"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
    shift
done

# All profiles that might be running
ALL_PROFILES="--profile postgres --profile minio --profile redis --profile supertokens"

# Stop all services (including profile services)
if [ "$REMOVE_VOLUMES" = true ]; then
    echo -e "${RED}WARNING: This will delete all data!${NC}"
    read -p "Are you sure? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Stopping services and removing volumes..."
        docker compose $ALL_PROFILES down -v
    else
        echo "Cancelled."
        exit 0
    fi
else
    echo "Stopping services..."
    docker compose $ALL_PROFILES down
fi

echo ""
echo -e "${GREEN}Services stopped successfully!${NC}"
