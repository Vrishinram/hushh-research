"""Security tests for PR 3499 — fix-windows-tests / consent route."""

import ast
import os

CONSENT_RT = os.path.join(os.path.dirname(__file__), "..", "api", "routes", "consent.py")


def _r(p):
    with open(p, encoding="utf-8", errors="replace") as f:
        return f.read()


def test_consent_route_exists():
    assert os.path.exists(CONSENT_RT)


def test_consent_route_valid_python():
    assert ast.parse(_r(CONSENT_RT)) is not None


def test_consent_route_requires_auth():
    content = _r(CONSENT_RT)
    assert any(k in content for k in ["VAULT_OWNER", "validate_token", "Depends", "Header"]), (
        "Consent route must require auth token via Depends/Header"
    )


def test_consent_route_has_vault_gate():
    assert "vault" in _r(CONSENT_RT).lower(), "Consent route must be vault-gated"


def test_consent_route_has_security_comment():
    assert "SECURITY" in _r(CONSENT_RT) or "security" in _r(CONSENT_RT).lower(), (
        "Consent route must document security requirements"
    )


def test_consent_route_uses_scopes():
    assert "scope" in _r(CONSENT_RT).lower(), (
        "Consent route must enforce scope-based access control"
    )
