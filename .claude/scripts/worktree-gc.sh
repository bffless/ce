#!/usr/bin/env bash
# Garbage-collect CE worktrees under .claude/worktrees/ (and prune stale entries).
#
#   .claude/scripts/worktree-gc.sh            # dry run: report what would be removed
#   .claude/scripts/worktree-gc.sh --apply    # actually remove merged + clean worktrees
#
# A worktree is removed only when ALL of these hold:
#   - its branch has a PR whose state is MERGED (or CLOSED)  -- via `gh pr list --head`
#   - it has no uncommitted or untracked changes
# Everything else (open PR, no PR yet, dirty tree) is reported and left alone.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
WT_DIR="$REPO_ROOT/.claude/worktrees"
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

cd "$REPO_ROOT"
git fetch -q origin
git worktree prune

[ -d "$WT_DIR" ] || { echo "no $WT_DIR — nothing to do"; exit 0; }

removed=0; kept=0
for wt in "$WT_DIR"/*/; do
  wt="${wt%/}"
  [ -d "$wt" ] || continue
  name="$(basename "$wt")"
  br="$(git -C "$wt" branch --show-current 2>/dev/null || true)"
  if [ -z "$br" ]; then
    echo "KEEP   $name  (detached HEAD or not a worktree)"; kept=$((kept+1)); continue
  fi
  dirty="$(git -C "$wt" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  state="$(gh pr list --head "$br" --state all --limit 1 --json state,number --jq '.[0] | "\(.state) #\(.number)"' 2>/dev/null || true)"
  [ -z "$state" ] || [ "$state" = "null #null" ] && state="NO-PR"

  case "$state" in
    MERGED*|CLOSED*)
      if [ "$dirty" != "0" ]; then
        echo "KEEP   $name  [$br]  $state  but $dirty uncommitted change(s) — inspect by hand"; kept=$((kept+1)); continue
      fi
      if [ "$APPLY" = 1 ]; then
        git worktree remove --force "$wt"
        git branch -D "$br" >/dev/null 2>&1 || true
        echo "REMOVED $name  [$br]  $state"
      else
        echo "WOULD-REMOVE $name  [$br]  $state"
      fi
      removed=$((removed+1)) ;;
    *)
      echo "KEEP   $name  [$br]  $state  dirty=$dirty"; kept=$((kept+1)) ;;
  esac
done

git worktree prune
echo
if [ "$APPLY" = 1 ]; then echo "removed=$removed kept=$kept"; else echo "would-remove=$removed kept=$kept  (re-run with --apply to act)"; fi
