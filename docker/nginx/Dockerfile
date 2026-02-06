FROM nginx:alpine

# Install inotify-tools for file watching
RUN apk add --no-cache inotify-tools

# Copy base nginx config and blocklist
COPY nginx.conf /etc/nginx/nginx.conf
COPY blocklist.conf /etc/nginx/blocklist.conf

# Create directories
RUN mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled /etc/nginx/error-pages

# Copy error pages (use /etc/nginx/error-pages to avoid volume mount conflicts)
COPY errors/ /etc/nginx/error-pages/

# Copy templates (will be processed by entrypoint)
COPY sites-available/main.conf.template /etc/nginx/sites-available/
COPY sites-available/minio.conf.template /etc/nginx/sites-available/
COPY sites-available/minio-disabled.conf.template /etc/nginx/sites-available/

# Copy watcher script
COPY nginx-reload-watcher.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/nginx-reload-watcher.sh

# Copy and set entrypoint
COPY docker-entrypoint.sh /
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["/bin/sh", "-c", "/usr/local/bin/nginx-reload-watcher.sh & nginx -g 'daemon off;'"]
