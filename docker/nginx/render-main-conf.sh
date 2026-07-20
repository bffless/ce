#!/bin/sh
# Re-runnable main-config renderer. Called by docker-entrypoint.sh at start and
# by nginx-reload-watcher.sh when /etc/nginx/bootstrap/ or certs change.
# Decides between BOOTSTRAP mode (no domain identity + no certs) and NORMAL mode.
set -e

SSL_DIR="/etc/nginx/ssl"
BOOTSTRAP_DIR="/etc/nginx/bootstrap"
SITES_AVAILABLE="/etc/nginx/sites-available"

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

have_certs() {
    [ -f "${SSL_DIR}/fullchain.pem" ] && [ -f "${SSL_DIR}/privkey.pem" ]
}

if [ "${STATE}" != "applied" ] && ! have_certs; then
    # ------------------------- BOOTSTRAP MODE -------------------------
    echo "🥾 Bootstrap mode: no domain identity and no certificates"
    mkdir -p /var/www/acme "${SSL_DIR}"

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
    echo "# realip inactive in bootstrap mode" > /etc/nginx/cloudflare-realip.conf
    echo "✅ Bootstrap config rendered"
    exit 0
fi

# --------------------------- NORMAL MODE ---------------------------
if [ -z "${PRIMARY_DOMAIN}" ]; then
    echo "❌ Certs exist but PRIMARY_DOMAIN is unset — cannot render"
    exit 1
fi
echo "🔧 Rendering nginx config for PRIMARY_DOMAIN: ${PRIMARY_DOMAIN} (PROXY_MODE=${PROXY_MODE})"

if [ "${PROXY_MODE}" = "cloudflare" ]; then
    # =========================================================================
    # Cloudflare mode
    # =========================================================================
    # - Expects Cloudflare Origin Certificates in ssl/
    # - Drops direct HTTP connections (Cloudflare handles HTTPS at edge)
    # - Configures real_ip from Cloudflare IP ranges
    # =========================================================================

    # Validate main cert (Origin Certificate from Cloudflare)
    if [ -f "${SSL_DIR}/fullchain.pem" ] && [ -f "${SSL_DIR}/privkey.pem" ]; then
        echo "✅ SSL certificates found (fullchain.pem, privkey.pem)"
    else
        echo "❌ SSL certificates not found!"
        echo ""
        echo "   Cloudflare mode requires Origin Certificates."
        echo "   Generate one in the Cloudflare dashboard:"
        echo "   SSL/TLS > Origin Server > Create Certificate"
        echo ""
        echo "   Save the certificate and key to the ssl/ directory:"
        echo "   ssl/fullchain.pem  (Origin Certificate)"
        echo "   ssl/privkey.pem    (Private Key)"
        echo ""
        echo "   See: https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/"
        echo ""
        exit 1
    fi

    # Wildcard cert handling for Cloudflare
    # Cloudflare Origin Certificates typically include *.domain.com SAN,
    # so the main cert can serve wildcard subdomains too.
    if [ -f "${SSL_DIR}/wildcard.${PRIMARY_DOMAIN}.crt" ] && [ -f "${SSL_DIR}/wildcard.${PRIMARY_DOMAIN}.key" ]; then
        echo "✅ Wildcard certificate found (separate files)"
        WILDCARD_CERT="${SSL_DIR}/wildcard.${PRIMARY_DOMAIN}.crt"
        WILDCARD_KEY="${SSL_DIR}/wildcard.${PRIMARY_DOMAIN}.key"
    else
        echo "ℹ️  No separate wildcard cert — using main Origin Certificate"
        echo "   (Cloudflare Origin Certs typically include *.${PRIMARY_DOMAIN} SAN)"
        WILDCARD_CERT="${SSL_DIR}/fullchain.pem"
        WILDCARD_KEY="${SSL_DIR}/privkey.pem"
    fi

    # Drop direct HTTP connections — Cloudflare handles HTTPS at edge
    PORT80_ACTION="return 444;"

    # Generate Cloudflare real IP configuration
    echo "📝 Generating Cloudflare real IP configuration..."
    cat > /etc/nginx/cloudflare-realip.conf <<'CFEOF'
# Cloudflare IP ranges (https://www.cloudflare.com/ips/)
# Last updated: 2026-02-02

# IPv4
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

# IPv6
set_real_ip_from 2400:cb00::/32;
set_real_ip_from 2606:4700::/32;
set_real_ip_from 2803:f800::/32;
set_real_ip_from 2405:b500::/32;
set_real_ip_from 2405:8100::/32;
set_real_ip_from 2a06:98c0::/29;
set_real_ip_from 2c0f:f248::/32;

real_ip_header CF-Connecting-IP;
CFEOF
    echo "✅ Cloudflare real IP configuration generated"

else
    # =========================================================================
    # Default mode (none) — standard Let's Encrypt / self-managed certs
    # =========================================================================

    # Check if SSL certificates exist (required - generated by setup.sh via certbot)
    if [ -f "${SSL_DIR}/fullchain.pem" ] && [ -f "${SSL_DIR}/privkey.pem" ]; then
        echo "✅ SSL certificates found (fullchain.pem, privkey.pem)"
    else
        echo "❌ SSL certificates not found!"
        echo ""
        echo "   The main SSL certificates are required for nginx to start."
        echo "   These should have been generated by the setup script via certbot."
        echo ""
        echo "   To generate certificates manually:"
        echo "   certbot certonly --standalone -d ${PRIMARY_DOMAIN} -d www.${PRIMARY_DOMAIN} -d admin.${PRIMARY_DOMAIN} -d minio.${PRIMARY_DOMAIN}"
        echo ""
        echo "   Then copy to ssl/ directory:"
        echo "   cp /etc/letsencrypt/live/${PRIMARY_DOMAIN}/fullchain.pem ssl/"
        echo "   cp /etc/letsencrypt/live/${PRIMARY_DOMAIN}/privkey.pem ssl/"
        echo ""
        exit 1
    fi

    # Check for wildcard cert (should have been created by setup.sh)
    # The wildcard cert is used by the catch-all server block for unmatched subdomains.
    # This can be a Let's Encrypt wildcard cert or a self-signed fallback.
    if [ -f "${SSL_DIR}/wildcard.${PRIMARY_DOMAIN}.crt" ] && [ -f "${SSL_DIR}/wildcard.${PRIMARY_DOMAIN}.key" ]; then
        echo "✅ Wildcard certificate found"
        WILDCARD_CERT="${SSL_DIR}/wildcard.${PRIMARY_DOMAIN}.crt"
        WILDCARD_KEY="${SSL_DIR}/wildcard.${PRIMARY_DOMAIN}.key"
    else
        echo "❌ Wildcard certificate not found!"
        echo ""
        echo "   Expected files:"
        echo "   - ${SSL_DIR}/wildcard.${PRIMARY_DOMAIN}.crt"
        echo "   - ${SSL_DIR}/wildcard.${PRIMARY_DOMAIN}.key"
        echo ""
        echo "   These should have been created by the setup script."
        echo ""
        echo "   Option 1: Generate Let's Encrypt wildcard cert (recommended):"
        echo "   certbot certonly --manual --preferred-challenges dns -d \"*.${PRIMARY_DOMAIN}\""
        echo "   cp /etc/letsencrypt/live/${PRIMARY_DOMAIN}/fullchain.pem ssl/wildcard.${PRIMARY_DOMAIN}.crt"
        echo "   cp /etc/letsencrypt/live/${PRIMARY_DOMAIN}/privkey.pem ssl/wildcard.${PRIMARY_DOMAIN}.key"
        echo ""
        echo "   Option 2: Generate self-signed wildcard cert (quick fix):"
        echo "   openssl req -x509 -nodes -days 365 -newkey rsa:2048 \\"
        echo "     -keyout ssl/wildcard.${PRIMARY_DOMAIN}.key \\"
        echo "     -out ssl/wildcard.${PRIMARY_DOMAIN}.crt \\"
        echo "     -subj \"/CN=*.${PRIMARY_DOMAIN}\""
        echo ""
        exit 1
    fi

    # Redirect HTTP to HTTPS
    PORT80_ACTION="return 301 https://\$host\$request_uri;"

    # Generate empty Cloudflare real IP config (placeholder)
    cat > /etc/nginx/cloudflare-realip.conf <<'CFEOF'
# Cloudflare real IP configuration (inactive — PROXY_MODE is not cloudflare)
CFEOF

fi

export WILDCARD_CERT
export WILDCARD_KEY
export PORT80_ACTION

# Generate base configuration
echo "📝 Generating base nginx configuration..."
# shellcheck disable=SC2016 # single quotes are intentional: envsubst's variable-list
# argument wants the literal ${VAR} tokens, not shell-expanded values.
envsubst '${PRIMARY_DOMAIN} ${WILDCARD_CERT} ${WILDCARD_KEY} ${PORT80_ACTION}' < /etc/nginx/sites-available/main.conf.template > /etc/nginx/sites-available/main.conf

# Conditionally generate MinIO configuration
if [ "${ENABLE_MINIO:-false}" = "true" ]; then
    echo "✅ MinIO enabled - generating minio proxy config"
    # shellcheck disable=SC2016 # see justification above
    envsubst '${PRIMARY_DOMAIN}' < /etc/nginx/sites-available/minio.conf.template > /etc/nginx/sites-available/minio.conf
else
    echo "⚠️  MinIO disabled - generating placeholder config"
    # shellcheck disable=SC2016 # see justification above
    envsubst '${PRIMARY_DOMAIN}' < /etc/nginx/sites-available/minio-disabled.conf.template > /etc/nginx/sites-available/minio.conf
fi

echo "✅ Nginx configuration generated"
