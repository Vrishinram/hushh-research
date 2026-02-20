#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
PROTOCOL_DIR="$REPO_ROOT/consent-protocol"

cd "$PROTOCOL_DIR"
bash scripts/ci/backend-check.sh
