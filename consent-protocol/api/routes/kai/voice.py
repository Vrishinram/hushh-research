import logging
import time
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from api.middleware import require_vault_owner_token
from hushh_mcp.services.voice_intent_service import VoiceIntentService, VoiceServiceError

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Kai Voice"])
voice_service = VoiceIntentService()


class VoicePlanRequest(BaseModel):
    user_id: str
    transcript: str
    context: dict[str, Any] = Field(default_factory=dict)


class VoicePlanResponse(BaseModel):
    tool_call: dict[str, Any]


class VoiceSTTResponse(BaseModel):
    transcript: str


class VoiceTTSRequest(BaseModel):
    user_id: str
    text: str
    voice: Optional[str] = "alloy"


class VoiceTTSResponse(BaseModel):
    audio_base64: str
    mime_type: str


@router.post("/voice/stt", response_model=VoiceSTTResponse)
async def kai_voice_stt(
    user_id: str = Form(...),
    audio_file: UploadFile = File(...),
    token_data: dict = Depends(require_vault_owner_token),
):
    started_at = time.perf_counter()
    if token_data.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Token user_id does not match request user_id")

    try:
        audio_bytes = await audio_file.read()
        transcript = await voice_service.transcribe_audio(
            audio_bytes=audio_bytes,
            filename=audio_file.filename or "voice-input.webm",
            content_type=audio_file.content_type or "application/octet-stream",
        )
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        logger.info(
            "[Kai Voice] route=/voice/stt status=ok elapsed_ms=%s audio_bytes=%s transcript_chars=%s",
            elapsed_ms,
            len(audio_bytes),
            len(transcript),
        )
        return VoiceSTTResponse(transcript=transcript)
    except VoiceServiceError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message)
    except Exception as error:
        logger.exception("[Kai Voice] STT failed: %s", error)
        raise HTTPException(status_code=500, detail="Voice transcription failed")


@router.post("/voice/plan", response_model=VoicePlanResponse)
async def kai_voice_plan(
    body: VoicePlanRequest,
    token_data: dict = Depends(require_vault_owner_token),
):
    started_at = time.perf_counter()
    if token_data.get("user_id") != body.user_id:
        raise HTTPException(status_code=403, detail="Token user_id does not match request user_id")

    try:
        tool_call = await voice_service.plan_intent(
            transcript=body.transcript,
            user_id=body.user_id,
            context=body.context,
        )
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        logger.info(
            "[Kai Voice] route=/voice/plan status=ok elapsed_ms=%s transcript_chars=%s tool_call=%s",
            elapsed_ms,
            len(body.transcript or ""),
            tool_call,
        )
        return VoicePlanResponse(tool_call=tool_call)
    except VoiceServiceError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message)
    except Exception as error:
        logger.exception("[Kai Voice] planning failed: %s", error)
        raise HTTPException(status_code=500, detail="Voice intent planning failed")


@router.post("/voice/tts", response_model=VoiceTTSResponse)
async def kai_voice_tts(
    body: VoiceTTSRequest,
    token_data: dict = Depends(require_vault_owner_token),
):
    started_at = time.perf_counter()
    if token_data.get("user_id") != body.user_id:
        raise HTTPException(status_code=403, detail="Token user_id does not match request user_id")

    try:
        audio_base64, mime_type = await voice_service.synthesize_speech(
            text=body.text,
            voice=body.voice or "alloy",
        )
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        logger.info(
            "[Kai Voice] route=/voice/tts status=ok elapsed_ms=%s text_chars=%s audio_b64_chars=%s",
            elapsed_ms,
            len(body.text or ""),
            len(audio_base64),
        )
        return VoiceTTSResponse(audio_base64=audio_base64, mime_type=mime_type)
    except VoiceServiceError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message)
    except Exception as error:
        logger.exception("[Kai Voice] TTS failed: %s", error)
        raise HTTPException(status_code=500, detail="Voice synthesis failed")
