#!/bin/bash
#
# End-to-end smoke test for web-bootstrap mode (zero-SSH first boot).
#
# Proves the whole loop on any docker host, with no DNS required
# (curl --resolve simulates test.local):
#   1. Cert-less boot: port 80 redirects, port 443 serves the bootstrap
#      wizard over a self-signed cert, and /api/setup/status reports
#      bootstrapMode:true.
#   2. HTTP-driven wizard apply: drives the REAL wizard mutations over HTTP
#      against the running stack via curl — the claim-token gate, admin
#      creation, cert upload, and apply — instead of hand-writing the cert +
#      instance files to disk. This exercises POST /api/setup/certificates and
#      POST /api/setup/apply exactly as the browser wizard does (session-less,
#      claim-token-gated), which is the surface that shipped five live-droplet
#      defects while every unit test stayed green (ONBOARDING_TOKEN not passed
#      to the backend via compose, cert/apply session-guarded against a
#      session-less wizard, ...). It then confirms nginx picks up the new
#      identity WITHOUT a restart (the re-runnable renderer + inotify watcher
#      from docker/nginx/).
#   3. Backend restart: the real apply endpoint exits the backend, Docker's
#      restart policy revives it, and it hydrates the applied identity from
#      bootstrap/instance.json at process start (apps/backend/src/bootstrap/
#      hydrate.ts) — confirmed via the restarted container's logs.
#
# Run from the repo root on a docker host:
#   ./test-bootstrap.sh
#
# Safety: this script creates/overwrites .env, ssl/, and bootstrap/ and starts
# the full docker stack. To guarantee it NEVER clobbers the real working tree,
# it first copies the repo into a throwaway `mktemp -d` (excluding the caller's
# live .env/ssl/bootstrap and heavy node_modules/.git), sets an isolated
# COMPOSE_PROJECT_NAME, remaps the backend's published port off the commonly
# occupied :3000, and re-execs itself there. The copy (and its whole docker
# stack + volumes) is torn down on EXIT via a trap, even on failure. It only
# ever stops the stack it created (its own project).

set -euo pipefail

# ---------------------------------------------------------------------------
# Self-relocation into a throwaway copy (safety). Everything below the guard
# runs inside the sandbox; BOOTSTRAP_SMOKE_SANDBOX marks that we're already in
# it so the re-exec doesn't recurse.
# ---------------------------------------------------------------------------
if [ -z "${BOOTSTRAP_SMOKE_SANDBOX:-}" ]; then
    origin="$(cd "$(dirname "$0")" && pwd)"
    sandbox="$(mktemp -d "${TMPDIR:-/tmp}/ce-bootstrap-smoke.XXXXXX")"
    echo "— relocating into throwaway copy: ${sandbox} —"
    # Copy the repo, dropping only the heavy trees that the docker stack never
    # needs (node_modules at any depth, .git). These names never collide with
    # real source paths, so an unanchored exclude is safe. The stack is
    # self-contained: pre-built images plus the nginx build context under
    # docker/.
    tar -C "$origin" --exclude=node_modules --exclude=.git -cf - . \
        | tar -C "$sandbox" -xf -
    # Then remove ONLY the top-level live stack state, so the copy can never
    # inherit the caller's .env (which would suppress ./setup.sh --bootstrap
    # and its fresh claim token) or a stale ssl/bootstrap identity. Scoped to
    # $sandbox/<name> so it can't touch same-named source dirs (e.g.
    # apps/backend/src/bootstrap).
    rm -rf "$sandbox/.env" "$sandbox/ssl" "$sandbox/bootstrap"
    export BOOTSTRAP_SMOKE_SANDBOX="$sandbox"
    # Isolate compose objects (volumes/network/project) so cleanup only ever
    # touches the stack this run created.
    export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-cebootstrapsmoke}"
    # Pin images built from this branch's HEAD (published :bootstrap tag). The
    # default :latest images predate — and therefore lack — the bootstrap fixes
    # under test (claim-token passthrough, session-less cert/apply).
    export BACKEND_TAG="${BACKEND_TAG:-bootstrap}"
    export FRONTEND_TAG="${FRONTEND_TAG:-bootstrap}"
    # Host port 3000 is commonly occupied by an unrelated process. The smoke
    # test drives everything through nginx (443), so the backend's published
    # port only has to not collide — remap it in the throwaway copy.
    sed -i "s/'3000:3000'/'13000:3000'/" "$sandbox/docker-compose.yml"
    cd "$sandbox"
    exec bash "$sandbox/test-bootstrap.sh" "$@"
fi

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
    # Remove the throwaway copy (and the certs generated inside it). cd out of
    # it first so `rm -rf` isn't operating on our own cwd.
    if [ -n "${BOOTSTRAP_SMOKE_SANDBOX:-}" ] && [ -d "${BOOTSTRAP_SMOKE_SANDBOX}" ]; then
        cd / 2>/dev/null || true
        rm -rf "$BOOTSTRAP_SMOKE_SANDBOX" 2>/dev/null || true
    fi
    exit "$exit_code"
}
trap cleanup EXIT

[ -f .env ] || ./setup.sh --bootstrap
# Belt-and-suspenders: pin the branch-built images in the compose env file too,
# so `docker compose` uses them regardless of shell-vs-.env precedence.
grep -q '^BACKEND_TAG=' .env  || echo "BACKEND_TAG=${BACKEND_TAG}"   >> .env
grep -q '^FRONTEND_TAG=' .env || echo "FRONTEND_TAG=${FRONTEND_TAG}" >> .env
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

# ===========================================================================
# Restart-in-bootstrap-mode leg (memory-note lesson). A bootstrap-mode nginx
# restart while still UNCLAIMED (no domain ever applied) is a real crash
# class that first-boot-clean runs mask: the self-signed cert + bootstrap
# main.conf are only ever WRITTEN on the render that finds them absent; a
# restart re-runs the entrypoint against a filesystem that may already carry
# leftover dynamic config from a previous run. This exact class of bug
# (NginxStartupService writing a welcome-page config with a hardcoded
# fullchain.pem path while genuinely cert-less) crash-looped nginx on the
# real DO droplet after a `down -v` + restart (Fix E, commit 23f7fd8) even
# though every earlier smoke run — always first-boot-clean — stayed green.
# Restart nginx here, while the stack is still unclaimed, and prove it comes
# back up still serving the bootstrap wizard.
# ===========================================================================
info "restart nginx while still in unclaimed bootstrap mode"
docker compose restart nginx >/dev/null
wait_until 60 "nginx container to be running again after the in-bootstrap restart" -- \
    bash -c 'docker compose ps nginx --format "{{.State}}" | grep -q running'
wait_until 60 "bootstrap wizard to keep serving over https after the restart" -- \
    bash -c 'curl -ks -o /dev/null -w "%{http_code}" https://localhost/ | grep -q 200'
wait_until 60 "backend to keep reporting bootstrap mode after the restart" -- \
    bash -c 'curl -ks https://localhost/api/setup/status | grep -q "\"bootstrapMode\":true"'
ok "nginx survived a restart while still in unclaimed bootstrap mode"

# ===========================================================================
# HTTP-driven wizard apply. Everything past this point calls the REAL setup
# endpoints over HTTPS (through nginx, exactly as the browser wizard does),
# rather than hand-writing cert/instance files. The wizard is anonymous and
# session-less, so the mutating endpoints are gated by the claim token
# (ONBOARDING_TOKEN), not an admin session.
# ===========================================================================
BASE="https://localhost"        # nginx :443, self-signed (curl -k)
DOMAIN="test.local"
ADMIN_EMAIL="admin@test.local"
ADMIN_PASSWORD="SmokeTestPass123!"

# Emit a JSON object from key/value + file arguments using python3 (near
# universal, and it round-trips PEM newlines intact — never hand-escape PEM in
# shell). Usage: json_kv KEY VALUE [KEY VALUE ...]  ; json_cert_body reads PEM
# files directly so the multi-line blocks survive verbatim.
json_cert_body() {  # domain token certfile keyfile
    python3 -c '
import json, sys
domain, token, cert_file, key_file = sys.argv[1:5]
with open(cert_file) as f: cert = f.read()
with open(key_file) as f: key = f.read()
print(json.dumps({
    "domain": domain,
    "certificatePem": cert,
    "privateKeyPem": key,
    "token": token,
}))' "$1" "$2" "$3" "$4"
}

# POST a JSON body (on stdin) and print "<body>\n<http_code>" so callers can
# split code off the last line. --data-binary @- preserves the body byte-for-
# byte (no newline mangling).
post_json() {  # url  (body on stdin)
    curl -ks -o - -w $'\n%{http_code}' -X POST "$1" \
        -H 'Content-Type: application/json' --data-binary @-
}

# ---- 1. status: bootstrapMode:true AND claimRequired:true -----------------
# claimRequired:true is the Fix A regression guard — it can only be true if
# ONBOARDING_TOKEN actually reached the backend via compose (getSetupStatus
# reads process.env.ONBOARDING_TOKEN). If the compose passthrough regresses,
# claimRequired silently goes false and admin creation is UNGATED on a public
# IP; this assertion fails loudly instead.
info "verify bootstrap status + claim requirement"
CLAIM_TOKEN="$(grep -E '^ONBOARDING_TOKEN=' .env | head -1 | cut -d= -f2-)"
[ -n "$CLAIM_TOKEN" ] || fail "ONBOARDING_TOKEN missing from generated .env"
STATUS_JSON="$(curl -ks "${BASE}/api/setup/status")"
echo "$STATUS_JSON" | grep -q '"bootstrapMode":true' \
    || fail "status not bootstrapMode:true — got: $STATUS_JSON"
echo "$STATUS_JSON" | grep -q '"claimRequired":true' \
    || fail "claimRequired not true — ONBOARDING_TOKEN did not reach the backend (Fix A regression). status: $STATUS_JSON"
ok "status reports bootstrapMode:true and claimRequired:true (claim token reached backend)"

# ---- generate a REAL RSA cert covering apex + wildcard --------------------
# node-forge (validateCertificatePair) only accepts RSA; SANs must cover BOTH
# the apex and *.<domain> (admin/www/preview subdomains ride the wildcard).
# Generated before the wrong-token probe so that probe carries a well-formed
# body — proving it's the claim gate that rejects it, not DTO validation.
info "generate RSA cert for ${DOMAIN} (apex + wildcard SANs)"
CERT_DIR="${PWD}/.smoke-certs"
mkdir -p "$CERT_DIR"
openssl req -x509 -nodes -days 30 -newkey rsa:2048 \
    -keyout "${CERT_DIR}/key.pem" -out "${CERT_DIR}/cert.pem" \
    -subj "/CN=${DOMAIN}" \
    -addext "subjectAltName=DNS:${DOMAIN},DNS:*.${DOMAIN}" 2>/dev/null \
    || fail "openssl failed to generate the test certificate"
ok "generated RSA cert with SANs ${DOMAIN} + *.${DOMAIN}"

# ---- 2. claim-token gate on cert upload (Fix C regression guard) ----------
# The cert/apply endpoints used to be session-guarded; against the session-
# less wizard every cert upload 401'd. They are now claim-token-gated. Prove
# the gate rejects a WRONG token (must be 4xx, never 2xx). One failed attempt
# is well under the 5-attempt rate-limit window, and the correct initialize
# below resets the counter.
info "claim-token gate: cert upload with WRONG token must be rejected"
WRONG_RESP="$(json_cert_body "$DOMAIN" "wrong-${CLAIM_TOKEN}" "${CERT_DIR}/cert.pem" "${CERT_DIR}/key.pem" | post_json "${BASE}/api/setup/certificates")"
WRONG_CODE="$(printf '%s' "$WRONG_RESP" | tail -n1)"
case "$WRONG_CODE" in
    2*) fail "cert upload with a wrong token was ACCEPTED (HTTP ${WRONG_CODE}) — claim gate bypassed (Fix C regression)";;
esac
{ [ "$WRONG_CODE" -ge 400 ] && [ "$WRONG_CODE" -lt 500 ]; } 2>/dev/null \
    || fail "cert upload with wrong token returned HTTP ${WRONG_CODE}, expected a 4xx rejection"
ok "cert upload with wrong token rejected (HTTP ${WRONG_CODE})"

# ---- 3. initialize the admin with the correct claim token -----------------
# Retry until 201 (created) or 409 (already created): the only expected
# transient is SuperTokens not yet ready (5xx). Passing the CORRECT token
# resets the rate-limit counter, so the earlier wrong-token failure never
# lingers.
info "initialize admin with the correct claim token"
INIT_BODY="$(python3 -c 'import json,sys; print(json.dumps({"email": sys.argv[1], "password": sys.argv[2], "token": sys.argv[3]}))' "$ADMIN_EMAIL" "$ADMIN_PASSWORD" "$CLAIM_TOKEN")"
INIT_CODE=""
init_admin() {
    local resp
    resp="$(printf '%s' "$INIT_BODY" | post_json "${BASE}/api/setup/initialize")"
    INIT_CODE="$(printf '%s' "$resp" | tail -n1)"
    [ "$INIT_CODE" = "201" ] || [ "$INIT_CODE" = "409" ]
}
wait_until 90 "admin creation (initialize) to succeed" -- init_admin
ok "admin created via POST /api/setup/initialize (HTTP ${INIT_CODE})"

# ---- 4/5. upload certs with the CORRECT token -----------------------------
# THE most important assertion: this exact call 401'd before Fix C. It must
# now return 200 {"saved":true,...}, and the four cert files must actually
# land in the SSL dir the backend shares with nginx.
info "upload certs with the correct claim token (POST /api/setup/certificates)"
CERT_RESP="$(json_cert_body "$DOMAIN" "$CLAIM_TOKEN" "${CERT_DIR}/cert.pem" "${CERT_DIR}/key.pem" | post_json "${BASE}/api/setup/certificates")"
CERT_CODE="$(printf '%s' "$CERT_RESP" | tail -n1)"
CERT_OUT="$(printf '%s' "$CERT_RESP" | sed '$d')"
# The wizard is an RTK Query client, so ANY 2xx is success — the endpoint
# returns 201 (NestJS's default for POST; it carries no @HttpCode) with the
# real contract in the body. What Fix C is about is that this call must NOT be
# REJECTED (it used to 401 the session-less wizard), so assert a 2xx plus
# saved:true rather than an exact status code.
case "$CERT_CODE" in
    2*) ;;
    *) fail "cert upload rejected (HTTP ${CERT_CODE}): ${CERT_OUT} — this is the Fix C bug (session-guarded cert upload rejecting the session-less wizard)";;
esac
echo "$CERT_OUT" | grep -q '"saved":true' \
    || fail "cert upload did not return saved:true — got: ${CERT_OUT}"
ok "certs accepted (HTTP ${CERT_CODE}, saved:true): ${CERT_OUT}"

# Verify inside the backend container (it owns the writes, so this is robust
# to host-side file permissions on the 0600 keys).
MISSING="$(docker compose exec -T backend sh -c 'for f in fullchain.pem privkey.pem wildcard.test.local.crt wildcard.test.local.key; do [ -s "/etc/nginx/ssl/$f" ] || echo "$f"; done' 2>/dev/null || echo 'CONTAINER_EXEC_FAILED')"
[ -z "$MISSING" ] || fail "cert files missing/empty in ssl dir after upload: ${MISSING}"
ok "four cert files written to the ssl dir by the backend (fullchain/privkey + wildcard.${DOMAIN}.crt/.key)"

# ---- 6. apply the domain identity -----------------------------------------
info "apply domain identity (POST /api/setup/apply)"
APPLY_BODY="$(python3 -c 'import json,sys; print(json.dumps({"domain": sys.argv[1], "proxyMode": sys.argv[2], "token": sys.argv[3]}))' "$DOMAIN" "cloudflare" "$CLAIM_TOKEN")"
APPLY_RESP="$(printf '%s' "$APPLY_BODY" | post_json "${BASE}/api/setup/apply")"
APPLY_CODE="$(printf '%s' "$APPLY_RESP" | tail -n1)"
APPLY_OUT="$(printf '%s' "$APPLY_RESP" | sed '$d')"
# Same 2xx-is-success rationale as the cert upload (apply also carries no
# @HttpCode, so it returns 201). The real success signals are the body fields.
case "$APPLY_CODE" in
    2*) ;;
    *) fail "apply rejected (HTTP ${APPLY_CODE}): ${APPLY_OUT}";;
esac
echo "$APPLY_OUT" | grep -q '"applying":true' \
    || fail "apply did not return applying:true — got: ${APPLY_OUT}"
echo "$APPLY_OUT" | grep -q "\"adminUrl\":\"https://admin.${DOMAIN}\"" \
    || fail "apply adminUrl mismatch — got: ${APPLY_OUT}"
ok "apply accepted (HTTP ${APPLY_CODE}, applying:true, adminUrl https://admin.${DOMAIN})"

# ---- 7. effects of the real apply -----------------------------------------
# (a) nginx transitions to the applied identity WITHOUT a restart: the render
#     script's inotify watcher re-renders on the instance.env the apply
#     endpoint wrote, and reloads. The admin vhost must then serve 200.
wait_until 60 "admin vhost to serve after real apply (no nginx restart)" -- \
    bash -c 'curl -ks --resolve admin.test.local:443:127.0.0.1 https://admin.test.local/ -o /dev/null -w "%{http_code}" | grep -q 200'
ok "nginx transitioned to applied identity without restart"

# (b) the apply endpoint exits the backend; Docker's restart policy revives it
#     and hydrate.ts logs the identity at import time (before Nest/SuperTokens
#     read process.env). Confirm via the restarted container's logs.
wait_until 90 "backend to restart and log identity hydration" -- \
    bash -c 'docker compose logs backend 2>/dev/null | grep -q "identity hydrated from instance.json"'
ok "backend restarted (via apply) and adopted instance.json identity"

# ===========================================================================
# v1 regression leg. A legacy install's instance.env (written before the
# knob rework in Task 1 of the bootstrap-domain-ssl-model plan) carries only
# STATE=applied / PRIMARY_DOMAIN / PROXY_MODE — none of the newer
# PORT80/REALIP_MODE/SSL_MODE keys. render-main-conf.sh must still derive
# PROXY_MODE=cloudflare -> closed port 80 (`return 444;`) + Cloudflare
# real-IP trust exactly as it always has.
#
# docker/nginx/render-main-conf.test.sh (the host harness, run separately as
# part of this task's own verification step) already asserts this exact
# derivation against a fake NGINX_ETC tree. This leg proves the SAME
# derivation inside the REAL, already-running nginx container built from the
# actual image under test — the thing the host harness structurally cannot
# do (it never builds or runs the Dockerfile). Runs last, against the
# already-applied stack, since it intentionally clobbers instance.env and
# nothing downstream depends on the prior (cloudflare/test.local) state.
# ===========================================================================
info "v1 regression: legacy env-only instance.env inside the running nginx container"
# Written via `docker compose exec backend` (which mounts ./bootstrap rw and
# runs as root), NOT a host-side redirect: the real apply() above already
# had the backend write instance.json/instance.env as the container's root
# user, so the host's unprivileged user cannot overwrite the bind-mounted
# file directly (`> bootstrap/instance.env` from the host fails with
# "Permission denied" — caught by an earlier real run of this leg).
docker compose exec -T backend sh -c "printf 'STATE=applied\nPRIMARY_DOMAIN=%s\nPROXY_MODE=cloudflare\n' '${DOMAIN}' > /app/bootstrap/instance.env" \
    || fail "v1-regression: could not write a legacy env-only instance.env via the backend container"
docker compose exec -T nginx /usr/local/bin/render-main-conf.sh >/dev/null \
    || fail "v1-regression: render-main-conf.sh failed inside the nginx container on a legacy env-only instance.env"
docker compose exec -T nginx sh -c 'grep -qF "return 444;" /etc/nginx/sites-available/main.conf' \
    || fail "v1-regression: legacy env-only instance.env did not close port 80 (return 444) inside the container"
docker compose exec -T nginx sh -c 'grep -qF "real_ip_header CF-Connecting-IP;" /etc/nginx/cloudflare-realip.conf' \
    || fail "v1-regression: legacy env-only instance.env did not derive the Cloudflare real-IP header inside the container"
ok "v1 regression: legacy env-only instance.env (no knob keys) derives return 444 + CF realip inside the real nginx image"

echo "🎉 bootstrap smoke test passed (HTTP-driven cert-upload + apply + restart + v1-regression)"

# ===========================================================================
# LE-path leg (opt-in: RUN_LE_LEG=1). Drives dns-preflight, issue-certificate
# and apply for the direct + Let's Encrypt path (proxyMode 'none', sslMode
# 'letsencrypt'), and asserts the rendered nginx config carries the ACME
# challenge location. Off by default because it is materially heavier than
# everything above it:
#
#   - A real install can only ever apply() ONCE — the moment STATE flips to
#     'applied', SetupService.isBootstrapModeActive() permanently closes
#     bootstrap mode (state != 'applied' is one of its conjuncts), so this
#     CANNOT reuse the stack above, which already applied proxyMode
#     cloudflare for $DOMAIN. It needs its own fresh, cert-less boot.
#   - issue-certificate does a server-side DNS+HTTP self-probe of the
#     domain before issuing (same BootstrapDnsPreflightService used by
#     dns-preflight), so the test domain must actually resolve to something
#     that serves /.well-known/acme-challenge/. There is no real DNS here,
#     so this pins the domain via the BACKEND container's /etc/hosts (the
#     probe runs from the backend) at nginx's address on the compose
#     network — a hosts-file pin, exactly as the brief specifies.
#
# Run explicitly when you have a few extra minutes (CI or a droplet):
#   RUN_LE_LEG=1 ./test-bootstrap.sh
# ===========================================================================
if [ "${RUN_LE_LEG:-0}" = "1" ]; then
    info "LE-path leg: tearing down the applied stack, booting a fresh cert-less one"
    docker compose --profile postgres --profile minio --profile redis --profile supertokens down -v >/dev/null 2>&1
    rm -rf bootstrap ssl .smoke-certs
    mkdir -p bootstrap ssl
    ./start.sh
    wait_until 60 "LE-path: fresh stack's bootstrap wizard to serve on 443" -- \
        bash -c 'curl -ks -o /dev/null -w "%{http_code}" https://localhost/ | grep -q 200'
    ok "LE-path leg: fresh cert-less stack booted"

    LE_DOMAIN="bootstrap-le-test.local"
    LE_CLAIM_TOKEN="$(grep -E '^ONBOARDING_TOKEN=' .env | head -1 | cut -d= -f2-)"
    [ -n "$LE_CLAIM_TOKEN" ] || fail "LE-path: ONBOARDING_TOKEN missing from the fresh .env"

    # ---- 1. dns-preflight against an unresolvable domain: the endpoint
    # itself must still succeed (2xx) and report the failure IN THE BODY —
    # "still exits 0 for the leg" means this shell leg passes as long as the
    # API behaves correctly, not that DNS happened to resolve. ----
    info "LE-path: dns-preflight against an unresolvable domain must report ok:false"
    PREFLIGHT_BODY="$(python3 -c 'import json,sys; print(json.dumps({"domain": sys.argv[1], "token": sys.argv[2]}))' "definitely-unresolvable.invalid" "$LE_CLAIM_TOKEN")"
    PREFLIGHT_RESP="$(printf '%s' "$PREFLIGHT_BODY" | post_json "${BASE}/api/setup/dns-preflight")"
    PREFLIGHT_CODE="$(printf '%s' "$PREFLIGHT_RESP" | tail -n1)"
    PREFLIGHT_OUT="$(printf '%s' "$PREFLIGHT_RESP" | sed '$d')"
    case "$PREFLIGHT_CODE" in
        2*) ;;
        *) fail "dns-preflight against an unresolvable domain returned HTTP ${PREFLIGHT_CODE} (expected 2xx with ok:false): ${PREFLIGHT_OUT}";;
    esac
    echo "$PREFLIGHT_OUT" | grep -q '"ok":false' \
        || fail "dns-preflight against an unresolvable domain did not report ok:false: ${PREFLIGHT_OUT}"
    ok "LE-path: dns-preflight correctly reports ok:false for an unresolvable domain (leg still exits 0)"

    # ---- 2. pin LE_DOMAIN to nginx via the backend container's /etc/hosts,
    # then issue-certificate (MOCK_SSL — no real network ACME needed; the
    # server-side preflight re-check still does a real DNS+HTTP self-probe,
    # which is exactly what the hosts pin satisfies). ----
    info "LE-path: pin ${LE_DOMAIN} to nginx in the backend container's /etc/hosts"
    NGINX_IP="$(docker compose exec -T backend getent hosts nginx | awk '{print $1}' | head -1)"
    [ -n "$NGINX_IP" ] || fail "LE-path: could not resolve nginx's container IP from inside the backend container"
    docker compose exec -T backend sh -c "echo '${NGINX_IP} ${LE_DOMAIN} www.${LE_DOMAIN} admin.${LE_DOMAIN}' >> /etc/hosts"
    ok "LE-path: ${LE_DOMAIN} resolves to nginx (${NGINX_IP}) inside the backend container"

    info "LE-path: MOCK_SSL issue-certificate for ${LE_DOMAIN}"
    ISSUE_BODY="$(python3 -c 'import json,sys; print(json.dumps({"domain": sys.argv[1], "token": sys.argv[2]}))' "$LE_DOMAIN" "$LE_CLAIM_TOKEN")"
    ISSUE_RESP="$(printf '%s' "$ISSUE_BODY" | post_json "${BASE}/api/setup/issue-certificate")"
    ISSUE_CODE="$(printf '%s' "$ISSUE_RESP" | tail -n1)"
    ISSUE_OUT="$(printf '%s' "$ISSUE_RESP" | sed '$d')"
    case "$ISSUE_CODE" in
        2*) ;;
        *) fail "LE-path: issue-certificate rejected (HTTP ${ISSUE_CODE}): ${ISSUE_OUT}";;
    esac
    echo "$ISSUE_OUT" | grep -q '"issued":true' \
        || fail "LE-path: issue-certificate did not return issued:true: ${ISSUE_OUT}"
    ok "LE-path: certificate issued (MOCK_SSL) for ${LE_DOMAIN}: ${ISSUE_OUT}"

    # ---- 3. apply with {proxyMode:'none', sslMode:'letsencrypt'} ----
    info "LE-path: apply direct + Let's Encrypt"
    LE_APPLY_BODY="$(python3 -c 'import json,sys; print(json.dumps({"domain": sys.argv[1], "proxyMode": "none", "sslMode": "letsencrypt", "token": sys.argv[2]}))' "$LE_DOMAIN" "$LE_CLAIM_TOKEN")"
    LE_APPLY_RESP="$(printf '%s' "$LE_APPLY_BODY" | post_json "${BASE}/api/setup/apply")"
    LE_APPLY_CODE="$(printf '%s' "$LE_APPLY_RESP" | tail -n1)"
    LE_APPLY_OUT="$(printf '%s' "$LE_APPLY_RESP" | sed '$d')"
    case "$LE_APPLY_CODE" in
        2*) ;;
        *) fail "LE-path: apply rejected (HTTP ${LE_APPLY_CODE}): ${LE_APPLY_OUT}";;
    esac
    ok "LE-path: apply accepted: ${LE_APPLY_OUT}"

    # ---- 4. backend restarts under the new identity; nginx must render the
    # ACME challenge location (direct/none mode defaults PORT80=redirect,
    # which is what puts /.well-known/acme-challenge/ in main.conf). ----
    wait_until 90 "LE-path: backend to restart under the new identity" -- \
        bash -c 'docker compose logs backend 2>/dev/null | grep -q "identity hydrated from instance.json"'
    wait_until 60 "LE-path: nginx to render the ACME challenge location" -- \
        bash -c "docker compose exec -T nginx sh -c 'grep -qF \"/.well-known/acme-challenge/\" /etc/nginx/sites-available/main.conf'"
    ok "LE-path leg passed: direct + Let's Encrypt apply renders the ACME challenge location"
else
    info "skipping LE-path leg (set RUN_LE_LEG=1 to run it — needs a second full stack boot + container-network DNS pinning; intended for CI/droplet where the extra minutes are cheap)"
fi

# ===========================================================================
# Legacy-upgrade leg (opt-in: RUN_LEGACY_LEG=1). Simulates a pre-wizard
# env-only install (identity in .env, certs in ssl/, empty bootstrap/) being
# upgraded to this image: first boot must ADOPT it into bootstrap/
# instance.json with origin:'env', and a later .env edit + container
# recreate must RE-SYNC the file (spec §§2–3). Opt-in because it needs its
# own fresh stack boot, like the LE leg.
#   RUN_LEGACY_LEG=1 ./test-bootstrap.sh
# ===========================================================================
if [ "${RUN_LEGACY_LEG:-0}" = "1" ]; then
    info "legacy leg: tearing down, building a hand-made legacy env install"
    docker compose --profile postgres --profile minio --profile redis --profile supertokens down -v >/dev/null 2>&1
    rm -rf bootstrap ssl
    mkdir -p bootstrap ssl

    LEGACY_DOMAIN="legacy-test.local"
    # Legacy identity in .env, exactly as interactive setup.sh writes it.
    sed -i "s/^PRIMARY_DOMAIN=.*/PRIMARY_DOMAIN=${LEGACY_DOMAIN}/" .env
    sed -i "s|^FRONTEND_URL=.*|FRONTEND_URL=https://www.${LEGACY_DOMAIN}|" .env
    grep -q '^PROXY_MODE=' .env && sed -i 's/^PROXY_MODE=.*/PROXY_MODE=cloudflare/' .env || echo 'PROXY_MODE=cloudflare' >> .env
    # Legacy certs: self-signed stand-ins (non-LE issuer → must adopt as paste).
    openssl req -x509 -nodes -days 2 -newkey rsa:2048 -keyout ssl/privkey.pem \
        -out ssl/fullchain.pem -subj "/CN=${LEGACY_DOMAIN}" 2>/dev/null
    cp ssl/fullchain.pem "ssl/wildcard.${LEGACY_DOMAIN}.crt"
    cp ssl/privkey.pem "ssl/wildcard.${LEGACY_DOMAIN}.key"

    ./start.sh
    wait_until 90 "legacy leg: backend to adopt the env identity" -- \
        bash -c 'docker compose logs backend 2>/dev/null | grep -q "adopted env identity into instance.json"'
    grep -q '"origin": "env"' bootstrap/instance.json \
        || fail "legacy leg: adopted instance.json missing origin:env: $(cat bootstrap/instance.json)"
    grep -q "\"primaryDomain\": \"${LEGACY_DOMAIN}\"" bootstrap/instance.json \
        || fail "legacy leg: adopted instance.json has wrong domain: $(cat bootstrap/instance.json)"
    grep -q '"sslMode": "paste"' bootstrap/instance.json \
        || fail "legacy leg: self-signed legacy cert must adopt as paste: $(cat bootstrap/instance.json)"
    grep -q "PRIMARY_DOMAIN=${LEGACY_DOMAIN}" bootstrap/instance.env \
        || fail "legacy leg: instance.env not written for nginx"
    ok "legacy leg: env install adopted (origin:env, sslMode:paste)"

    # .env edit must still work: recreate the backend (compose re-reads .env)
    # and the file must follow.
    RENAMED_DOMAIN="renamed-test.local"
    sed -i "s/^PRIMARY_DOMAIN=.*/PRIMARY_DOMAIN=${RENAMED_DOMAIN}/" .env
    docker compose up -d backend >/dev/null 2>&1
    wait_until 90 "legacy leg: re-sync after .env edit" -- \
        bash -c "grep -q '\"primaryDomain\": \"${RENAMED_DOMAIN}\"' bootstrap/instance.json"
    ok "legacy leg passed: .env edit re-synced instance.json (env stays authoritative)"
else
    info "skipping legacy-upgrade leg (set RUN_LEGACY_LEG=1 to run it — needs its own fresh stack boot)"
fi
