import json
import logging
import os
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"
_OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions"
_OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech"

_ALLOWED_TOOL_NAMES = {
    "execute_kai_command",
    "navigate_back",
    "resume_active_analysis",
    "cancel_active_analysis",
    "clarify",
}
_ALLOWED_COMMANDS = {
    "analyze",
    "optimize",
    "consent",
    "profile",
    "history",
    "dashboard",
    "home",
}
_ALLOWED_HISTORY_TABS = {"history", "debate", "summary", "transcript"}
_COMMAND_ALIASES = {
    "analysis": "history",
    "analysis_section": "history",
    "analysis_history": "history",
    "history_section": "history",
    "market": "home",
    "market_section": "home",
    "kai": "home",
    "kai_section": "home",
    "kai_home": "home",
    "consents": "consent",
    "consent_section": "consent",
    "portfolio": "dashboard",
    "portfolio_section": "dashboard",
}


class VoiceServiceError(Exception):
    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        self.message = message
        super().__init__(message)


class VoiceIntentService:
    def __init__(self) -> None:
        self.api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
        self.stt_model = (os.getenv("OPENAI_VOICE_STT_MODEL") or "gpt-4o-mini-transcribe").strip()
        self.intent_model = (os.getenv("OPENAI_VOICE_INTENT_MODEL") or "gpt-4.1-mini").strip()
        self.tts_model = (os.getenv("OPENAI_VOICE_TTS_MODEL") or "gpt-4o-mini-tts").strip()

    def _require_api_key(self) -> None:
        if not self.api_key:
            raise VoiceServiceError(503, "OPENAI_API_KEY is not configured")

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
        }

    async def transcribe_audio(
        self,
        *,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
    ) -> str:
        started_at = time.perf_counter()
        self._require_api_key()
        if not audio_bytes:
            raise VoiceServiceError(400, "Audio payload is empty")

        files = {
            "file": (filename, audio_bytes, content_type or "application/octet-stream"),
        }
        data = {
            "model": self.stt_model,
        }

        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                _OPENAI_TRANSCRIBE_URL,
                headers=self._headers(),
                data=data,
                files=files,
            )

        payload = response.json() if response.content else {}
        if response.status_code >= 400:
            detail = _extract_openai_error(payload) or "STT request failed"
            raise VoiceServiceError(502, detail)

        transcript = str(payload.get("text") or "").strip()
        if not transcript:
            raise VoiceServiceError(422, "No transcript returned from STT")
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        logger.info(
            "[VOICE_STT] status=ok model=%s elapsed_ms=%s transcript_chars=%s",
            self.stt_model,
            elapsed_ms,
            len(transcript),
        )
        return transcript

    async def plan_intent(
        self,
        *,
        transcript: str,
        user_id: str,
        context: dict[str, Any] | None,
    ) -> dict[str, Any]:
        started_at = time.perf_counter()
        self._require_api_key()
        clean_transcript = str(transcript or "").strip()
        if not clean_transcript:
            raise VoiceServiceError(422, "Transcript is empty")

        tools = _build_tools_schema()
        context_payload = context or {}

        payload = {
            "model": self.intent_model,
            "temperature": 0,
            "max_tokens": 180,
            "tool_choice": "required",
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are Kai voice intent planner. Return exactly one tool call from the provided "
                        "tool list. Never return free text. Use only provided enum values and argument shapes. "
                        "Canonical mapping rules: "
                        "'analysis section' => execute_kai_command(command='history'). "
                        "'market section' or 'kai section' => execute_kai_command(command='home'). "
                        "'dashboard section' or 'portfolio section' => execute_kai_command(command='dashboard'). "
                        "'consents section' => execute_kai_command(command='consent'). "
                        "Use tab='history' for explicit 'analysis history'."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "user_id": user_id,
                            "transcript": clean_transcript,
                            "context": context_payload,
                        }
                    ),
                },
            ],
            "tools": tools,
        }

        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                _OPENAI_CHAT_URL,
                headers={
                    **self._headers(),
                    "Content-Type": "application/json",
                },
                json=payload,
            )

        result = response.json() if response.content else {}
        if response.status_code >= 400:
            detail = _extract_openai_error(result) or "Intent planning request failed"
            raise VoiceServiceError(502, detail)

        tool_call = _extract_first_tool_call(result)
        validated = _validate_tool_call(tool_call)
        if not validated:
            elapsed_ms = int((time.perf_counter() - started_at) * 1000)
            logger.warning(
                "[VOICE_PLAN] status=clarify elapsed_ms=%s transcript=%r raw_tool_call=%s",
                elapsed_ms,
                clean_transcript,
                tool_call,
            )
            return {
                "tool_name": "clarify",
                "args": {
                    "question": "I could not map that safely. Please repeat your request.",
                    "options": ["Analyze a stock", "Open dashboard", "Open profile"],
                },
            }
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        logger.info(
            "[VOICE_PLAN] status=ok model=%s elapsed_ms=%s transcript=%r tool_call=%s",
            self.intent_model,
            elapsed_ms,
            clean_transcript,
            validated,
        )
        return validated

    async def synthesize_speech(
        self,
        *,
        text: str,
        voice: str,
    ) -> tuple[str, str]:
        self._require_api_key()
        clean_text = str(text or "").strip()
        if not clean_text:
            raise VoiceServiceError(422, "Text is required for TTS")

        payload = {
            "model": self.tts_model,
            "input": clean_text,
            "voice": str(voice or "alloy").strip() or "alloy",
            "format": "mp3",
        }

        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                _OPENAI_TTS_URL,
                headers={
                    **self._headers(),
                    "Content-Type": "application/json",
                },
                json=payload,
            )

        if response.status_code >= 400:
            payload = response.json() if response.content else {}
            detail = _extract_openai_error(payload) or "TTS request failed"
            raise VoiceServiceError(502, detail)

        import base64

        audio_b64 = base64.b64encode(response.content or b"").decode("utf-8")
        if not audio_b64:
            raise VoiceServiceError(502, "TTS response was empty")
        return audio_b64, "audio/mpeg"


def _extract_openai_error(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    error = payload.get("error")
    if isinstance(error, dict):
        message = error.get("message")
        if isinstance(message, str) and message.strip():
            return message.strip()
    return None


def _extract_first_tool_call(payload: dict[str, Any]) -> dict[str, Any] | None:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return None
    first = choices[0]
    if not isinstance(first, dict):
        return None
    message = first.get("message")
    if not isinstance(message, dict):
        return None
    tool_calls = message.get("tool_calls")
    if not isinstance(tool_calls, list) or not tool_calls:
        return None
    call = tool_calls[0]
    if not isinstance(call, dict):
        return None
    fn = call.get("function")
    if not isinstance(fn, dict):
        return None
    name = fn.get("name")
    raw_args = fn.get("arguments")
    if not isinstance(name, str) or not isinstance(raw_args, str):
        return None
    try:
        args = json.loads(raw_args)
    except Exception:
        return None
    return {
        "tool_name": name,
        "args": args,
    }


def _build_tools_schema() -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": "execute_kai_command",
                "description": "Execute an existing Kai command action.",
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "command": {
                            "type": "string",
                            "enum": sorted(_ALLOWED_COMMANDS),
                        },
                        "params": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "symbol": {"type": "string"},
                                "focus": {"type": "string", "enum": ["active"]},
                                "tab": {"type": "string", "enum": sorted(_ALLOWED_HISTORY_TABS)},
                            },
                        },
                    },
                    "required": ["command"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "navigate_back",
                "description": "Navigate back using existing app back handler.",
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {},
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "resume_active_analysis",
                "description": "Resume active analysis run for current user/session.",
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {},
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "cancel_active_analysis",
                "description": "Cancel active analysis run, requires confirmation.",
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "confirm": {"type": "boolean"},
                    },
                    "required": ["confirm"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "clarify",
                "description": "Ask user a clarification question before any action.",
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "question": {"type": "string"},
                        "options": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                    },
                    "required": ["question"],
                },
            },
        },
    ]


def _validate_tool_call(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None

    tool_name = value.get("tool_name")
    args = value.get("args")
    if not isinstance(tool_name, str) or tool_name not in _ALLOWED_TOOL_NAMES:
        return None
    if not isinstance(args, dict):
        return None

    if tool_name in {"navigate_back", "resume_active_analysis"}:
        if args:
            return None
        return {"tool_name": tool_name, "args": {}}

    if tool_name == "cancel_active_analysis":
        if set(args.keys()) != {"confirm"}:
            return None
        if not isinstance(args.get("confirm"), bool):
            return None
        return {"tool_name": tool_name, "args": {"confirm": args["confirm"]}}

    if tool_name == "clarify":
        allowed = {"question", "options"}
        if any(key not in allowed for key in args.keys()):
            return None
        question = args.get("question")
        if not isinstance(question, str) or not question.strip():
            return None
        options = args.get("options")
        if options is not None:
            if not isinstance(options, list) or not all(isinstance(item, str) for item in options):
                return None
        out = {
            "tool_name": "clarify",
            "args": {
                "question": question.strip(),
            },
        }
        if options is not None:
            out["args"]["options"] = options
        return out

    if tool_name == "execute_kai_command":
        allowed = {"command", "params"}
        if any(key not in allowed for key in args.keys()):
            return None

        command = args.get("command")
        if not isinstance(command, str):
            return None
        normalized_command = command.strip().lower().replace(" ", "_")
        command = _COMMAND_ALIASES.get(normalized_command, normalized_command)
        if command not in _ALLOWED_COMMANDS:
            return None

        out_params: dict[str, Any] = {}
        raw_params = args.get("params")
        if raw_params is not None:
            if not isinstance(raw_params, dict):
                return None
            if any(key not in {"symbol", "focus", "tab"} for key in raw_params.keys()):
                return None

            symbol = raw_params.get("symbol")
            if symbol is not None:
                if not isinstance(symbol, str) or not symbol.strip():
                    return None
                out_params["symbol"] = symbol.strip().upper()

            focus = raw_params.get("focus")
            if focus is not None:
                if focus != "active":
                    return None
                out_params["focus"] = "active"

            tab = raw_params.get("tab")
            if tab is not None:
                if tab not in _ALLOWED_HISTORY_TABS:
                    return None
                out_params["tab"] = tab

        if command == "analyze" and "symbol" not in out_params:
            return None

        tool_call = {
            "tool_name": "execute_kai_command",
            "args": {
                "command": command,
            },
        }
        if out_params:
            tool_call["args"]["params"] = out_params
        return tool_call

    return None
