#!/bin/sh
# Boot guard: never let one bad per-domain file keep nginx from starting.
#
# nginx starts alongside the backend and loads whatever is in sites-enabled
# at that moment. The backend regenerates every config in place after it
# boots, but an invalid leftover — a rotated or removed certificate path, a
# file from a template the upgrade changed — fails `nginx -t` as a whole and
# nginx refuses to start, taking every site down and crash-looping until the
# backend's rewrite lands (and it cannot land if the backend depends on a
# healthy proxy). So: validate before starting; when the failing directive is
# in a sites-enabled file, move that file aside (`<name>.invalid`, outside the
# `*.conf` include) and validate again. The backend regenerates the real file
# from the database within seconds of its own start; the `.invalid` copy stays
# for the operator to inspect. A failure anywhere else (main config, missing
# module) is not ours to hide: it is reported and the caller decides.
#
# Host-testable: nginx-boot-guard.test.sh runs `quarantine_invalid_sites`
# with a shim nginx on PATH and NGINX_SITES_DIR pointing at a sandbox.

SITES_DIR="${NGINX_SITES_DIR:-/etc/nginx/sites-enabled}"
MAX_QUARANTINE="${NGINX_BOOT_GUARD_MAX:-20}"

# Prints the sites-enabled file `nginx -t`'s first error names, or nothing.
# nginx reports the location as `in <path>:<line>`.
failing_site_file() {
  nginx -t 2>&1 | sed -n "s#.* in \(${SITES_DIR}/[^:]*\.conf\):[0-9]*.*#\1#p" | head -n1
}

# Returns 0 when nginx's configuration validates (possibly after quarantining
# files), 1 when it still fails for a reason outside sites-enabled.
quarantine_invalid_sites() {
  n=0
  while ! nginx -t >/dev/null 2>&1; do
    bad="$(failing_site_file)"
    if [ -z "$bad" ] || [ ! -f "$bad" ]; then
      echo "❌ nginx configuration invalid outside ${SITES_DIR}; not quarantining:" >&2
      nginx -t 2>&1 | tail -n 3 >&2
      return 1
    fi
    n=$((n + 1))
    if [ "$n" -gt "$MAX_QUARANTINE" ]; then
      echo "❌ quarantined ${MAX_QUARANTINE} files and nginx still fails; giving up" >&2
      return 1
    fi
    mv "$bad" "$bad.invalid"
    echo "⚠️  quarantined invalid site config $(basename "$bad") → $(basename "$bad").invalid (the backend regenerates it from the database)" >&2
  done
  return 0
}

# When executed (not sourced), run the guard.
case "$0" in
  *nginx-boot-guard.sh) quarantine_invalid_sites ;;
esac
