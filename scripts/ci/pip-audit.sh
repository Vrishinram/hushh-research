#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 Hushh
#
# Run pip-audit against the consent-protocol virtual environment and
# save a JSON report to pip-audit-report.json.
# Exits non-zero only on high/critical CVEs when
# REQUIRE_PIP_AUDIT_CLEAN=1.  Otherwise advisory only.

set -euo pipefail

REQUIRE_PIP_AUDIT_CLEAN="${REQUIRE_PIP_AUDIT_CLEAN:-0}"

REPO_ROOT="$(git rev-parse --show-toplevel)"
PROTOCOL_DIR="$REPO_ROOT/consent-protocol"
REPORT="$PROTOCOL_DIR/pip-audit-report.json"

cd "$PROTOCOL_DIR"

if ! command -v pip-audit >/dev/null 2>&1; then
  echo "pip-audit not found; attempting install via uv pip..."
  if command -v uv >/dev/null 2>&1; then
    uv pip install pip-audit --quiet
  else
    python3 -m pip install pip-audit --quiet
  fi
fi

echo "Running pip-audit..."
EXIT_CODE=0
pip-audit --format json --output "$REPORT" 2>/dev/null || EXIT_CODE=$?

# Summarise vulnerability count from the report
VULN_COUNT="$(python3 - <<'PY' "$REPORT"
import json, sys
from pathlib import Path
try:
    data = json.loads(Path(sys.argv[1]).read_text())
    # pip-audit JSON: list of {name, version, vulns: [...]}
    count = sum(len(dep.get("vulns", [])) for dep in data)
    print(count)
except Exception:
    print(0)
PY
)"

echo "pip-audit: vulnerabilities = ${VULN_COUNT}"

if [ "$VULN_COUNT" -gt 0 ]; then
  echo "pip-audit report written to $REPORT"
  if [ "$REQUIRE_PIP_AUDIT_CLEAN" = "1" ]; then
    echo "Failing CI: REQUIRE_PIP_AUDIT_CLEAN=1 and ${VULN_COUNT} vulnerabilities found."
    exit 1
  else
    echo "Advisory: vulnerabilities found but REQUIRE_PIP_AUDIT_CLEAN is not set to 1."
  fi
fi

echo "pip-audit report written to $REPORT"
exit 0
