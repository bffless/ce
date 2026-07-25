#!/bin/bash
# Host-runnable unit tests for restart.sh / update.sh / logs.sh / status.sh /
# backup.sh. No docker or root needed: external commands are stubbed on PATH
# and each case runs in its own sandbox copy of the scripts.
# Run: bash scripts/lifecycle.test.sh
# shellcheck disable=SC2030,SC2031
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

if [ "$FAILURES" -eq 0 ]; then
    echo 'ALL LIFECYCLE TESTS PASSED'
else
    echo "$FAILURES FAILURES"
    exit 1
fi
