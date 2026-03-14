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
const DEV_VOICE_DEBUG_ENABLED =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_KAI_VOICE_DEBUG === "1";

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

  const { rawRms, normalizedLevel, smoothedLevel, start, stop } = useAmplitudeMeter({
    sensitivity: 11,
    smoothingFactor: 0.2,
    logIntervalMs: 500,
  });

  const micHidden = voiceVisibilityMode === "hidden";
  const micDisabled = disabled || !voiceAvailable || voiceVisibilityMode === "disabled";
  const voiceTransportMode = ApiService.getVoiceTransportMode();

  useEffect(() => {
    console.info(
      "[VOICE_DIAG] planner_normalization_version=%s transport_mode=%s transport_reason=%s tts_voice=%s",
      VOICE_PLAN_NORMALIZATION_VERSION,
      voiceTransportMode.mode,
      voiceTransportMode.reason,
      DEFAULT_TTS_VOICE
    );
  }, [voiceTransportMode.mode, voiceTransportMode.reason]);

  const emitDebug = useCallback(
    (
      stage: "turn" | "mic" | "stt" | "planner" | "dispatch" | "tts" | "ui_fsm",
      event: string,
      payload: Record<string, unknown> = {},
      turnId?: string | null
    ) => {
      const resolvedTurn = turnId || currentVoiceTurnIdRef.current || "no_turn";
      appendDebugEvent({
        turnId: resolvedTurn,
        sessionId: voiceSessionIdRef.current,
        stage,
        event,
        payload,
      });
    },
    [appendDebugEvent]
  );

  const isCurrentTurn = useCallback((turnId: string): boolean => {
    if (!turnId) return false;
    return currentVoiceTurnIdRef.current === turnId;
  }, []);

  const abortInFlightUnderstand = useCallback(
    (reason: string) => {
      const active = understandAbortControllerRef.current;
      if (!active) return;
      active.abort(reason);
      understandAbortControllerRef.current = null;
      emitDebug("stt", "request_aborted", { reason }, currentVoiceTurnIdRef.current);
    },
    [emitDebug]
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
        stage,
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
    [emitDebug]
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
    [emitDebug, stop]
  );

  const speakAssistantMessage = useCallback(
    async (text: string, voiceTurnId?: string) => {
      const manager = ttsPlaybackManagerRef.current;
      if (!manager) return;
      const cleanText = String(text || "").trim();
      if (!cleanText) return;

      if (!userId || !vaultOwnerToken) {
        await manager.speakLocally(cleanText, voiceTurnId);
        return;
      }

      await manager.speak({
        userId,
        vaultOwnerToken,
        text: cleanText,
        voice: DEFAULT_TTS_VOICE,
        voiceTurnId,
      });
    },
    [userId, vaultOwnerToken]
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
        emitStageTiming(turnId, "planner_started", {
          source,
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
        const planResponse = await withTimeout(
          ApiService.planKaiVoiceIntent({
            userId,
            vaultOwnerToken,
            transcript: cleanTranscript,
            context: voiceContext,
            appState: appRuntimeState,
            voiceTurnId: turnId,
          }),
          12000,
          "VOICE_PLAN_TIMEOUT"
        );
        planElapsedMs = formatMs(performance.now() - planStartedAt);
        rawPlanPayload = (await planResponse.json().catch(() => ({}))) as VoicePlannerRawPayload;

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
      emitStageTiming(turnId, "frontend_request_started", {
        request: "understand",
        audio_bytes: audioBlob.size,
        transport: voiceTransportMode.mode,
        transport_reason: voiceTransportMode.reason,
      });
      emitStageTiming(turnId, "stt_started", {
        layer: "frontend_combined",
        audio_bytes: audioBlob.size,
      });
      emitStageTiming(turnId, "planner_started", {
        layer: "frontend_combined",
        audio_bytes: audioBlob.size,
      });
      emitDebug(
        "stt",
        "request_started",
        {
          audio_bytes: audioBlob.size,
          transport: voiceTransportMode.mode,
          transport_reason: voiceTransportMode.reason,
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
          18000,
          "VOICE_UNDERSTAND_TIMEOUT",
          () => understandAbortController.abort("VOICE_UNDERSTAND_TIMEOUT")
        );
        if (!isCurrentTurn(turnId)) return;
        const sttElapsedMs = formatMs(performance.now() - sttStartedAt);
        const understandPayload = (await understandResponse.json().catch(() => ({}))) as {
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
          const message =
            (understandResponse.status === 401 || understandResponse.status === 403
              ? "Unlock your vault to use voice."
              : null) ||
            (typeof understandPayload.detail === "string" && understandPayload.detail) ||
            (typeof understandPayload.error === "string" && understandPayload.error) ||
            "Voice understanding failed";
          emitDebug("stt", "request_failed", { message, status: understandResponse.status }, turnId);
          throw new Error(message);
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
        emitStageTiming(turnId, "stt_finished", {
          layer: "frontend_combined",
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

  const startListening = useCallback(async () => {
    if (!voiceAvailable) {
      const reason = voiceUnavailableReason || "Unlock your vault to use voice";
      toast.info(reason);
      return;
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setVoiceError("Microphone API is not available", "Could not access microphone.");
      return;
    }

    abortInFlightUnderstand("new_mic_turn_started");
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
      emitDebug("mic", "recording_started", { waveform_active: true }, turnId);
      emitStageTiming(turnId, "recording_started", { waveform_active: true });

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recordingStartedAtRef.current = performance.now();
      stopRequestedAtRef.current = null;

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
        const mimeType = recorder.mimeType || "audio/webm";
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
              clearStageTiming(turnId);
              return;
            }
            emitDebug("turn", "turn_completed", {}, turnId);
            clearStageTiming(turnId);
          })
          .catch(async (error: unknown) => {
            if (!isCurrentTurn(turnId)) {
              clearStageTiming(turnId);
              return;
            }
            const message = error instanceof Error ? error.message : "Voice command failed";
            if (isAbortError(error)) {
              emitDebug("turn", "turn_aborted", { reason: message }, turnId);
              clearStageTiming(turnId);
              transitionVoiceState("idle", "turn_aborted", { turn_id: turnId });
              return;
            }
            emitDebug("turn", "turn_failed", { reason: message }, turnId);
            if (isTimeoutError(error)) {
              toast.error(NETWORK_RETRY_MESSAGE);
              try {
                const manager = ttsPlaybackManagerRef.current;
                if (manager) {
                  await manager.speakLocally(NETWORK_RETRY_MESSAGE, turnId);
                }
              } catch {
                // noop
              }
              transitionVoiceState("retry_ready", "timeout_retry_path", { turn_id: turnId });
              clearStageTiming(turnId);
              return;
            }
            setVoiceError(message, "Transcription failed. Try again.");
            transitionVoiceState("retry_ready", "turn_failed_retry", { turn_id: turnId });
            clearStageTiming(turnId);
          });
      };

      recorder.start(200);
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
    abortInFlightUnderstand,
    appRuntimeState?.auth,
    appRuntimeState?.route.pathname,
    appRuntimeState?.route.screen,
    appRuntimeState?.vault,
    clearStageTiming,
    cleanupAudioResources,
    emitDebug,
    emitStageTiming,
    isCurrentTurn,
    processVoiceRecording,
    setVoiceError,
    start,
    transitionVoiceState,
    voiceAvailable,
    voiceUnavailableReason,
  ]);

  const submitListening = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (recorder.state !== "recording" && recorder.state !== "paused") return;
    stopRequestedAtRef.current = performance.now();
    setProcessingStageText("Finalizing voice capture...");
    transitionVoiceState("sheet_submitting", "submit_clicked");
    recorder.stop();
  }, [transitionVoiceState]);

  const togglePauseListening = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

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
  }, [cleanupAudioResources, transitionVoiceState]);

  const handleExamplePrompt = useCallback(
    async (prompt: string) => {
      const trimmed = String(prompt || "").trim();
      if (!trimmed) return;
      abortInFlightUnderstand("example_prompt_turn_started");
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
      abortInFlightUnderstand,
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
        onAudioReceived: ({
          voiceTurnId,
          mimeType,
          audioBytesEstimate,
          source,
          model,
          voice,
          format,
        }) => {
          if (voiceTurnId) {
            emitStageTiming(voiceTurnId, "tts_finished", {
              layer: "frontend",
              source,
              model: model || null,
              voice: voice || null,
              format: format || null,
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
              mime_type: mimeType,
              audio_bytes_estimate: audioBytesEstimate,
            },
            voiceTurnId || null
          );
        },
        onPlaybackStarted: ({ voiceTurnId, source }) => {
          if (voiceTurnId) {
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
      abortInFlightUnderstand("component_unmount");
      cleanupAudioResources("component_unmount");
      ttsPlaybackManagerRef.current?.stop();
    };
  }, [abortInFlightUnderstand, cleanupAudioResources]);

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
