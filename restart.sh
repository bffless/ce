#!/bin/bash
# Restart BFFless services: ./stop.sh then ./start.sh.
# Any flags are passed through to start.sh (see ./start.sh --help).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: ./restart.sh [start.sh flags]"
    echo ""
    echo "Stops all services (./stop.sh), then starts them again (./start.sh)."
    echo "Flags are passed through to start.sh, e.g.:"
    echo "  ./restart.sh --all       restart with every optional service"
    echo "  ./restart.sh --minimal   restart with core services only"
    exit 0
fi

./stop.sh
./start.sh "$@"
