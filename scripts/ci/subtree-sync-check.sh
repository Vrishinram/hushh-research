#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

UPSTREAM_REMOTE="consent-upstream"
UPSTREAM_BRANCH="main"
SUBTREE_PREFIX="consent-protocol"
SYNC_REF="refs/subtree-sync/consent-protocol"
MONOREPO_SYNC_CHECK="consent-protocol/ops/monorepo/pre-push.sh"

git remote add "$UPSTREAM_REMOTE" https://github.com/hushh-labs/consent-protocol.git 2>/dev/null || true
git fetch "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH" --quiet 2>/dev/null || {
  echo "Could not fetch upstream. Skipping sync check."
  exit 0
}

UPSTREAM_COMMIT="$(git rev-parse "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" 2>/dev/null || true)"
if [ -z "$UPSTREAM_COMMIT" ]; then
  echo "Could not resolve upstream commit. Skipping."
  exit 0
fi

UPSTREAM_TREE="$(git rev-parse "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH^{tree}" 2>/dev/null || true)"
LOCAL_TREE="$(git rev-parse "HEAD:$SUBTREE_PREFIX" 2>/dev/null || true)"

LOCAL_SPLIT="$(git subtree split --prefix="$SUBTREE_PREFIX" HEAD 2>/dev/null || true)"
if [ -z "$LOCAL_SPLIT" ]; then
  # Some histories contain missing split hashes from old subtree joins.
  # Ignore joins so we can still classify ahead/behind when possible.
  LOCAL_SPLIT="$(git subtree split --ignore-joins --prefix="$SUBTREE_PREFIX" HEAD 2>/dev/null || true)"
fi

if [ -n "$LOCAL_SPLIT" ] && [ "$LOCAL_SPLIT" = "$UPSTREAM_COMMIT" ]; then
  echo "✅ consent-protocol/ is in sync with upstream."
  exit 0
fi

if [ -n "$LOCAL_SPLIT" ] && git merge-base --is-ancestor "$UPSTREAM_COMMIT" "$LOCAL_SPLIT" 2>/dev/null; then
  AHEAD_BY="$(git rev-list --count "$UPSTREAM_COMMIT..$LOCAL_SPLIT" 2>/dev/null || echo "unknown")"
  echo "ℹ️ consent-protocol/ subtree is ahead of upstream by ${AHEAD_BY} commit(s). Run: make push-protocol"
  exit 0
fi

if [ -n "$LOCAL_SPLIT" ] && git merge-base --is-ancestor "$LOCAL_SPLIT" "$UPSTREAM_COMMIT" 2>/dev/null; then
  BEHIND_BY="$(git rev-list --count "$LOCAL_SPLIT..$UPSTREAM_COMMIT" 2>/dev/null || echo "unknown")"
  echo "⚠️ consent-protocol/ subtree is behind upstream by ${BEHIND_BY} commit(s). Run: make sync-protocol"
  exit 0
fi

if [ -n "$UPSTREAM_TREE" ] && [ -n "$LOCAL_TREE" ] && [ "$UPSTREAM_TREE" = "$LOCAL_TREE" ]; then
  echo "✅ consent-protocol/ subtree content matches upstream."
  exit 0
fi

if [ ! -x "$MONOREPO_SYNC_CHECK" ]; then
  echo "ℹ️ consent-protocol/ subtree differs from upstream (direction undetermined). Verify manually with make check-protocol-sync."
  exit 0
fi

set +e
SYNC_GATE_OUTPUT="$(
  CONSENT_UPSTREAM_REMOTE="$UPSTREAM_REMOTE" \
  CONSENT_UPSTREAM_BRANCH="$UPSTREAM_BRANCH" \
  CONSENT_SUBTREE_PREFIX="$SUBTREE_PREFIX" \
  CONSENT_SYNC_REF="$SYNC_REF" \
  sh "$MONOREPO_SYNC_CHECK" --check-only 2>&1
)"
SYNC_GATE_EXIT="$?"
set -e

SYNC_GATE_SUMMARY="$(printf '%s' "$SYNC_GATE_OUTPUT" | sed -E 's/\x1b\[[0-9;]*m//g' | tr -s '\n' ' ' | sed -E 's/[[:space:]]+/ /g' | cut -c1-220)"

if [ "$SYNC_GATE_EXIT" -eq 0 ]; then
  echo "ℹ️ consent-protocol/ subtree differs from upstream; upstream is not ahead of the known sync baseline. If these subtree changes are intentional, run: make push-protocol"
  exit 0
fi

echo "⚠️ consent-protocol/ subtree differs from upstream and upstream may be ahead (or sync metadata is stale). Run: make sync-protocol, then make push-protocol if needed."
if [ -n "$SYNC_GATE_SUMMARY" ]; then
  echo "   sync-gate: $SYNC_GATE_SUMMARY"
fi
