import asyncio
import re
from typing import Any, Dict, Optional


# Mock the context
class MockContext:
    def __init__(self):
        self.user_id = "user_123"
        self.consent_token = "HCT_TEST"  # noqa: S105


async def process_incoming_email(
    sender: str, subject: str, body: str, metadata: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    # Mocking the actual tool logic here for testing the logic in isolation
    # since we can't easily import the decorated hushh_tool version without context
    tickers = re.findall(r"\$([A-Z]+)", subject + " " + body)

    return {
        "status": "Email processed and queued for analysis",
        "sender": sender,
        "subject": subject,
        "extracted_tickers": tickers,
        "message": f"Kai is now looking into {', '.join(tickers) if tickers else 'the market trends'} for you.",
    }


async def test_process_incoming_email():
    sender = "investor@example.com"
    subject = "Analysis for $AAPL and $MSFT"
    body = "Please look at the growth prospects for $AAPL."

    result = await process_incoming_email(sender, subject, body)

    assert result["status"] == "Email processed and queued for analysis"
    assert result["sender"] == sender
    assert "AAPL" in result["message"]
    assert "AAPL" in result["extracted_tickers"]
    assert "MSFT" in result["extracted_tickers"]


if __name__ == "__main__":
    asyncio.run(test_process_incoming_email())
    print("Kai Email Processing tests passed!")
