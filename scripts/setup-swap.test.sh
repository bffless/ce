#!/bin/bash
# Host-runnable unit tests for scripts/setup-swap.sh (no root, no docker).
# Run: bash scripts/setup-swap.test.sh
set -u
FAILURES=0
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/setup-swap.sh"

assert_contains() { # file needle label
    if grep -qF "$2" "$1" 2>/dev/null; then echo "ok: $3"; else echo "FAIL: $3 (missing '$2' in $1)"; FAILURES=$((FAILURES+1)); fi
}
assert_no_file() { # path label
    if [ ! -e "$1" ]; then echo "ok: $2"; else echo "FAIL: $2 (unexpected file $1)"; FAILURES=$((FAILURES+1)); fi
}
assert_file() { # path label
    if [ -e "$1" ]; then echo "ok: $2"; else echo "FAIL: $2 (missing file $1)"; FAILURES=$((FAILURES+1)); fi
}
assert_exit0() { # label (checks $?) — call immediately after the command
    if [ "$1" -eq 0 ]; then echo "ok: $2"; else echo "FAIL: $2 (exit $1)"; FAILURES=$((FAILURES+1)); fi
}

make_sandbox() { # $1 = MemTotal kB, $2 = swapon --show output ("" = no swap)
    SB=$(mktemp -d)
    mkdir -p "$SB/bin" "$SB/sysctl.d"
    printf 'MemTotal:       %s kB\n' "$1" > "$SB/meminfo"
    : > "$SB/fstab"
    cat > "$SB/bin/swapon" <<STUB
#!/bin/bash
if [[ "\$*" == *--show* ]]; then printf '%s' '$2'; fi
exit 0
STUB
    cat > "$SB/bin/fallocate" <<'STUB'
#!/bin/bash
# args: -l <size> <path> — create the file like the real thing would
: > "$3"
STUB
    printf '#!/bin/bash\nexit 0\n' > "$SB/bin/mkswap"
    printf '#!/bin/bash\nexit 0\n' > "$SB/bin/sysctl"
    chmod +x "$SB/bin/"*
}

run_swap() { # runs the script inside the sandbox; sets RC
    RC=0
    PATH="$SB/bin:$PATH" SETUP_SWAP_ALLOW_NONROOT=1 \
        SWAPFILE="$SB/swapfile" FSTAB="$SB/fstab" MEMINFO="$SB/meminfo" \
        SYSCTL_DIR="$SB/sysctl.d" bash "$SCRIPT" >/dev/null 2>&1 || RC=$?
}

echo "— case 1: low-RAM host creates swap —"
make_sandbox 987000 ""            # ~1 GB droplet, no active swap
run_swap; assert_exit0 "$RC" "low-RAM run exits 0"
assert_file "$SB/swapfile" "swapfile created"
assert_contains "$SB/fstab" "$SB/swapfile none swap sw 0 0" "fstab entry added"
assert_file "$SB/sysctl.d/99-bffless-swappiness.conf" "swappiness conf written"
assert_contains "$SB/sysctl.d/99-bffless-swappiness.conf" "vm.swappiness=10" "swappiness value"

echo "— case 2: re-run is a no-op (fstab already has entry) —"
run_swap; assert_exit0 "$RC" "re-run exits 0"
if [ "$(grep -c 'none swap sw' "$SB/fstab")" -eq 1 ]; then echo "ok: no duplicate fstab entry"; else echo "FAIL: duplicate fstab entry"; FAILURES=$((FAILURES+1)); fi
rm -rf "$SB"

echo "— case 3: 4GB-class host is a no-op —"
make_sandbox 3900000 ""           # 4 GB droplet reports ~3.8 GB
run_swap; assert_exit0 "$RC" "high-RAM run exits 0"
assert_no_file "$SB/swapfile" "no swapfile on 4GB host"
rm -rf "$SB"

echo "— case 4: active swap is a no-op —"
make_sandbox 987000 'NAME      TYPE SIZE USED PRIO
/swapfile file   2G   0B   -2
'
run_swap; assert_exit0 "$RC" "active-swap run exits 0"
assert_no_file "$SB/swapfile" "no swapfile when swap already active"
rm -rf "$SB"

if [ "$FAILURES" -eq 0 ]; then
    echo 'ALL SETUP-SWAP TESTS PASSED'
else
    echo "$FAILURES FAILURES"
    exit 1
fi
