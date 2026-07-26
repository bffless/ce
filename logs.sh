#!/bin/bash
# Follow logs from all BFFless services, or a single service.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: ./logs.sh [service]"
    echo ""
    echo "Follows logs (last 100 lines) for all services, or one of:"
    echo "  nginx backend frontend postgres minio redis supertokens"
    exit 0
fi

# Pass every profile (same trick as stop.sh) so any service that exists is
# included, whatever this install has enabled.
ALL_PROFILES="--profile postgres --profile minio --profile redis --profile supertokens"
# shellcheck disable=SC2086  # ALL_PROFILES is an arg list by design
docker compose $ALL_PROFILES logs -f --tail=100 "$@"
