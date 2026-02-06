#!/bin/bash
# Complete reset and setup for development
# Usage: ./scripts/dev-reset-and-setup.sh [local|minio]

set -e

STORAGE_TYPE="${1:-local}"

if [ "$STORAGE_TYPE" != "local" ] && [ "$STORAGE_TYPE" != "minio" ]; then
  echo "❌ Invalid storage type: $STORAGE_TYPE"
  echo "Usage: $0 [local|minio]"
  exit 1
fi

echo "🔄 Development Reset & Setup"
echo "   Storage: $STORAGE_TYPE"
echo ""

# Get the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 1. Reset setup state (--force skips confirmation, reset-setup.sh now handles SuperTokens too)
echo "🗑️  Resetting setup state..."
bash "$SCRIPT_DIR/reset-setup.sh" --force

# Give backend a moment to reload (if running)
echo "⏳ Waiting for backend to reload..."
sleep 2

# 2. Run appropriate setup script
echo ""
if [ "$STORAGE_TYPE" = "local" ]; then
  bash "$SCRIPT_DIR/setup-local.sh"
else
  bash "$SCRIPT_DIR/setup-minio.sh"
fi

echo ""
echo "✅ Development environment ready!"
echo ""
echo "⚠️  IMPORTANT: Restart your backend to apply storage changes!"
echo "   Stop the current backend (Ctrl+C) and run: pnpm dev"

