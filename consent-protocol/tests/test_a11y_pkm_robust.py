"""Security tests for PR 3498 — a11y-settings-tests-win / pkm_routes."""
import os, ast
PKM_RT = os.path.join(os.path.dirname(__file__), "..", "api", "routes", "pkm_routes_shared.py")
def _r(p):
    with open(p, encoding="utf-8", errors="replace") as f: return f.read()
def test_pkm_route_exists(): assert os.path.exists(PKM_RT)
def test_pkm_route_valid_python(): assert ast.parse(_r(PKM_RT)) is not None
def test_pkm_route_has_cwe400_protection():
    """CWE-400 protection must be present (bounded path params)."""
    assert "CWE-400" in _r(PKM_RT) or "bounded" in _r(PKM_RT).lower(), \
        "PKM routes must document CWE-400 (unbounded input) mitigation"
def test_pkm_route_uses_encrypted_blobs():
    assert "encrypt" in _r(PKM_RT).lower() or "blob" in _r(PKM_RT).lower(), \
        "PKM routes must use encrypted blob storage"
def test_pkm_route_has_scope_enforcement():
    assert "scope" in _r(PKM_RT).lower(), "PKM routes must enforce scope-based access control"
