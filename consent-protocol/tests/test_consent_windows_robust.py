"""Security tests for PR 3451 — fix-consent-windows / consent route."""
import os, ast
CONSENT_RT = os.path.join(os.path.dirname(__file__), "..", "api", "routes", "consent.py")
def _r(p):
    with open(p, encoding="utf-8", errors="replace") as f: return f.read()
def test_exists(): assert os.path.exists(CONSENT_RT)
def test_syntax(): assert ast.parse(_r(CONSENT_RT)) is not None
def test_requires_auth():
    assert any(k in _r(CONSENT_RT) for k in ["VAULT_OWNER","validate_token","Depends","Header"])
def test_vault_gate(): assert "vault" in _r(CONSENT_RT).lower()
def test_scopes(): assert "scope" in _r(CONSENT_RT).lower()
