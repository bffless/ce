#!/bin/sh
# Host-runnable harness for nginx-reload-watcher.sh: shim inotifywait, nginx,
# the renderer and a scripted event queue, then assert how many reloads a
# burst of writes produces. Run: sh docker/nginx/nginx-reload-watcher.test.sh
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
FAILURES=0
assert_eq() { # actual expected label
  if [ "$1" = "$2" ]; then echo "ok: $3"; else echo "FAIL: $3 (got '$1', want '$2')"; FAILURES=$((FAILURES+1)); fi
}

# One sandbox per scenario: a watched dir, a shim bin dir, an event queue.
# The inotifywait shim pops one line from the queue per call:
#   "event"        → exit 0 (an event arrived)
#   "quiet"        → exit 2 (timeout: nothing for QUIET_SECONDS)
#   "event:<file>" → write that file into the watched dir, then exit 0
# An empty queue means "no more events ever": the shim blocks briefly and,
# because MAX_CYCLES is set, the watcher has already exited by then.
setup() {
  SANDBOX="$(mktemp -d)"
  mkdir -p "$SANDBOX/sites" "$SANDBOX/bin"
  QUEUE="$SANDBOX/queue"; : > "$QUEUE"
  cat > "$SANDBOX/bin/inotifywait" <<'EOF'
#!/bin/sh
line="$(head -n1 "$WATCH_TEST_QUEUE")"
if [ -z "$line" ]; then sleep 5; exit 1; fi
tail -n +2 "$WATCH_TEST_QUEUE" > "$WATCH_TEST_QUEUE.next" && mv "$WATCH_TEST_QUEUE.next" "$WATCH_TEST_QUEUE"
case "$line" in
  quiet) exit 2 ;;
  event:*) f="${line#event:}"; echo "server {}" > "$WATCH_TEST_SITES/$f"; exit 0 ;;
  *) exit 0 ;;
esac
EOF
  cat > "$SANDBOX/bin/nginx" <<'EOF'
#!/bin/sh
case "$*" in
  *-t*) echo "nginx: configuration file /etc/nginx/nginx.conf test is successful" ;;
  *reload*) echo reload >> "$WATCH_TEST_RELOADS"; ls "$WATCH_TEST_SITES" | sort | tr '\n' ' ' >> "$WATCH_TEST_RELOADS"; echo >> "$WATCH_TEST_RELOADS" ;;
esac
EOF
  cat > "$SANDBOX/bin/render" <<'EOF'
#!/bin/sh
exit 0
EOF
  chmod +x "$SANDBOX/bin/"*
  RELOADS="$SANDBOX/reloads"; : > "$RELOADS"
  export WATCH_TEST_QUEUE="$QUEUE" WATCH_TEST_SITES="$SANDBOX/sites" WATCH_TEST_RELOADS="$RELOADS"
}

run_watcher() { # max cycles
  PATH="$SANDBOX/bin:$PATH" \
  NGINX_WATCH_PATHS="$SANDBOX/sites/" NGINX_WATCH_QUIET_SECONDS=1 \
  NGINX_WATCH_RENDER="$SANDBOX/bin/render" NGINX_WATCH_MAX_CYCLES="$1" \
    sh "$HERE/nginx-reload-watcher.sh" > "$SANDBOX/log" 2>&1
}

echo "--- a burst of writes reloads once, after the last write"
setup
# first event wakes the watcher; three more writes arrive while it drains; then quiet
printf 'event:domain-a.conf\nevent:domain-b.conf\nevent:domain-c.conf\nevent:domain-d.conf\nquiet\n' > "$QUEUE"
run_watcher 1
assert_eq "$(grep -c '^reload$' "$RELOADS")" "1" "one reload for a four-file burst"
assert_eq "$(sed -n '2p' "$RELOADS" | tr -s ' ')" "domain-a.conf domain-b.conf domain-c.conf domain-d.conf " "nginx saw every file of the burst at reload time"

echo "--- a write that lands during the reload gets its own cycle"
setup
# The nginx shim's reload writes nothing; simulate a late write by making the
# render shim drop a file into the watched dir (the watcher is busy, no watch armed).
cat > "$SANDBOX/bin/render" <<'EOF'
#!/bin/sh
if [ ! -f "$WATCH_TEST_SITES/late.conf" ] && [ -f "$WATCH_TEST_SITES/domain-a.conf" ]; then echo "server {}" > "$WATCH_TEST_SITES/late.conf"; fi
exit 0
EOF
chmod +x "$SANDBOX/bin/render"
printf 'event:domain-a.conf\nquiet\nquiet\n' > "$QUEUE"
run_watcher 2
assert_eq "$(grep -c '^reload$' "$RELOADS")" "2" "the late write triggered a second reload"
assert_eq "$(grep -c 'going again' "$SANDBOX/log")" "1" "the watcher noticed the fingerprint change"

echo "--- an invalid config is not reloaded"
setup
cat > "$SANDBOX/bin/nginx" <<'EOF'
#!/bin/sh
case "$*" in *-t*) echo "nginx: [emerg] unexpected end of file" ;; *reload*) echo reload >> "$WATCH_TEST_RELOADS" ;; esac
EOF
chmod +x "$SANDBOX/bin/nginx"
printf 'event:domain-a.conf\nquiet\n' > "$QUEUE"
run_watcher 1
assert_eq "$(grep -c '^reload$' "$RELOADS")" "0" "no reload on an invalid config"
assert_eq "$(grep -c 'Config invalid' "$SANDBOX/log")" "1" "the failure is logged"

if [ "$FAILURES" -eq 0 ]; then echo "ALL WATCHER TESTS PASSED"; else echo "$FAILURES FAILURE(S)"; exit 1; fi
