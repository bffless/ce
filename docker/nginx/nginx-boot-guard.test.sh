#!/bin/sh
# Host-runnable harness for nginx-boot-guard.sh: a shim nginx whose `-t`
# fails while any file listed in $WATCH_TEST_BAD exists in the sites dir.
# Run: sh docker/nginx/nginx-boot-guard.test.sh
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
FAILURES=0
assert_eq() { # actual expected label
  if [ "$1" = "$2" ]; then echo "ok: $3"; else echo "FAIL: $3 (got '$1', want '$2')"; FAILURES=$((FAILURES+1)); fi
}

setup() {
  SANDBOX="$(mktemp -d)"
  mkdir -p "$SANDBOX/sites" "$SANDBOX/bin"
  cat > "$SANDBOX/bin/nginx" <<'EOF'
#!/bin/sh
# `nginx -t` fails on the first still-present bad file; else succeeds.
case "$*" in
  *-t*)
    for f in $WATCH_TEST_BAD; do
      if [ -f "$WATCH_TEST_SITES/$f" ]; then
        echo "nginx: [emerg] cannot load certificate \"/etc/nginx/ssl/gone.crt\" in $WATCH_TEST_SITES/$f:12" >&2
        echo "nginx: configuration file /etc/nginx/nginx.conf test failed" >&2
        exit 1
      fi
    done
    if [ -n "$WATCH_TEST_MAIN_BROKEN" ]; then
      echo "nginx: [emerg] unknown directive \"bogus\" in /etc/nginx/nginx.conf:5" >&2
      exit 1
    fi
    echo "nginx: configuration file /etc/nginx/nginx.conf test is successful" >&2 ;;
esac
EOF
  chmod +x "$SANDBOX/bin/nginx"
  export WATCH_TEST_SITES="$SANDBOX/sites"
}

run_guard() {
  PATH="$SANDBOX/bin:$PATH" NGINX_SITES_DIR="$SANDBOX/sites" sh "$HERE/nginx-boot-guard.sh" > "$SANDBOX/log" 2>&1
}

echo "--- two invalid site files are moved aside and nginx validates"
setup
for f in domain-good.conf domain-bad1.conf domain-bad2.conf; do echo "server {}" > "$SANDBOX/sites/$f"; done
WATCH_TEST_BAD="domain-bad1.conf domain-bad2.conf" run_guard; rc=$?
assert_eq "$rc" "0" "guard exits 0 once the config validates"
# shellcheck disable=SC2012 # sandbox names are ours
assert_eq "$(ls "$SANDBOX/sites" | sort | tr '\n' ' ')" "domain-bad1.conf.invalid domain-bad2.conf.invalid domain-good.conf " "the bad files are renamed .invalid, the good one untouched"
assert_eq "$(grep -c quarantined "$SANDBOX/log")" "2" "each quarantine is logged"

echo "--- a valid tree is left alone"
setup
echo "server {}" > "$SANDBOX/sites/domain-a.conf"
WATCH_TEST_BAD="" run_guard; rc=$?
assert_eq "$rc" "0" "exit 0"
assert_eq "$(ls "$SANDBOX/sites")" "domain-a.conf" "nothing renamed"

echo "--- a failure outside sites-enabled is reported, not hidden"
setup
echo "server {}" > "$SANDBOX/sites/domain-a.conf"
set +e
WATCH_TEST_BAD="" WATCH_TEST_MAIN_BROKEN=1 run_guard; rc=$?
set -e
assert_eq "$rc" "1" "exit 1 when the main config is the problem"
assert_eq "$(ls "$SANDBOX/sites")" "domain-a.conf" "no site file quarantined for someone else's error"
assert_eq "$(grep -c 'not quarantining' "$SANDBOX/log")" "1" "the reason is logged"

if [ "$FAILURES" -eq 0 ]; then echo "ALL BOOT GUARD TESTS PASSED"; else echo "$FAILURES FAILURE(S)"; exit 1; fi
