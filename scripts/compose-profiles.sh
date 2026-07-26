#!/bin/bash
# Shared helper: compute `docker compose` --profile args from the environment.
# Source this file, then call compose_profiles. Callers load .env first
# (set -a; source .env; set +a) — this helper only reads env vars.
# Defaults mirror start.sh: postgres on, minio off, redis off, supertokens local.

compose_profiles() {
    local profiles=""
    if [ "${ENABLE_POSTGRES:-true}" = "true" ]; then
        profiles="$profiles --profile postgres"
    fi
    if [ "${ENABLE_MINIO:-false}" = "true" ]; then
        profiles="$profiles --profile minio"
    fi
    if [ "${ENABLE_REDIS:-false}" = "true" ]; then
        profiles="$profiles --profile redis"
    fi
    if [ "${SUPERTOKENS_MODE:-local}" = "local" ]; then
        profiles="$profiles --profile supertokens"
    fi
    echo "$profiles"
}
