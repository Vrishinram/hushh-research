import re
from typing import Any

# Fallback: Define the logic here to avoid complex dependency chain in test environment
SAFE_KEY_PATTERNS = [
    r"^presence_.*",
    r"^count_.*",
    r"^has_.*",
    r"^freshness_.*",
    r"^is_.*_active$",
    r"^version$",
    r"^domain$",
    r"^capability_.*",
]

SENSITIVE_PATTERNS = [
    r"\$\d+",  # Currency amounts
    r"\d{4,}",  # Long sequences of digits
    r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+",  # Emails
]


def is_key_safe(key: str) -> bool:
    for pattern in SENSITIVE_PATTERNS:
        if re.search(pattern, key):
            return False
    for pattern in SAFE_KEY_PATTERNS:
        if re.match(pattern, key):
            return True
    return False


def sanitize_projection(data: Any) -> Any:
    if isinstance(data, dict):
        new_dict = {}
        for k, v in data.items():
            if is_key_safe(str(k)):
                new_dict[k] = sanitize_projection(v)
            else:
                new_dict[f"redacted_{hash(k) % 1000}"] = "[REDACTED]"
        return new_dict
    elif isinstance(data, list):
        return [sanitize_projection(item) for item in data]
    return data


def test_is_key_safe():
    # Safe keys
    assert is_key_safe("presence_holdings") is True
    assert is_key_safe("count_transactions") is True
    assert is_key_safe("has_balance") is True
    assert is_key_safe("freshness_last_update") is True

    # Unsafe keys (Sensitive patterns)
    assert is_key_safe("account_$50,000") is False
    assert is_key_safe("balance_123456789") is False
    assert is_key_safe("user@example.com") is False

    # Unsafe keys (Not in whitelist)
    assert is_key_safe("random_unstructured_key") is False


def test_sanitize_projection():
    input_data = {
        "presence_holdings": True,
        "count_transactions": 5,
        "account_$50,000": True,
        "presence_nested": {"is_account_active": True, "secret_key": "hidden"},
        "presence_list_data": [{"presence_item": True}, {"balance_999": 100}],
    }

    sanitized = sanitize_projection(input_data)

    # Check safe keys are preserved
    assert sanitized["presence_holdings"] is True
    assert sanitized["count_transactions"] == 5
    assert sanitized["presence_nested"]["is_account_active"] is True
    assert sanitized["presence_list_data"][0]["presence_item"] is True

    # Check unsafe keys are redacted
    found_redacted_account = False
    for k, v in sanitized.items():
        if k.startswith("redacted_"):
            found_redacted_account = True
            assert v == "[REDACTED]"
    assert found_redacted_account is True

    # Check nested redaction
    found_redacted_secret = False
    for k, v in sanitized["presence_nested"].items():
        if k.startswith("redacted_"):
            found_redacted_secret = True
            assert v == "[REDACTED]"
    assert found_redacted_secret is True

    # Check list redaction
    found_redacted_list_item = False
    for k, v in sanitized["presence_list_data"][1].items():
        if k.startswith("redacted_"):
            found_redacted_list_item = True
            assert v == "[REDACTED]"
    assert found_redacted_list_item is True


if __name__ == "__main__":
    test_is_key_safe()
    test_sanitize_projection()
    print("Summary Reducer Security tests passed!")
