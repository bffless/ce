#!/bin/sh
# Re-runnable main-config renderer. Called by docker-entrypoint.sh at start and
# by nginx-reload-watcher.sh when /etc/nginx/bootstrap/ or certs change.
# Decides between BOOTSTRAP mode and NORMAL mode — see should_bootstrap() below
# for the exact gate (STATE=applied, with a legacy-install carve-out).
set -e

NGINX_ETC="${NGINX_ETC:-/etc/nginx}"
SSL_DIR="${NGINX_ETC}/ssl"
BOOTSTRAP_DIR="${NGINX_ETC}/bootstrap"
SITES_AVAILABLE="${NGINX_ETC}/sites-available"
REALIP_CONF="${NGINX_ETC}/cloudflare-realip.conf"
CERTBOT_ROOT="${CERTBOT_ROOT:-/var/www/certbot}"

# Domain identity: instance.env (written by the backend on apply) overrides env.
# STATE is reset unconditionally (not just defaulted) so a stale/injected STATE
# from the container environment can never fake "applied" — the only legitimate
# source of STATE=applied is instance.env itself. PRIMARY_DOMAIN/PROXY_MODE are
# NOT reset the same way: they are expected to arrive from docker-compose's
# `environment:` block (a trusted, operator-controlled source) as the pre-apply
# default, and instance.env is allowed to override them post-apply — that's the
# documented precedence, not a spoofing risk.
STATE=""
if [ -f "${BOOTSTRAP_DIR}/instance.env" ]; then
    # shellcheck disable=SC1091
    . "${BOOTSTRAP_DIR}/instance.env"
fi
PRIMARY_DOMAIN="${PRIMARY_DOMAIN:-}"
PROXY_MODE="${PROXY_MODE:-none}"
# PRIMARY_DOMAIN/PROXY_MODE feed envsubst below, which only sees exported
# variables. They already arrive exported via docker-compose's `environment:`
# block, and POSIX shells preserve the export attribute across a plain
# reassignment (including one made inside the sourced instance.env) — but
# exporting explicitly here removes any doubt for a future compose layout
# where these might only ever be set via instance.env.
export PRIMARY_DOMAIN
export PROXY_MODE

# Knob resolution: instance.env (Task 1's writeInstanceConfig) carries these
# directly for installs applied since the knob rework. Legacy env-only
# installs (no instance.env, or an old one predating the knobs) have none of
# these set, so derive PORT80/REALIP_MODE from PROXY_MODE exactly as
# deriveKnobs does on the backend.
SSL_MODE="${SSL_MODE:-paste}"
PORT80="${PORT80:-}"
REALIP_MODE="${REALIP_MODE:-}"
REALIP_HEADER="${REALIP_HEADER:-X-Forwarded-For}"
REALIP_RANGES="${REALIP_RANGES:-}"
if [ -z "${PORT80}" ]; then
    [ "${PROXY_MODE}" = "cloudflare" ] && PORT80="closed" || PORT80="redirect"
fi
if [ -z "${REALIP_MODE}" ]; then
    [ "${PROXY_MODE}" = "cloudflare" ] && REALIP_MODE="cloudflare" || REALIP_MODE="off"
fi

have_certs() {
    [ -f "${SSL_DIR}/fullchain.pem" ] && [ -f "${SSL_DIR}/privkey.pem" ]
}

# True once this install's nginx has, at some point, rendered the cert-less
# bootstrap config below (which creates this file the first time it runs
# with no real certs present, and never deletes it). Durable for the life of
# the install: the ssl/ volume is bind-mounted and persists across restarts.
have_bootstrap_marker() {
    [ -f "${SSL_DIR}/bootstrap-selfsigned.crt" ]
}

# Whether to render BOOTSTRAP mode vs NORMAL mode. This used to be
# `[ "${STATE}" != "applied" ] && ! have_certs`, which had a half-apply
# window: the web-bootstrap wizard's Domain & SSL step
# (`POST /api/setup/certificates`) stages real fullchain.pem/privkey.pem
# BEFORE Apply (`POST /api/setup/apply`, which writes instance.env with
# STATE=applied) ever runs. The moment those certs land, `have_certs` flips
# true while STATE is still unset, and the watcher-triggered re-render would
# fall through to NORMAL MODE and attempt to cut over to sites-enabled/
# *before* the backend has restarted under its new identity — today that
# happens to fail closed only because the pre-apply PRIMARY_DOMAIN
# (docker-compose's `yourdomain.com` placeholder) doesn't match the
# wildcard cert filename the wizard just wrote; it is not a real guarantee.
#
# Fix: gate on STATE=applied, EXCEPT for installs that have never been
# cert-less at all (no bootstrap marker) — those are genuine legacy
# installs (`./setup.sh` + certbot run before the container's first boot,
# so nginx rendered NORMAL from its very first render and this marker was
# never created) and must keep rendering NORMAL exactly as before, with no
# instance.env in the picture at all.
should_bootstrap() {
    [ "${STATE}" != "applied" ] || return 1
    if have_certs && ! have_bootstrap_marker; then
        return 1
    fi
    return 0
}

if should_bootstrap; then
    # ------------------------- BOOTSTRAP MODE -------------------------
    echo "🥾 Bootstrap mode: no domain identity and no certificates"
    mkdir -p "${CERTBOT_ROOT}" "${SSL_DIR}"

    if [ ! -f "${SSL_DIR}/bootstrap-selfsigned.crt" ]; then
        echo "🔐 Generating self-signed bootstrap certificate..."
        openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
            -keyout "${SSL_DIR}/bootstrap-selfsigned.key" \
            -out "${SSL_DIR}/bootstrap-selfsigned.crt" \
            -subj "/CN=bffless-bootstrap" 2>/dev/null
        chmod 600 "${SSL_DIR}/bootstrap-selfsigned.key"
    fi

    cp "${SITES_AVAILABLE}/bootstrap.conf.template" "${SITES_AVAILABLE}/main.conf"
    # Neutralize minio config in bootstrap mode
    echo "# minio disabled in bootstrap mode" > "${SITES_AVAILABLE}/minio.conf"
    echo "# realip inactive in bootstrap mode" > "${REALIP_CONF}"
    echo "✅ Bootstrap config rendered"
    exit 0
fi

# --------------------------- NORMAL MODE ---------------------------
if [ -z "${PRIMARY_DOMAIN}" ]; then
    echo "❌ Certs exist but PRIMARY_DOMAIN is unset — cannot render"
    exit 1
fi
echo "🔧 Rendering nginx config for PRIMARY_DOMAIN: ${PRIMARY_DOMAIN} (PROXY_MODE=${PROXY_MODE})"

# --- certificates (path selection is knob/file-driven, not vendor-driven) ---
PRIMARY_CERT="${SSL_DIR}/fullchain.pem"
PRIMARY_KEY="${SSL_DIR}/privkey.pem"
if [ "${SSL_MODE}" = "selfsigned" ]; then
    # Behind a proxy/CDN that terminates browser TLS and does not validate the
    # origin certificate (e.g. Bunny's default), the origin keeps serving the
    # built-in self-signed cert — no real cert is ever pasted or issued. Serve
    # it for both the admin and wildcard vhosts.
    if [ ! -f "${SSL_DIR}/bootstrap-selfsigned.crt" ] || [ ! -f "${SSL_DIR}/bootstrap-selfsigned.key" ]; then
        echo "❌ SSL_MODE=selfsigned but bootstrap-selfsigned.crt/.key is missing"
        exit 1
    fi
    echo "✅ Serving the built-in self-signed certificate (a proxy terminates browser TLS)"
    # Backend-generated vhost configs (primary-content, custom/subdomain blocks)
    # can reference /etc/nginx/ssl/fullchain.pem directly. On a selfsigned
    # install that file otherwise never exists, so any such config makes nginx
    # crash-loop on load. Materialize fullchain.pem/privkey.pem as a copy of the
    # self-signed pair so EVERY reference resolves to the cert we intend to
    # serve — regardless of which generator emitted it. This is the robust
    # catch-all; the per-vhost primaryCertPaths() awareness is belt-and-braces.
    cp -f "${SSL_DIR}/bootstrap-selfsigned.crt" "${SSL_DIR}/fullchain.pem"
    cp -f "${SSL_DIR}/bootstrap-selfsigned.key" "${SSL_DIR}/privkey.pem"
    PRIMARY_CERT="${SSL_DIR}/bootstrap-selfsigned.crt"
    PRIMARY_KEY="${SSL_DIR}/bootstrap-selfsigned.key"
    WILDCARD_CERT="${SSL_DIR}/bootstrap-selfsigned.crt"
    WILDCARD_KEY="${SSL_DIR}/bootstrap-selfsigned.key"
else
    if [ -f "${SSL_DIR}/fullchain.pem" ] && [ -f "${SSL_DIR}/privkey.pem" ]; then
        echo "✅ SSL certificates found (fullchain.pem, privkey.pem)"
    else
        echo "❌ SSL certificates not found (fullchain.pem/privkey.pem required)"
        exit 1
    fi
    if [ -f "${SSL_DIR}/wildcard.${PRIMARY_DOMAIN}.crt" ] && [ -f "${SSL_DIR}/wildcard.${PRIMARY_DOMAIN}.key" ]; then
        WILDCARD_CERT="${SSL_DIR}/wildcard.${PRIMARY_DOMAIN}.crt"
        WILDCARD_KEY="${SSL_DIR}/wildcard.${PRIMARY_DOMAIN}.key"
    elif [ "${PROXY_MODE}" = "cloudflare" ]; then
        # Legacy CF installs predating the wildcard.* copies: Origin Certs carry
        # the *.domain SAN, so the generic pair can serve the wildcard vhost.
        echo "ℹ️  No separate wildcard cert — using main certificate (Cloudflare Origin Cert)"
        WILDCARD_CERT="${SSL_DIR}/fullchain.pem"
        WILDCARD_KEY="${SSL_DIR}/privkey.pem"
    else
        echo "❌ Wildcard certificate not found (wildcard.${PRIMARY_DOMAIN}.crt/.key)"
        exit 1
    fi
fi
export PRIMARY_CERT PRIMARY_KEY

# --- port 80 (knob: PORT80) ---
if [ "${PORT80}" = "closed" ]; then
    PORT80_ACTION="return 444;"
    ACME_LOCATION="# port 80 closed — no ACME location"
else
    PORT80_ACTION="return 301 https://\$host\$request_uri;"
    ACME_LOCATION="location /.well-known/acme-challenge/ { root ${CERTBOT_ROOT}; }"
fi

# --- real-IP (knob: REALIP_MODE) ---
case "${REALIP_MODE}" in
cloudflare)
    cat > "${REALIP_CONF}" <<'CFEOF'
# Cloudflare IP ranges (https://www.cloudflare.com/ips/)
# Last updated: 2026-02-02
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 131.0.72.0/22;
set_real_ip_from 2400:cb00::/32;
set_real_ip_from 2606:4700::/32;
set_real_ip_from 2803:f800::/32;
set_real_ip_from 2405:b500::/32;
set_real_ip_from 2405:8100::/32;
set_real_ip_from 2a06:98c0::/29;
set_real_ip_from 2c0f:f248::/32;
real_ip_header CF-Connecting-IP;
CFEOF
    ;;
custom)
    {
        echo "# Custom proxy real-IP trust (REALIP_MODE=custom, from instance.env)"
        # shellcheck disable=SC2086
        for range in ${REALIP_RANGES}; do
            echo "set_real_ip_from ${range};"
        done
        echo "real_ip_header ${REALIP_HEADER};"
    } > "${REALIP_CONF}"
    ;;
*)
    echo "# real-IP trust inactive (REALIP_MODE=off)" > "${REALIP_CONF}"
    ;;
esac

export WILDCARD_CERT WILDCARD_KEY PORT80_ACTION ACME_LOCATION

# Generate base configuration
echo "📝 Generating base nginx configuration..."
# shellcheck disable=SC2016 # single quotes are intentional: envsubst's variable-list
# argument wants the literal ${VAR} tokens, not shell-expanded values.
envsubst '${PRIMARY_DOMAIN} ${PRIMARY_CERT} ${PRIMARY_KEY} ${WILDCARD_CERT} ${WILDCARD_KEY} ${PORT80_ACTION} ${ACME_LOCATION}' \
    < "${SITES_AVAILABLE}/main.conf.template" > "${SITES_AVAILABLE}/main.conf"

# Conditionally generate MinIO configuration
if [ "${ENABLE_MINIO:-false}" = "true" ]; then
    echo "✅ MinIO enabled - generating minio proxy config"
    # shellcheck disable=SC2016 # see justification above
    envsubst '${PRIMARY_DOMAIN}' < "${SITES_AVAILABLE}/minio.conf.template" > "${SITES_AVAILABLE}/minio.conf"
else
    echo "⚠️  MinIO disabled - generating placeholder config"
    # shellcheck disable=SC2016 # see justification above
    envsubst '${PRIMARY_DOMAIN}' < "${SITES_AVAILABLE}/minio-disabled.conf.template" > "${SITES_AVAILABLE}/minio.conf"
fi

echo "✅ Nginx configuration generated"
