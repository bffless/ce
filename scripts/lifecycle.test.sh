#!/bin/bash
# Host-runnable unit tests for restart.sh / update.sh / logs.sh / status.sh /
# backup.sh. No docker or root needed: external commands are stubbed on PATH
# and each case runs in its own sandbox copy of the scripts.
# Run: bash scripts/lifecycle.test.sh
# shellcheck disable=SC2030,SC2031,SC2164,SC2012
set -u
FAILURES=0
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

assert_contains() { # file needle label
    if grep -qF "$2" "$1" 2>/dev/null; then echo "ok: $3"; else echo "FAIL: $3 (missing '$2' in $1)"; FAILURES=$((FAILURES+1)); fi
}
assert_not_contains() { # file needle label
    if ! grep -qF "$2" "$1" 2>/dev/null; then echo "ok: $3"; else echo "FAIL: $3 (unexpected '$2' in $1)"; FAILURES=$((FAILURES+1)); fi
}
assert_file() { if [ -e "$1" ]; then echo "ok: $2"; else echo "FAIL: $2 (missing $1)"; FAILURES=$((FAILURES+1)); fi }
assert_exit() { # want got label
    if [ "$2" -eq "$1" ]; then echo "ok: $3"; else echo "FAIL: $3 (exit $2, want $1)"; FAILURES=$((FAILURES+1)); fi
}

make_sandbox() {
    SB=$(mktemp -d)
    mkdir -p "$SB/app/scripts" "$SB/bin"
    for f in restart.sh update.sh logs.sh status.sh backup.sh; do
        [ -f "$REPO_ROOT/$f" ] && cp "$REPO_ROOT/$f" "$SB/app/"
    done
    cp "$REPO_ROOT/scripts/compose-profiles.sh" "$SB/app/scripts/" 2>/dev/null || true
    # Default docker stub: log argv, succeed. Cases overwrite for richer behavior.
    cat > "$SB/bin/docker" <<'STUB'
#!/bin/bash
echo "docker $*" >> "$DOCKER_LOG"
exit 0
STUB
    chmod +x "$SB/bin/docker"
    export DOCKER_LOG="$SB/docker.log"
    : > "$DOCKER_LOG"
}

# ---------------------------------------------------------------- restart.sh
echo "— restart.sh: order + flag passthrough —"
(
    make_sandbox
    FAILURES=0
    cat > "$SB/app/stop.sh" <<'STUB'
#!/bin/bash
echo "stop" >> calls.log
STUB
    cat > "$SB/app/start.sh" <<'STUB'
#!/bin/bash
echo "start $*" >> calls.log
STUB
    chmod +x "$SB/app/stop.sh" "$SB/app/start.sh"
    (cd "$SB/app" && PATH="$SB/bin:$PATH" ./restart.sh --all); rc=$?
    assert_exit 0 "$rc" "restart exits 0"
    assert_contains "$SB/app/calls.log" "stop" "stop.sh ran"
    assert_contains "$SB/app/calls.log" "start --all" "start.sh got --all"
    if [ "$(head -1 "$SB/app/calls.log")" = "stop" ]; then echo "ok: stop before start"; else echo "FAIL: stop before start"; FAILURES=$((FAILURES+1)); fi
    rm -rf "$SB"
    exit "$FAILURES"
); FAILURES=$((FAILURES+$?))

echo "— logs.sh: full compose invocation + service filter —"
(
    make_sandbox
    FAILURES=0
    (cd "$SB/app" && PATH="$SB/bin:$PATH" ./logs.sh backend); rc=$?
    assert_exit 0 "$rc" "logs exits 0"
    assert_contains "$DOCKER_LOG" \
        "docker compose --profile postgres --profile minio --profile redis --profile supertokens logs -f --tail=100 backend" \
        "logs passes all profiles + service"
    rm -rf "$SB"
    exit "$FAILURES"
); FAILURES=$((FAILURES+$?))

echo "— update.sh: aborts on dirty tree —"
(
    make_sandbox
    FAILURES=0
    cd "$SB/app"
    printf '{\n  "version": "0.0.1"\n}\n' > package.json
    printf '#!/bin/bash\necho "restart $*" >> calls.log\n' > restart.sh && chmod +x restart.sh
    git init -q && git config user.email t@t && git config user.name t
    git add -A && git commit -qm init
    echo dirty > dirty.txt                       # untracked file = dirty tree
    PATH="$SB/bin:$PATH" ./update.sh >/dev/null 2>&1; rc=$?
    assert_exit 1 "$rc" "update exits 1 on dirty tree"
    assert_not_contains "$DOCKER_LOG" "pull" "no image pull on dirty tree"
    assert_not_contains "calls.log" "restart" "no restart on dirty tree"
    cd / && rm -rf "$SB"
    exit "$FAILURES"
); FAILURES=$((FAILURES+$?))

echo "— update.sh: clean tree pulls with detected profiles and restarts —"
(
    make_sandbox
    FAILURES=0
    cd "$SB/app"
    printf '{\n  "version": "0.0.1"\n}\n' > package.json
    printf 'ENABLE_MINIO=true\n' > .env
    printf '#!/bin/bash\necho "restart $*" >> calls.log\n' > restart.sh && chmod +x restart.sh
    git init -q && git config user.email t@t && git config user.name t
    git add -A && git commit -qm init
    # Give the repo an upstream so `git pull --ff-only` succeeds (already up to date)
    git clone -q --bare . "$SB/origin.git"
    git remote add origin "$SB/origin.git" && git fetch -q origin
    branch=$(git symbolic-ref --short HEAD)
    git branch -q --set-upstream-to="origin/$branch"
    PATH="$SB/bin:$PATH" ./update.sh >/dev/null 2>&1; rc=$?
    assert_exit 0 "$rc" "update exits 0 on clean tree"
    assert_contains "$DOCKER_LOG" \
        "docker compose --profile postgres --profile minio --profile supertokens pull" \
        "profile-aware image pull (minio on, redis off)"
    assert_contains "calls.log" "restart" "restart.sh invoked"
    cd / && rm -rf "$SB"
    exit "$FAILURES"
); FAILURES=$((FAILURES+$?))

echo "— status.sh: reports sections, restart-pending, and survives failures —"
(
    make_sandbox
    FAILURES=0
    cd "$SB/app"
    printf '{\n  "version": "0.0.1"\n}\n' > package.json
    git init -q && git config user.email t@t && git config user.name t
    git add -A && git commit -qm init
    mkdir -p bootstrap ssl
    printf 'STATE=applied\nPRIMARY_DOMAIN=example.com\n' > bootstrap/instance.env
    # docker stub: running container image ID differs from the tag's image ID
    cat > "$SB/bin/docker" <<'STUB'
#!/bin/bash
echo "docker $*" >> "$DOCKER_LOG"
case "$*" in
    "inspect --format {{.Image}} assethost-backend")        echo "sha256:aaa" ;;
    "inspect --format {{.Config.Image}} assethost-backend") echo "ghcr.io/bffless/ce-backend:latest" ;;
    "inspect --format {{.Image}} assethost-frontend")        echo "sha256:ccc" ;;
    "inspect --format {{.Config.Image}} assethost-frontend") echo "ghcr.io/bffless/ce-frontend:latest" ;;
    "image inspect --format {{.Id}} ghcr.io/bffless/ce-backend:latest")  echo "sha256:bbb" ;;
    "image inspect --format {{.Id}} ghcr.io/bffless/ce-frontend:latest") echo "sha256:ccc" ;;
    image\ inspect*Labels*) echo "0.3.2" ;;
    compose*ps*) echo "NAME  STATUS" ;;
    *) : ;;
esac
exit 0
STUB
    chmod +x "$SB/bin/docker"
    # curl stub: health check fails
    printf '#!/bin/bash\nexit 7\n' > "$SB/bin/curl" && chmod +x "$SB/bin/curl"
    out="$SB/status.out"
    PATH="$SB/bin:$PATH" ./status.sh > "$out" 2>&1; rc=$?
    assert_exit 0 "$rc" "status exits 0 even with failed health check"
    assert_contains "$out" "v0.0.1" "repo version shown"
    assert_contains "$out" "restart" "restart-pending warning shown (backend IDs differ)"
    assert_contains "$out" "example.com" "domain from bootstrap/instance.env"
    assert_contains "$out" "health check failed" "failed health reported, not fatal"
    cd / && rm -rf "$SB"
    exit "$FAILURES"
); FAILURES=$((FAILURES+$?))

echo "— backup.sh: archive contains db dump, assets, and config —"
(
    make_sandbox
    FAILURES=0
    cd "$SB/app"
    printf 'PRIMARY_DOMAIN=example.com\n' > .env      # ENABLE_MINIO unset → local storage path
    mkdir -p bootstrap ssl
    echo 'STATE=applied' > bootstrap/instance.env
    echo 'cert' > ssl/fullchain.pem
    cat > "$SB/bin/docker" <<'STUB'
#!/bin/bash
echo "docker $*" >> "$DOCKER_LOG"
case "$*" in
    "inspect --format {{.State.Running}} assethost-postgres") echo "true" ;;
    exec*pg_dump*) echo "-- pg_dump stub" ;;
    cp\ assethost-backend:*)
        dest="${!#}"
        mkdir -p "$dest" && echo blob > "$dest/asset.bin" ;;
esac
exit 0
STUB
    chmod +x "$SB/bin/docker"
    PATH="$SB/bin:$PATH" ./backup.sh >/dev/null 2>&1; rc=$?
    assert_exit 0 "$rc" "backup exits 0"
    archive=$(ls backups/bffless-backup-*.tar.gz 2>/dev/null | head -1)
    assert_file "$archive" "archive created"
    perms=$(stat -c %a "$archive" 2>/dev/null)
    if [ "$perms" = "600" ]; then echo "ok: archive is 600"; else echo "FAIL: archive perms $perms"; FAILURES=$((FAILURES+1)); fi
    listing="$SB/tar.lst"; tar -tzf "$archive" > "$listing"
    assert_contains "$listing" "database.sql" "db dump in archive"
    assert_contains "$listing" "uploads/asset.bin" "local assets in archive"
    assert_contains "$listing" ".env" ".env in archive"
    assert_contains "$listing" "bootstrap/instance.env" "bootstrap identity in archive"
    assert_contains "$listing" "ssl/fullchain.pem" "certs in archive"
    cd / && rm -rf "$SB"
    exit "$FAILURES"
); FAILURES=$((FAILURES+$?))

if [ "$FAILURES" -eq 0 ]; then
    echo 'ALL LIFECYCLE TESTS PASSED'
else
    echo "$FAILURES FAILURES"
    exit 1
fi
