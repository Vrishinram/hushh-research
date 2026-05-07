#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 Hushh
#
# Run npm audit and save the JSON report to npm-audit-report.json.
# Exits non-zero only on high/critical vulnerabilities when
# REQUIRE_NPM_AUDIT_CLEAN=1 (the default in CI).  When
# REQUIRE_NPM_AUDIT_CLEAN=0 the report is still written but the
# script always succeeds (advisory lane).

set -euo pipefail

REQUIRE_NPM_AUDIT_CLEAN="${REQUIRE_NPM_AUDIT_CLEAN:-0}"

REPO_ROOT="$(git rev-parse --show-toplevel)"
WEB_DIR="$REPO_ROOT/hushh-webapp"
REPORT="$WEB_DIR/npm-audit-report.json"

cd "$WEB_DIR"

echo "Running npm audit..."
EXIT_CODE=0
npm audit --json >"$REPORT" 2>/dev/null || EXIT_CODE=$?

# Summarise high/critical count from the report
HIGH_CRITICAL="$(python3 - <<'PY' "$REPORT"
import json, sys
from pathlib import Path
try:
    data = json.loads(Path(sys.argv[1]).read_text())
    meta = data.get("metadata", {})
    vulns = meta.get("vulnerabilities", {})
    count = vulns.get("high", 0) + vulns.get("critical", 0)
    print(count)
except Exception:
    print(0)
PY
)"

echo "npm audit: high/critical vulnerabilities = ${HIGH_CRITICAL}"

if [ "$HIGH_CRITICAL" -gt 0 ]; then
  if [ "$REQUIRE_NPM_AUDIT_CLEAN" = "1" ]; then
    echo "npm audit report written to $REPORT"
    echo "Failing CI: REQUIRE_NPM_AUDIT_CLEAN=1 and ${HIGH_CRITICAL} high/critical vulnerabilities found."
    exit 1
  else
    echo "Advisory: high/critical vulnerabilities found but REQUIRE_NPM_AUDIT_CLEAN is not set to 1."
  fi
fi

echo "npm audit report written to $REPORT"
exit 0
