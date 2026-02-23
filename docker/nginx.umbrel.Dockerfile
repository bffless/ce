# Umbrel-specific nginx image
# Contains:
# - nginx.conf.template for Umbrel's Cloudflare Tunnel setup
# - Setup wizard page shown on internal access (umbrel.local)
# - Entrypoint that processes config template and watches for reloads

FROM nginx:1.27-alpine

# Install inotify-tools for config watching
RUN apk add --no-cache inotify-tools

# Copy nginx configuration template
COPY umbrel/nginx.conf.template /etc/nginx/nginx.conf.template

# Copy setup wizard files (shown when accessing via internal URL)
COPY umbrel/setup/ /usr/share/nginx/html/setup/

# Copy entrypoint script
COPY docker/nginx-umbrel-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create directories for dynamic configs
RUN mkdir -p /etc/nginx/sites-enabled /app/config

EXPOSE 5537

ENTRYPOINT ["/entrypoint.sh"]
