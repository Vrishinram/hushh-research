"""
Summary Reducer Agent (ADK Port with Dual-Layer Security)

MIGRATED TO ADK (v1.1.0)
Added Security Post-Processor to prevent PII leakage in JSON keys.
"""

import json
import logging
import os
import re
from typing import Any, Dict

from hushh_mcp.hushh_adk.core import HushhAgent
from hushh_mcp.hushh_adk.manifest import ManifestLoader

logger = logging.getLogger(__name__)

# Strict Registry of Safe Keys for PKM Summary Projection
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

# Sensitive patterns that should NEVER appear in a key
SENSITIVE_PATTERNS = [
    r"\$\d+",        # Currency amounts
    r"\d{4,}",      # Long sequences of digits (likely IDs/accounts)
    r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+", # Emails
]

def is_key_safe(key: str) -> bool:
    """
    Validates if a JSON key is safe to export in a summary.
    """
    # 1. Check against sensitive patterns (Strict Block)
    for pattern in SENSITIVE_PATTERNS:
        if re.search(pattern, key):
            logger.warning(f"🚩 Sensitive pattern detected in key: '{key}'")
            return False
            
    # 2. Check against allowed patterns (Whitelist)
    # If it's a simple alphanumeric key without sensitive stuff, we might allow it
    # but for high-security summaries, we prefer the whitelist.
    for pattern in SAFE_KEY_PATTERNS:
        if re.match(pattern, key):
            return True
            
    # If it doesn't match a whitelist but isn't explicitly sensitive, 
    # we might still want to flag it or sanitize it.
    # For now, we'll be strict.
    return False

def sanitize_projection(data: Any) -> Any:
    """
    Recursively sanitizes a dictionary to remove unsafe keys.
    """
    if isinstance(data, dict):
        new_dict = {}
        for k, v in data.items():
            if is_key_safe(str(k)):
                new_dict[k] = sanitize_projection(v)
            else:
                # Redact the key
                safe_k = f"redacted_{hash(k) % 1000}"
                logger.info(f"🔒 Redacting unsafe key '{k}' -> '{safe_k}'")
                new_dict[safe_k] = "[REDACTED]"
        return new_dict
    elif isinstance(data, list):
        return [sanitize_projection(item) for item in data]
    return data

class SummaryReducerAgent(HushhAgent):
    """
    Secure PKM Summary Reducer.
    Implements Dual-Layer Security:
    Layer 1: LLM System Instructions (Probabilistic)
    Layer 2: Python Key Validation (Deterministic)
    """

    def __init__(self):
        manifest_path = os.path.join(os.path.dirname(__file__), "agent.yaml")
        self.manifest = ManifestLoader.load(manifest_path)

        super().__init__(
            name=self.manifest.name,
            model=self.manifest.model,
            system_prompt=self.manifest.system_instruction,
            tools=[],
            required_scopes=self.manifest.required_scopes,
        )

    def handle_message(
        self, prompt: str, user_id: str, consent_token: str = ""
    ) -> Dict[str, Any]:
        """
        Secure Entry Point with Post-Processing.
        """
        try:
            # 1. Execute LLM Run
            response = self.run(prompt, user_id=user_id, consent_token=consent_token)
            
            raw_text = response.text if hasattr(response, "text") else str(response)
            
            # 2. Parse JSON
            try:
                # LLM might wrap in ```json ... ```
                json_match = re.search(r"```json\s*(\{.*?\})\s*```", raw_text, re.DOTALL)
                if json_match:
                    raw_text = json_match.group(1)
                
                data = json.loads(raw_text)
            except json.JSONDecodeError:
                logger.error("Failed to parse LLM output as JSON")
                return {"error": "Invalid format from LLM", "raw_response": raw_text}

            # 3. Apply Deterministic Security Layer
            safe_data = sanitize_projection(data)

            return {
                "summary_projection": safe_data,
                "is_complete": True,
            }

        except Exception as e:
            logger.error(f"SummaryReducerAgent error: {e}")
            return {
                "response": "Error processing summary.",
                "error": str(e),
            }

# Singleton
_reducer_agent = None

def get_reducer_agent():
    global _reducer_agent
    if not _reducer_agent:
        _reducer_agent = SummaryReducerAgent()
    return _reducer_agent
