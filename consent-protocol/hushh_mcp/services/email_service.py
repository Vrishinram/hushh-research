"""
Hushh Email Service

Handles incoming emails for agents, specifically kai@hushh.ai.
"""

import logging
from typing import Any, Dict

from hushh_mcp.agents.kai.agent import get_kai_agent
from hushh_mcp.types import UserID

logger = logging.getLogger(__name__)

class EmailService:
    """
    Service to route emails to agents.
    """

    async def handle_incoming_email(
        self, 
        to_address: str,
        from_address: str,
        subject: str,
        body: str,
        user_id: UserID,
        consent_token: str
    ) -> Dict[str, Any]:
        """
        Main entry point for incoming emails.
        """
        logger.info(f"📧 Incoming email for {to_address} from {from_address}")

        if to_address.startswith("kai"):
            # Route to Kai agent
            kai = get_kai_agent()
            
            # Create a prompt based on the email
            prompt = f"Email from {from_address} with subject '{subject}':\n\n{body}"
            
            # Run the agent
            # Note: We might want to use the process_incoming_email tool explicitly
            # but for a simple endpoint, we can just run the agent with the email as prompt.
            result = kai.handle_message(prompt, user_id=user_id, consent_token=consent_token)
            
            return {
                "status": "success",
                "agent": "kai",
                "result": result
            }
        
        return {
            "status": "error",
            "message": f"No agent configured for address {to_address}"
        }

# Singleton
_email_service = None

def get_email_service():
    global _email_service
    if not _email_service:
        _email_service = EmailService()
    return _email_service
