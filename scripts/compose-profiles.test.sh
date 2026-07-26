#!/bin/bash
# Unit tests for scripts/compose-profiles.sh. Run: bash scripts/compose-profiles.test.sh
set -u
FAILURES=0
LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/compose-profiles.sh"

check() { # label expected env-assignments...
    local label="$1" expected="$2"; shift 2
    local got
    got=$(env -i bash -c "$* ; source '$LIB'; compose_profiles")
    if [ "$got" = "$expected" ]; then echo "ok: $label"; else echo "FAIL: $label (got '$got', want '$expected')"; FAILURES=$((FAILURES+1)); fi
}

check "defaults: postgres + supertokens" \
    " --profile postgres --profile supertokens" "true"
check "everything on" \
    " --profile postgres --profile minio --profile redis --profile supertokens" \
    "export ENABLE_POSTGRES=true ENABLE_MINIO=true ENABLE_REDIS=true SUPERTOKENS_MODE=local"
check "external DB + managed supertokens" \
    "" "export ENABLE_POSTGRES=false SUPERTOKENS_MODE=managed"
check "minio only extra" \
    " --profile postgres --profile minio --profile supertokens" \
    "export ENABLE_MINIO=true"

if [ "$FAILURES" -eq 0 ]; then
    echo 'ALL COMPOSE-PROFILES TESTS PASSED'
else
    echo "$FAILURES FAILURES"
    exit 1
fi
