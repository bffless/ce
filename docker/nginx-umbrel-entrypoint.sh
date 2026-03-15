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

# If PRIMARY_DOMAIN is localhost, add a catch-all server block that shows setup instructions
# This catches requests from actual domains when the user hasn't configured their domain yet
# The default_server must be moved to this new block so it catches non-localhost requests
if [ "$PRIMARY_DOMAIN" = "localhost" ]; then
    echo "⚠️  Domain not configured - adding catch-all server for setup instructions"

    # Remove default_server from the wildcard block so our catch-all takes precedence
    sed -i 's/listen 5537 default_server;/listen 5537;/' /etc/nginx/conf.d/default.conf

    # Add catch-all server block that shows the setup instructions page
    cat >> /etc/nginx/conf.d/default.conf << 'CATCHALL'

# ============================================================================
# Catch-all Server: Domain Not Configured
# ============================================================================
# This server block catches requests from non-localhost domains when PRIMARY_DOMAIN
# is not configured. It shows the setup instructions page instead of a confusing 404.
server {
    listen 5537 default_server;
    server_name _;

    root /usr/share/nginx/html/setup;
    index domain-not-configured.html;

    location / {
        try_files $uri $uri/ /domain-not-configured.html;
    }
}
CATCHALL
fi

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
