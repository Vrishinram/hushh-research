import logging
import hashlib
import json
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field

from api.middleware import require_vault_owner_token
from api.routes.kai.portfolio import _IMPORT_RUN_MANAGER
from api.routes.kai.stream import _RUN_MANAGER
from hushh_mcp.services.voice_intent_service import (
    VoiceIntentService,
    VoiceServiceError,
    _PLANNER_NORMALIZATION_VERSION,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Kai Voice"])
voice_service = VoiceIntentService()
_VOICE_NOT_ENABLED_MESSAGE = "Voice is not enabled for this account yet."
_VOICE_KILL_SWITCH_MESSAGE = (
    "Voice actions are temporarily unavailable. I can still respond and guide you."
)
_VOICE_STAGE_TIMING: dict[str, dict[str, float]] = {}


def _env_truthy(name: str, fallback: str = "false") -> bool:
    return str(os.getenv(name, fallback)).strip().lower() in {"1", "true", "yes", "on", "enabled"}


def _voice_tool_execution_disabled() -> bool:
    return _env_truthy("KAI_VOICE_V1_DISABLE_TOOL_EXECUTION", "false")


def _parse_voice_allowlist() -> set[str]:
    raw = str(os.getenv("KAI_VOICE_V1_ALLOWED_USERS", "")).strip()
    if not raw:
        return set()
    return {item.strip() for item in raw.split(",") if item.strip()}


def _safe_user_ref(user_id: str) -> str:
    digest = hashlib.sha256(str(user_id).encode("utf-8")).hexdigest()
    return digest[:12]


def _stable_user_bucket(user_id: str) -> int:
    digest = hashlib.sha256(str(user_id).encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % 100


def _voice_rollout_state(user_id: str) -> dict[str, Any]:
    enabled_globally = _env_truthy("KAI_VOICE_V1_ENABLED", "true")
    if not enabled_globally:
        return {"enabled": False, "reason": "globally_disabled", "bucket": None, "canary_percent": 0}

    allowlist = _parse_voice_allowlist()
    if allowlist:
        in_allowlist = user_id in allowlist
        return {
            "enabled": in_allowlist,
            "reason": "allowlist" if in_allowlist else "not_allowlisted",
            "bucket": None,
            "canary_percent": None,
        }

    raw_percent = str(os.getenv("KAI_VOICE_V1_CANARY_PERCENT", "100")).strip()
    try:
        canary_percent = int(raw_percent)
    except ValueError:
        canary_percent = 100
    canary_percent = max(0, min(100, canary_percent))
    bucket = _stable_user_bucket(user_id)
    enabled = bucket < canary_percent
    return {
        "enabled": enabled,
        "reason": "canary_enabled" if enabled else "canary_excluded",
        "bucket": bucket,
        "canary_percent": canary_percent,
    }


def _resolve_voice_turn_id(request: Request) -> str:
    raw = (request.headers.get("x-voice-turn-id") or "").strip()
    if raw:
        return raw[:128]
    return f"vturn_{uuid.uuid4().hex}"


def _set_voice_turn_id_header(response: Response, turn_id: str) -> None:
    response.headers["X-Voice-Turn-Id"] = turn_id


def _log_voice_metric(
    name: str,
    value: int | float,
    *,
    turn_id: str,
    user_id: str,
    tags: dict[str, Any] | None = None,
) -> None:
    payload = {
        "event": "kai_voice_metric",
        "metric": name,
        "value": value,
        "turn_id": turn_id,
        "user_ref": _safe_user_ref(user_id),
        "tags": tags or {},
    }
    logger.info("[KAI_VOICE_METRIC] %s", json.dumps(payload, sort_keys=True))


def _log_voice_audit(
    *,
    turn_id: str,
    user_id: str,
    response_payload: dict[str, Any],
    meta: dict[str, Any] | None = None,
) -> None:
    payload = {
        "event": "kai_voice_audit",
        "turn_id": turn_id,
        "user_ref": _safe_user_ref(user_id),
        "kind": response_payload.get("kind"),
        "reason": response_payload.get("reason"),
        "task": response_payload.get("task"),
        "tool_name": (
            response_payload.get("tool_call", {}).get("tool_name")
            if isinstance(response_payload.get("tool_call"), dict)
            else None
        ),
        "ticker": response_payload.get("ticker"),
        "run_id": response_payload.get("run_id"),
        "meta": meta or {},
    }
    logger.info("[KAI_VOICE_AUDIT] %s", json.dumps(payload, sort_keys=True))


def _resolve_planner_branch(*, model: str, response_kind: str, response_reason: str) -> str:
    normalized_model = str(model or "").strip().lower()
    if response_kind == "clarify" and response_reason == "stt_unusable":
        return "clarify_fallback"
    if normalized_model.startswith("deterministic"):
        return "deterministic"
    return "nano_model"


def _trace_voice_stage(
    turn_id: str,
    stage: str,
    metadata: dict[str, Any] | None = None,
    *,
    finalize: bool = False,
) -> None:
    if not turn_id:
        return
    now_ms = time.perf_counter() * 1000.0
    current = _VOICE_STAGE_TIMING.get(turn_id)
    if current is None:
        current = {
            "turn_start_ms": now_ms,
            "last_stage_ms": now_ms,
        }
        _VOICE_STAGE_TIMING[turn_id] = current
    since_prev_ms = int(max(0.0, now_ms - current["last_stage_ms"]))
    since_turn_start_ms = int(max(0.0, now_ms - current["turn_start_ms"]))
    current["last_stage_ms"] = now_ms

    payload = {
        "event": "kai_voice_stage_timing",
        "turn_id": turn_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "stage": stage,
        "since_prev_ms": since_prev_ms,
        "since_turn_start_ms": since_turn_start_ms,
        **(metadata or {}),
    }
    logger.info("[KAI_VOICE_TRACE_BE] %s", json.dumps(payload, sort_keys=True))

    if finalize:
        _VOICE_STAGE_TIMING.pop(turn_id, None)


class AppRuntimeAuth(BaseModel):
    signed_in: bool = False
    user_id: Optional[str] = None


class AppRuntimeVault(BaseModel):
    unlocked: bool = False
    token_available: bool = False
    token_valid: bool = False


class AppRuntimeRoute(BaseModel):
    pathname: str = ""
    screen: str = ""
    subview: Optional[str] = None


class AppRuntimeRuntime(BaseModel):
    analysis_active: bool = False
    analysis_ticker: Optional[str] = None
    analysis_run_id: Optional[str] = None
    import_active: bool = False
    import_run_id: Optional[str] = None
    busy_operations: list[str] = Field(default_factory=list)


class AppRuntimePortfolio(BaseModel):
    has_portfolio_data: bool = False


class AppRuntimeVoice(BaseModel):
    available: bool = False
    tts_playing: bool = False
    last_tool_name: Optional[str] = None
    last_ticker: Optional[str] = None


class AppRuntimeState(BaseModel):
    auth: AppRuntimeAuth = Field(default_factory=AppRuntimeAuth)
    vault: AppRuntimeVault = Field(default_factory=AppRuntimeVault)
    route: AppRuntimeRoute = Field(default_factory=AppRuntimeRoute)
    runtime: AppRuntimeRuntime = Field(default_factory=AppRuntimeRuntime)
    portfolio: AppRuntimePortfolio = Field(default_factory=AppRuntimePortfolio)
    voice: AppRuntimeVoice = Field(default_factory=AppRuntimeVoice)


class VoicePlanRequest(BaseModel):
    user_id: str
    transcript: str
    context: dict[str, Any] = Field(default_factory=dict)
    app_state: Optional[AppRuntimeState] = None


class VoiceMemoryHints(BaseModel):
    allow_durable_write: bool = False


class VoiceResponsePayload(BaseModel):
    kind: str
    message: str
    speak: bool = True
    reason: Optional[str] = None
    task: Optional[str] = None
    ticker: Optional[str] = None
    run_id: Optional[str] = None
    candidate: Optional[str] = None
    tool_call: Optional[dict[str, Any]] = None


class VoicePlanResponse(BaseModel):
    response: VoiceResponsePayload
    tool_call: dict[str, Any]
    memory: VoiceMemoryHints
    elapsed_ms: int
    openai_http_ms: int
    model: str


class VoiceSTTResponse(BaseModel):
    transcript: str
    elapsed_ms: int
    openai_http_ms: int
    audio_read_ms: int
    audio_bytes: int
    model: str


class VoiceTTSRequest(BaseModel):
    user_id: str
    text: str
    voice: Optional[str] = "alloy"


class VoiceTTSResponse(BaseModel):
    audio_base64: str
    mime_type: str
    model: str
    voice: str
    format: str


class VoiceUnderstandResponse(BaseModel):
    transcript: str
    stt_elapsed_ms: int
    stt_openai_http_ms: int
    stt_audio_read_ms: int
    stt_audio_bytes: int
    stt_model: str
    response: VoiceResponsePayload
    tool_call: dict[str, Any]
    memory: VoiceMemoryHints
    planner_elapsed_ms: int
    openai_http_ms: int
    model: str
    elapsed_ms: int


async def _resolve_active_analysis(user_id: str, app_state: dict[str, Any]) -> dict[str, Any] | None:
    runtime = app_state.get("runtime") if isinstance(app_state.get("runtime"), dict) else {}
    run_id = runtime.get("analysis_run_id")
    if isinstance(run_id, str) and run_id.strip():
        run = await _RUN_MANAGER.get_run(run_id.strip())
        if run and run.user_id == user_id and run.status == "running":
            return {"run_id": run.run_id, "ticker": run.ticker}

    if runtime.get("analysis_active") is True:
        ticker = runtime.get("analysis_ticker")
        return {
            "run_id": run_id.strip() if isinstance(run_id, str) and run_id.strip() else None,
            "ticker": str(ticker).strip().upper() if ticker else None,
        }
    return None


async def _resolve_active_import(user_id: str, app_state: dict[str, Any]) -> dict[str, Any] | None:
    runtime = app_state.get("runtime") if isinstance(app_state.get("runtime"), dict) else {}
    run_id = runtime.get("import_run_id")
    if isinstance(run_id, str) and run_id.strip():
        run = await _IMPORT_RUN_MANAGER.get_run(run_id.strip())
        if run and run.user_id == user_id and run.status == "running":
            return {"run_id": run.run_id}

    if runtime.get("import_active") is True:
        return {"run_id": run_id.strip() if isinstance(run_id, str) and run_id.strip() else None}
    return None


def _parse_optional_form_json(raw_value: str | None, *, field_name: str) -> dict[str, Any]:
    text = (raw_value or "").strip()
    if not text:
        return {}
    try:
        parsed = json.loads(text)
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}") from error
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}")
    return parsed


@router.post("/voice/stt", response_model=VoiceSTTResponse)
async def kai_voice_stt(
    request: Request,
    http_response: Response,
    user_id: str = Form(...),
    audio_file: UploadFile = File(...),
    token_data: dict = Depends(require_vault_owner_token),
):
    started_at = time.perf_counter()
    turn_id = _resolve_voice_turn_id(request)
    _set_voice_turn_id_header(http_response, turn_id)
    _trace_voice_stage(
        turn_id,
        "backend_received",
        {
            "route": "/voice/stt",
            "method": "POST",
        },
    )
    if token_data.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Token user_id does not match request user_id")

    try:
        read_started_at = time.perf_counter()
        audio_bytes = await audio_file.read()
        audio_read_ms = int((time.perf_counter() - read_started_at) * 1000)
        _trace_voice_stage(
            turn_id,
            "stt_started",
            {
                "route": "/voice/stt",
                "audio_bytes": len(audio_bytes),
                "audio_content_type": audio_file.content_type or "application/octet-stream",
            },
        )
        transcript, openai_http_ms, model_used = await voice_service.transcribe_audio(
            audio_bytes=audio_bytes,
            filename=audio_file.filename or "voice-input.webm",
            content_type=audio_file.content_type or "application/octet-stream",
        )
        _trace_voice_stage(
            turn_id,
            "stt_finished",
            {
                "route": "/voice/stt",
                "status": "ok",
                "model": model_used,
                "audio_read_ms": audio_read_ms,
                "openai_http_ms": openai_http_ms,
                "transcript_chars": len(transcript),
            },
        )
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        logger.info(
            (
                "[Kai Voice] route=/voice/stt status=ok turn_id=%s elapsed_ms=%s audio_read_ms=%s "
                "openai_http_ms=%s model=%s audio_bytes=%s transcript_chars=%s"
            ),
            turn_id,
            elapsed_ms,
            audio_read_ms,
            openai_http_ms,
            model_used,
            len(audio_bytes),
            len(transcript),
        )
        _log_voice_metric(
            "stt_latency_ms",
            elapsed_ms,
            turn_id=turn_id,
            user_id=user_id,
            tags={"route": "/voice/stt", "model": model_used},
        )
        return VoiceSTTResponse(
            transcript=transcript,
            elapsed_ms=elapsed_ms,
            openai_http_ms=openai_http_ms,
            audio_read_ms=audio_read_ms,
            audio_bytes=len(audio_bytes),
            model=model_used,
        )
    except VoiceServiceError as error:
        _trace_voice_stage(
            turn_id,
            "stt_finished",
            {
                "route": "/voice/stt",
                "status": "error",
                "error": error.message,
            },
            finalize=True,
        )
        raise HTTPException(status_code=error.status_code, detail=error.message)
    except Exception as error:
        _trace_voice_stage(
            turn_id,
            "stt_finished",
            {
                "route": "/voice/stt",
                "status": "error",
                "error": str(error),
            },
            finalize=True,
        )
        logger.exception("[Kai Voice] STT failed turn_id=%s: %s", turn_id, error)
        raise HTTPException(status_code=500, detail="Voice transcription failed")


@router.post("/voice/understand", response_model=VoiceUnderstandResponse)
async def kai_voice_understand(
    request: Request,
    http_response: Response,
    user_id: str = Form(...),
    audio_file: UploadFile = File(...),
    context_json: Optional[str] = Form(None),
    app_state_json: Optional[str] = Form(None),
    token_data: dict = Depends(require_vault_owner_token),
):
    started_at = time.perf_counter()
    turn_id = _resolve_voice_turn_id(request)
    _set_voice_turn_id_header(http_response, turn_id)
    _trace_voice_stage(
        turn_id,
        "backend_received",
        {
            "route": "/voice/understand",
            "method": "POST",
        },
    )
    if token_data.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Token user_id does not match request user_id")

    stt_completed = False
    planner_started = False
    planner_completed = False

    try:
        context_payload = _parse_optional_form_json(context_json, field_name="context_json")
        app_state_raw = _parse_optional_form_json(app_state_json, field_name="app_state_json")

        app_state_model: AppRuntimeState | None = None
        if app_state_raw:
            try:
                app_state_model = AppRuntimeState.model_validate(app_state_raw)
            except Exception:
                app_state_model = AppRuntimeState()
        app_state_payload = app_state_model.model_dump() if app_state_model is not None else {}

        stt_started_at = time.perf_counter()
        read_started_at = time.perf_counter()
        audio_bytes = await audio_file.read()
        audio_read_ms = int((time.perf_counter() - read_started_at) * 1000)
        _trace_voice_stage(
            turn_id,
            "stt_started",
            {
                "route": "/voice/understand",
                "audio_bytes": len(audio_bytes),
                "audio_content_type": audio_file.content_type or "application/octet-stream",
            },
        )
        transcript, stt_openai_http_ms, stt_model_used = await voice_service.transcribe_audio(
            audio_bytes=audio_bytes,
            filename=audio_file.filename or "voice-input.webm",
            content_type=audio_file.content_type or "application/octet-stream",
        )
        stt_elapsed_ms = int((time.perf_counter() - stt_started_at) * 1000)
        stt_completed = True
        _trace_voice_stage(
            turn_id,
            "stt_finished",
            {
                "route": "/voice/understand",
                "status": "ok",
                "model": stt_model_used,
                "audio_read_ms": audio_read_ms,
                "openai_http_ms": stt_openai_http_ms,
                "transcript_chars": len(transcript),
                "stt_elapsed_ms": stt_elapsed_ms,
            },
        )
        _log_voice_metric(
            "stt_latency_ms",
            stt_elapsed_ms,
            turn_id=turn_id,
            user_id=user_id,
            tags={"route": "/voice/understand", "model": stt_model_used},
        )

        planner_started_at = time.perf_counter()
        logger.info(
            "[KAI_VOICE_DIAG] planner_normalization_version=%s",
            _PLANNER_NORMALIZATION_VERSION,
        )
        rollout = _voice_rollout_state(user_id)
        planner_openai_http_ms = 0
        planner_model_used = "deterministic_rollout"

        if not rollout["enabled"]:
            response_payload = voice_service._build_response(
                kind="speak_only",
                message=_VOICE_NOT_ENABLED_MESSAGE,
            )
            response_payload["memory"] = {"allow_durable_write": False}
            tool_call = voice_service._legacy_tool_call_for_response(response_payload)
            memory_hint = response_payload["memory"]
            planner_elapsed_ms = int((time.perf_counter() - planner_started_at) * 1000)
            _log_voice_metric(
                "planner_latency_ms",
                planner_elapsed_ms,
                turn_id=turn_id,
                user_id=user_id,
                tags={"route": "/voice/understand", "model": planner_model_used},
            )
            _log_voice_metric(
                "response_kind_count",
                1,
                turn_id=turn_id,
                user_id=user_id,
                tags={"kind": "speak_only", "reason": "rollout_not_enabled"},
            )
            _log_voice_audit(
                turn_id=turn_id,
                user_id=user_id,
                response_payload=response_payload,
                meta={
                    "rollout_reason": rollout["reason"],
                    "canary_percent": rollout["canary_percent"],
                    "bucket": rollout["bucket"],
                    "planner_branch": "deterministic",
                    "planner_normalization_version": _PLANNER_NORMALIZATION_VERSION,
                },
            )
            planner_started = True
            planner_completed = True
            _trace_voice_stage(
                turn_id,
                "planner_finished",
                {
                    "route": "/voice/understand",
                    "status": "ok",
                    "kind": "speak_only",
                    "reason": "rollout_not_enabled",
                    "model": planner_model_used,
                    "openai_http_ms": planner_openai_http_ms,
                    "planner_elapsed_ms": planner_elapsed_ms,
                },
            )
            elapsed_ms = int((time.perf_counter() - started_at) * 1000)
            return VoiceUnderstandResponse(
                transcript=transcript,
                stt_elapsed_ms=stt_elapsed_ms,
                stt_openai_http_ms=stt_openai_http_ms,
                stt_audio_read_ms=audio_read_ms,
                stt_audio_bytes=len(audio_bytes),
                stt_model=stt_model_used,
                response=VoiceResponsePayload(**response_payload),
                tool_call=tool_call,
                memory=VoiceMemoryHints(**memory_hint),
                planner_elapsed_ms=planner_elapsed_ms,
                openai_http_ms=planner_openai_http_ms,
                model=planner_model_used,
                elapsed_ms=elapsed_ms,
            )

        active_analysis = await _resolve_active_analysis(user_id, app_state_payload)
        active_import = await _resolve_active_import(user_id, app_state_payload)
        planner_started = True
        _trace_voice_stage(
            turn_id,
            "planner_started",
            {
                "route": "/voice/understand",
                "transcript_chars": len(transcript),
            },
        )
        response_payload, planner_openai_http_ms, planner_model_used = await voice_service.plan_voice_response(
            transcript=transcript,
            user_id=user_id,
            app_state=app_state_payload,
            context=context_payload,
            active_analysis=active_analysis,
            active_import=active_import,
        )
        if _voice_tool_execution_disabled() and response_payload.get("kind") == "execute":
            response_payload = voice_service._build_response(
                kind="speak_only",
                message=_VOICE_KILL_SWITCH_MESSAGE,
            )
            response_payload["memory"] = {"allow_durable_write": False}

        tool_call = response_payload.get("tool_call")
        if not isinstance(tool_call, dict):
            tool_call = voice_service._legacy_tool_call_for_response(response_payload)
        memory_hint = response_payload.get("memory")
        if not isinstance(memory_hint, dict):
            memory_hint = voice_service._memory_hint_from_response(response_payload)

        response_kind = str(response_payload.get("kind") or "")
        response_reason = str(response_payload.get("reason") or "")
        response_task = str(response_payload.get("task") or "")
        planner_branch = _resolve_planner_branch(
            model=planner_model_used,
            response_kind=response_kind,
            response_reason=response_reason,
        )
        planner_elapsed_ms = int((time.perf_counter() - planner_started_at) * 1000)
        planner_completed = True
        _trace_voice_stage(
            turn_id,
            "planner_finished",
            {
                "route": "/voice/understand",
                "status": "ok",
                "kind": response_kind,
                "reason": response_reason,
                "model": planner_model_used,
                "openai_http_ms": planner_openai_http_ms,
                "planner_elapsed_ms": planner_elapsed_ms,
            },
        )
        _log_voice_metric(
            "planner_latency_ms",
            planner_elapsed_ms,
            turn_id=turn_id,
            user_id=user_id,
            tags={"route": "/voice/understand", "model": planner_model_used, "branch": planner_branch},
        )
        _log_voice_metric(
            "response_kind_count",
            1,
            turn_id=turn_id,
            user_id=user_id,
            tags={"kind": response_kind, "branch": planner_branch},
        )
        if response_kind == "clarify" and response_reason == "stt_unusable":
            _log_voice_metric(
                "unclear_stt_rate",
                1,
                turn_id=turn_id,
                user_id=user_id,
                tags={},
            )
        if response_kind == "clarify" and response_reason in {"ticker_ambiguous", "ticker_unknown"}:
            _log_voice_metric(
                "ambiguous_ticker_rate",
                1,
                turn_id=turn_id,
                user_id=user_id,
                tags={"reason": response_reason},
            )
        if response_kind == "already_running":
            _log_voice_metric(
                "already_running_rate",
                1,
                turn_id=turn_id,
                user_id=user_id,
                tags={"task": response_task or "unknown"},
            )
        _log_voice_audit(
            turn_id=turn_id,
            user_id=user_id,
            response_payload={**response_payload, "tool_call": tool_call},
            meta={
                "rollout_reason": rollout["reason"],
                "canary_percent": rollout["canary_percent"],
                "bucket": rollout["bucket"],
                "tool_execution_disabled": _voice_tool_execution_disabled(),
                "planner_branch": planner_branch,
                "planner_normalization_version": _PLANNER_NORMALIZATION_VERSION,
            },
        )
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        logger.info(
            (
                "[Kai Voice] route=/voice/understand status=ok turn_id=%s elapsed_ms=%s stt_elapsed_ms=%s "
                "planner_elapsed_ms=%s stt_model=%s planner_model=%s kind=%s tool_call=%s"
            ),
            turn_id,
            elapsed_ms,
            stt_elapsed_ms,
            planner_elapsed_ms,
            stt_model_used,
            planner_model_used,
            response_payload.get("kind"),
            tool_call,
        )
        _log_voice_metric(
            "understand_latency_ms",
            elapsed_ms,
            turn_id=turn_id,
            user_id=user_id,
            tags={
                "route": "/voice/understand",
                "stt_model": stt_model_used,
                "planner_model": planner_model_used,
            },
        )
        return VoiceUnderstandResponse(
            transcript=transcript,
            stt_elapsed_ms=stt_elapsed_ms,
            stt_openai_http_ms=stt_openai_http_ms,
            stt_audio_read_ms=audio_read_ms,
            stt_audio_bytes=len(audio_bytes),
            stt_model=stt_model_used,
            response=VoiceResponsePayload(**response_payload),
            tool_call=tool_call,
            memory=VoiceMemoryHints(**memory_hint),
            planner_elapsed_ms=planner_elapsed_ms,
            openai_http_ms=planner_openai_http_ms,
            model=planner_model_used,
            elapsed_ms=elapsed_ms,
        )
    except VoiceServiceError as error:
        if not stt_completed:
            _trace_voice_stage(
                turn_id,
                "stt_finished",
                {
                    "route": "/voice/understand",
                    "status": "error",
                    "error": error.message,
                },
                finalize=True,
            )
        elif planner_started and not planner_completed:
            _trace_voice_stage(
                turn_id,
                "planner_finished",
                {
                    "route": "/voice/understand",
                    "status": "error",
                    "error": error.message,
                },
                finalize=True,
            )
        else:
            _trace_voice_stage(
                turn_id,
                "planner_finished",
                {
                    "route": "/voice/understand",
                    "status": "error",
                    "error": error.message,
                },
                finalize=True,
            )
        raise HTTPException(status_code=error.status_code, detail=error.message)
    except HTTPException:
        _trace_voice_stage(
            turn_id,
            "planner_finished" if stt_completed else "stt_finished",
            {
                "route": "/voice/understand",
                "status": "error",
                "error": "http_exception",
            },
            finalize=True,
        )
        raise
    except Exception as error:
        _trace_voice_stage(
            turn_id,
            "planner_finished" if stt_completed else "stt_finished",
            {
                "route": "/voice/understand",
                "status": "error",
                "error": str(error),
            },
            finalize=True,
        )
        logger.exception("[Kai Voice] understand failed turn_id=%s: %s", turn_id, error)
        raise HTTPException(status_code=500, detail="Voice understand request failed")


@router.post("/voice/plan", response_model=VoicePlanResponse)
async def kai_voice_plan(
    request: Request,
    http_response: Response,
    body: VoicePlanRequest,
    token_data: dict = Depends(require_vault_owner_token),
):
    started_at = time.perf_counter()
    turn_id = _resolve_voice_turn_id(request)
    _set_voice_turn_id_header(http_response, turn_id)
    _trace_voice_stage(
        turn_id,
        "backend_received",
        {
            "route": "/voice/plan",
            "method": "POST",
            "transcript_chars": len(body.transcript or ""),
        },
    )
    if token_data.get("user_id") != body.user_id:
        raise HTTPException(status_code=403, detail="Token user_id does not match request user_id")

    try:
        logger.info(
            "[KAI_VOICE_DIAG] planner_normalization_version=%s",
            _PLANNER_NORMALIZATION_VERSION,
        )
        rollout = _voice_rollout_state(body.user_id)
        if not rollout["enabled"]:
            response_payload = voice_service._build_response(
                kind="speak_only",
                message=_VOICE_NOT_ENABLED_MESSAGE,
            )
            response_payload["memory"] = {"allow_durable_write": False}
            tool_call = voice_service._legacy_tool_call_for_response(response_payload)
            elapsed_ms = int((time.perf_counter() - started_at) * 1000)
            _log_voice_metric(
                "planner_latency_ms",
                elapsed_ms,
                turn_id=turn_id,
                user_id=body.user_id,
                tags={"route": "/voice/plan", "model": "deterministic_rollout"},
            )
            _log_voice_metric(
                "response_kind_count",
                1,
                turn_id=turn_id,
                user_id=body.user_id,
                tags={"kind": "speak_only", "reason": "rollout_not_enabled"},
            )
            _log_voice_audit(
                turn_id=turn_id,
                user_id=body.user_id,
                response_payload=response_payload,
                meta={
                    "rollout_reason": rollout["reason"],
                    "canary_percent": rollout["canary_percent"],
                    "bucket": rollout["bucket"],
                },
            )
            return VoicePlanResponse(
                response=VoiceResponsePayload(**response_payload),
                tool_call=tool_call,
                memory=VoiceMemoryHints(**response_payload["memory"]),
                elapsed_ms=elapsed_ms,
                openai_http_ms=0,
                model="deterministic_rollout",
            )

        app_state_payload = body.app_state.model_dump() if body.app_state is not None else {}
        active_analysis = await _resolve_active_analysis(body.user_id, app_state_payload)
        active_import = await _resolve_active_import(body.user_id, app_state_payload)
        _trace_voice_stage(
            turn_id,
            "planner_started",
            {
                "route": "/voice/plan",
                "transcript_chars": len(body.transcript or ""),
            },
        )
        response, openai_http_ms, model_used = await voice_service.plan_voice_response(
            transcript=body.transcript,
            user_id=body.user_id,
            app_state=app_state_payload,
            context=body.context,
            active_analysis=active_analysis,
            active_import=active_import,
        )
        _trace_voice_stage(
            turn_id,
            "planner_finished",
            {
                "route": "/voice/plan",
                "status": "ok",
                "kind": str(response.get("kind") or ""),
                "reason": str(response.get("reason") or ""),
                "model": model_used,
                "openai_http_ms": openai_http_ms,
            },
        )
        if _voice_tool_execution_disabled() and response.get("kind") == "execute":
            response = voice_service._build_response(
                kind="speak_only",
                message=_VOICE_KILL_SWITCH_MESSAGE,
            )
            response["memory"] = {"allow_durable_write": False}

        tool_call = response.get("tool_call")
        if not isinstance(tool_call, dict):
            tool_call = voice_service._legacy_tool_call_for_response(response)
        memory_hint = response.get("memory")
        if not isinstance(memory_hint, dict):
            memory_hint = voice_service._memory_hint_from_response(response)
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        logger.info(
            (
                "[Kai Voice] route=/voice/plan status=ok turn_id=%s elapsed_ms=%s openai_http_ms=%s "
                "model=%s transcript_chars=%s kind=%s tool_call=%s"
            ),
            turn_id,
            elapsed_ms,
            openai_http_ms,
            model_used,
            len(body.transcript or ""),
            response.get("kind"),
            tool_call,
        )
        response_kind = str(response.get("kind") or "")
        response_reason = str(response.get("reason") or "")
        response_task = str(response.get("task") or "")
        planner_branch = _resolve_planner_branch(
            model=model_used,
            response_kind=response_kind,
            response_reason=response_reason,
        )
        _log_voice_metric(
            "planner_latency_ms",
            elapsed_ms,
            turn_id=turn_id,
            user_id=body.user_id,
            tags={"route": "/voice/plan", "model": model_used, "branch": planner_branch},
        )
        _log_voice_metric(
            "response_kind_count",
            1,
            turn_id=turn_id,
            user_id=body.user_id,
            tags={"kind": response_kind, "branch": planner_branch},
        )
        if response_kind == "clarify" and response_reason == "stt_unusable":
            _log_voice_metric(
                "unclear_stt_rate",
                1,
                turn_id=turn_id,
                user_id=body.user_id,
                tags={},
            )
        if response_kind == "clarify" and response_reason in {"ticker_ambiguous", "ticker_unknown"}:
            _log_voice_metric(
                "ambiguous_ticker_rate",
                1,
                turn_id=turn_id,
                user_id=body.user_id,
                tags={"reason": response_reason},
            )
        if response_kind == "already_running":
            _log_voice_metric(
                "already_running_rate",
                1,
                turn_id=turn_id,
                user_id=body.user_id,
                tags={"task": response_task or "unknown"},
            )
        _log_voice_audit(
            turn_id=turn_id,
            user_id=body.user_id,
            response_payload={**response, "tool_call": tool_call},
            meta={
                "rollout_reason": rollout["reason"],
                "canary_percent": rollout["canary_percent"],
                "bucket": rollout["bucket"],
                "tool_execution_disabled": _voice_tool_execution_disabled(),
                "planner_branch": planner_branch,
                "planner_normalization_version": _PLANNER_NORMALIZATION_VERSION,
            },
        )
        return VoicePlanResponse(
            response=VoiceResponsePayload(**response),
            tool_call=tool_call,
            memory=VoiceMemoryHints(**memory_hint),
            elapsed_ms=elapsed_ms,
            openai_http_ms=openai_http_ms,
            model=model_used,
        )
    except VoiceServiceError as error:
        _trace_voice_stage(
            turn_id,
            "planner_finished",
            {
                "route": "/voice/plan",
                "status": "error",
                "error": error.message,
            },
            finalize=True,
        )
        raise HTTPException(status_code=error.status_code, detail=error.message)
    except Exception as error:
        _trace_voice_stage(
            turn_id,
            "planner_finished",
            {
                "route": "/voice/plan",
                "status": "error",
                "error": str(error),
            },
            finalize=True,
        )
        logger.exception("[Kai Voice] planning failed turn_id=%s: %s", turn_id, error)
        raise HTTPException(status_code=500, detail="Voice intent planning failed")


@router.post("/voice/tts", response_model=VoiceTTSResponse)
async def kai_voice_tts(
    request: Request,
    http_response: Response,
    body: VoiceTTSRequest,
    token_data: dict = Depends(require_vault_owner_token),
):
    started_at = time.perf_counter()
    turn_id = _resolve_voice_turn_id(request)
    _set_voice_turn_id_header(http_response, turn_id)
    _trace_voice_stage(
        turn_id,
        "backend_received",
        {
            "route": "/voice/tts",
            "method": "POST",
            "text_chars": len(body.text or ""),
        },
    )
    if token_data.get("user_id") != body.user_id:
        raise HTTPException(status_code=403, detail="Token user_id does not match request user_id")

    try:
        _trace_voice_stage(
            turn_id,
            "tts_started",
            {
                "route": "/voice/tts",
                "text_chars": len(body.text or ""),
                "voice": body.voice or voice_service.tts_default_voice,
            },
        )
        audio_base64, mime_type, tts_meta = await voice_service.synthesize_speech(
            text=body.text,
            voice=body.voice or voice_service.tts_default_voice,
        )
        _trace_voice_stage(
            turn_id,
            "tts_finished",
            {
                "route": "/voice/tts",
                "status": "ok",
                "model": tts_meta.get("model"),
                "voice": tts_meta.get("voice"),
                "format": tts_meta.get("format"),
                "mime_type": mime_type,
                "audio_b64_chars": len(audio_base64),
            },
            finalize=True,
        )
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        logger.info(
            "[Kai Voice] route=/voice/tts status=ok turn_id=%s elapsed_ms=%s text_chars=%s "
            "audio_b64_chars=%s model=%s voice=%s format=%s",
            turn_id,
            elapsed_ms,
            len(body.text or ""),
            len(audio_base64),
            tts_meta.get("model", ""),
            tts_meta.get("voice", ""),
            tts_meta.get("format", ""),
        )
        _log_voice_metric(
            "tts_latency_ms",
            elapsed_ms,
            turn_id=turn_id,
            user_id=body.user_id,
            tags={
                "route": "/voice/tts",
                "model": tts_meta.get("model"),
                "voice": tts_meta.get("voice"),
                "format": tts_meta.get("format"),
            },
        )
        return VoiceTTSResponse(
            audio_base64=audio_base64,
            mime_type=mime_type,
            model=str(tts_meta.get("model") or ""),
            voice=str(tts_meta.get("voice") or ""),
            format=str(tts_meta.get("format") or ""),
        )
    except VoiceServiceError as error:
        _trace_voice_stage(
            turn_id,
            "tts_finished",
            {
                "route": "/voice/tts",
                "status": "error",
                "error": error.message,
            },
            finalize=True,
        )
        raise HTTPException(status_code=error.status_code, detail=error.message)
    except Exception as error:
        _trace_voice_stage(
            turn_id,
            "tts_finished",
            {
                "route": "/voice/tts",
                "status": "error",
                "error": str(error),
            },
            finalize=True,
        )
        logger.exception("[Kai Voice] TTS failed turn_id=%s: %s", turn_id, error)
        raise HTTPException(status_code=500, detail="Voice synthesis failed")
