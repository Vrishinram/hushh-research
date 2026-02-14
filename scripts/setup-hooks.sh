#!/bin/sh
# scripts/setup-hooks.sh -- Install git hooks for hushh-research monorepo
#
# Called by:
#   - make setup          (first-time onboarding)
#   - npm install          (via "prepare" lifecycle hook in package.json)
#   - manual: sh scripts/setup-hooks.sh
#
# Idempotent — safe to run multiple times.

set -e

# Resolve repo root (this script lives in scripts/)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOKS_DIR="$REPO_ROOT/.githooks"

# ─────────────────────────────────────────────────────────────────────────────
# 1. Verify we're inside a git repo
# ─────────────────────────────────────────────────────────────────────────────

if [ ! -d "$REPO_ROOT/.git" ]; then
  # Probably running inside a CI tarball or npm pack — skip silently
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# 2. Point git to our hooks directory
# ─────────────────────────────────────────────────────────────────────────────

CURRENT_HOOKS_PATH=$(cd "$REPO_ROOT" && git config core.hooksPath 2>/dev/null || true)

if [ "$CURRENT_HOOKS_PATH" = ".githooks" ]; then
  echo "[setup-hooks] Git hooks already configured. ✓"
else
  (cd "$REPO_ROOT" && git config core.hooksPath .githooks)
  echo "[setup-hooks] Git hooks path set to .githooks ✓"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 3. Ensure hooks are executable
# ─────────────────────────────────────────────────────────────────────────────

if [ -d "$HOOKS_DIR" ]; then
  for hook in "$HOOKS_DIR"/*; do
    if [ -f "$hook" ]; then
      chmod +x "$hook"
    fi
  done
  echo "[setup-hooks] Hook files are executable. ✓"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 4. Add consent-upstream remote (if missing)
# ─────────────────────────────────────────────────────────────────────────────

if (cd "$REPO_ROOT" && git remote | grep -q "consent-upstream"); then
  echo "[setup-hooks] Remote 'consent-upstream' already configured. ✓"
else
  (cd "$REPO_ROOT" && git remote add consent-upstream https://github.com/hushh-labs/consent-protocol.git 2>/dev/null) && \
    echo "[setup-hooks] Remote 'consent-upstream' added. ✓" || \
    echo "[setup-hooks] Could not add consent-upstream remote (may already exist)."
fi

echo "[setup-hooks] Done. Hooks are active for this repo."
