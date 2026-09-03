#!/bin/sh
# Reloads nginx when the backend writes per-domain configs, certificates or the
# bootstrap marker. Host-testable: nginx-reload-watcher.test.sh runs it with
# shim inotifywait/nginx/render binaries on PATH and NGINX_WATCH_* overrides.

WATCHED_PATHS="${NGINX_WATCH_PATHS:-/etc/nginx/sites-enabled/ /etc/nginx/ssl/ /etc/nginx/bootstrap/}"
# How long the watched paths must stay quiet before a burst of writes is
# treated as complete. The backend's startup regeneration rewrites every
# domain config within a couple of seconds; reloading in the middle of that
# burst loads a partial set of server blocks and — with the old one-event
# design — nothing reloaded again afterwards (#747).
QUIET_SECONDS="${NGINX_WATCH_QUIET_SECONDS:-2}"
RENDER="${NGINX_WATCH_RENDER:-/usr/local/bin/render-main-conf.sh}"
# Set by the test harness to stop after N reload cycles; unset = forever.
MAX_CYCLES="${NGINX_WATCH_MAX_CYCLES:-}"

# A digest of every watched file's name, size and mtime. Compared before and
# after a reload cycle: any write that landed while this script was busy
# rendering/validating/reloading (no inotifywait armed) shows up as a
# different digest and gets its own cycle instead of being lost.
fingerprint() {
  # shellcheck disable=SC2086 # WATCHED_PATHS is a space-separated list on purpose
  find $WATCHED_PATHS -maxdepth 1 -type f 2>/dev/null | sort | while IFS= read -r f; do
    stat -c '%n %s %Y' "$f" 2>/dev/null
  done | md5sum | cut -d' ' -f1
}

# Keep re-arming the watch until the paths have been quiet for QUIET_SECONDS.
# inotifywait exits 0 on an event (keep draining), 2 on timeout (quiet), 1 on
# error (stop draining and let the cycle proceed rather than spin).
drain_burst() {
  # shellcheck disable=SC2086
  while inotifywait -t "$QUIET_SECONDS" -e create,modify,delete,moved_to -q $WATCHED_PATHS 2>/dev/null; do :; done
}

# One render → validate → reload pass. Returns 0 when nginx was reloaded.
reload_cycle() {
  echo "🔧 Re-rendering nginx config..."
  # A render failure must never fall through to validate/reload — that would
  # risk reloading nginx onto a half-written or stale sites-available/main.conf.
  # render-main-conf.sh writes only unwatched paths (sites-available/, the
  # realip include) plus existence-guarded certs, so it cannot re-trigger us.
  if ! "$RENDER"; then
    echo "❌ Render failed, skipping reload"
    return 1
  fi
  echo "🔍 Validating nginx configuration..."
  if nginx -t 2>&1 | grep -q "successful"; then
    echo "✅ Config valid, reloading nginx..."
    nginx -s reload
    echo "🔄 Nginx reloaded successfully at $(date)"
    return 0
  fi
  echo "❌ Config invalid, skipping reload"
  nginx -t
  return 1
}

echo "🔄 Starting nginx config watcher..."
cycles=0
while true; do
  # /etc/nginx/bootstrap/ is a bind mount the backend's apply step writes
  # instance.env into; it may not exist yet on an older install. inotifywait
  # fails immediately on a missing path, so make its existence an invariant.
  mkdir -p /etc/nginx/bootstrap 2>/dev/null

  # moved_to is required: the backend and render-main-conf.sh write via
  # rename-into-place, which inotify reports as moved_to on the final name.
  # shellcheck disable=SC2086
  if ! inotifywait -e create,modify,delete,moved_to -q $WATCHED_PATHS 2>/dev/null; then
    # A watched path is missing or unreadable. Back off so this can never
    # become a CPU-burning spin, and say so — inotifywait's stderr is discarded.
    echo "⚠️  inotifywait failed (watched path missing or unreadable), retrying in 2s..." >&2
    sleep 2
    continue
  fi
  echo "📝 Config/certificate/bootstrap change detected, waiting for the burst to settle..."

  # Reload once per burst, and once more for anything that landed while we
  # were busy — never leave nginx on a partial set of server blocks.
  while :; do
    drain_burst
    before="$(fingerprint)"
    reload_cycle
    cycles=$((cycles + 1))
    if [ "$(fingerprint)" = "$before" ]; then
      break
    fi
    echo "📝 More changes landed during the reload, going again..."
  done

  if [ -n "$MAX_CYCLES" ] && [ "$cycles" -ge "$MAX_CYCLES" ]; then
    echo "test harness: $cycles cycle(s) done, exiting"
    exit 0
  fi
done
