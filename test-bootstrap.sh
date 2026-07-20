#!/bin/bash
#
# End-to-end smoke test for web-bootstrap mode (zero-SSH first boot).
#
# Proves the whole loop on any docker host, with no DNS required
# (curl --resolve simulates test.local):
#   1. Cert-less boot: port 80 redirects, port 443 serves the bootstrap
#      wizard over a self-signed cert, and /api/setup/status reports
#      bootstrapMode:true.
#   2. Simulated wizard apply: writes certs + bootstrap/instance.json +
#      bootstrap/instance.env exactly as the backend's apply step does,
#      and confirms nginx picks up the new identity WITHOUT a restart
#      (the re-runnable renderer + inotify watcher from docker/nginx/).
#   3. Backend restart: confirms the backend hydrates the applied identity
#      from bootstrap/instance.json at process start (apps/backend/src/
#      bootstrap/hydrate.ts).
#
# Run from the repo root on a docker host:
#   ./test-bootstrap.sh
#
# Safety: this script runs `./setup.sh --bootstrap` and `./start.sh`
# against the CURRENT directory. Never run it against a checkout whose
# .env/ssl/bootstrap you care about - it will create/overwrite them and
# start the full stack. For CI or throwaway verification, run it inside a
# disposable copy of the repo.

set -euo pipefail

fail() { echo "❌ $1" >&2; exit 1; }
ok()   { echo "✅ $1"; }
info() { echo "— $1 —"; }

# Poll until CMD succeeds (exit 0) or TIMEOUT seconds elapse. Prefer this
# over fixed `sleep N` so the script is reliable on slow hosts (image
# pulls, cold container starts, watcher debounce) instead of flaky.
#
# Usage: wait_until <timeout_seconds> <description> -- cmd arg1 arg2...
wait_until() {
    local timeout_s="$1"; shift
    local desc="$1"; shift
    [ "$1" = "--" ] && shift
    local waited=0
    local interval=1
    until "$@" >/dev/null 2>&1; do
        if [ "$waited" -ge "$timeout_s" ]; then
            echo "❌ Timed out after ${timeout_s}s waiting for: ${desc}" >&2
            echo "   Last attempt's output:" >&2
            "$@" 2>&1 | sed 's/^/   /' >&2 || true
            return 1
        fi
        sleep "$interval"
        waited=$((waited + interval))
    done
}

cleanup() {
    local exit_code=$?
    info "cleanup"
    if [ "$exit_code" -ne 0 ]; then
        echo "❌ Smoke test failed (exit ${exit_code}) — diagnostics:" >&2
        docker compose ps 2>&1 | sed 's/^/   /' >&2 || true
        echo "   --- backend logs (last 80 lines) ---" >&2
        docker compose logs --tail=80 backend 2>&1 | sed 's/^/   /' >&2 || true
        echo "   --- nginx logs (last 80 lines) ---" >&2
        docker compose logs --tail=80 nginx 2>&1 | sed 's/^/   /' >&2 || true
    fi
    # Deliberately NOT `./stop.sh --volumes`: that script gates volume
    # removal behind an interactive `read -p "Are you sure? (y/N)"` prompt.
    # With no tty on stdin (every automated run of this smoke test - CI, an
    # agent, a background shell) `read` hits EOF immediately, REPLY stays
    # empty, stop.sh prints "Cancelled." and exits 0 *without stopping
    # anything* - and because that's a zero exit code, the `||` fallback
    # here would never fire, silently leaving the whole stack running.
    # Call compose directly instead, covering every profile stop.sh knows
    # about so this cleans up regardless of which profiles start.sh chose.
    docker compose --profile postgres --profile minio --profile redis --profile supertokens down -v >/dev/null 2>&1 || true
    exit "$exit_code"
}
trap cleanup EXIT

[ -f .env ] || ./setup.sh --bootstrap
mkdir -p bootstrap ssl

info "boot cert-less stack"
./start.sh

wait_until 60 "port 80 to redirect (301)" -- \
    bash -c 'curl -s -o /dev/null -w "%{http_code}" http://localhost/ | grep -q 301'
ok "port 80 redirects to https"

wait_until 60 "bootstrap wizard to serve on 443" -- \
    bash -c 'curl -ks -o /dev/null -w "%{http_code}" https://localhost/ | grep -q 200'
ok "wizard serves over self-signed https"

wait_until 60 "backend to report bootstrap mode" -- \
    bash -c 'curl -ks https://localhost/api/setup/status | grep -q "\"bootstrapMode\":true"'
ok "backend reports bootstrap mode"

info "simulate wizard apply (certs + instance files, as the backend writes them)"

# Same four files BootstrapSetupService.saveCertificates() writes
# (apps/backend/src/setup/bootstrap-setup.service.ts): the generic
# fullchain/privkey pair (used directly by the admin.<domain> vhost) plus
# the domain-specific wildcard pair (used by the *.{domain} catch-all).
openssl req -x509 -nodes -days 30 -newkey rsa:2048 \
    -keyout ssl/privkey.pem -out ssl/fullchain.pem \
    -subj "/CN=test.local" -addext "subjectAltName=DNS:test.local,DNS:*.test.local" 2>/dev/null
cp ssl/fullchain.pem ssl/wildcard.test.local.crt
cp ssl/privkey.pem ssl/wildcard.test.local.key

# Same shape BootstrapSetupService/instance-config.ts's writeInstanceConfig()
# writes (apps/backend/src/bootstrap/instance-config.ts): instance.json is
# the full InstanceConfig; instance.env is the shell-sourceable sibling the
# nginx render script sources (STATE / PRIMARY_DOMAIN / PROXY_MODE only).
printf '{ "version": 1, "state": "applied", "primaryDomain": "test.local", "proxyMode": "cloudflare", "sslMode": "paste" }\n' > bootstrap/instance.json
printf 'STATE=applied\nPRIMARY_DOMAIN=test.local\nPROXY_MODE=cloudflare\n' > bootstrap/instance.env

wait_until 40 "admin vhost to serve after apply (no nginx restart)" -- \
    bash -c 'curl -ks --resolve admin.test.local:443:127.0.0.1 https://admin.test.local/ -o /dev/null -w "%{http_code}" | grep -q 200'
ok "nginx transitioned to applied identity without restart"

info "restart backend and confirm it adopts the identity"
docker compose restart backend >/dev/null

# hydrate.ts logs "[bootstrap] identity hydrated from instance.json: <domain>"
# at import time (apps/backend/src/bootstrap/hydrate.ts), before Nest/
# SuperTokens ever read process.env — confirm it via the restarted
# container's logs rather than a fixed sleep.
wait_until 60 "backend to log identity hydration" -- \
    bash -c 'docker compose logs backend 2>/dev/null | grep -q "identity hydrated from instance.json"'
ok "backend adopted instance.json identity on restart"

echo "🎉 bootstrap smoke test passed"
