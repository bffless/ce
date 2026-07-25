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
if [ -f "$ETC/ssl/fullchain.pem" ] && [ -f "$ETC/ssl/privkey.pem" ] \
   && cmp -s "$ETC/ssl/fullchain.pem" "$ETC/ssl/bootstrap-selfsigned.crt" \
   && cmp -s "$ETC/ssl/privkey.pem" "$ETC/ssl/bootstrap-selfsigned.key"; then
    echo 'ok: selfsigned: fullchain.pem/privkey.pem materialized from the self-signed pair'
else
    echo 'FAIL: selfsigned: fullchain.pem/privkey.pem not materialized (or does not match the self-signed pair)'; FAILURES=$((FAILURES+1))
fi

# --- selfsigned + a STAGED cert already in place: a re-render triggered by
# the reload watcher (e.g. right after the backend's saveCertificates() writes
# a pasted cert, but before "apply" has flipped SSL_MODE away from selfsigned)
# must NOT clobber it. Regression test: the old unguarded `cp -f` destroyed
# the staged cert here, which made apply's assertStagedCertificateCovers()
# check fail every time — this test fails against that code.
setup_etc 'STATE=applied
PRIMARY_DOMAIN=example.com
PROXY_MODE=proxy
SSL_MODE=selfsigned
PORT80=redirect
REALIP_MODE=off'
printf 'STAGED-REAL-CERT\n' > "$ETC/ssl/fullchain.pem"
printf 'STAGED-REAL-KEY\n' > "$ETC/ssl/privkey.pem"
run_render
assert_contains "$ETC/ssl/fullchain.pem" 'STAGED-REAL-CERT' 'selfsigned: staged fullchain.pem survives a re-render'
assert_contains "$ETC/ssl/privkey.pem"   'STAGED-REAL-KEY'  'selfsigned: staged privkey.pem survives a re-render'
# The admin/wildcard vhosts must still SERVE the self-signed cert directly
# (not the now-foreign staged fullchain.pem) — only the materialization of
# fullchain.pem itself is guarded, PRIMARY_CERT/WILDCARD_CERT are unaffected.
assert_contains "$ETC/sites-available/main.conf" "ssl_certificate $ETC/ssl/bootstrap-selfsigned.crt;" 'selfsigned: admin vhost still serves self-signed cert with a staged fullchain present'

# --- adoption parity: an env-adopted instance.env must render main.conf
# byte-identically to the pure-env legacy render it replaces (spec §2:
# adoption changes nothing nginx serves). Paths embed $ETC, so normalize. ---
setup_etc 'STATE=applied
PRIMARY_DOMAIN=example.com
PROXY_MODE=none
SSL_MODE=letsencrypt'
run_render
ADOPTED_CONF="$(mktemp)"
sed "s|$ETC|@ETC@|g" "$ETC/sites-available/main.conf" > "$ADOPTED_CONF"

# pure-env legacy install: certs present, NO instance.env, NO bootstrap
# marker (a genuine pre-wizard install never rendered bootstrap mode).
ETC="$(mktemp -d)"
mkdir -p "$ETC/ssl" "$ETC/bootstrap" "$ETC/sites-available"
cp "$HERE/sites-available/"*.template "$ETC/sites-available/"
openssl req -x509 -nodes -days 2 -newkey rsa:2048 -keyout "$ETC/ssl/privkey.pem" \
    -out "$ETC/ssl/fullchain.pem" -subj "/CN=test" 2>/dev/null
cp "$ETC/ssl/fullchain.pem" "$ETC/ssl/wildcard.example.com.crt"
cp "$ETC/ssl/privkey.pem" "$ETC/ssl/wildcard.example.com.key"
( NGINX_ETC="$ETC" CERTBOT_ROOT="$ETC/certbot" PRIMARY_DOMAIN=example.com PROXY_MODE=none \
    sh "$HERE/render-main-conf.sh" >/dev/null )
LEGACY_CONF="$(mktemp)"
sed "s|$ETC|@ETC@|g" "$ETC/sites-available/main.conf" > "$LEGACY_CONF"

if diff -u "$LEGACY_CONF" "$ADOPTED_CONF" >/dev/null; then
    echo "ok: adoption parity: adopted instance.env renders identically to pure env"
else
    echo "FAIL: adoption parity: adopted vs pure-env main.conf differ:"
    diff -u "$LEGACY_CONF" "$ADOPTED_CONF" || true
    FAILURES=$((FAILURES+1))
fi

# --- C1: selfsigned WITHOUT a pre-existing pair (env-adopted install) ---
# Adoption gates on the marker being ABSENT, so an adopted install that
# switches to selfsigned day-2 has no bootstrap-selfsigned.* at all. The
# render must generate the pair on demand instead of exit-1 (which silently
# no-ops under the watcher and crash-loops nginx on the next restart).
setup_etc 'STATE=applied
PRIMARY_DOMAIN=example.com
PROXY_MODE=proxy
SSL_MODE=selfsigned
PORT80=redirect
REALIP_MODE=off'
rm -f "$ETC/ssl/bootstrap-selfsigned.crt" "$ETC/ssl/bootstrap-selfsigned.key"
rm -f "$ETC/ssl/fullchain.pem" "$ETC/ssl/privkey.pem"
run_render
[ -f "$ETC/ssl/bootstrap-selfsigned.crt" ] && echo "ok: C1 pair generated on demand" \
    || { echo "FAIL: C1 selfsigned pair not generated"; FAILURES=$((FAILURES+1)); }
[ -f "$ETC/ssl/fullchain.pem" ] && echo "ok: C1 fullchain materialized" \
    || { echo "FAIL: C1 fullchain.pem not materialized"; FAILURES=$((FAILURES+1)); }
key_mode=$(stat -c '%a' "$ETC/ssl/bootstrap-selfsigned.key" 2>/dev/null || stat -f '%Lp' "$ETC/ssl/bootstrap-selfsigned.key")
[ "$key_mode" = "600" ] && echo "ok: C1 key is 0600" \
    || { echo "FAIL: C1 key mode is $key_mode"; FAILURES=$((FAILURES+1)); }
assert_contains "$ETC/sites-available/main.conf" 'bootstrap-selfsigned.crt' 'C1: vhosts serve the generated pair'

[ "$FAILURES" -eq 0 ] && echo 'ALL RENDER TESTS PASSED' || { echo "$FAILURES FAILURES"; exit 1; }
