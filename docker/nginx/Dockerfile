FROM nginx:alpine

# Install inotify-tools for file watching, openssl for the bootstrap self-signed cert
RUN apk add --no-cache inotify-tools openssl

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
COPY sites-available/bootstrap.conf.template /etc/nginx/sites-available/bootstrap.conf.template

# Copy watcher script
COPY nginx-reload-watcher.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/nginx-reload-watcher.sh

# Boot guard: quarantines an invalid leftover site config so nginx still starts
COPY nginx-boot-guard.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/nginx-boot-guard.sh

# Copy main-config renderer (re-runnable: called by entrypoint and by the watcher)
COPY render-main-conf.sh /usr/local/bin/render-main-conf.sh
RUN chmod +x /usr/local/bin/render-main-conf.sh

# Copy and set entrypoint
COPY docker-entrypoint.sh /
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["/bin/sh", "-c", "/usr/local/bin/nginx-reload-watcher.sh & nginx -g 'daemon off;'"]
