#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

git remote add consent-upstream https://github.com/hushh-labs/consent-protocol.git 2>/dev/null || true
git fetch consent-upstream main --quiet 2>/dev/null || {
  echo "Could not fetch upstream. Skipping sync check."
  exit 0
}

UPSTREAM_COMMIT="$(git rev-parse consent-upstream/main 2>/dev/null || true)"
if [ -z "$UPSTREAM_COMMIT" ]; then
  echo "Could not resolve upstream commit. Skipping."
  exit 0
fi

LOCAL_SPLIT="$(git subtree split --prefix=consent-protocol HEAD 2>/dev/null || true)"

if [ -z "$LOCAL_SPLIT" ]; then
  echo "Could not compute local subtree split commit. Falling back to tree comparison."
  UPSTREAM_TREE="$(git rev-parse consent-upstream/main^{tree} 2>/dev/null || true)"
  LOCAL_TREE="$(git rev-parse HEAD:consent-protocol 2>/dev/null || true)"
  if [ -n "$UPSTREAM_TREE" ] && [ -n "$LOCAL_TREE" ] && [ "$UPSTREAM_TREE" = "$LOCAL_TREE" ]; then
    echo "✅ consent-protocol/ subtree content matches upstream."
  else
    echo "ℹ️ consent-protocol/ subtree differs from upstream (direction undetermined). Verify manually with make check-protocol-sync."
  fi
  exit 0
fi

if [ "$LOCAL_SPLIT" = "$UPSTREAM_COMMIT" ]; then
  echo "✅ consent-protocol/ is in sync with upstream."
  exit 0
fi

if git merge-base --is-ancestor "$UPSTREAM_COMMIT" "$LOCAL_SPLIT" 2>/dev/null; then
  AHEAD_BY="$(git rev-list --count "$UPSTREAM_COMMIT..$LOCAL_SPLIT" 2>/dev/null || echo "unknown")"
  echo "ℹ️ consent-protocol/ subtree is ahead of upstream by ${AHEAD_BY} commit(s). Run: make push-protocol"
  exit 0
fi

if git merge-base --is-ancestor "$LOCAL_SPLIT" "$UPSTREAM_COMMIT" 2>/dev/null; then
  BEHIND_BY="$(git rev-list --count "$LOCAL_SPLIT..$UPSTREAM_COMMIT" 2>/dev/null || echo "unknown")"
  echo "⚠️ consent-protocol/ subtree is behind upstream by ${BEHIND_BY} commit(s). Run: make sync-protocol"
  exit 0
fi

echo "⚠️ consent-protocol/ subtree has diverged from upstream. Run: make sync-protocol then make push-protocol as needed."
