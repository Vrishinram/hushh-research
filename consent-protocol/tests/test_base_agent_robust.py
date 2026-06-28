"""
Robust security tests for hushh_mcp/agents/base_agent.py

Proves that HushhAgent enforces credential shape at the entry point —
blank tokens and empty user_ids are rejected before any scope check.
"""

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from unittest.mock import MagicMock, patch

import pytest


def _make_agent(required_scopes=None):
    """Build a HushhAgent with a stubbed parent class."""
    from hushh_mcp.agents.base_agent import HushhAgent  # noqa: F401 — imported for patching

    with patch("hushh_mcp.agents.base_agent.LlmAgent.__init__", return_value=None):
        agent = HushhAgent.__new__(HushhAgent)
        agent.hushh_name = "test-agent"
        agent.required_scopes = required_scopes or []
    return agent


def test_blank_token_rejected():
    """Empty consent_token must raise PermissionError immediately."""
    agent = _make_agent()
    with pytest.raises(PermissionError, match="consent_token is missing or blank"):
        agent.run(prompt="hello", user_id="user-1", consent_token="")


def test_whitespace_only_token_rejected():
    """Whitespace-only consent_token must be treated as blank."""
    agent = _make_agent()
    with pytest.raises(PermissionError, match="consent_token is missing or blank"):
        agent.run(prompt="hello", user_id="user-1", consent_token="   ")


def test_none_token_rejected():
    """None consent_token must raise PermissionError."""
    agent = _make_agent()
    with pytest.raises(PermissionError, match="consent_token is missing or blank"):
        agent.run(prompt="hello", user_id="user-1", consent_token=None)


def test_blank_user_id_rejected():
    """Empty user_id must raise PermissionError."""
    agent = _make_agent()
    with pytest.raises(PermissionError, match="user_id is missing or blank"):
        agent.run(prompt="hello", user_id="", consent_token="HCT:valid-token")


def test_whitespace_user_id_rejected():
    """Whitespace-only user_id is rejected."""
    agent = _make_agent()
    with pytest.raises(PermissionError, match="user_id is missing or blank"):
        agent.run(prompt="hello", user_id="  ", consent_token="HCT:valid-token")


def test_invalid_scope_rejected():
    """Token with wrong scope must be denied even with valid credentials."""
    agent = _make_agent(required_scopes=["vault.read"])

    with patch("hushh_mcp.agents.base_agent.validate_token") as mock_validate:
        mock_validate.return_value = (False, "Scope mismatch: expected vault.read", None)
        with pytest.raises(PermissionError, match="Agent Access Denied"):
            agent.run(prompt="hello", user_id="user-1", consent_token="HCT:bad-scope-token")


def test_valid_token_passes_gate():
    """A valid token with correct scope passes the security gate."""
    agent = _make_agent(required_scopes=["vault.read"])

    with (
        patch("hushh_mcp.agents.base_agent.validate_token") as mock_validate,
        patch("hushh_mcp.agents.base_agent.HushhContext") as mock_ctx,
        patch("hushh_mcp.agents.base_agent.LlmAgent.run") as mock_run,
    ):
        mock_validate.return_value = (True, "OK", MagicMock())
        mock_ctx.return_value.__enter__ = MagicMock(return_value=None)
        mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
        mock_run.return_value = {"result": "ok"}

        result = agent.run(prompt="hello", user_id="user-1", consent_token="HCT:good-token")
        assert result == {"result": "ok"}
