#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

if [ "${SKIP_SECRET_SCAN:-0}" = "1" ]; then
  echo "Skipping secret scan because SKIP_SECRET_SCAN=1"
  exit 0
fi

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks is required for CI parity. Install it or set SKIP_SECRET_SCAN=1 for local-only runs."
  exit 1
fi

LOG_OPTS="${GITLEAKS_LOG_OPTS:---all}"
gitleaks git --redact --no-banner --exit-code 1 --log-opts="${LOG_OPTS}"
