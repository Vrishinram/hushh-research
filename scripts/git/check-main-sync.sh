#!/bin/sh
# scripts/git/check-main-sync.sh
# Ensures the current branch contains the latest origin/main before push/merge.

set -e

REMOTE="${MAIN_SYNC_REMOTE:-origin}"
BRANCH="${MAIN_SYNC_BRANCH:-main}"

CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || true)

if [ -z "$CURRENT_BRANCH" ]; then
  printf "\033[33m[main-sync]\033[0m Detached HEAD detected; skipping %s/%s check.\n" "$REMOTE" "$BRANCH"
  exit 0
fi

if [ "$CURRENT_BRANCH" = "$BRANCH" ]; then
  printf "\033[32m[main-sync]\033[0m On %s; no branch sync needed.\n" "$BRANCH"
  exit 0
fi

if ! git remote | grep -q "^${REMOTE}$"; then
  printf "\033[31m[main-sync]\033[0m Remote '%s' is not configured.\n" "$REMOTE"
  printf "         Run: \033[36mgit remote add %s <repo-url>\033[0m\n" "$REMOTE"
  exit 1
fi

if ! git fetch "$REMOTE" "$BRANCH" --quiet 2>/dev/null; then
  printf "\033[31m[main-sync]\033[0m Could not fetch %s/%s.\n" "$REMOTE" "$BRANCH"
  printf "         Run: \033[36mgit fetch %s %s\033[0m\n" "$REMOTE" "$BRANCH"
  exit 1
fi

REMOTE_SHA=$(git rev-parse "$REMOTE/$BRANCH" 2>/dev/null || echo "")
LOCAL_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")

if [ -z "$REMOTE_SHA" ] || [ -z "$LOCAL_SHA" ]; then
  printf "\033[31m[main-sync]\033[0m Could not resolve local or remote commit state.\n"
  exit 1
fi

if git merge-base --is-ancestor "$REMOTE_SHA" "$LOCAL_SHA" 2>/dev/null; then
  printf "\033[32m[main-sync]\033[0m Branch contains latest %s/%s. ✓\n" "$REMOTE" "$BRANCH"
  printf "         Local:  %s (%s)\n" "$(echo "$LOCAL_SHA" | cut -c1-8)" "$CURRENT_BRANCH"
  printf "         Remote: %s (%s/%s)\n" "$(echo "$REMOTE_SHA" | cut -c1-8)" "$REMOTE" "$BRANCH"
  exit 0
fi

BEHIND_COUNT=$(git rev-list "$LOCAL_SHA".."$REMOTE_SHA" --count 2>/dev/null || echo "unknown")
printf "\n\033[31m[main-sync] BLOCKED\033[0m Branch '%s' is behind %s/%s by %s commit(s).\n" \
  "$CURRENT_BRANCH" "$REMOTE" "$BRANCH" "$BEHIND_COUNT"
printf "         Local:  %s\n" "$(echo "$LOCAL_SHA" | cut -c1-8)"
printf "         Remote: %s\n\n" "$(echo "$REMOTE_SHA" | cut -c1-8)"
printf "  Run one of:\n"
printf "    \033[36mmake sync-main\033[0m\n"
printf "    \033[36mgit fetch %s %s && git merge %s/%s\033[0m\n" "$REMOTE" "$BRANCH" "$REMOTE" "$BRANCH"
printf "    \033[36mgit fetch %s %s && git rebase %s/%s\033[0m\n\n" "$REMOTE" "$BRANCH" "$REMOTE" "$BRANCH"
exit 1
