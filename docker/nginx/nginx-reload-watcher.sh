#!/bin/sh
echo "🔄 Starting nginx config watcher..."

while true; do
  # /etc/nginx/bootstrap/ is a bind mount added by a later task (the backend's
  # apply step writes instance.env there) and may not exist yet on an older
  # install or before that mount is wired up. inotifywait fails immediately on
  # a missing path; since stderr is discarded below, that failure would
  # otherwise be silent, and — without the guard on the inotifywait exit
  # status further down — the loop would hot-spin (re-arm the watch every
  # iteration with no delay). mkdir -p makes the directory's existence a
  # guaranteed invariant instead of an assumption, so the watch call itself
  # never has a reason to fail on this path.
  mkdir -p /etc/nginx/bootstrap

  # Wait for file changes in sites-enabled (dynamic per-domain configs),
  # ssl (certificates), or bootstrap (instance.env written by the backend on
  # apply). moved_to is required, not optional: both the backend
  # (writeInstanceConfig) and render-main-conf.sh write via rename-into-place
  # for atomicity, which inotify reports as moved_to rather than
  # create/modify on the final filename.
  if ! inotifywait -e create,modify,delete,moved_to -q \
    /etc/nginx/sites-enabled/ /etc/nginx/ssl/ /etc/nginx/bootstrap/ 2>/dev/null; then
    # inotifywait couldn't watch one of the paths (e.g. still missing despite
    # mkdir -p, or some other transient error). Back off before retrying so
    # this can never become a tight, CPU-burning spin loop.
    #
    # Log it: a PERMANENT fault (broken bind mount, bad permissions) retries
    # here forever, and inotifywait's own stderr is discarded above. Without
    # this line the watcher would fail silently and invisibly — the old
    # hot-spin was at least diagnosable from high CPU.
    echo "⚠️  inotifywait failed (watched path missing or unreadable), retrying in 2s..." >&2
    sleep 2
    continue
  fi

  echo "📝 Config/certificate/bootstrap change detected, waiting for write to complete..."
  sleep 1

  # Re-render main config first. This picks up bootstrap→applied transitions
  # (new instance.env) and newly-written certs, and decides bootstrap vs.
  # normal mode itself. A render failure must never fall through to
  # validate/reload — that would risk reloading nginx onto a half-written or
  # stale sites-available/main.conf. This script has no `set -e`, so a
  # non-zero return here only trips the `if`, it can't abort the loop.
  #
  # Feedback-loop check: render-main-conf.sh writes sites-available/*.conf
  # and /etc/nginx/cloudflare-realip.conf, neither of which is a watched
  # path, so those writes cannot re-trigger this watcher. Its writes into a
  # watched directory (ssl/) are all guarded by `[ ! -f ... ]` existence
  # checks — the bootstrap self-signed cert (idempotent after the first run,
  # which normally already happened via docker-entrypoint.sh before this
  # watcher even starts) AND, in SSL_MODE=selfsigned, the fullchain.pem/
  # privkey.pem materialization (guarded so it never overwrites a staged
  # pasted cert already sitting there). So a render triggered by this watcher
  # cannot itself produce another watched-path change: no infinite loop.
  echo "🔧 Re-rendering nginx config..."
  if ! /usr/local/bin/render-main-conf.sh; then
    # No backoff needed: the next statement after `continue` is another
    # blocking inotifywait, so there is no spin to prevent here — unlike the
    # inotifywait-failure branch above, which returns instantly.
    echo "❌ Render failed, skipping reload"
    continue
  fi

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
