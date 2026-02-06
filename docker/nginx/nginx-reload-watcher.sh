#!/bin/sh
echo "🔄 Starting nginx config watcher..."

while true; do
  # Wait for file changes in sites-enabled directory OR ssl directory
  # This ensures nginx reloads when:
  # 1. Config files change (domain mappings, etc.)
  # 2. SSL certificates are created/updated (wildcard certs, custom domain certs)
  inotifywait -e create,modify,delete -q /etc/nginx/sites-enabled/ /etc/nginx/ssl/ 2>/dev/null

  echo "📝 Config/certificate change detected, waiting for write to complete..."
  sleep 1

  echo "🔍 Validating nginx configuration..."

  # Validate config before reloading
  if nginx -t 2>&1 | grep -q "successful"; then
    echo "✅ Config valid, reloading nginx..."
    nginx -s reload
    echo "🔄 Nginx reloaded successfully at $(date)"
  else
    echo "❌ Config invalid, skipping reload"
    nginx -t
  fi

  # Debounce - wait before watching again
  sleep 2
done
