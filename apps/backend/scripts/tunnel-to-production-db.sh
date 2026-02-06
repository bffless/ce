#!/bin/bash
# SSH tunnel to production database on Digital Ocean
# This creates a secure tunnel from your local machine to the database running in Docker

# Usage: bash scripts/tunnel-to-production-db.sh [your-droplet-ip-or-hostname]

DROPLET_HOST="${1:-YOUR_DROPLET_IP}"
LOCAL_PORT=5433  # Using 5433 to avoid conflicts with local postgres on 5432
REMOTE_PORT=5432 # Port on the droplet where postgres is exposed

if [ "$DROPLET_HOST" = "YOUR_DROPLET_IP" ]; then
  echo "Error: Please provide your Digital Ocean droplet IP or hostname"
  echo "Usage: bash scripts/tunnel-to-production-db.sh <droplet-ip-or-hostname>"
  echo "Example: bash scripts/tunnel-to-production-db.sh 142.93.123.45"
  exit 1
fi

echo "Creating SSH tunnel to production database..."
echo "Local port: $LOCAL_PORT -> Remote port: $REMOTE_PORT on $DROPLET_HOST"
echo ""
echo "Once connected, you can access the database at:"
echo "postgresql://postgres:PASSWORD@localhost:$LOCAL_PORT/assethost"
echo ""
echo "Press Ctrl+C to close the tunnel"
echo ""

# Create the SSH tunnel
# -N: Don't execute a remote command
# -L: Local port forwarding
ssh -N -L ${LOCAL_PORT}:localhost:${REMOTE_PORT} root@${DROPLET_HOST}
