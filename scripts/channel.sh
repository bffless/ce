#!/bin/sh
# Shared helper: release-channel handling for self-hosted installs.
# POSIX sh — sourced by install.sh, update.sh and status.sh.
#
#   stable  (default)  git tree pinned to the newest vX.Y.Z tag, images :latest
#   preview            git tree on main, images :preview (rebuilt on every merge)
#
# The choice is persisted in .env as BFFLESS_CHANNEL; the preview channel also
# sets BACKEND_TAG / FRONTEND_TAG so docker-compose.yml resolves :preview.
# Tests: bash scripts/channel.test.sh

CHANNEL_DEFAULT="stable"
CHANNEL_MAIN_BRANCH="${CHANNEL_MAIN_BRANCH:-main}"

channel_valid() {
    case "$1" in
        stable|preview) return 0 ;;
        *) return 1 ;;
    esac
}

# Channel recorded in an .env file (default ./.env); "stable" when unset/invalid.
channel_read() {
    _env_file="${1:-.env}"
    _ch=""
    if [ -f "$_env_file" ]; then
        _ch=$(sed -nE 's/^BFFLESS_CHANNEL=["'"'"']?([A-Za-z]+).*$/\1/p' "$_env_file" | tail -1)
    fi
    if channel_valid "$_ch"; then
        echo "$_ch"
    else
        echo "$CHANNEL_DEFAULT"
    fi
}

# Persist a channel to an .env file (default ./.env). Replaces any existing
# BFFLESS_CHANNEL / BACKEND_TAG / FRONTEND_TAG lines. stable drops the *_TAG
# keys so docker-compose.yml falls back to :latest.
channel_write() {
    _ch="$1"
    _env_file="${2:-.env}"
    if ! channel_valid "$_ch"; then
        echo "channel_write: invalid channel '$_ch' (stable|preview)" >&2
        return 1
    fi
    [ -f "$_env_file" ] || : > "$_env_file"
    _tmp="${_env_file}.channel.tmp"
    grep -vE '^(BFFLESS_CHANNEL|BACKEND_TAG|FRONTEND_TAG)=|^# Release channel \(' "$_env_file" > "$_tmp" || true
    # Ensure the file ends with a newline before appending.
    if [ -s "$_tmp" ] && [ "$(tail -c1 "$_tmp" | od -An -c | tr -d ' ')" != '\n' ]; then
        echo "" >> "$_tmp"
    fi
    {
        echo "# Release channel (stable | preview) - managed by install.sh / update.sh --channel"
        echo "BFFLESS_CHANNEL=$_ch"
        if [ "$_ch" = "preview" ]; then
            echo "BACKEND_TAG=preview"
            echo "FRONTEND_TAG=preview"
        fi
    } >> "$_tmp"
    mv "$_tmp" "$_env_file"
}

# Newest stable tag (vX.Y.Z, no pre-release suffix) on a remote (name or URL).
# Prints nothing when the remote has no stable tags or cannot be reached.
channel_latest_stable_tag() {
    _remote="${1:-origin}"
    git ls-remote --tags --refs "$_remote" 'refs/tags/v[0-9]*' 2>/dev/null \
        | sed -nE 's#^[0-9a-f]+[[:space:]]+refs/tags/(v[0-9]+\.[0-9]+\.[0-9]+)$#\1#p' \
        | sort -t. -k1.2,1n -k2,2n -k3,3n \
        | tail -1
}

# Git ref a channel should track on a remote: preview → main;
# stable → newest vX.Y.Z tag, or main when the remote has no stable tag yet.
channel_ref() {
    _ch="$1"
    _remote="${2:-origin}"
    if [ "$_ch" = "preview" ]; then
        echo "$CHANNEL_MAIN_BRANCH"
        return 0
    fi
    _tag=$(channel_latest_stable_tag "$_remote")
    echo "${_tag:-$CHANNEL_MAIN_BRANCH}"
}

# preview-YYYY-MM-DD-<sha> tag pointing exactly at HEAD, if any.
channel_head_preview_tag() {
    git tag --points-at HEAD 'preview-*' 2>/dev/null | head -1
}
