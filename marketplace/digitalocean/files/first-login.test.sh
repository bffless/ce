#!/bin/bash
# Unit tests for first-login.sh (env-seam paths; no /opt or /root access).
# Run: bash marketplace/digitalocean/files/first-login.test.sh
set -u
FAILURES=0
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/first-login.sh"

assert_contains() { if grep -qF "$2" "$1" 2>/dev/null; then echo "ok: $3"; else echo "FAIL: $3 (missing '$2' in $1)"; FAILURES=$((FAILURES+1)); fi }
assert_file_eq() { if diff -q "$1" "$2" >/dev/null 2>&1; then echo "ok: $3"; else echo "FAIL: $3"; FAILURES=$((FAILURES+1)); fi }

make_sandbox() {
    SB=$(mktemp -d)
    mkdir -p "$SB/app/bootstrap" "$SB/bin"
    echo "hook-line" > "$SB/bashrc"
    echo "clean-skel" > "$SB/skel-bashrc"
    # curl stub so detect_server_ip is deterministic and offline-safe
    printf '#!/bin/bash\necho 203.0.113.9\n' > "$SB/bin/curl" && chmod +x "$SB/bin/curl"
}
run_fl() { # stdin already wired by caller
    PATH="$SB/bin:$PATH" BFFLESS_INSTALL_DIR="$SB/app" BFFLESS_BASHRC="$SB/bashrc" \
        BFFLESS_SKEL_BASHRC="$SB/skel-bashrc" bash "$SCRIPT"
}

echo "— applied instance: prints admin URL, restores bashrc —"
make_sandbox
printf 'STATE=applied\nPRIMARY_DOMAIN=example.com\n' > "$SB/app/bootstrap/instance.env"
out=$(run_fl < /dev/null)
echo "$out" > "$SB/out"
assert_contains "$SB/out" "https://admin.example.com" "admin URL shown"
assert_file_eq "$SB/bashrc" "$SB/skel-bashrc" "bashrc restored from skel"
rm -rf "$SB"

echo "— unclaimed with .env: prints wizard link with token, keeps hook —"
make_sandbox
printf 'ONBOARDING_TOKEN=tok123\n' > "$SB/app/.env"
out=$(printf '\n' | run_fl)           # user presses Enter (skip terminal setup)
echo "$out" > "$SB/out"
assert_contains "$SB/out" "https://203.0.113.9/?token=tok123" "wizard claim URL shown"
assert_contains "$SB/bashrc" "hook-line" "bashrc hook kept while unclaimed"
rm -rf "$SB"

echo "— first boot not finished (no .env): says preparing, keeps hook —"
make_sandbox
out=$(run_fl < /dev/null)
echo "$out" > "$SB/out"
assert_contains "$SB/out" "still preparing" "preparing message shown"
assert_contains "$SB/bashrc" "hook-line" "bashrc hook kept"
rm -rf "$SB"

# shellcheck disable=SC2015
[ "$FAILURES" -eq 0 ] && echo 'ALL FIRST-LOGIN TESTS PASSED' || { echo "$FAILURES FAILURES"; exit 1; }
