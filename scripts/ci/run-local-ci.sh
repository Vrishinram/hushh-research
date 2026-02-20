#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo "== CI Parity (Local) =="
echo "Running the same check scripts used by GitHub Actions."

scripts/ci/secret-scan.sh
scripts/ci/docs-parity-check.sh
scripts/ci/web-check.sh
scripts/ci/protocol-check.sh
scripts/ci/integration-check.sh
scripts/ci/subtree-sync-check.sh

echo "✅ Local CI parity checks passed."
