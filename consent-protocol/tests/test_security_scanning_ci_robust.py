"""
Security enforcement tests for PR 3524 — security-scanning CI.

Validates that the security scanning script and workflow config
contain required safety enforcement clauses (set -euo pipefail,
bandit, fail-on-exit logic), ensuring the CI gate is not bypassable.
"""

import os
import re

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
# The scripts/ dir lives in the hushh-research root, one level above consent-protocol
HUSHH_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SCAN_SCRIPT = os.path.join(HUSHH_ROOT, "scripts", "ops", "run-security-scan.sh")
WORKFLOW = os.path.join(
    HUSHH_ROOT, "docs", "reference", "operations", "proposals", "security-scanning.workflow.yml"
)


def _read(path):
    assert os.path.exists(path), f"Required file missing: {path}"
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read()


def test_scan_script_exists():
    """The security scan shell script must be present."""
    assert os.path.exists(SCAN_SCRIPT), f"Missing: {SCAN_SCRIPT}"


def test_scan_script_has_strict_mode():
    """Script must use set -euo pipefail so any failure is fatal."""
    content = _read(SCAN_SCRIPT)
    assert "set -euo pipefail" in content, (
        "Security scan script must use 'set -euo pipefail' for strict failure handling"
    )


def test_scan_script_runs_bandit():
    """Script must invoke bandit for Python static security analysis."""
    content = _read(SCAN_SCRIPT)
    assert "bandit" in content, "Security scan script must invoke bandit for Python static analysis"


def test_scan_script_tracks_failures():
    """Script must track failures via a fail flag and exit non-zero on failure."""
    content = _read(SCAN_SCRIPT)
    assert re.search(r"\bfail\b", content), (
        "Script must maintain a 'fail' flag to accumulate errors"
    )
    assert re.search(r"exit\s+\$?fail", content) or re.search(r"exit\s+1", content), (
        "Script must exit non-zero when any security check fails"
    )


def test_scan_script_excludes_test_dirs():
    """Bandit invocation must exclude test directories to avoid false positives."""
    content = _read(SCAN_SCRIPT)
    assert "--exclude" in content and "tests" in content, (
        "Bandit must exclude test directories from scanning"
    )


def test_contributing_md_references_security_scanning():
    """contributing.md must reference the security scanning process."""
    contrib_path = os.path.join(HUSHH_ROOT, "contributing.md")
    if not os.path.exists(contrib_path):
        pytest.skip("contributing.md not in repo root — check docs/")
    content = _read(contrib_path).lower()
    assert any(kw in content for kw in ["security", "bandit", "scan", "vulnerability"]), (
        "contributing.md must mention security scanning requirements for contributors"
    )
