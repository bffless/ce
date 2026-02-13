# Production stage - uses pre-built dist from CI
# This Dockerfile is used when the frontend is already built in CI
# Saves ~60s by skipping pnpm install and build
#
# Fresh file sync: On every container start, files are synced from the image
# to the mounted volume. This ensures updates are applied without needing to
# manually clear the volume (no more `--fresh` flag needed).

FROM node:20-alpine

WORKDIR /app

# Copy pre-built dist folder to a source directory (not the volume mount point)
# This allows us to sync fresh files on every container start
COPY apps/frontend/dist ./dist-source

# Create the entrypoint script that syncs files on startup
RUN echo '#!/bin/sh' > /app/entrypoint.sh && \
    echo 'echo "🔄 Syncing frontend files..."' >> /app/entrypoint.sh && \
    echo 'rm -rf /app/dist/*' >> /app/entrypoint.sh && \
    echo 'cp -r /app/dist-source/* /app/dist/' >> /app/entrypoint.sh && \
    echo 'echo "✅ Frontend files synced ($(ls /app/dist | wc -l) items)"' >> /app/entrypoint.sh && \
    echo 'exec tail -f /dev/null' >> /app/entrypoint.sh && \
    chmod +x /app/entrypoint.sh

# Create empty dist directory for volume mount
RUN mkdir -p /app/dist

ENTRYPOINT ["/app/entrypoint.sh"]
