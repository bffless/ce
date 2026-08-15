#!/bin/bash
# Unit tests for scripts/channel.sh. Run: bash scripts/channel.test.sh
# No network: the "remote" is a local bare repo with tags.
set -u
FAILURES=0
LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/channel.sh"

ok()   { echo "ok: $1"; }
fail() { echo "FAIL: $1"; FAILURES=$((FAILURES+1)); }
assert_eq() { # got want label
    if [ "$1" = "$2" ]; then ok "$3"; else fail "$3 (got '$1', want '$2')"; fi
}
assert_grep() { # file pattern label
    if grep -qE "$2" "$1"; then ok "$3"; else fail "$3 (no /$2/ in $1)"; fi
}
assert_no_grep() { # file pattern label
    if ! grep -qE "$2" "$1"; then ok "$3"; else fail "$3 (unexpected /$2/ in $1)"; fi
}

SB=$(mktemp -d)
trap 'rm -rf "$SB"' EXIT
cd "$SB" || exit 1
# shellcheck disable=SC1090
. "$LIB"

echo "— channel_read —"
assert_eq "$(channel_read /nonexistent)" "stable" "missing .env → stable"
printf 'FOO=bar\n' > a.env
assert_eq "$(channel_read a.env)" "stable" "no key → stable"
printf 'BFFLESS_CHANNEL=preview\n' > a.env
assert_eq "$(channel_read a.env)" "preview" "preview read back"
printf 'BFFLESS_CHANNEL="preview"\n' > a.env
assert_eq "$(channel_read a.env)" "preview" "quoted value read back"
printf 'BFFLESS_CHANNEL=nightly\n' > a.env
assert_eq "$(channel_read a.env)" "stable" "invalid value → stable"

echo "— channel_write —"
printf 'ENABLE_MINIO=true' > b.env   # no trailing newline on purpose
channel_write preview b.env
assert_grep b.env '^ENABLE_MINIO=true$' "existing keys preserved"
assert_grep b.env '^BFFLESS_CHANNEL=preview$' "channel written"
assert_grep b.env '^BACKEND_TAG=preview$' "backend tag written"
assert_grep b.env '^FRONTEND_TAG=preview$' "frontend tag written"
channel_write preview b.env
assert_eq "$(grep -c '^BFFLESS_CHANNEL=' b.env)" "1" "rewrite is idempotent (one channel line)"
assert_eq "$(grep -c '^# Release channel' b.env)" "1" "rewrite is idempotent (one comment line)"
channel_write stable b.env
assert_grep b.env '^BFFLESS_CHANNEL=stable$' "switch back to stable"
assert_no_grep b.env '^(BACKEND|FRONTEND)_TAG=' "stable drops image tag overrides"
assert_grep b.env '^ENABLE_MINIO=true$' "other keys still intact after switch"
assert_eq "$(channel_read b.env)" "stable" "read after write round-trips"
channel_write bogus b.env 2>/dev/null; rc=$?
assert_eq "$rc" "1" "invalid channel rejected"
channel_write preview c.env
assert_grep c.env '^BFFLESS_CHANNEL=preview$' "creates .env when missing"

echo "— channel_latest_stable_tag / channel_ref —"
git init -q src && (
    cd src || exit 1; git config user.email t@t && git config user.name t
    git commit -q --allow-empty -m init
    git tag v0.4.9; git tag v0.4.10; git tag v0.4.28; git tag bffless-v0.3.1
    git tag preview-2026-08-15-abcdef123456; git tag v0.5.0-rc.1
)
git clone -q --bare src remote.git
assert_eq "$(channel_latest_stable_tag "$SB/remote.git")" "v0.4.28" "newest stable tag (numeric sort, ignores cli/preview/rc tags)"
assert_eq "$(channel_ref stable "$SB/remote.git")" "v0.4.28" "stable ref = newest tag"
assert_eq "$(channel_ref preview "$SB/remote.git")" "main" "preview ref = main"
git init -q --bare empty.git
assert_eq "$(channel_latest_stable_tag "$SB/empty.git")" "" "no tags → empty"
assert_eq "$(channel_ref stable "$SB/empty.git")" "main" "stable with no tags falls back to main"
assert_eq "$(channel_ref stable "$SB/does-not-exist.git")" "main" "unreachable remote falls back to main"

echo "— channel_head_preview_tag —"
(
    cd src || exit 1
    assert_eq "$(channel_head_preview_tag)" "preview-2026-08-15-abcdef123456" "preview tag at HEAD"
    git commit -q --allow-empty -m next
    assert_eq "$(channel_head_preview_tag)" "" "no preview tag at new HEAD"
    exit "$FAILURES"
); FAILURES=$((FAILURES+$?))

if [ "$FAILURES" -eq 0 ]; then
    echo 'ALL CHANNEL TESTS PASSED'
else
    echo "$FAILURES FAILURES"
    exit 1
fi
