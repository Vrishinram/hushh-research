#!/bin/sh
# scripts/setup-hooks.sh
# Monorepo wrapper that delegates setup to consent-protocol's shared toolkit.

set -e

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
DELEGATE="$REPO_ROOT/consent-protocol/ops/monorepo/setup.sh"

if [ ! -f "$DELEGATE" ]; then
  echo "[setup-hooks] Missing delegate script: consent-protocol/ops/monorepo/setup.sh"
  echo "[setup-hooks] Ensure consent-protocol subtree is present, then retry."
  exit 1
fi

exec sh "$DELEGATE" "$@"
