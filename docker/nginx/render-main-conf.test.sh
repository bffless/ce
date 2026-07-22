#!/bin/sh
# Host-runnable render harness: builds a fake NGINX_ETC in a temp dir, runs the
# renderer for each knob combination, and asserts on the generated files.
# Requires: envsubst (gettext), openssl. Run: sh docker/nginx/render-main-conf.test.sh
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
FAILURES=0

assert_contains() { # file needle label
    if grep -qF "$2" "$1"; then echo "ok: $3"; else echo "FAIL: $3 (missing '$2' in $1)"; FAILURES=$((FAILURES+1)); fi
}
assert_not_contains() {
    if grep -qF "$2" "$1"; then echo "FAIL: $3 (unexpected '$2' in $1)"; FAILURES=$((FAILURES+1)); else echo "ok: $3"; fi
}

setup_etc() { # $1 = instance.env content
    ETC="$(mktemp -d)"
    mkdir -p "$ETC/ssl" "$ETC/bootstrap" "$ETC/sites-available"
    cp "$HERE/sites-available/"*.template "$ETC/sites-available/"
    # Applied installs need certs + the bootstrap marker; mint throwaways.
    openssl req -x509 -nodes -days 2 -newkey rsa:2048 -keyout "$ETC/ssl/privkey.pem" \
        -out "$ETC/ssl/fullchain.pem" -subj "/CN=test" 2>/dev/null
    cp "$ETC/ssl/fullchain.pem" "$ETC/ssl/wildcard.example.com.crt"
    cp "$ETC/ssl/privkey.pem" "$ETC/ssl/wildcard.example.com.key"
    touch "$ETC/ssl/bootstrap-selfsigned.crt" "$ETC/ssl/bootstrap-selfsigned.key"
    printf '%s\n' "$1" > "$ETC/bootstrap/instance.env"
}

run_render() {
    ( unset PRIMARY_DOMAIN PROXY_MODE SSL_MODE PORT80 REALIP_MODE REALIP_HEADER REALIP_RANGES
      NGINX_ETC="$ETC" CERTBOT_ROOT="$ETC/certbot" sh "$HERE/render-main-conf.sh" >/dev/null )
}

# --- cloudflare preset: closed port 80, CF realip ---
setup_etc 'STATE=applied
PRIMARY_DOMAIN=example.com
PROXY_MODE=cloudflare
SSL_MODE=paste
PORT80=closed
REALIP_MODE=cloudflare'
run_render
assert_contains     "$ETC/sites-available/main.conf" 'return 444;'                    'cloudflare: port 80 closed'
assert_not_contains "$ETC/sites-available/main.conf" 'acme-challenge'                 'cloudflare: no ACME location'
assert_contains     "$ETC/cloudflare-realip.conf"    'real_ip_header CF-Connecting-IP;' 'cloudflare: CF realip header'
assert_contains     "$ETC/cloudflare-realip.conf"    'set_real_ip_from 173.245.48.0/20;' 'cloudflare: CF ranges'

# --- proxy + custom realip: redirect + ACME + generated ranges ---
setup_etc 'STATE=applied
PRIMARY_DOMAIN=example.com
PROXY_MODE=proxy
SSL_MODE=paste
PORT80=redirect
REALIP_MODE=custom
REALIP_HEADER=True-Client-IP
REALIP_RANGES="151.101.0.0/16 2a04:4e40::/32"'
run_render
assert_contains "$ETC/sites-available/main.conf" 'return 301 https://$host$request_uri;' 'proxy: port 80 redirects'
assert_contains "$ETC/sites-available/main.conf" '/.well-known/acme-challenge/'          'proxy: ACME location present'
assert_contains "$ETC/cloudflare-realip.conf"    'set_real_ip_from 151.101.0.0/16;'      'proxy: custom range 1'
assert_contains "$ETC/cloudflare-realip.conf"    'set_real_ip_from 2a04:4e40::/32;'      'proxy: custom range 2'
assert_contains "$ETC/cloudflare-realip.conf"    'real_ip_header True-Client-IP;'        'proxy: custom header'

# --- direct + letsencrypt: redirect + ACME + realip off ---
setup_etc 'STATE=applied
PRIMARY_DOMAIN=example.com
PROXY_MODE=none
SSL_MODE=letsencrypt
PORT80=redirect
REALIP_MODE=off'
run_render
assert_contains     "$ETC/sites-available/main.conf" '/.well-known/acme-challenge/' 'direct: ACME location present'
assert_not_contains "$ETC/cloudflare-realip.conf"    'set_real_ip_from'             'direct: realip inactive'
assert_contains     "$ETC/sites-available/main.conf" "ssl_certificate $ETC/ssl/fullchain.pem;" 'direct: admin vhost uses fullchain.pem by default'

# --- legacy env-only install (no knobs in instance.env): derives from PROXY_MODE ---
setup_etc 'STATE=applied
PRIMARY_DOMAIN=example.com
PROXY_MODE=cloudflare'
run_render
assert_contains "$ETC/sites-available/main.conf" 'return 444;' 'legacy v1 env: cloudflare derives closed port 80'
assert_contains "$ETC/cloudflare-realip.conf" 'real_ip_header CF-Connecting-IP;' 'legacy v1 env: cloudflare derives CF realip'

# --- proxy + selfsigned: serves the built-in self-signed cert, no fullchain ---
setup_etc 'STATE=applied
PRIMARY_DOMAIN=example.com
PROXY_MODE=proxy
SSL_MODE=selfsigned
PORT80=redirect
REALIP_MODE=off'
# setup_etc mints fullchain.pem/wildcard.* by default — remove them so this
# genuinely proves selfsigned does NOT require a real cert.
rm -f "$ETC/ssl/fullchain.pem" "$ETC/ssl/privkey.pem" \
      "$ETC/ssl/wildcard.example.com.crt" "$ETC/ssl/wildcard.example.com.key"
run_render
assert_contains "$ETC/sites-available/main.conf" "ssl_certificate $ETC/ssl/bootstrap-selfsigned.crt;" 'selfsigned: admin vhost uses self-signed cert'
assert_contains "$ETC/sites-available/main.conf" 'bootstrap-selfsigned.key' 'selfsigned: self-signed key referenced'
assert_not_contains "$ETC/sites-available/main.conf" 'fullchain.pem' 'selfsigned: no fullchain reference'
# The render must materialize fullchain.pem/privkey.pem (copies of the
# self-signed pair) so ANY backend-generated vhost that references the root
# fullchain.pem path resolves instead of crash-looping nginx on a selfsigned
# install — even though main.conf itself points at bootstrap-selfsigned.
if [ -f "$ETC/ssl/fullchain.pem" ] && [ -f "$ETC/ssl/privkey.pem" ]; then
    echo 'ok: selfsigned: fullchain.pem/privkey.pem materialized from the self-signed pair'
else
    echo 'FAIL: selfsigned: fullchain.pem/privkey.pem not materialized'; FAILURES=$((FAILURES+1))
fi

[ "$FAILURES" -eq 0 ] && echo 'ALL RENDER TESTS PASSED' || { echo "$FAILURES FAILURES"; exit 1; }
