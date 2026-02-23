#!/bin/sh
set -e

echo "🚀 Starting BFFless nginx for Umbrel..."

# Create required directories
mkdir -p /etc/nginx/sites-enabled

# Read PRIMARY_DOMAIN from config file if it exists
DOMAIN_FILE="/app/config/domain.txt"
if [ -f "$DOMAIN_FILE" ]; then
    export PRIMARY_DOMAIN=$(cat "$DOMAIN_FILE" | tr -d '[:space:]')
    echo "📍 Domain configured: $PRIMARY_DOMAIN"
else
    export PRIMARY_DOMAIN="localhost"
    echo "📍 No domain configured - using localhost"
fi

# Generate nginx config from template using envsubst
echo "📝 Generating nginx config for domain: $PRIMARY_DOMAIN"
envsubst '$PRIMARY_DOMAIN' < /etc/nginx/nginx.conf.template > /etc/nginx/conf.d/default.conf

# Validate config
if ! nginx -t 2>&1; then
    echo "❌ Nginx config validation failed!"
    exit 1
fi
echo "✅ Nginx config generated successfully"

# Config watcher - reloads nginx when backend writes new domain configs
(while true; do
    inotifywait -e create,modify,delete -q /etc/nginx/sites-enabled/ 2>/dev/null
    sleep 1
    if nginx -t 2>&1 | grep -q "successful"; then
        nginx -s reload
        echo "🔄 Nginx reloaded at $(date)"
    fi
    sleep 2
done) &

# Start nginx in foreground
exec nginx -g "daemon off;"
