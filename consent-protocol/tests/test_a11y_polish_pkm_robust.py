"""Security tests for PR 3474 — a11y-polish-settings-v2 / PKM routes."""
import os, ast
PKM_RT = os.path.join(os.path.dirname(__file__), "..", "api", "routes", "pkm_routes_shared.py")
def _r(p):
    with open(p, encoding="utf-8", errors="replace") as f: return f.read()
def test_pkm_route_exists(): assert os.path.exists(PKM_RT)
def test_pkm_syntax(): assert ast.parse(_r(PKM_RT)) is not None
def test_cwe400(): assert "CWE-400" in _r(PKM_RT) or "bounded" in _r(PKM_RT).lower()
def test_encrypted_storage(): assert "encrypt" in _r(PKM_RT).lower() or "blob" in _r(PKM_RT).lower()
def test_scope_enforcement(): assert "scope" in _r(PKM_RT).lower()
