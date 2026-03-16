"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { Bug, Mic, Search } from "lucide-react";

import { KaiCommandPalette } from "@/components/kai/kai-command-palette";
import { VoiceCompactStatus } from "@/components/kai/voice/voice-compact-status";
import { VoiceConsoleSheet } from "@/components/kai/voice/voice-console-sheet";
import { VoiceDebugDrawer } from "@/components/kai/voice/voice-debug-drawer";
import type { KaiCommandAction } from "@/lib/kai/kai-command-types";
import { Button } from "@/lib/morphy-ux/button";
import { morphyToast as toast } from "@/lib/morphy-ux/morphy";
import { Icon } from "@/lib/morphy-ux/ui";
import { useKaiBottomChromeVisibility } from "@/lib/navigation/kai-bottom-chrome-visibility";
import { KAI_COMMAND_BAR_OPEN_EVENT } from "@/lib/navigation/kai-command-bar-events";
import { ApiService } from "@/lib/services/api-service";
import { cn } from "@/lib/utils";
import { useAmplitudeMeter } from "@/lib/voice/use-amplitude-meter";
import {
  normalizeClarifyToolCall,
  validateVoicePlanPayload,
  VOICE_PLAN_NORMALIZATION_VERSION,
} from "@/lib/voice/voice-json-validator";
import { useVoiceSession } from "@/lib/voice/voice-session-store";
import { createVoiceTurnId, logVoiceMetric } from "@/lib/voice/voice-telemetry";
import {
  canTransitionVoiceUiState,
  getAllowedVoiceUiTransitions,
  type VoiceUiState,
} from "@/lib/voice/voice-ui-state-machine";
import { VoiceTtsPlaybackManager } from "@/lib/voice/voice-tts-playback";
import { VoiceRealtimeClient } from "@/lib/voice/voice-realtime-client";
import type {
  AppRuntimeState,
  VoiceMemoryHint,
  VoicePlanPayload,
  VoiceResponse,
} from "@/lib/voice/voice-types";

type VoiceVisibilityMode = "enabled" | "disabled" | "hidden";
type VoiceSubmitSource = "microphone" | "example_chip" | "replay";
type VoiceTurnStageTiming = {
  turnStartMs: number;
  lastStageMs: number;
};

type VoicePlannerRawPayload = {
  response?: unknown;
  tool_call?: unknown;
  memory?: unknown;
  elapsed_ms?: unknown;
  openai_http_ms?: unknown;
  model?: unknown;
  detail?: unknown;
  error?: unknown;
};

type PreparedVoicePlan = {
  normalizedPlan: VoicePlanPayload;
  rawPlanPayload: VoicePlannerRawPayload;
  planElapsedMs: number;
  plannerModel: string;
  plannerBranch: "deterministic" | "nano_model" | "clarify_fallback";
};

const STT_UNCLEAR_MESSAGE = "I couldn’t understand what you said, please repeat.";
const NETWORK_RETRY_MESSAGE = "I couldn’t complete that request, please try again.";
const DEFAULT_TTS_VOICE =
  String(process.env.NEXT_PUBLIC_KAI_VOICE_TTS_VOICE || "alloy").trim() || "alloy";
const DEFAULT_UNDERSTAND_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.NEXT_PUBLIC_KAI_VOICE_UNDERSTAND_TIMEOUT_MS || "");
  if (Number.isFinite(parsed) && parsed >= 20000) return Math.round(parsed);
  return 50000;
})();
const EXPECTED_BACKEND_UPSTREAM_TIMEOUT_S = (() => {
  const parsed = Number(process.env.NEXT_PUBLIC_KAI_VOICE_BACKEND_UPSTREAM_TIMEOUT_S || "");
  if (Number.isFinite(parsed) && parsed >= 1) return Number(parsed);
  return 45;
})();
const VOICE_STREAMING_ENABLED =
  String(process.env.NEXT_PUBLIC_KAI_VOICE_STREAMING_ENABLED || "")
    .trim()
    .toLowerCase() === "true";
const DEV_VOICE_DEBUG_ENABLED =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_KAI_VOICE_DEBUG === "1";

type VoiceUnderstandErrorCode =
  | "stt_upstream_timeout"
  | "stt_upstream_error"
  | "planner_timeout"
  | "planner_error"
  | "client_aborted"
  | "request_timeout"
  | "request_error";

type VoiceTurnError = Error & {
  voice_error_code?: VoiceUnderstandErrorCode;
  voice_error_stage?: string;
  voice_http_status?: number;
};

function createVoiceTurnError(
  message: string,
  meta: {
    code?: VoiceUnderstandErrorCode;
    stage?: string;
    status?: number;
  } = {}
): VoiceTurnError {
  const error = new Error(message) as VoiceTurnError;
  if (meta.code) error.voice_error_code = meta.code;
  if (meta.stage) error.voice_error_stage = meta.stage;
  if (typeof meta.status === "number") error.voice_http_status = meta.status;
  return error;
}

function resolveVoiceTurnErrorMeta(error: unknown): {
  code: VoiceUnderstandErrorCode | "unknown";
  stage: string | null;
  status: number | null;
  message: string;
} {
  const typed = error as VoiceTurnError;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Voice command failed";
  const stage =
    typed && typeof typed === "object" && typeof typed.voice_error_stage === "string"
      ? typed.voice_error_stage
      : null;
  const status =
    typed && typeof typed === "object" && typeof typed.voice_http_status === "number"
      ? typed.voice_http_status
      : null;
  const directCode =
    typed && typeof typed === "object" && typeof typed.voice_error_code === "string"
      ? typed.voice_error_code
      : null;
  if (directCode) {
    return {
      code: directCode as VoiceUnderstandErrorCode,
      stage,
      status,
      message,
    };
  }
  const normalized = message.toLowerCase();
  if (normalized.includes("voice_understand_timeout")) {
    return { code: "request_timeout", stage, status, message };
  }
  if (normalized.includes("voice_plan_timeout")) {
    return { code: "planner_timeout", stage, status, message };
  }
  if (normalized.includes("abort")) {
    return { code: "client_aborted", stage, status, message };
  }
  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return { code: "request_timeout", stage, status, message };
  }
  return { code: "unknown", stage, status, message };
}

function userMessageForUnderstandFailure(code: VoiceUnderstandErrorCode | "unknown"): string {
  if (code === "stt_upstream_timeout" || code === "request_timeout") {
    return "I couldn’t understand in time. Please try again.";
  }
  if (code === "stt_upstream_error") {
    return "I couldn’t process your voice input. Please try again.";
  }
  if (code === "planner_timeout" || code === "planner_error") {
    return "I couldn’t complete voice planning. Please try again.";
  }
  if (code === "client_aborted") {
    return "Voice request cancelled.";
  }
  return NETWORK_RETRY_MESSAGE;
}

interface KaiSearchBarProps {
  onCommand: (command: KaiCommandAction, params?: Record<string, unknown>) => void;
  onVoiceResponse?: (payload: {
    transcript: string;
    response: VoiceResponse;
    memory?: VoiceMemoryHint;
  }) => Promise<unknown> | unknown;
  disabled?: boolean;
  hasPortfolioData?: boolean;
  userId?: string;
  vaultOwnerToken?: string;
  voiceAvailable?: boolean;
  voiceVisibilityMode?: VoiceVisibilityMode;
  voiceUnavailableReason?: string;
  appRuntimeState?: AppRuntimeState;
  onTtsPlayingChange?: (playing: boolean) => void;
  voiceContext?: Record<string, unknown>;
  portfolioTickers?: Array<{
    symbol: string;
    name?: string;
    sector?: string;
    asset_type?: string;
    is_investable?: boolean;
    analyze_eligible?: boolean;
  }>;
}

function isPermissionDeniedError(error: unknown): boolean {
  const name =
    error && typeof error === "object" && "name" in error ? String(error.name || "") : "";
  return name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError";
}

function isTimeoutError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const normalized = message.toLowerCase();
  return (
    normalized.includes("voice_understand_timeout") ||
    normalized.includes("voice_plan_timeout") ||
    normalized.includes("voice_tts_timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("timeout")
  );
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.toLowerCase().includes("abort");
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutCode: string,
  onTimeout?: () => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      onTimeout?.();
      reject(new Error(timeoutCode));
    }, timeoutMs);
    void promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

function formatMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function normalizeVoiceAudioMimeType(rawMimeType: string | null | undefined): string {
  const normalized = String(rawMimeType || "").trim().toLowerCase();
  const base = (normalized.split(";", 1)[0] || "").trim();
  if (base === "video/webm") return "audio/webm";
  if (base === "audio/webm") return "audio/webm";
  if (base === "audio/wav" || base === "audio/x-wav") return "audio/wav";
  if (base === "audio/mp4" || base === "audio/m4a" || base === "audio/x-m4a") return "audio/mp4";
  if (base === "audio/mpeg" || base === "audio/mp3" || base === "audio/mpga") return "audio/mpeg";
  return "audio/webm";
}

function selectRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  if (typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/mpeg",
  ];
  for (const candidate of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    } catch {
      // ignore and continue
    }
  }
  return undefined;
}

export function KaiSearchBar({
  onCommand,
  onVoiceResponse,
  disabled = false,
  hasPortfolioData = true,
  userId,
  vaultOwnerToken,
  voiceAvailable = true,
  voiceVisibilityMode = "enabled",
  voiceUnavailableReason,
  appRuntimeState,
  onTtsPlayingChange,
  voiceContext,
  portfolioTickers = [],
}: KaiSearchBarProps) {
  const [open, setOpen] = useState(false);
  const [voiceUiState, setVoiceUiState] = useState<VoiceUiState>("idle");
  const [voiceErrorMessage, setVoiceErrorMessage] = useState<string | null>(null);
  const [ttsPlaybackState, setTtsPlaybackState] = useState<"idle" | "loading" | "playing">("idle");
  const [processingStageText, setProcessingStageText] = useState<string | null>(null);
  const [transcriptPreview, setTranscriptPreview] = useState<string>("");
  const [finalTranscript, setFinalTranscript] = useState<string>("");
  const [lastReplyText, setLastReplyText] = useState<string>("");
  const [lastResponseKind, setLastResponseKind] = useState<VoiceResponse["kind"] | null>(null);
  const [micPermissionStatus, setMicPermissionStatus] = useState<string>("unknown");

  const { hidden: hideBottomChrome, progress: hideBottomChromeProgress } =
    useKaiBottomChromeVisibility(true);

  const appendDebugEvent = useVoiceSession((s) => s.appendDebugEvent);
  const setLastAssistantReply = useVoiceSession((s) => s.setLastAssistantReply);

  const barRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingCancelledRef = useRef(false);
  const recordingStartedAtRef = useRef<number | null>(null);
  const stopRequestedAtRef = useRef<number | null>(null);
  const ttsPlaybackManagerRef = useRef<VoiceTtsPlaybackManager | null>(null);
  const currentVoiceTurnIdRef = useRef<string | null>(null);
  const voiceSessionIdRef = useRef<string>(`vsession_${createVoiceTurnId().replace("vturn_", "")}`);
  const turnStageTimingRef = useRef<Record<string, VoiceTurnStageTiming>>({});
  const understandAbortControllerRef = useRef<AbortController | null>(null);
  const plannerAbortControllerRef = useRef<AbortController | null>(null);
  const realtimeClientRef = useRef<VoiceRealtimeClient | null>(null);
  const realtimeStreamingTurnRef = useRef<string | null>(null);

  const { rawRms, normalizedLevel, smoothedLevel, start, stop } = useAmplitudeMeter({
    sensitivity: 11,
    smoothingFactor: 0.2,
    logIntervalMs: 500,
  });

  const micHidden = voiceVisibilityMode === "hidden";
  const micDisabled = disabled || !voiceAvailable || voiceVisibilityMode === "disabled";
  const voiceTransportMode = ApiService.getVoiceTransportMode();
  const realtimeStreamingAvailable =
    VOICE_STREAMING_ENABLED &&
    typeof window !== "undefined" &&
    typeof RTCPeerConnection !== "undefined";

  useEffect(() => {
    console.info(
      "[VOICE_DIAG] planner_normalization_version=%s transport_mode=%s transport_reason=%s tts_voice=%s understand_timeout_ms=%s backend_upstream_timeout_s=%s realtime_streaming_available=%s",
      VOICE_PLAN_NORMALIZATION_VERSION,
      voiceTransportMode.mode,
      voiceTransportMode.reason,
      DEFAULT_TTS_VOICE,
      DEFAULT_UNDERSTAND_TIMEOUT_MS,
      EXPECTED_BACKEND_UPSTREAM_TIMEOUT_S,
      realtimeStreamingAvailable
    );
  }, [realtimeStreamingAvailable, voiceTransportMode.mode, voiceTransportMode.reason]);

  const emitDebug = useCallback(
    (
      stage: "turn" | "mic" | "stt" | "planner" | "dispatch" | "tts" | "ui_fsm",
      event: string,
      payload: Record<string, unknown> = {},
      turnId?: string | null
    ) => {
      const resolvedTurn = turnId || currentVoiceTurnIdRef.current || "no_turn";
      const routePath = appRuntimeState?.route.pathname || null;
      const enrichedPayload = {
        event,
        timestamp_iso: new Date().toISOString(),
        layer:
          typeof payload.layer === "string" && payload.layer.trim()
            ? payload.layer
            : "frontend",
        source:
          typeof payload.source === "string" && payload.source.trim()
            ? payload.source
            : `kai_search_bar_${stage}`,
        route:
          typeof payload.route === "string" && payload.route.trim()
            ? payload.route
            : routePath,
        ...payload,
      };
      appendDebugEvent({
        turnId: resolvedTurn,
        sessionId: voiceSessionIdRef.current,
        stage,
        event,
        payload: enrichedPayload,
      });
    },
    [appRuntimeState?.route.pathname, appendDebugEvent]
  );

  useEffect(() => {
    ApiService.setVoiceTransportTraceListener((payload) => {
      const turnId =
        typeof payload.turn_id === "string" && payload.turn_id.trim()
          ? payload.turn_id
          : currentVoiceTurnIdRef.current;
      if (!turnId) return;
      const eventName =
        typeof payload.event === "string" && payload.event.trim()
          ? payload.event
          : "transport_event";
      emitDebug(
        "turn",
        eventName,
        {
          ...payload,
          source: "api_service_transport",
          layer: "frontend",
        },
        turnId
      );
    });
    return () => {
      ApiService.setVoiceTransportTraceListener(null);
    };
  }, [emitDebug]);

  const isCurrentTurn = useCallback((turnId: string): boolean => {
    if (!turnId) return false;
    return currentVoiceTurnIdRef.current === turnId;
  }, []);

  const closeRealtimeClient = useCallback(
    (reason: string, options?: { stopLocalStream?: boolean }) => {
      const client = realtimeClientRef.current;
      if (!client) return;
      realtimeClientRef.current = null;
      realtimeStreamingTurnRef.current = null;
      emitDebug(
        "stt",
        "stream_session_closed",
        {
          reason,
        },
        currentVoiceTurnIdRef.current
      );
      void client.close({ stopLocalStream: options?.stopLocalStream });
    },
    [emitDebug]
  );

  const abortInFlightVoiceRequests = useCallback(
    (reason: string) => {
      const activeUnderstand = understandAbortControllerRef.current;
      if (activeUnderstand) {
        activeUnderstand.abort(reason);
        understandAbortControllerRef.current = null;
        emitDebug("stt", "request_aborted", { reason }, currentVoiceTurnIdRef.current);
      }
      const activePlanner = plannerAbortControllerRef.current;
      if (activePlanner) {
        activePlanner.abort(reason);
        plannerAbortControllerRef.current = null;
        emitDebug("planner", "request_aborted", { reason }, currentVoiceTurnIdRef.current);
      }
      const streamingClient = realtimeClientRef.current;
      if (streamingClient) {
        try {
          streamingClient.cancelSpeech("VOICE_STREAM_ABORTED");
        } catch {
          // noop
        }
      }
      closeRealtimeClient(reason);
    },
    [closeRealtimeClient, emitDebug]
  );

  const emitStageTiming = useCallback(
    (
      turnId: string,
      stage: string,
      metadata: Record<string, unknown> = {},
      options?: { finalize?: boolean }
    ) => {
      if (!turnId) return;
      const nowMs = performance.now();
      const nowIso = new Date().toISOString();
      const existing = turnStageTimingRef.current[turnId];
      if (!existing) {
        turnStageTimingRef.current[turnId] = {
          turnStartMs: nowMs,
          lastStageMs: nowMs,
        };
      }
      const current =
        turnStageTimingRef.current[turnId] || {
          turnStartMs: nowMs,
          lastStageMs: nowMs,
        };
      if (!turnStageTimingRef.current[turnId]) {
        turnStageTimingRef.current[turnId] = current;
      }
      const sincePrevMs = existing ? formatMs(nowMs - existing.lastStageMs) : 0;
      const sinceTurnStartMs = formatMs(nowMs - current.turnStartMs);
      turnStageTimingRef.current[turnId] = {
        turnStartMs: current.turnStartMs,
        lastStageMs: nowMs,
      };

      const payload = {
        event: stage,
        stage,
        layer:
          typeof metadata.layer === "string" && metadata.layer.trim()
            ? metadata.layer
            : "frontend",
        source:
          typeof metadata.source === "string" && metadata.source.trim()
            ? metadata.source
            : "kai_search_bar_stage_timing",
        route:
          typeof metadata.route === "string" && metadata.route.trim()
            ? metadata.route
            : appRuntimeState?.route.pathname || null,
        timestamp_iso: nowIso,
        timestamp: nowIso,
        since_prev_ms: sincePrevMs,
        since_turn_start_ms: sinceTurnStartMs,
        ...metadata,
      };
      emitDebug("turn", "stage_timing", payload, turnId);
      console.info("[KAI_VOICE_TRACE_FE]", {
        turn_id: turnId,
        ...payload,
      });

      if (options?.finalize) {
        delete turnStageTimingRef.current[turnId];
      }
    },
    [appRuntimeState?.route.pathname, emitDebug]
  );

  const clearStageTiming = useCallback((turnId?: string | null) => {
    if (!turnId) return;
    delete turnStageTimingRef.current[turnId];
  }, []);

  const transitionVoiceState = useCallback(
    (next: VoiceUiState, reason: string, payload: Record<string, unknown> = {}) => {
      setVoiceUiState((prev) => {
        if (prev === next) return prev;
        const valid = canTransitionVoiceUiState(prev, next);
        if (!valid) {
          emitDebug("ui_fsm", "state_invalid_transition", {
            from: prev,
            to: next,
            reason,
            allowed: getAllowedVoiceUiTransitions(prev),
            ...payload,
          });
          return prev;
        }
        emitDebug("ui_fsm", "state_transition", {
          from: prev,
          to: next,
          reason,
          ...payload,
        });
        return next;
      });
    },
    [emitDebug]
  );

  const setVoiceError = useCallback(
    (message: string, userMessage?: string) => {
      setVoiceErrorMessage(message);
      transitionVoiceState("error_terminal", "error", { message });
      emitDebug("turn", "error", { message });
      toast.error(userMessage || message);
    },
    [emitDebug, transitionVoiceState]
  );

  const cleanupAudioResources = useCallback(
    (reason: string) => {
      stop();
      if (realtimeClientRef.current) {
        closeRealtimeClient(`cleanup_${reason}`);
      }
      const recorder = mediaRecorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;
      }
      mediaRecorderRef.current = null;

      const stream = mediaStreamRef.current;
      if (stream) {
        stream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch {
            // ignore
          }
        });
      }
      mediaStreamRef.current = null;
      audioChunksRef.current = [];
      recordingStartedAtRef.current = null;
      stopRequestedAtRef.current = null;

      emitDebug("mic", "recording_resources_cleaned", { reason });
    },
    [closeRealtimeClient, emitDebug, stop]
  );

  const speakAssistantMessage = useCallback(
    async (text: string, voiceTurnId?: string) => {
      const manager = ttsPlaybackManagerRef.current;
      if (!manager) return;
      const cleanText = String(text || "").trim();
      if (!cleanText) return;

      const realtimeClient = realtimeClientRef.current;
      const realtimeTurnId = realtimeStreamingTurnRef.current;
      const useRealtimeStreamingTts =
        Boolean(realtimeClient && realtimeClient.connected()) &&
        Boolean(realtimeTurnId) &&
        (!voiceTurnId || voiceTurnId === realtimeTurnId);

      if (!userId || !vaultOwnerToken) {
        await manager.speakLocally(cleanText, voiceTurnId);
        return;
      }

      if (useRealtimeStreamingTts && realtimeClient) {
        const streamTtsAttemptStartedAt = performance.now();
        emitDebug(
          "tts",
          "stream_tts_attempt_started",
          {
            attempted_source: "realtime_stream_tts",
            fallback_target_if_failed: "backend_batch_tts",
            requested_voice: DEFAULT_TTS_VOICE,
          },
          voiceTurnId || null
        );
        try {
          await manager.speak({
            userId,
            vaultOwnerToken,
            text: cleanText,
            voice: DEFAULT_TTS_VOICE,
            voiceTurnId,
            adapter: "realtime_stream_tts",
            realtimeAdapter: {
              speak: async ({
                text: responseText,
                voice,
                timeoutMs,
                onFirstAudio,
                onPlaybackStarted,
                onPlaybackEnded,
              }) => {
                await realtimeClient.requestSpeech({
                  text: responseText,
                  voice: voice || DEFAULT_TTS_VOICE,
                  timeoutMs,
                  onFirstAudio,
                  onPlaybackStarted,
                  onPlaybackEnded,
                });
              },
              cancel: () => {
                realtimeClient.cancelSpeech("VOICE_STREAM_TTS_CANCELLED");
              },
            },
          });
          emitDebug(
            "tts",
            "stream_tts_attempt_succeeded",
            {
              source: "realtime_stream_tts",
              elapsed_ms: formatMs(performance.now() - streamTtsAttemptStartedAt),
            },
            voiceTurnId || null
          );
          return;
        } catch (error) {
          emitDebug(
            "tts",
            "stream_tts_failed_fallback_batch",
            {
              reason: error instanceof Error ? error.message : "stream_tts_failed",
              attempted_source: "realtime_stream_tts",
              fallback_source: "backend_batch_tts",
              elapsed_ms: formatMs(performance.now() - streamTtsAttemptStartedAt),
            },
            voiceTurnId || null
          );
        }
      }

      const batchTtsAttemptStartedAt = performance.now();
      await manager.speak({
        userId,
        vaultOwnerToken,
        text: cleanText,
        voice: DEFAULT_TTS_VOICE,
        voiceTurnId,
      });
      emitDebug(
        "tts",
        "batch_tts_attempt_succeeded",
        {
          source: "backend_batch_tts",
          elapsed_ms: formatMs(performance.now() - batchTtsAttemptStartedAt),
          requested_voice: DEFAULT_TTS_VOICE,
        },
        voiceTurnId || null
      );
    },
    [emitDebug, userId, vaultOwnerToken]
  );

  const processTranscriptTurn = useCallback(
    async (
      transcript: string,
      source: VoiceSubmitSource,
      turnId: string,
      preparedPlan?: PreparedVoicePlan
    ) => {
      if (!isCurrentTurn(turnId)) return;
      const cleanTranscript = String(transcript || "").trim();
      if (!onVoiceResponse) {
        setVoiceError("Voice response callback is not configured", "Voice command failed. Try again.");
        return;
      }
      if (!voiceAvailable || !userId || !vaultOwnerToken) {
        const blockedMessage = voiceUnavailableReason || "Unlock your vault to use voice";
        toast.info(blockedMessage);
        transitionVoiceState("idle", "voice_unavailable_during_turn");
        return;
      }
      let normalizedPlan: VoicePlanPayload;
      let rawPlanPayload: VoicePlannerRawPayload;
      let planElapsedMs: number;
      let plannerModel: string;
      let plannerBranch: "deterministic" | "nano_model" | "clarify_fallback";

      if (preparedPlan) {
        normalizedPlan = preparedPlan.normalizedPlan;
        rawPlanPayload = preparedPlan.rawPlanPayload;
        planElapsedMs = preparedPlan.planElapsedMs;
        plannerModel = preparedPlan.plannerModel;
        plannerBranch = preparedPlan.plannerBranch;
      } else {
        setProcessingStageText("Planning response...");
        emitStageTiming(turnId, "frontend_request_started", {
          request: "planner",
          source,
          transcript_chars: cleanTranscript.length,
        });
        emitStageTiming(turnId, "planner_request_prepared", {
          layer: "frontend",
          source: "process_transcript_turn",
          route: "/api/kai/voice/plan",
          origin: "frontend_optimistic",
          transcript_chars: cleanTranscript.length,
        });
        emitStageTiming(turnId, "planner_request_sent", {
          layer: "frontend",
          source: "process_transcript_turn",
          route: "/api/kai/voice/plan",
          origin: "frontend_optimistic",
          transcript_chars: cleanTranscript.length,
        });
        // Compatibility alias: optimistic frontend marker, not backend planner confirmation.
        emitStageTiming(turnId, "planner_started", {
          source,
          origin: "frontend_optimistic",
          transcript_chars: cleanTranscript.length,
        });
        emitDebug(
          "planner",
          "app_runtime_state_sent",
          {
            source,
            transcript_chars: cleanTranscript.length,
            app_state: appRuntimeState ?? null,
            context: voiceContext ?? null,
          },
          turnId
        );

        const planStartedAt = performance.now();
        const plannerAbortController = new AbortController();
        plannerAbortControllerRef.current = plannerAbortController;
        let planResponse: Response;
        try {
          planResponse = await withTimeout(
            ApiService.planKaiVoiceIntent({
              userId,
              vaultOwnerToken,
              transcript: cleanTranscript,
              context: voiceContext,
              appState: appRuntimeState,
              voiceTurnId: turnId,
              signal: plannerAbortController.signal,
            }),
            12000,
            "VOICE_PLAN_TIMEOUT",
            () => plannerAbortController.abort("VOICE_PLAN_TIMEOUT")
          );
        } finally {
          if (plannerAbortControllerRef.current === plannerAbortController) {
            plannerAbortControllerRef.current = null;
          }
        }
        planElapsedMs = formatMs(performance.now() - planStartedAt);
        emitStageTiming(turnId, "planner_response_headers_received", {
          layer: "frontend",
          source: "process_transcript_turn",
          route: "/api/kai/voice/plan",
          origin: "backend_confirmed",
          status_code: planResponse.status,
        });
        const plannerBodyReadStartedAt = performance.now();
        const plannerBodyText = await planResponse.text().catch(() => "");
        emitStageTiming(turnId, "planner_response_body_received", {
          layer: "frontend",
          source: "process_transcript_turn",
          route: "/api/kai/voice/plan",
          origin: "backend_confirmed",
          status_code: planResponse.status,
          response_body_chars: plannerBodyText.length,
          elapsed_ms: formatMs(performance.now() - plannerBodyReadStartedAt),
        });
        const plannerParseStartedAt = performance.now();
        let plannerPayloadParseError: string | null = null;
        let parsedPlannerPayload: Record<string, unknown> = {};
        if (plannerBodyText) {
          try {
            const maybePayload = JSON.parse(plannerBodyText) as unknown;
            if (maybePayload && typeof maybePayload === "object") {
              parsedPlannerPayload = maybePayload as Record<string, unknown>;
            }
          } catch (error) {
            plannerPayloadParseError = error instanceof Error ? error.message : String(error);
          }
        }
        emitStageTiming(turnId, "planner_payload_parsed", {
          layer: "frontend",
          source: "process_transcript_turn",
          route: "/api/kai/voice/plan",
          origin: "frontend_confirmed",
          status_code: planResponse.status,
          payload_parse_error: plannerPayloadParseError,
          elapsed_ms: formatMs(performance.now() - plannerParseStartedAt),
        });
        rawPlanPayload = parsedPlannerPayload as VoicePlannerRawPayload;

        if (!planResponse.ok && planResponse.status !== 401 && planResponse.status !== 403) {
          const message =
            (typeof rawPlanPayload.detail === "string" && rawPlanPayload.detail) ||
            (typeof rawPlanPayload.error === "string" && rawPlanPayload.error) ||
            "Voice command planning failed";
          emitDebug("planner", "response_failed", { status: planResponse.status, message }, turnId);
          throw new Error(message);
        }

        const validatedPlan = validateVoicePlanPayload(rawPlanPayload);
        if (!validatedPlan && (planResponse.status === 401 || planResponse.status === 403)) {
          normalizedPlan = {
            response: {
              kind: "blocked",
              reason: "vault_required",
              message: "Unlock your vault to use voice.",
              speak: true,
            },
            memory: { allow_durable_write: false },
          };
        } else if (!validatedPlan) {
          normalizedPlan = {
            response: {
              kind: "clarify",
              reason: "stt_unusable",
              message: STT_UNCLEAR_MESSAGE,
              speak: true,
            },
            tool_call: normalizeClarifyToolCall(STT_UNCLEAR_MESSAGE),
            memory: { allow_durable_write: false },
          };
        } else {
          normalizedPlan = validatedPlan;
        }

        plannerModel =
          typeof rawPlanPayload.model === "string" && rawPlanPayload.model.trim()
            ? rawPlanPayload.model.trim()
            : "unknown";
        plannerBranch =
          plannerModel.toLowerCase().startsWith("deterministic")
            ? "deterministic"
            : normalizedPlan.response.kind === "clarify" &&
                normalizedPlan.response.reason === "stt_unusable"
              ? "clarify_fallback"
              : "nano_model";
      }

      if (!isCurrentTurn(turnId)) return;

      const response = normalizedPlan.response;
      setLastReplyText(response.message);
      setLastResponseKind(response.kind);
      setLastAssistantReply({
        message: response.message,
        kind: response.kind,
        turnId,
      });
      emitDebug(
        "planner",
        "response_received",
        {
          response_kind: response.kind,
          response_message: response.message,
          response_payload: response,
          memory: normalizedPlan.memory ?? null,
          tool_call: normalizedPlan.tool_call ?? (response.kind === "execute" ? response.tool_call : null),
          planner_latency_ms: planElapsedMs,
          planner_model: plannerModel,
          planner_branch: plannerBranch,
          openai_http_ms: rawPlanPayload.openai_http_ms ?? null,
        },
        turnId
      );
      emitStageTiming(turnId, "planner_finished", {
        origin: "backend_confirmed",
        response_kind: response.kind,
        planner_model: plannerModel,
        planner_branch: plannerBranch,
        planner_latency_ms: planElapsedMs,
        openai_http_ms: rawPlanPayload.openai_http_ms ?? null,
      });
      logVoiceMetric({
        metric: "planner_latency_ms",
        value: planElapsedMs,
        turnId,
        tags: { source, response_kind: response.kind, planner_branch: plannerBranch },
      });

      setProcessingStageText("Executing action...");
      emitDebug(
        "dispatch",
        "started",
        {
          response_kind: response.kind,
          tool_call:
            normalizedPlan.tool_call ?? (response.kind === "execute" ? response.tool_call : null),
        },
        turnId
      );
      emitStageTiming(turnId, "dispatch_started", {
        response_kind: response.kind,
        tool_name:
          normalizedPlan.tool_call?.tool_name ??
          (response.kind === "execute" ? response.tool_call.tool_name : null),
      });
      const executePromise = Promise.resolve(
        onVoiceResponse({
          transcript: cleanTranscript,
          response,
          memory: normalizedPlan.memory,
        })
      )
        .then((dispatchResult) => {
          emitDebug(
            "dispatch",
            "success",
            {
              response_kind: response.kind,
              dispatch_result: dispatchResult ?? null,
            },
            turnId
          );
          emitStageTiming(turnId, "dispatch_finished", {
            response_kind: response.kind,
            status: "success",
          });
          return dispatchResult;
        })
        .catch((error: unknown) => {
          emitDebug(
            "dispatch",
            "failed",
            { reason: error instanceof Error ? error.message : "unknown_error" },
            turnId
          );
          emitStageTiming(turnId, "dispatch_finished", {
            response_kind: response.kind,
            status: "failed",
            reason: error instanceof Error ? error.message : "unknown_error",
          });
          throw error;
        });

      transitionVoiceState("speaking_compact", "response_ready_for_speaking", {
        response_kind: response.kind,
      });
      setProcessingStageText("Kai is speaking...");

      const speakPromise = response.speak
        ? speakAssistantMessage(response.message, turnId)
        : Promise.resolve();
      const [executeResult, playbackResult] = await Promise.allSettled([executePromise, speakPromise]);

      if (!isCurrentTurn(turnId)) return;

      if (executeResult.status === "rejected") {
        toast.error("Voice action failed.", {
          description:
            executeResult.reason instanceof Error
              ? executeResult.reason.message
              : "Could not execute this voice request.",
        });
      }

      if (playbackResult.status === "rejected") {
        emitDebug(
          "tts",
          "playback_failed_surface",
          {
            reason:
              playbackResult.reason instanceof Error
                ? playbackResult.reason.message
                : "playback_failed",
          },
          turnId
        );
        toast.error("I couldn't play the audio response.", {
          description: "The action was still processed.",
        });
      }

      const keepRetryEasy = response.kind === "clarify" || response.kind === "blocked";
      if (keepRetryEasy) {
        transitionVoiceState("retry_ready", "response_requires_retry", { response_kind: response.kind });
      } else {
        transitionVoiceState("idle", "response_complete", { response_kind: response.kind });
      }
      setProcessingStageText(null);
      currentVoiceTurnIdRef.current = turnId;
    },
    [
      appRuntimeState,
      emitDebug,
      emitStageTiming,
      isCurrentTurn,
      onVoiceResponse,
      setLastAssistantReply,
      setVoiceError,
      speakAssistantMessage,
      transitionVoiceState,
      userId,
      vaultOwnerToken,
      voiceAvailable,
      voiceContext,
      voiceTransportMode.mode,
      voiceTransportMode.reason,
      voiceUnavailableReason,
    ]
  );

  const processVoiceRecording = useCallback(
    async (audioBlob: Blob, turnId: string) => {
      if (!isCurrentTurn(turnId)) return;
      if (!voiceAvailable || !userId || !vaultOwnerToken) {
        const blockedMessage = voiceUnavailableReason || "Unlock your vault to use voice";
        toast.info(blockedMessage);
        transitionVoiceState("idle", "voice_unavailable_before_stt");
        return;
      }

      const understandAbortController = new AbortController();
      understandAbortControllerRef.current = understandAbortController;
      setProcessingStageText("Understanding your request...");
      emitStageTiming(turnId, "understand_request_prepared", {
        layer: "frontend",
        source: "process_voice_recording",
        route: "/api/kai/voice/understand",
        origin: "frontend_optimistic",
        transport_mode: voiceTransportMode.mode,
        transport_reason: voiceTransportMode.reason,
        audio_bytes: audioBlob.size,
        mime_type: audioBlob.type || null,
      });
      emitStageTiming(turnId, "understand_request_sent", {
        layer: "frontend",
        source: "process_voice_recording",
        route: "/api/kai/voice/understand",
        origin: "frontend_optimistic",
        transport_mode: voiceTransportMode.mode,
        transport_reason: voiceTransportMode.reason,
      });
      emitStageTiming(turnId, "frontend_request_started", {
        request: "understand",
        audio_bytes: audioBlob.size,
        transport: voiceTransportMode.mode,
        transport_reason: voiceTransportMode.reason,
        understand_timeout_ms: DEFAULT_UNDERSTAND_TIMEOUT_MS,
        backend_upstream_timeout_s: EXPECTED_BACKEND_UPSTREAM_TIMEOUT_S,
      });
      // Compatibility alias: optimistic frontend marker, not backend STT confirmation.
      emitStageTiming(turnId, "stt_started", {
        layer: "frontend_combined",
        origin: "frontend_optimistic",
        audio_bytes: audioBlob.size,
      });
      // Compatibility alias: optimistic frontend marker, not backend planner confirmation.
      emitStageTiming(turnId, "planner_started", {
        layer: "frontend_combined",
        origin: "frontend_optimistic",
        audio_bytes: audioBlob.size,
      });
      emitDebug(
        "stt",
        "request_started",
        {
          audio_bytes: audioBlob.size,
          transport: voiceTransportMode.mode,
          transport_reason: voiceTransportMode.reason,
          understand_timeout_ms: DEFAULT_UNDERSTAND_TIMEOUT_MS,
          backend_upstream_timeout_s: EXPECTED_BACKEND_UPSTREAM_TIMEOUT_S,
        },
        turnId
      );
      emitDebug(
        "planner",
        "app_runtime_state_sent",
        {
          source: "microphone",
          transcript_chars: null,
          app_state: appRuntimeState ?? null,
          context: voiceContext ?? null,
          combined_endpoint: true,
        },
        turnId
      );
      const sttStartedAt = performance.now();
      try {
        const understandResponse = await withTimeout(
          ApiService.understandKaiVoice({
            userId,
            vaultOwnerToken,
            audioBlob,
            context: voiceContext,
            appState: appRuntimeState,
            mimeType: audioBlob.type || undefined,
            voiceTurnId: turnId,
            signal: understandAbortController.signal,
          }),
          DEFAULT_UNDERSTAND_TIMEOUT_MS,
          "VOICE_UNDERSTAND_TIMEOUT",
          () => understandAbortController.abort("VOICE_UNDERSTAND_TIMEOUT")
        );
        emitStageTiming(turnId, "understand_response_headers_received", {
          layer: "frontend",
          source: "process_voice_recording",
          route: "/api/kai/voice/understand",
          origin: "backend_confirmed",
          status_code: understandResponse.status,
        });
        if (!isCurrentTurn(turnId)) {
          emitDebug("turn", "stale_turn_ignored", { reason: "understand_response_arrived_for_old_turn" }, turnId);
          return;
        }
        const sttElapsedMs = formatMs(performance.now() - sttStartedAt);
        const bodyReadStartedAt = performance.now();
        const understandBodyText = await understandResponse.text().catch(() => "");
        const bodyReadElapsedMs = formatMs(performance.now() - bodyReadStartedAt);
        emitStageTiming(turnId, "understand_response_body_received", {
          layer: "frontend",
          source: "process_voice_recording",
          route: "/api/kai/voice/understand",
          origin: "backend_confirmed",
          status_code: understandResponse.status,
          response_body_chars: understandBodyText.length,
          elapsed_ms: bodyReadElapsedMs,
        });
        const payloadParseStartedAt = performance.now();
        let payloadParseError: string | null = null;
        let parsedPayload: Record<string, unknown> = {};
        if (understandBodyText) {
          try {
            const maybePayload = JSON.parse(understandBodyText) as unknown;
            if (maybePayload && typeof maybePayload === "object") {
              parsedPayload = maybePayload as Record<string, unknown>;
            }
          } catch (error) {
            payloadParseError = error instanceof Error ? error.message : String(error);
          }
        }
        emitStageTiming(turnId, "understand_payload_parsed", {
          layer: "frontend",
          source: "process_voice_recording",
          route: "/api/kai/voice/understand",
          origin: "frontend_confirmed",
          status_code: understandResponse.status,
          payload_parse_error: payloadParseError,
          elapsed_ms: formatMs(performance.now() - payloadParseStartedAt),
        });
        const understandPayload = parsedPayload as {
          transcript?: unknown;
          response?: unknown;
          tool_call?: unknown;
          memory?: unknown;
          elapsed_ms?: unknown;
          planner_elapsed_ms?: unknown;
          openai_http_ms?: unknown;
          model?: unknown;
          stt_elapsed_ms?: unknown;
          stt_openai_http_ms?: unknown;
          stt_audio_read_ms?: unknown;
          stt_audio_bytes?: unknown;
          stt_model?: unknown;
          audio_read_ms?: unknown;
          audio_bytes?: unknown;
          detail?: unknown;
          error?: unknown;
        };

        if (!understandResponse.ok) {
          const detailObject =
            understandPayload.detail && typeof understandPayload.detail === "object"
              ? (understandPayload.detail as {
                  error_code?: unknown;
                  error_stage?: unknown;
                  message?: unknown;
                  debug_message?: unknown;
                })
              : null;
          const backendErrorCode =
            detailObject && typeof detailObject.error_code === "string"
              ? (detailObject.error_code as VoiceUnderstandErrorCode)
              : undefined;
          const backendErrorStage =
            detailObject && typeof detailObject.error_stage === "string"
              ? detailObject.error_stage
              : undefined;
          const backendMessage =
            (detailObject && typeof detailObject.message === "string" && detailObject.message) ||
            (typeof understandPayload.detail === "string" && understandPayload.detail) ||
            (typeof understandPayload.error === "string" && understandPayload.error) ||
            "";
          const message =
            (understandResponse.status === 401 || understandResponse.status === 403
              ? "Unlock your vault to use voice."
              : null) ||
            backendMessage ||
            "Voice understanding failed";
          emitDebug(
            "stt",
            "request_failed",
            {
              message,
              status: understandResponse.status,
              error_code: backendErrorCode || null,
              error_stage: backendErrorStage || null,
              error_detail: detailObject || null,
            },
            turnId
          );
          throw createVoiceTurnError(message, {
            code: backendErrorCode,
            stage: backendErrorStage,
            status: understandResponse.status,
          });
        }

        const transcript = String(understandPayload.transcript || "").trim();
        setFinalTranscript(transcript);
        setTranscriptPreview(transcript || STT_UNCLEAR_MESSAGE);

        const sttLatencyMs =
          typeof understandPayload.stt_elapsed_ms === "number"
            ? formatMs(understandPayload.stt_elapsed_ms)
            : sttElapsedMs;
        const sttModel =
          typeof understandPayload.stt_model === "string" && understandPayload.stt_model.trim()
            ? understandPayload.stt_model.trim()
            : "unknown";
        const sttOpenAiHttpMs =
          typeof understandPayload.stt_openai_http_ms === "number"
            ? Number(understandPayload.stt_openai_http_ms)
            : Number(understandPayload.openai_http_ms || 0);

        emitDebug(
          "stt",
          "request_ended",
          {
            transcript_partial: "(not-supported)",
            transcript_final: transcript,
            transcript_latency_ms: sttLatencyMs,
            model: sttModel,
            openai_http_ms: sttOpenAiHttpMs,
            fallback_triggered: false,
          },
          turnId
        );
        // Compatibility alias: backend-confirmed STT completion surfaced by combined endpoint payload.
        emitStageTiming(turnId, "stt_finished", {
          layer: "frontend_combined",
          origin: "backend_confirmed",
          transcript_chars: transcript.length,
          transcript_latency_ms: sttLatencyMs,
          model: sttModel,
          openai_http_ms: sttOpenAiHttpMs,
        });
        logVoiceMetric({
          metric: "stt_latency_ms",
          value: sttLatencyMs,
          turnId,
          tags: { model: sttModel, source: "combined_understand" },
        });

        const rawPlanPayload = understandPayload as VoicePlannerRawPayload;
        let normalizedPlan = validateVoicePlanPayload(rawPlanPayload);
        if (!normalizedPlan) {
          normalizedPlan = {
            response: {
              kind: "clarify",
              reason: "stt_unusable",
              message: STT_UNCLEAR_MESSAGE,
              speak: true,
            },
            tool_call: normalizeClarifyToolCall(STT_UNCLEAR_MESSAGE),
            memory: { allow_durable_write: false },
          };
        }
        const plannerModel =
          typeof understandPayload.model === "string" && understandPayload.model.trim()
            ? understandPayload.model.trim()
            : "unknown";
        const plannerBranch =
          plannerModel.toLowerCase().startsWith("deterministic")
            ? "deterministic"
            : normalizedPlan.response.kind === "clarify" &&
                normalizedPlan.response.reason === "stt_unusable"
              ? "clarify_fallback"
              : "nano_model";
        const plannerElapsedMs =
          typeof understandPayload.planner_elapsed_ms === "number"
            ? formatMs(understandPayload.planner_elapsed_ms)
            : formatMs(sttElapsedMs);

        await processTranscriptTurn(transcript, "microphone", turnId, {
          normalizedPlan,
          rawPlanPayload,
          planElapsedMs: plannerElapsedMs,
          plannerModel,
          plannerBranch,
        });
      } finally {
        if (understandAbortControllerRef.current === understandAbortController) {
          understandAbortControllerRef.current = null;
        }
      }
    },
    [
      appRuntimeState,
      emitDebug,
      emitStageTiming,
      isCurrentTurn,
      processTranscriptTurn,
      transitionVoiceState,
      userId,
      vaultOwnerToken,
      voiceAvailable,
      voiceContext,
      voiceUnavailableReason,
    ]
  );

  const processRealtimeStreamingTurn = useCallback(
    async (turnId: string) => {
      const realtimeClient = realtimeClientRef.current;
      if (!realtimeClient || realtimeStreamingTurnRef.current !== turnId) {
        throw createVoiceTurnError("Realtime stream session unavailable", {
          code: "request_error",
          stage: "request",
        });
      }
      if (!voiceAvailable || !userId || !vaultOwnerToken) {
        throw createVoiceTurnError("Unlock your vault to use voice.", {
          code: "request_error",
          stage: "request",
          status: 401,
        });
      }

      setProcessingStageText("Understanding your request...");
      emitStageTiming(turnId, "frontend_request_started", {
        request: "streamed_understand",
        transport: "realtime_webrtc",
      });
      emitStageTiming(turnId, "stt_started", {
        layer: "frontend_realtime",
        origin: "frontend_optimistic",
      });
      emitDebug(
        "stt",
        "request_started",
        {
          transport: "realtime_webrtc",
          stream_mode: true,
        },
        turnId
      );

      realtimeClient.commitInputAudio();
      emitDebug(
        "stt",
        "stream_commit_started",
        {
          transport: "realtime_webrtc",
        },
        turnId
      );

      const sttStartedAt = performance.now();
      const transcript = (await realtimeClient.waitForFinalTranscript(
        DEFAULT_UNDERSTAND_TIMEOUT_MS
      )) || "";
      const cleanTranscript = String(transcript || "").trim();
      if (!cleanTranscript) {
        throw createVoiceTurnError("No transcript returned from realtime stream", {
          code: "stt_upstream_error",
          stage: "stt_upstream",
        });
      }
      if (!isCurrentTurn(turnId)) {
        emitDebug("turn", "stale_turn_ignored", { reason: "stream_final_transcript_for_old_turn" }, turnId);
        return;
      }

      const sttElapsedMs = formatMs(performance.now() - sttStartedAt);
      setFinalTranscript(cleanTranscript);
      setTranscriptPreview(cleanTranscript);
      emitDebug(
        "stt",
        "request_ended",
        {
          transcript_final: cleanTranscript,
          transcript_latency_ms: sttElapsedMs,
          model: "realtime_stream",
          openai_http_ms: null,
          fallback_triggered: false,
        },
        turnId
      );
      emitStageTiming(turnId, "stt_finished", {
        layer: "frontend_realtime",
        origin: "backend_confirmed",
        transcript_chars: cleanTranscript.length,
        transcript_latency_ms: sttElapsedMs,
        model: "realtime_stream",
      });
      emitDebug(
        "planner",
        "stream_planner_started",
        {
          transcript_chars: cleanTranscript.length,
        },
        turnId
      );
      emitStageTiming(turnId, "planner_started", {
        layer: "frontend_realtime",
        origin: "frontend_optimistic",
        transcript_chars: cleanTranscript.length,
      });

      await processTranscriptTurn(cleanTranscript, "microphone", turnId);
    },
    [
      emitDebug,
      emitStageTiming,
      isCurrentTurn,
      processTranscriptTurn,
      userId,
      vaultOwnerToken,
      voiceAvailable,
    ]
  );

  const handleTurnFailure = useCallback(
    (turnId: string, error: unknown) => {
      if (!isCurrentTurn(turnId)) {
        emitDebug("turn", "stale_turn_ignored", { reason: "turn_failed_for_old_turn" }, turnId);
        clearStageTiming(turnId);
        return;
      }
      const failure = resolveVoiceTurnErrorMeta(error);
      const message = failure.message || "Voice command failed";
      if (isAbortError(error) || failure.code === "client_aborted") {
        emitDebug(
          "turn",
          "turn_aborted",
          {
            reason: message,
            error_code: failure.code,
            error_stage: failure.stage,
            status: failure.status,
          },
          turnId
        );
        clearStageTiming(turnId);
        transitionVoiceState("idle", "turn_aborted", { turn_id: turnId });
        return;
      }
      emitDebug(
        "turn",
        "turn_failed",
        {
          reason: message,
          error_code: failure.code,
          error_stage: failure.stage,
          status: failure.status,
        },
        turnId
      );
      const isUnderstandFailure =
        failure.code === "request_timeout" ||
        failure.code === "stt_upstream_timeout" ||
        failure.code === "stt_upstream_error" ||
        failure.code === "planner_timeout" ||
        failure.code === "planner_error";
      if (isUnderstandFailure || isTimeoutError(error)) {
        emitDebug(
          "stt",
          "request_failed",
          {
            message,
            error_code: failure.code,
            error_stage: failure.stage,
            status: failure.status,
          },
          turnId
        );
        toast.error(userMessageForUnderstandFailure(failure.code));
        transitionVoiceState("retry_ready", "understand_failed_retry_path", {
          turn_id: turnId,
          error_code: failure.code,
          error_stage: failure.stage,
        });
        clearStageTiming(turnId);
        return;
      }
      setVoiceError(message, "Transcription failed. Try again.");
      clearStageTiming(turnId);
    },
    [clearStageTiming, emitDebug, isCurrentTurn, setVoiceError, transitionVoiceState]
  );

  const startListening = useCallback(async () => {
    if (!voiceAvailable) {
      const reason = voiceUnavailableReason || "Unlock your vault to use voice";
      toast.info(reason);
      return;
    }
    if (!userId || !vaultOwnerToken) {
      toast.info("Unlock your vault to use voice");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setVoiceError("Microphone API is not available", "Could not access microphone.");
      return;
    }

    abortInFlightVoiceRequests("new_mic_turn_started");
    const turnId = createVoiceTurnId();
    currentVoiceTurnIdRef.current = turnId;
    setVoiceErrorMessage(null);
    setProcessingStageText(null);
    setFinalTranscript("");
    setTranscriptPreview("Listening for your voice...");
    recordingCancelledRef.current = false;

    emitDebug(
      "turn",
      "turn_started",
      {
        source: "microphone",
        route: appRuntimeState?.route.pathname || "",
        screen: appRuntimeState?.route.screen || "",
        auth: appRuntimeState?.auth ?? null,
        vault: appRuntimeState?.vault ?? null,
        voice_available: voiceAvailable,
        voice_unavailable_reason: voiceUnavailableReason || null,
      },
      turnId
    );
    emitStageTiming(turnId, "mic_tapped", {
      source: "microphone",
      route: appRuntimeState?.route.pathname || "",
      screen: appRuntimeState?.route.screen || "",
    });
    transitionVoiceState("sheet_listening", "mic_tapped", { turn_id: turnId });

    try {
      if (navigator.permissions?.query) {
        try {
          const result = await navigator.permissions.query({ name: "microphone" as PermissionName });
          setMicPermissionStatus(result.state);
          emitDebug("mic", "permission_checked", { status: result.state }, turnId);
          if (result.state === "denied") {
            setVoiceError("Microphone permission denied", "Microphone permission denied");
            return;
          }
        } catch {
          setMicPermissionStatus("unknown");
          emitDebug("mic", "permission_checked", { status: "unknown" }, turnId);
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];
      await start(stream);
      recordingStartedAtRef.current = performance.now();
      stopRequestedAtRef.current = null;
      emitDebug("mic", "recording_started", { waveform_active: true }, turnId);
      emitStageTiming(turnId, "recording_started", { waveform_active: true });

      if (realtimeStreamingAvailable) {
        emitDebug("stt", "stream_session_request_started", { transport: "realtime_webrtc" }, turnId);
        const streamSessionStartedAt = performance.now();
        try {
          const sessionResponse = await ApiService.createKaiRealtimeSession({
            userId,
            vaultOwnerToken,
            voice: DEFAULT_TTS_VOICE,
            voiceTurnId: turnId,
          });
          const sessionPayload = (await sessionResponse.json().catch(() => ({}))) as {
            session_id?: unknown;
            client_secret?: unknown;
            client_secret_expires_at?: unknown;
            model?: unknown;
            voice?: unknown;
            detail?: unknown;
            error?: unknown;
          };

          if (!sessionResponse.ok) {
            const message =
              (typeof sessionPayload.detail === "string" && sessionPayload.detail) ||
              (typeof sessionPayload.error === "string" && sessionPayload.error) ||
              `Realtime session failed (${sessionResponse.status})`;
            throw createVoiceTurnError(message, {
              code: "request_error",
              stage: "stream_session",
              status: sessionResponse.status,
            });
          }

          const clientSecret =
            typeof sessionPayload.client_secret === "string" ? sessionPayload.client_secret.trim() : "";
          const model = typeof sessionPayload.model === "string" ? sessionPayload.model.trim() : "";
          const selectedVoice =
            typeof sessionPayload.voice === "string" && sessionPayload.voice.trim()
              ? sessionPayload.voice.trim()
              : DEFAULT_TTS_VOICE;
          if (!clientSecret || !model) {
            throw createVoiceTurnError("Realtime session payload was incomplete", {
              code: "request_error",
              stage: "stream_session",
            });
          }

          const realtimeClient = new VoiceRealtimeClient();
          realtimeClientRef.current = realtimeClient;
          realtimeStreamingTurnRef.current = turnId;
          await realtimeClient.connect({
            session: {
              clientSecret,
              model,
              voice: selectedVoice,
              sessionId:
                typeof sessionPayload.session_id === "string" ? sessionPayload.session_id : null,
            },
            localStream: stream,
            turnId,
            onTranscript: (event) => {
              if (!isCurrentTurn(turnId)) return;
              if (event.kind === "partial") {
                setTranscriptPreview(event.text);
                emitDebug(
                  "stt",
                  "stream_partial_transcript",
                  {
                    text: event.text,
                    item_id: event.itemId || null,
                  },
                  turnId
                );
              } else {
                setFinalTranscript(event.text);
                setTranscriptPreview(event.text);
                emitDebug(
                  "stt",
                  "stream_final_transcript",
                  {
                    text: event.text,
                    item_id: event.itemId || null,
                  },
                  turnId
                );
              }
            },
            onDebug: (event, payload) => {
              emitDebug("stt", event, payload || {}, turnId);
            },
          });
          emitDebug(
            "stt",
            "stream_session_started",
            {
              transport: "realtime_webrtc",
              model,
              voice: selectedVoice,
              session_id:
                typeof sessionPayload.session_id === "string" ? sessionPayload.session_id : null,
              client_secret_expires_at:
                typeof sessionPayload.client_secret_expires_at === "number"
                  ? sessionPayload.client_secret_expires_at
                  : null,
            },
            turnId
          );
          emitStageTiming(turnId, "stream_session_start", {
            transport: "realtime_webrtc",
            model,
            voice: selectedVoice,
          });
          return;
        } catch (error) {
          emitDebug(
            "stt",
            "stream_session_failed",
            {
              reason: error instanceof Error ? error.message : "stream_session_failed",
              attempted_transport: "realtime_webrtc",
              fallback: "batch_upload",
              fallback_transport: voiceTransportMode.mode,
              elapsed_ms: formatMs(performance.now() - streamSessionStartedAt),
            },
            turnId
          );
          const activeRealtimeClient = realtimeClientRef.current;
          realtimeClientRef.current = null;
          realtimeStreamingTurnRef.current = null;
          if (activeRealtimeClient) {
            void activeRealtimeClient.close({ stopLocalStream: false });
          }
        }
      }

      const preferredRecorderMime = selectRecorderMimeType();
      const recorder = preferredRecorderMime
        ? new MediaRecorder(stream, { mimeType: preferredRecorderMime })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      emitDebug(
        "mic",
        "recorder_configured",
        {
          requested_mime_type: preferredRecorderMime || null,
          recorder_mime_type: recorder.mimeType || null,
        },
        turnId
      );

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = (event: Event) => {
        const errorMessage =
          event && "type" in event ? `MediaRecorder error event: ${String(event.type)}` : "MediaRecorder failed";
        emitDebug("mic", "recording_failed", { reason: errorMessage }, turnId);
        setVoiceError(errorMessage, "Couldn’t access microphone");
        cleanupAudioResources("recorder_error");
      };

      recorder.onstop = () => {
        const stopToOnStopMs =
          stopRequestedAtRef.current != null
            ? formatMs(performance.now() - stopRequestedAtRef.current)
            : -1;
        const recordingDurationMs =
          recordingStartedAtRef.current != null
            ? formatMs(performance.now() - recordingStartedAtRef.current)
            : -1;
        const recordedChunks = [...audioChunksRef.current];
        const mimeType = normalizeVoiceAudioMimeType(
          recorder.mimeType || preferredRecorderMime || "audio/webm"
        );
        const audioBlob = new Blob(recordedChunks, { type: mimeType });
        emitStageTiming(turnId, "recording_stopped", {
          recording_duration_ms: recordingDurationMs,
          stop_to_onstop_ms: stopToOnStopMs,
          chunk_count: recordedChunks.length,
          blob_bytes: audioBlob.size,
        });
        emitStageTiming(turnId, "blob_finalized", {
          blob_bytes: audioBlob.size,
          mime_type: mimeType,
          chunk_count: recordedChunks.length,
        });

        emitDebug(
          "mic",
          "recording_stopped",
          {
            recording_duration_ms: recordingDurationMs,
            stop_to_onstop_ms: stopToOnStopMs,
            chunk_count: recordedChunks.length,
            blob_bytes: audioBlob.size,
            waveform_active: false,
          },
          turnId
        );
        cleanupAudioResources("recorder_stop");

        if (recordingCancelledRef.current) {
          transitionVoiceState("idle", "recording_cancelled", { turn_id: turnId });
          return;
        }
        if (audioBlob.size === 0) {
          emitDebug("mic", "recording_empty", {}, turnId);
          setVoiceError("Recorded audio was empty", "Couldn’t access microphone");
          transitionVoiceState("retry_ready", "recording_empty", { turn_id: turnId });
          return;
        }
        transitionVoiceState("processing_compact", "audio_submitted", { turn_id: turnId });
        void processVoiceRecording(audioBlob, turnId)
          .then(() => {
            if (!isCurrentTurn(turnId)) {
              emitDebug("turn", "stale_turn_ignored", { reason: "turn_completed_for_old_turn" }, turnId);
              clearStageTiming(turnId);
              return;
            }
            emitDebug("turn", "turn_completed", {}, turnId);
            clearStageTiming(turnId);
          })
          .catch((error: unknown) => {
            handleTurnFailure(turnId, error);
          });
      };

      // One finalized blob is more reliable for downstream STT than tiny chunk slices.
      recorder.start();
    } catch (error) {
      cleanupAudioResources("start_failed");
      if (isPermissionDeniedError(error)) {
        setMicPermissionStatus("denied");
        emitDebug("mic", "permission_checked", { status: "denied" }, turnId);
        setVoiceError("Microphone permission denied", "Microphone permission denied");
        transitionVoiceState("retry_ready", "permission_denied", { turn_id: turnId });
        return;
      }
      setVoiceError(
        (error as Error).message || "Could not access microphone",
        "Couldn’t access microphone"
      );
      transitionVoiceState("retry_ready", "mic_start_failed", { turn_id: turnId });
    }
  }, [
    abortInFlightVoiceRequests,
    appRuntimeState?.auth,
    appRuntimeState?.route.pathname,
    appRuntimeState?.route.screen,
    appRuntimeState?.vault,
    clearStageTiming,
    cleanupAudioResources,
    emitDebug,
    emitStageTiming,
    handleTurnFailure,
    isCurrentTurn,
    processVoiceRecording,
    realtimeStreamingAvailable,
    setVoiceError,
    start,
    transitionVoiceState,
    userId,
    vaultOwnerToken,
    voiceAvailable,
    voiceUnavailableReason,
  ]);

  const submitListening = useCallback(() => {
    const streamTurnId = realtimeStreamingTurnRef.current;
    const streamingClient = realtimeClientRef.current;
    if (streamTurnId && streamingClient && isCurrentTurn(streamTurnId)) {
      setProcessingStageText("Finalizing voice capture...");
      transitionVoiceState("sheet_submitting", "submit_clicked");
      stop();
      mediaStreamRef.current?.getAudioTracks?.().forEach((track) => {
        track.enabled = false;
      });
      emitStageTiming(streamTurnId, "recording_stopped", {
        recording_duration_ms:
          recordingStartedAtRef.current != null
            ? formatMs(performance.now() - recordingStartedAtRef.current)
            : -1,
        stream_mode: true,
      });
      emitStageTiming(streamTurnId, "blob_finalized", {
        blob_bytes: null,
        mime_type: "audio/realtime_stream",
        chunk_count: null,
      });
      transitionVoiceState("processing_compact", "audio_submitted", { turn_id: streamTurnId });
      void processRealtimeStreamingTurn(streamTurnId)
        .then(() => {
          if (!isCurrentTurn(streamTurnId)) {
            emitDebug(
              "turn",
              "stale_turn_ignored",
              { reason: "stream_turn_completed_for_old_turn" },
              streamTurnId
            );
            clearStageTiming(streamTurnId);
            closeRealtimeClient("stream_turn_completed");
            cleanupAudioResources("stream_turn_completed");
            return;
          }
          emitDebug("turn", "turn_completed", { stream_mode: true }, streamTurnId);
          clearStageTiming(streamTurnId);
          closeRealtimeClient("stream_turn_completed");
          cleanupAudioResources("stream_turn_completed");
        })
        .catch((error: unknown) => {
          handleTurnFailure(streamTurnId, error);
          closeRealtimeClient("stream_turn_failed");
          cleanupAudioResources("stream_turn_failed");
        });
      return;
    }

    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (recorder.state !== "recording" && recorder.state !== "paused") return;
    stopRequestedAtRef.current = performance.now();
    setProcessingStageText("Finalizing voice capture...");
    transitionVoiceState("sheet_submitting", "submit_clicked");
    recorder.stop();
  }, [
    clearStageTiming,
    cleanupAudioResources,
    closeRealtimeClient,
    emitDebug,
    emitStageTiming,
    handleTurnFailure,
    isCurrentTurn,
    processRealtimeStreamingTurn,
    stop,
    transitionVoiceState,
  ]);

  const togglePauseListening = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) {
      const stream = mediaStreamRef.current;
      const track = stream?.getAudioTracks?.()[0];
      if (!track) return;
      const shouldPause = track.enabled;
      track.enabled = !shouldPause;
      if (shouldPause) {
        transitionVoiceState("sheet_paused", "pause_clicked");
        emitDebug("mic", "recording_paused", { stream_mode: true });
        setTranscriptPreview("Listening paused. Tap resume to continue.");
      } else {
        transitionVoiceState("sheet_listening", "resume_clicked");
        emitDebug("mic", "recording_resumed", { stream_mode: true });
        setTranscriptPreview("Listening for your voice...");
      }
      return;
    }

    if (recorder.state === "recording") {
      recorder.pause();
      transitionVoiceState("sheet_paused", "pause_clicked");
      emitDebug("mic", "recording_paused", {});
      setTranscriptPreview("Listening paused. Tap resume to continue.");
      return;
    }
    if (recorder.state === "paused") {
      recorder.resume();
      transitionVoiceState("sheet_listening", "resume_clicked");
      emitDebug("mic", "recording_resumed", {});
      setTranscriptPreview("Listening for your voice...");
    }
  }, [emitDebug, transitionVoiceState]);

  const cancelListening = useCallback(() => {
    recordingCancelledRef.current = true;
    closeRealtimeClient("cancel_clicked");
    const recorder = mediaRecorderRef.current;
    if (recorder && (recorder.state === "recording" || recorder.state === "paused")) {
      recorder.stop();
    } else {
      cleanupAudioResources("cancel_without_active_recorder");
    }
    setProcessingStageText(null);
    setTranscriptPreview("");
    setFinalTranscript("");
    transitionVoiceState("idle", "cancel_clicked");
  }, [cleanupAudioResources, closeRealtimeClient, transitionVoiceState]);

  const handleExamplePrompt = useCallback(
    async (prompt: string) => {
      const trimmed = String(prompt || "").trim();
      if (!trimmed) return;
      abortInFlightVoiceRequests("example_prompt_turn_started");
      recordingCancelledRef.current = true;
      const recorder = mediaRecorderRef.current;
      if (recorder && (recorder.state === "recording" || recorder.state === "paused")) {
        recorder.stop();
      } else {
        cleanupAudioResources("example_prompt_without_recorder");
      }

      const turnId = createVoiceTurnId();
      currentVoiceTurnIdRef.current = turnId;
      setFinalTranscript(trimmed);
      setTranscriptPreview(trimmed);
      transitionVoiceState("processing_compact", "example_prompt_selected", {
        prompt: trimmed,
      });
      emitDebug(
        "turn",
        "turn_started",
        {
          source: "example_chip",
          prompt: trimmed,
          route: appRuntimeState?.route.pathname || "",
          screen: appRuntimeState?.route.screen || "",
        },
        turnId
      );

      try {
        await processTranscriptTurn(trimmed, "example_chip", turnId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Example prompt failed";
        setVoiceError(message, "Could not execute voice example.");
        transitionVoiceState("retry_ready", "example_prompt_failed");
      }
    },
    [
      abortInFlightVoiceRequests,
      appRuntimeState?.route.pathname,
      appRuntimeState?.route.screen,
      cleanupAudioResources,
      emitDebug,
      processTranscriptTurn,
      setVoiceError,
      transitionVoiceState,
    ]
  );

  const handleReplay = useCallback(async () => {
    const replayText = String(lastReplyText || "").trim();
    if (!replayText) return;
    const turnId = currentVoiceTurnIdRef.current || createVoiceTurnId();
    currentVoiceTurnIdRef.current = turnId;
    emitDebug("tts", "replay_clicked", { reply_chars: replayText.length }, turnId);
    emitStageTiming(turnId, "tts_started", {
      source: "replay",
      text_chars: replayText.length,
    });
    transitionVoiceState("speaking_compact", "replay_clicked", { turn_id: turnId });
    try {
      await speakAssistantMessage(replayText, turnId);
      const keepRetryEasy = lastResponseKind === "clarify" || lastResponseKind === "blocked";
      transitionVoiceState(keepRetryEasy ? "retry_ready" : "idle", "replay_complete", {
        response_kind: lastResponseKind,
      });
    } catch (error) {
      emitDebug("tts", "replay_failed", {
        reason: error instanceof Error ? error.message : "unknown_error",
      }, turnId);
      setVoiceError("Could not replay the last response.", "Could not replay the last response.");
    }
  }, [
    emitDebug,
    emitStageTiming,
    lastReplyText,
    lastResponseKind,
    setVoiceError,
    speakAssistantMessage,
    transitionVoiceState,
  ]);

  const handleStopSpeaking = useCallback(
    (event?: MouseEvent<HTMLButtonElement>) => {
      event?.preventDefault();
      event?.stopPropagation();
      const turnId = currentVoiceTurnIdRef.current || createVoiceTurnId();
      emitDebug("tts", "stop_clicked", {}, turnId);
      logVoiceMetric({
        metric: "tts_stop_button_usage",
        value: 1,
        turnId,
        tags: {},
      });
      ttsPlaybackManagerRef.current?.stop();
      const keepRetryEasy = lastResponseKind === "clarify" || lastResponseKind === "blocked";
      transitionVoiceState(keepRetryEasy ? "retry_ready" : "idle", "stop_speaking_clicked", {
        response_kind: lastResponseKind,
      });
    },
    [emitDebug, lastResponseKind, transitionVoiceState]
  );

  const handleRetry = useCallback(async () => {
    transitionVoiceState("idle", "retry_button_clicked");
    await startListening();
  }, [startListening, transitionVoiceState]);

  const handleMicTap = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (micHidden) return;
      if (micDisabled) {
        if (voiceUnavailableReason) {
          toast.info(voiceUnavailableReason);
        }
        return;
      }
      if (
        voiceUiState === "sheet_listening" ||
        voiceUiState === "sheet_paused" ||
        voiceUiState === "sheet_submitting"
      ) {
        submitListening();
        return;
      }
      if (voiceUiState === "processing_compact" || voiceUiState === "speaking_compact") {
        return;
      }
      await startListening();
    },
    [
      micDisabled,
      micHidden,
      startListening,
      submitListening,
      voiceUiState,
      voiceUnavailableReason,
    ]
  );

  useLayoutEffect(() => {
    const root = document.documentElement;
    const update = () => {
      const barHeight = barRef.current?.getBoundingClientRect().height ?? 48;
      const cssGap = Number.parseFloat(
        getComputedStyle(root).getPropertyValue("--kai-command-bottom-gap")
      );
      const gap = Number.isFinite(cssGap) ? cssGap : 12;
      const total = Math.round(barHeight + gap);
      root.style.setProperty("--kai-command-fixed-ui", `${total}px`);
    };

    update();
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => update()) : null;
    if (barRef.current && ro) {
      ro.observe(barRef.current);
    }

    window.addEventListener("resize", update, { passive: true });
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener(KAI_COMMAND_BAR_OPEN_EVENT, handleOpen as EventListener);
    return () => {
      window.removeEventListener(KAI_COMMAND_BAR_OPEN_EVENT, handleOpen as EventListener);
    };
  }, []);

  useEffect(() => {
    if (ttsPlaybackManagerRef.current) return;
    ttsPlaybackManagerRef.current = new VoiceTtsPlaybackManager(
      (state) => {
        setTtsPlaybackState(state);
        onTtsPlayingChange?.(state === "playing");
      },
      {
        onRequested: ({ voiceTurnId, text, voice }) => {
          if (voiceTurnId) {
            emitStageTiming(voiceTurnId, "frontend_request_started", {
              request: "tts",
              text_chars: text.length,
              requested_voice: voice || DEFAULT_TTS_VOICE,
            });
            emitStageTiming(voiceTurnId, "tts_started", {
              layer: "frontend",
              text_chars: text.length,
              requested_voice: voice || DEFAULT_TTS_VOICE,
            });
          }
          emitDebug(
            "tts",
            "requested",
            {
              text_chars: text.length,
              requested_voice: voice || DEFAULT_TTS_VOICE,
              transport: voiceTransportMode.mode,
              transport_reason: voiceTransportMode.reason,
            },
            voiceTurnId || null
          );
        },
        onTraceEvent: ({ voiceTurnId, event, metadata, finalize }) => {
          const turn = voiceTurnId || currentVoiceTurnIdRef.current;
          if (!turn) return;
          emitStageTiming(
            turn,
            event,
            {
              ...(metadata || {}),
            },
            finalize ? { finalize: true } : undefined
          );
          emitDebug("tts", event, metadata || {}, turn);
        },
        onAudioReceived: ({
          voiceTurnId,
          mimeType,
          audioBytesEstimate,
          source,
          model,
          voice,
          format,
          fallbackAttempted,
          candidateOrder,
          attempts,
        }) => {
          if (voiceTurnId) {
            emitStageTiming(voiceTurnId, "tts_payload_parsed", {
              layer: "frontend",
              source: "voice_tts_playback",
              route: "/api/kai/voice/tts",
              origin: "frontend_confirmed",
              source_path: source,
              mime_type: mimeType,
              audio_bytes_estimate: audioBytesEstimate,
            });
            // Compatibility alias retained for legacy dashboards.
            emitStageTiming(voiceTurnId, "tts_finished", {
              layer: "frontend",
              source,
              model: model || null,
              voice: voice || null,
              format: format || null,
              fallback_attempted: fallbackAttempted === true,
              candidate_order: candidateOrder || [],
              attempts: attempts || [],
              mime_type: mimeType,
              audio_bytes_estimate: audioBytesEstimate,
            });
          }
          emitDebug(
            "tts",
            "audio_received",
            {
              source,
              model: model || null,
              voice: voice || null,
              format: format || null,
              fallback_attempted: fallbackAttempted === true,
              candidate_order: candidateOrder || [],
              attempts: attempts || [],
              mime_type: mimeType,
              audio_bytes_estimate: audioBytesEstimate,
            },
            voiceTurnId || null
          );
          if (fallbackAttempted) {
            emitDebug(
              "tts",
              "model_fallback_used",
              {
                source,
                model: model || null,
                candidate_order: candidateOrder || [],
                attempts: attempts || [],
              },
              voiceTurnId || null
            );
          }
        },
        onPlaybackStarted: ({ voiceTurnId, source }) => {
          if (voiceTurnId) {
            // Compatibility alias retained for legacy dashboards.
            emitStageTiming(voiceTurnId, "playback_started", {
              source,
            });
          }
          emitDebug("tts", "playback_started", { source }, voiceTurnId || null);
          if (voiceTurnId) {
            logVoiceMetric({
              metric: "tts_start_success_rate",
              value: 1,
              turnId: voiceTurnId,
              tags: { source },
            });
          }
        },
        onPlaybackEnded: ({ voiceTurnId, source }) => {
          if (voiceTurnId) {
            // Compatibility alias retained for legacy dashboards.
            emitStageTiming(
              voiceTurnId,
              "playback_ended",
              {
                source,
              },
              { finalize: true }
            );
          }
          emitDebug("tts", "playback_ended", { source }, voiceTurnId || null);
        },
        onPlaybackFailed: ({ voiceTurnId, reason, source }) => {
          emitDebug("tts", "playback_failed", { reason, source: source || null }, voiceTurnId || null);
        },
        onFallbackActivated: ({
          voiceTurnId,
          source,
          reason,
          backendInFlight,
          backendResponseReceived,
          timeoutMs,
          requestedVoice,
        }) => {
          if (voiceTurnId) {
            // Compatibility alias retained for legacy dashboards.
            emitStageTiming(voiceTurnId, "tts_finished", {
              layer: "frontend",
              source,
              status: "fallback_activated",
              reason,
              backend_in_flight: backendInFlight,
              backend_response_received: backendResponseReceived,
              timeout_ms: timeoutMs,
              requested_voice: requestedVoice || DEFAULT_TTS_VOICE,
            });
          }
          emitDebug(
            "tts",
            "fallback_activated",
            {
              source,
              reason,
              backend_in_flight: backendInFlight,
              backend_response_received: backendResponseReceived,
              timeout_ms: timeoutMs,
              requested_voice: requestedVoice || DEFAULT_TTS_VOICE,
            },
            voiceTurnId || null
          );
        },
        onStopped: ({ voiceTurnId, source }) => {
          emitDebug("tts", "playback_stopped", { source: source || null }, voiceTurnId || null);
        },
      }
    );
  }, [
    emitDebug,
    emitStageTiming,
    onTtsPlayingChange,
    voiceTransportMode.mode,
    voiceTransportMode.reason,
  ]);

  useEffect(() => {
    return () => {
      recordingCancelledRef.current = true;
      abortInFlightVoiceRequests("component_unmount");
      cleanupAudioResources("component_unmount");
      ttsPlaybackManagerRef.current?.stop();
    };
  }, [abortInFlightVoiceRequests, cleanupAudioResources]);

  useEffect(() => {
    if (voiceUiState !== "error_terminal") return;
    const timer = window.setTimeout(() => {
      setVoiceErrorMessage(null);
      transitionVoiceState("idle", "error_recovered");
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [transitionVoiceState, voiceUiState]);

  useEffect(() => {
    if (voiceUiState !== "sheet_listening") return;
    const timer = window.setInterval(() => {
      const elapsedMs =
        recordingStartedAtRef.current != null ? performance.now() - recordingStartedAtRef.current : 0;
      const elapsedSec = Math.max(0, Math.floor(elapsedMs / 1000));
      const activity = smoothedLevel > 0.06 ? "Audio detected..." : "Listening...";
      setTranscriptPreview(`${activity} (${elapsedSec}s)`);
    }, 280);
    return () => {
      window.clearInterval(timer);
    };
  }, [smoothedLevel, voiceUiState]);

  useEffect(() => {
    if (voiceUiState !== "speaking_compact") return;
    if (ttsPlaybackState === "loading") {
      setProcessingStageText("Generating voice reply...");
      return;
    }
    if (ttsPlaybackState === "playing") {
      setProcessingStageText("Kai is speaking...");
    }
  }, [ttsPlaybackState, voiceUiState]);

  const showVoiceSheet =
    voiceUiState === "sheet_listening" ||
    voiceUiState === "sheet_paused";
  const showProcessingCompact =
    voiceUiState === "processing_compact" || voiceUiState === "sheet_submitting";
  const showSpeakingCompact = voiceUiState === "speaking_compact";
  const showRetryCompact = voiceUiState === "retry_ready";
  const showBaseCommandSurface =
    !showVoiceSheet && !showProcessingCompact && !showSpeakingCompact && !showRetryCompact;
  const isElevatedVoiceSurface =
    showVoiceSheet || showProcessingCompact || showSpeakingCompact || showRetryCompact;

  const compactLabel = useMemo(() => {
    if (showProcessingCompact) return "Processing your voice command...";
    if (showSpeakingCompact) return "Kai is responding...";
    if (showRetryCompact) return STT_UNCLEAR_MESSAGE;
    return "";
  }, [showProcessingCompact, showRetryCompact, showSpeakingCompact]);

  const commandBarBottomOffset = isElevatedVoiceSurface
    ? "calc(var(--app-bottom-inset) + 58px)"
    : "calc(var(--app-bottom-inset) + var(--kai-command-bottom-gap, 18px))";

  return (
    <>
      <div
        className={cn(
          "fixed inset-x-0 z-[136] flex justify-center px-4",
          hideBottomChrome ? "pointer-events-none opacity-0" : "pointer-events-none opacity-100"
        )}
        style={{
          bottom: commandBarBottomOffset,
          transform: `translate3d(0, calc(${100 * hideBottomChromeProgress}% + ${12 * hideBottomChromeProgress}px), 0)`,
          opacity: Math.max(0, 1 - hideBottomChromeProgress),
        }}
      >
        <div ref={barRef} className="pointer-events-auto w-full max-w-[460px]">
          {showVoiceSheet ? (
            <VoiceConsoleSheet
              open={showVoiceSheet}
              paused={voiceUiState === "sheet_paused"}
              submitting={false}
              transcriptPreview={transcriptPreview}
              smoothedLevel={smoothedLevel}
              onPauseToggle={togglePauseListening}
              onSubmit={submitListening}
              onCancel={cancelListening}
              onExamplePrompt={handleExamplePrompt}
            />
          ) : showProcessingCompact || showSpeakingCompact || showRetryCompact ? (
            <VoiceCompactStatus
              mode={showProcessingCompact ? "processing" : showSpeakingCompact ? "speaking" : "retry_ready"}
              label={compactLabel}
              stageText={processingStageText}
              replyText={showSpeakingCompact || showRetryCompact ? lastReplyText || finalTranscript : finalTranscript}
              smoothedLevel={smoothedLevel}
              onStopSpeaking={
                showSpeakingCompact && ttsPlaybackState === "playing"
                  ? () => handleStopSpeaking()
                  : undefined
              }
              onReplay={showSpeakingCompact && ttsPlaybackState === "playing" ? handleReplay : undefined}
              onRetry={showRetryCompact ? handleRetry : undefined}
            />
          ) : showBaseCommandSurface ? (
            <div className="relative h-12">
              <Button
                variant="none"
                effect="fade"
                fullWidth
                size="default"
                data-tour-id="kai-command-bar"
                className={cn(
                  "h-12 justify-start rounded-full px-4 pr-12 text-sm text-muted-foreground",
                  disabled && "pointer-events-none opacity-50"
                )}
                onClick={() => setOpen(true)}
              >
                <Icon icon={Search} size="sm" className="mr-2 text-muted-foreground" />
                Analyze, dashboard, consent with Kai
              </Button>
              {!micHidden ? (
                <button
                  type="button"
                  aria-label="Start voice recording"
                  data-no-route-swipe
                  disabled={micDisabled}
                  title={micDisabled ? voiceUnavailableReason : "Start voice recording"}
                  className={cn(
                    "absolute right-2 top-1/2 z-10 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground",
                    micDisabled && "cursor-not-allowed opacity-60"
                  )}
                  onClick={handleMicTap}
                >
                  <Icon icon={Mic} size="sm" />
                </button>
              ) : null}
            </div>
          ) : null}

          {showBaseCommandSurface && voiceVisibilityMode === "disabled" && voiceUnavailableReason ? (
            <p className="mt-1 text-center text-[10px] text-muted-foreground">{voiceUnavailableReason}</p>
          ) : null}
          {voiceErrorMessage ? (
            <p className="mt-1 text-center text-[10px] text-destructive">{voiceErrorMessage}</p>
          ) : null}
        </div>
      </div>

      <KaiCommandPalette
        open={open}
        onOpenChange={setOpen}
        onCommand={onCommand}
        hasPortfolioData={hasPortfolioData}
        portfolioTickers={portfolioTickers}
      />

      <VoiceDebugDrawer
        enabled={DEV_VOICE_DEBUG_ENABLED}
        currentState={voiceUiState}
        sessionId={voiceSessionIdRef.current}
        route={appRuntimeState?.route.pathname || ""}
        screen={appRuntimeState?.route.screen || ""}
        authStatus={appRuntimeState?.auth.signed_in ? "signed_in" : "signed_out"}
        vaultStatus={
          appRuntimeState?.vault.unlocked && appRuntimeState?.vault.token_valid
            ? "unlocked_valid"
            : "locked_or_invalid"
        }
        voiceAvailabilityReason={voiceAvailable ? "available" : voiceUnavailableReason || "unavailable"}
      />

      {DEV_VOICE_DEBUG_ENABLED ? (
        <div className="pointer-events-none fixed bottom-[108px] right-4 z-[150] rounded-full border border-border/60 bg-background/90 px-2 py-1 text-[10px] text-muted-foreground shadow">
          <span className="pointer-events-none inline-flex items-center gap-1">
            <Bug className="h-3 w-3" />
            {voiceUiState} | {ttsPlaybackState} | mic:{micPermissionStatus}
          </span>
        </div>
      ) : null}

      {DEV_VOICE_DEBUG_ENABLED && (rawRms > 0 || normalizedLevel > 0) ? (
        <div className="pointer-events-none fixed bottom-[90px] left-1/2 z-[150] -translate-x-1/2 rounded-full bg-background/85 px-3 py-1 text-[10px] text-muted-foreground shadow">
          raw={rawRms.toFixed(4)} level={normalizedLevel.toFixed(3)} smoothed={smoothedLevel.toFixed(3)}
        </div>
      ) : null}
    </>
  );
}
