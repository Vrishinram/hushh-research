"use client";

import { ApiService } from "@/lib/services/api-service";

export type VoiceTtsPlaybackState = "idle" | "loading" | "playing";

export type VoiceSpeakInput = {
  userId: string;
  vaultOwnerToken: string;
  text: string;
  voice?: string;
  voiceTurnId?: string;
  timeoutMs?: number;
  adapter?: "backend_batch_tts" | "realtime_stream_tts";
  realtimeAdapter?: {
    speak: (input: {
      text: string;
      voice?: string;
      voiceTurnId?: string;
      timeoutMs?: number;
      onFirstAudio?: () => void;
      onPlaybackStarted?: () => void;
      onPlaybackEnded?: () => void;
    }) => Promise<void>;
    cancel?: () => void;
  };
};

export type VoicePlaybackSource =
  | "backend_openai_audio"
  | "browser_speech_synthesis"
  | "realtime_stream_tts";

function shouldUseBrowserTtsFallback(errorMessage: string): boolean {
  const normalized = String(errorMessage || "").trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === "voice_tts_timeout") return true;
  if (normalized.startsWith("voice_tts_http_5")) return true;
  if (normalized.includes("networkerror")) return true;
  if (normalized.includes("failed to fetch")) return true;
  if (normalized.includes("aborterror")) return true;
  return false;
}

type VoiceTtsLifecycleHandlers = {
  onRequested?: (payload: { voiceTurnId?: string; text: string; voice?: string }) => void;
  onAudioReceived?: (payload: {
    voiceTurnId?: string;
    mimeType: string;
    audioBytesEstimate: number;
    source: VoicePlaybackSource;
    model?: string;
    voice?: string;
    format?: string;
    fallbackAttempted?: boolean;
    candidateOrder?: string[];
    attempts?: Array<{
      model?: string;
      status_code?: number;
      elapsed_ms?: number;
      result?: string;
      error?: string;
      next_model?: string | null;
    }>;
  }) => void;
  onPlaybackStarted?: (payload: { voiceTurnId?: string; source: VoicePlaybackSource }) => void;
  onPlaybackEnded?: (payload: { voiceTurnId?: string; source: VoicePlaybackSource }) => void;
  onPlaybackFailed?: (payload: {
    voiceTurnId?: string;
    reason: string;
    source?: VoicePlaybackSource;
  }) => void;
  onFallbackActivated?: (payload: {
    voiceTurnId?: string;
    source: "browser_speech_synthesis";
    reason: string;
    backendInFlight: boolean;
    backendResponseReceived: boolean;
    timeoutMs: number;
    requestedVoice?: string;
  }) => void;
  onStopped?: (payload: { voiceTurnId?: string; source?: VoicePlaybackSource }) => void;
  onTraceEvent?: (payload: {
    voiceTurnId?: string;
    event: string;
    metadata?: Record<string, unknown>;
    finalize?: boolean;
  }) => void;
};

function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toBlobFromBytes(bytes: Uint8Array, mimeType: string): Blob {
  const stableCopy = new Uint8Array(bytes.byteLength);
  stableCopy.set(bytes);
  return new Blob([stableCopy.buffer], { type: mimeType || "audio/mpeg" });
}

function resolveTtsTimeoutMs(explicitTimeout?: number): number {
  if (typeof explicitTimeout === "number" && Number.isFinite(explicitTimeout) && explicitTimeout > 0) {
    return Math.round(explicitTimeout);
  }
  const fromEnv = Number(process.env.NEXT_PUBLIC_KAI_VOICE_TTS_TIMEOUT_MS || "");
  if (Number.isFinite(fromEnv) && fromEnv >= 4000) {
    return Math.round(fromEnv);
  }
  return 20000;
}

export class VoiceTtsPlaybackManager {
  private audio: HTMLAudioElement | null = null;
  private audioUrl: string | null = null;
  private activeRunId = 0;
  private state: VoiceTtsPlaybackState = "idle";
  private usingSpeechSynthesis = false;
  private playbackCompletionResolver: (() => void) | null = null;
  private readonly onStateChange?: (state: VoiceTtsPlaybackState) => void;
  private readonly lifecycleHandlers?: VoiceTtsLifecycleHandlers;
  private activeVoiceTurnId: string | undefined;
  private activePlaybackSource: VoicePlaybackSource | undefined;
  private inFlightTtsAbortController: AbortController | null = null;
  private inFlightRealtimeCancel: (() => void) | null = null;
  private traceTimingByTurn = new Map<string, { turnStartMs: number; lastStageMs: number }>();

  constructor(
    onStateChange?: (state: VoiceTtsPlaybackState) => void,
    lifecycleHandlers?: VoiceTtsLifecycleHandlers
  ) {
    this.onStateChange = onStateChange;
    this.lifecycleHandlers = lifecycleHandlers;
  }

  private setState(next: VoiceTtsPlaybackState): void {
    if (this.state === next) return;
    this.state = next;
    this.onStateChange?.(next);
  }

  private isRunActive(runId: number): boolean {
    return runId === this.activeRunId;
  }

  private emitTraceEvent(
    event: string,
    metadata: Record<string, unknown> = {},
    options?: { voiceTurnId?: string; finalize?: boolean }
  ): void {
    const turnId = options?.voiceTurnId || this.activeVoiceTurnId;
    const nowMs = performance.now();
    const timestampIso = new Date().toISOString();
    let sincePrevMs = 0;
    let sinceTurnStartMs = 0;
    if (turnId) {
      const existing = this.traceTimingByTurn.get(turnId);
      if (!existing) {
        this.traceTimingByTurn.set(turnId, {
          turnStartMs: nowMs,
          lastStageMs: nowMs,
        });
      }
      const current = this.traceTimingByTurn.get(turnId)!;
      sincePrevMs = existing ? Math.max(0, Math.round(nowMs - existing.lastStageMs)) : 0;
      sinceTurnStartMs = Math.max(0, Math.round(nowMs - current.turnStartMs));
      this.traceTimingByTurn.set(turnId, {
        turnStartMs: current.turnStartMs,
        lastStageMs: nowMs,
      });
      if (options?.finalize) {
        this.traceTimingByTurn.delete(turnId);
      }
    }
    this.lifecycleHandlers?.onTraceEvent?.({
      voiceTurnId: turnId,
      event,
      metadata: {
        event,
        timestamp_iso: timestampIso,
        layer: "frontend",
        source:
          typeof metadata.source === "string" && metadata.source.trim()
            ? metadata.source
            : "voice_tts_playback",
        since_prev_ms: sincePrevMs,
        since_turn_start_ms: sinceTurnStartMs,
        ...metadata,
      },
      finalize: options?.finalize,
    });
  }

  private async playWithSpeechSynthesis(
    runId: number,
    text: string,
    fallbackReason: string,
    fallbackMeta: {
      backendInFlight: boolean;
      backendResponseReceived: boolean;
      timeoutMs: number;
      requestedVoice?: string;
    }
  ): Promise<boolean> {
    if (typeof window === "undefined") return false;
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      return false;
    }
    return new Promise<boolean>((resolve) => {
      this.usingSpeechSynthesis = true;
      this.activePlaybackSource = "browser_speech_synthesis";
      this.emitTraceEvent(
        "tts_fallback_triggered",
        {
          route: "/api/kai/voice/tts",
          fallback_triggered: true,
          fallback_reason: fallbackReason,
          backend_in_flight: fallbackMeta.backendInFlight,
          backend_response_received: fallbackMeta.backendResponseReceived,
          timeout_ms: fallbackMeta.timeoutMs,
          requested_voice: fallbackMeta.requestedVoice || null,
          source: "voice_tts_playback",
        },
        { voiceTurnId: this.activeVoiceTurnId }
      );
      this.lifecycleHandlers?.onFallbackActivated?.({
        voiceTurnId: this.activeVoiceTurnId,
        source: "browser_speech_synthesis",
        reason: fallbackReason,
        backendInFlight: fallbackMeta.backendInFlight,
        backendResponseReceived: fallbackMeta.backendResponseReceived,
        timeoutMs: fallbackMeta.timeoutMs,
        requestedVoice: fallbackMeta.requestedVoice,
      });
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onstart = () => {
        if (!this.isRunActive(runId)) return;
        this.emitTraceEvent(
          "tts_fallback_playback_started",
          {
            route: "/api/kai/voice/tts",
            playback_source: "browser_speech_synthesis",
            source: "voice_tts_playback",
          },
          { voiceTurnId: this.activeVoiceTurnId }
        );
        this.setState("playing");
        this.lifecycleHandlers?.onPlaybackStarted?.({
          voiceTurnId: this.activeVoiceTurnId,
          source: "browser_speech_synthesis",
        });
      };
      utterance.onend = () => {
        if (!this.isRunActive(runId)) {
          resolve(true);
          return;
        }
        this.emitTraceEvent(
          "tts_fallback_playback_ended",
          {
            route: "/api/kai/voice/tts",
            playback_source: "browser_speech_synthesis",
            source: "voice_tts_playback",
          },
          { voiceTurnId: this.activeVoiceTurnId, finalize: true }
        );
        this.usingSpeechSynthesis = false;
        this.setState("idle");
        this.lifecycleHandlers?.onPlaybackEnded?.({
          voiceTurnId: this.activeVoiceTurnId,
          source: "browser_speech_synthesis",
        });
        resolve(true);
      };
      utterance.onerror = () => {
        if (!this.isRunActive(runId)) {
          resolve(false);
          return;
        }
        this.emitTraceEvent(
          "tts_fallback_playback_failed",
          {
            route: "/api/kai/voice/tts",
            playback_source: "browser_speech_synthesis",
            source: "voice_tts_playback",
          },
          { voiceTurnId: this.activeVoiceTurnId, finalize: true }
        );
        this.usingSpeechSynthesis = false;
        this.setState("idle");
        resolve(false);
      };
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    });
  }

  stop(): void {
    this.activeRunId += 1;
    if (this.inFlightTtsAbortController) {
      this.inFlightTtsAbortController.abort("VOICE_TTS_STOPPED");
      this.inFlightTtsAbortController = null;
    }
    if (this.inFlightRealtimeCancel) {
      this.inFlightRealtimeCancel();
      this.inFlightRealtimeCancel = null;
    }
    if (this.playbackCompletionResolver) {
      this.playbackCompletionResolver();
      this.playbackCompletionResolver = null;
    }

    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
    }
    if (this.usingSpeechSynthesis && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      this.usingSpeechSynthesis = false;
    }

    this.lifecycleHandlers?.onStopped?.({
      voiceTurnId: this.activeVoiceTurnId,
      source: this.activePlaybackSource,
    });
    this.emitTraceEvent(
      "tts_playback_stopped",
      {
        route: "/api/kai/voice/tts",
        playback_source: this.activePlaybackSource || null,
        source: "voice_tts_playback",
      },
      { voiceTurnId: this.activeVoiceTurnId, finalize: true }
    );
    this.activeVoiceTurnId = undefined;
    this.activePlaybackSource = undefined;
    this.setState("idle");
  }

  async speak(input: VoiceSpeakInput): Promise<void> {
    const text = String(input.text || "").trim();
    if (!text) return;

    this.stop();
    const runId = this.activeRunId;
    this.activeVoiceTurnId = input.voiceTurnId;
    this.setState("loading");
    this.lifecycleHandlers?.onRequested?.({
      voiceTurnId: input.voiceTurnId,
      text,
      voice: input.voice,
    });
    this.emitTraceEvent(
      "tts_request_prepared",
      {
        route: "/api/kai/voice/tts",
        origin: "frontend_optimistic",
        text_chars: text.length,
        requested_voice: input.voice || null,
        adapter: input.adapter || "backend_batch_tts",
        source: "voice_tts_playback",
      },
      { voiceTurnId: input.voiceTurnId }
    );

    if (input.adapter === "realtime_stream_tts") {
      if (!input.realtimeAdapter) {
        this.setState("idle");
        throw new Error("VOICE_TTS_REALTIME_ADAPTER_MISSING");
      }
      this.emitTraceEvent(
        "tts_request_sent",
        {
          route: "realtime_stream",
          origin: "frontend_optimistic",
          adapter: "realtime_stream_tts",
          source: "voice_tts_playback",
        },
        { voiceTurnId: input.voiceTurnId }
      );
      this.activePlaybackSource = "realtime_stream_tts";
      this.inFlightRealtimeCancel = () => {
        try {
          input.realtimeAdapter?.cancel?.();
        } catch {
          // noop
        }
      };
      try {
        await input.realtimeAdapter.speak({
          text,
          voice: input.voice,
          voiceTurnId: input.voiceTurnId,
          timeoutMs: input.timeoutMs,
          onFirstAudio: () => {
            this.emitTraceEvent(
              "tts_response_body_received",
              {
                route: "realtime_stream",
                origin: "backend_confirmed",
                adapter: "realtime_stream_tts",
                source: "voice_tts_playback",
              },
              { voiceTurnId: input.voiceTurnId }
            );
            this.lifecycleHandlers?.onAudioReceived?.({
              voiceTurnId: input.voiceTurnId,
              mimeType: "audio/realtime",
              audioBytesEstimate: 0,
              source: "realtime_stream_tts",
              model: "realtime_stream",
              voice: input.voice,
              format: "stream",
            });
          },
          onPlaybackStarted: () => {
            if (!this.isRunActive(runId)) return;
            this.emitTraceEvent(
              "tts_playback_started",
              {
                route: "realtime_stream",
                playback_source: "realtime_stream_tts",
                source: "voice_tts_playback",
              },
              { voiceTurnId: input.voiceTurnId }
            );
            this.setState("playing");
            this.lifecycleHandlers?.onPlaybackStarted?.({
              voiceTurnId: input.voiceTurnId,
              source: "realtime_stream_tts",
            });
          },
          onPlaybackEnded: () => {
            if (!this.isRunActive(runId)) return;
            this.emitTraceEvent(
              "tts_playback_ended",
              {
                route: "realtime_stream",
                playback_source: "realtime_stream_tts",
                source: "voice_tts_playback",
              },
              { voiceTurnId: input.voiceTurnId, finalize: true }
            );
            this.setState("idle");
            this.lifecycleHandlers?.onPlaybackEnded?.({
              voiceTurnId: input.voiceTurnId,
              source: "realtime_stream_tts",
            });
          },
        });
        if (!this.isRunActive(runId)) return;
        this.emitTraceEvent(
          "tts_stream_protocol_done",
          {
            route: "realtime_stream",
            adapter: "realtime_stream_tts",
            source: "voice_tts_playback",
          },
          { voiceTurnId: input.voiceTurnId }
        );
        this.setState("idle");
        return;
      } catch (error) {
        if (!this.isRunActive(runId)) return;
        this.setState("idle");
        this.lifecycleHandlers?.onPlaybackFailed?.({
          voiceTurnId: input.voiceTurnId,
          reason: error instanceof Error ? error.message : "VOICE_STREAM_TTS_FAILED",
          source: "realtime_stream_tts",
        });
        throw error;
      } finally {
        if (this.inFlightRealtimeCancel) {
          this.inFlightRealtimeCancel = null;
        }
      }
    }

    const timeoutMs = resolveTtsTimeoutMs(input.timeoutMs);
    const ttsAbortController = new AbortController();
    this.inFlightTtsAbortController = ttsAbortController;
    let backendResponseReceived = false;

    try {
      this.emitTraceEvent(
        "tts_request_sent",
        {
          route: "/api/kai/voice/tts",
          origin: "frontend_optimistic",
          adapter: "backend_batch_tts",
          timeout_ms: timeoutMs,
          source: "voice_tts_playback",
        },
        { voiceTurnId: input.voiceTurnId }
      );
      const response = await new Promise<Response>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          if (!ttsAbortController.signal.aborted) {
            ttsAbortController.abort("VOICE_TTS_TIMEOUT");
          }
          reject(new Error("VOICE_TTS_TIMEOUT"));
        }, timeoutMs);

        void ApiService.synthesizeKaiVoice({
          userId: input.userId,
          vaultOwnerToken: input.vaultOwnerToken,
          text,
          voice: input.voice,
          voiceTurnId: input.voiceTurnId,
          signal: ttsAbortController.signal,
        })
          .then((value) => {
            window.clearTimeout(timer);
            resolve(value);
          })
          .catch((error: unknown) => {
            window.clearTimeout(timer);
            reject(error);
          });
      });
      if (!this.isRunActive(runId)) return;
      backendResponseReceived = true;
      this.emitTraceEvent(
        "tts_response_headers_received",
        {
          route: "/api/kai/voice/tts",
          origin: "backend_confirmed",
          status_code: response.status,
          source: "voice_tts_playback",
        },
        { voiceTurnId: input.voiceTurnId }
      );

      const ttsBodyReadStartedAt = performance.now();
      const responseBodyText = await response.text().catch(() => "");
      this.emitTraceEvent(
        "tts_response_body_received",
        {
          route: "/api/kai/voice/tts",
          origin: "backend_confirmed",
          status_code: response.status,
          response_body_chars: responseBodyText.length,
          elapsed_ms: Math.max(0, Math.round(performance.now() - ttsBodyReadStartedAt)),
          source: "voice_tts_playback",
        },
        { voiceTurnId: input.voiceTurnId }
      );
      const payloadParseStartedAt = performance.now();
      let payloadParseError: string | null = null;
      let parsedPayload: Record<string, unknown> = {};
      if (responseBodyText) {
        try {
          const maybePayload = JSON.parse(responseBodyText) as unknown;
          if (maybePayload && typeof maybePayload === "object") {
            parsedPayload = maybePayload as Record<string, unknown>;
          }
        } catch (error) {
          payloadParseError = error instanceof Error ? error.message : String(error);
        }
      }
      this.emitTraceEvent(
        "tts_payload_parsed",
        {
          route: "/api/kai/voice/tts",
          origin: "frontend_confirmed",
          status_code: response.status,
          payload_parse_error: payloadParseError,
          elapsed_ms: Math.max(0, Math.round(performance.now() - payloadParseStartedAt)),
          source: "voice_tts_playback",
        },
        { voiceTurnId: input.voiceTurnId }
      );
      const payload = parsedPayload as {
        audio_base64?: unknown;
        mime_type?: unknown;
        model?: unknown;
        voice?: unknown;
        format?: unknown;
        fallback_attempted?: unknown;
        candidate_order?: unknown;
        attempts?: unknown;
        detail?: unknown;
        error?: unknown;
      };

      if (!response.ok) {
        const message =
          (typeof payload.detail === "string" && payload.detail) ||
          (typeof payload.error === "string" && payload.error) ||
          `VOICE_TTS_HTTP_${response.status}`;
        throw new Error(message);
      }

      if (typeof payload.audio_base64 !== "string" || !payload.audio_base64.trim()) {
        throw new Error("VOICE_TTS_EMPTY_AUDIO");
      }

      const parsedAttempts: Array<{
        model?: string;
        status_code?: number;
        elapsed_ms?: number;
        result?: string;
        error?: string;
        next_model?: string | null;
      }> = Array.isArray(payload.attempts)
        ? payload.attempts
            .filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null)
            .map((value) => ({
              model: typeof value.model === "string" ? value.model : undefined,
              status_code: typeof value.status_code === "number" ? value.status_code : undefined,
              elapsed_ms: typeof value.elapsed_ms === "number" ? value.elapsed_ms : undefined,
              result: typeof value.result === "string" ? value.result : undefined,
              error: typeof value.error === "string" ? value.error : undefined,
              next_model:
                typeof value.next_model === "string"
                  ? value.next_model
                  : value.next_model === null
                    ? null
                    : undefined,
            }))
        : [];

      this.lifecycleHandlers?.onAudioReceived?.({
        voiceTurnId: input.voiceTurnId,
        mimeType: typeof payload.mime_type === "string" ? payload.mime_type : "audio/mpeg",
        audioBytesEstimate: payload.audio_base64.length,
        source: "backend_openai_audio",
        model: typeof payload.model === "string" ? payload.model : undefined,
        voice:
          typeof payload.voice === "string"
            ? payload.voice
            : typeof input.voice === "string"
              ? input.voice
              : undefined,
        format: typeof payload.format === "string" ? payload.format : undefined,
        fallbackAttempted:
          typeof payload.fallback_attempted === "boolean"
            ? payload.fallback_attempted
            : String(payload.fallback_attempted || "").trim().toLowerCase() === "true",
        candidateOrder: Array.isArray(payload.candidate_order)
          ? payload.candidate_order
              .map((value) => (typeof value === "string" ? value.trim() : ""))
              .filter((value) => value.length > 0)
          : [],
        attempts: parsedAttempts,
      });

      this.emitTraceEvent(
        "tts_audio_decode_started",
        {
          route: "/api/kai/voice/tts",
          source: "voice_tts_playback",
        },
        { voiceTurnId: input.voiceTurnId }
      );
      const decodedAudioBytes = decodeBase64ToBytes(payload.audio_base64);
      this.emitTraceEvent(
        "tts_audio_decode_finished",
        {
          route: "/api/kai/voice/tts",
          decoded_audio_bytes: decodedAudioBytes.length,
          source: "voice_tts_playback",
        },
        { voiceTurnId: input.voiceTurnId }
      );
      this.emitTraceEvent(
        "tts_blob_creation_started",
        {
          route: "/api/kai/voice/tts",
          source: "voice_tts_playback",
        },
        { voiceTurnId: input.voiceTurnId }
      );
      const blob = toBlobFromBytes(
        decodedAudioBytes,
        typeof payload.mime_type === "string" ? payload.mime_type : "audio/mpeg"
      );
      this.emitTraceEvent(
        "tts_blob_creation_finished",
        {
          route: "/api/kai/voice/tts",
          blob_bytes: blob.size,
          mime_type: blob.type,
          source: "voice_tts_playback",
        },
        { voiceTurnId: input.voiceTurnId }
      );
      if (!this.isRunActive(runId)) return;

      this.audioUrl = URL.createObjectURL(blob);
      this.audio = new Audio(this.audioUrl);
      this.activePlaybackSource = "backend_openai_audio";
      this.emitTraceEvent(
        "tts_audio_src_assigned",
        {
          route: "/api/kai/voice/tts",
          playback_source: "backend_openai_audio",
          audio_url_created: Boolean(this.audioUrl),
          source: "voice_tts_playback",
        },
        { voiceTurnId: input.voiceTurnId }
      );

      await new Promise<void>((resolve, reject) => {
        if (!this.audio) {
          reject(new Error("VOICE_TTS_AUDIO_INIT"));
          return;
        }
        let settled = false;
        const safeResolve = () => {
          if (settled) return;
          settled = true;
          this.playbackCompletionResolver = null;
          resolve();
        };
        const safeReject = (error: Error) => {
          if (settled) return;
          settled = true;
          this.playbackCompletionResolver = null;
          reject(error);
        };
        this.playbackCompletionResolver = safeResolve;
        this.audio.onended = () => safeResolve();
        this.audio.onerror = () => safeReject(new Error("VOICE_TTS_AUDIO_PLAYBACK"));
        this.audio.onplay = () => {
          if (!this.isRunActive(runId)) return;
          this.emitTraceEvent(
            "tts_playback_started",
            {
              route: "/api/kai/voice/tts",
              playback_source: "backend_openai_audio",
              source: "voice_tts_playback",
            },
            { voiceTurnId: input.voiceTurnId }
          );
          this.setState("playing");
          this.lifecycleHandlers?.onPlaybackStarted?.({
            voiceTurnId: input.voiceTurnId,
            source: "backend_openai_audio",
          });
        };
        this.emitTraceEvent(
          "tts_play_requested",
          {
            route: "/api/kai/voice/tts",
            playback_source: "backend_openai_audio",
            source: "voice_tts_playback",
          },
          { voiceTurnId: input.voiceTurnId }
        );
        const playResult = this.audio.play();
        if (playResult) {
          void playResult.catch((error: unknown) =>
            safeReject(error instanceof Error ? error : new Error("VOICE_TTS_AUDIO_PLAYBACK"))
          );
        }
      });

      if (!this.isRunActive(runId)) return;
      this.setState("idle");
      this.emitTraceEvent(
        "tts_playback_ended",
        {
          route: "/api/kai/voice/tts",
          playback_source: "backend_openai_audio",
          source: "voice_tts_playback",
        },
        { voiceTurnId: input.voiceTurnId, finalize: true }
      );
      this.lifecycleHandlers?.onPlaybackEnded?.({
        voiceTurnId: input.voiceTurnId,
        source: "backend_openai_audio",
      });
    } catch (error) {
      if (!this.isRunActive(runId)) return;

      const errorMessage = error instanceof Error ? error.message : "VOICE_TTS_UNKNOWN";
      const shouldFallback = shouldUseBrowserTtsFallback(errorMessage);
      const backendInFlightAtFailure =
        !backendResponseReceived &&
        (errorMessage === "VOICE_TTS_TIMEOUT" ||
          (error instanceof DOMException && error.name === "AbortError"));
      if (!shouldFallback) {
        this.emitTraceEvent(
          "tts_fallback_skipped",
          {
            route: "/api/kai/voice/tts",
            fallback_triggered: false,
            reason: errorMessage,
            backend_response_received: backendResponseReceived,
            source: "voice_tts_playback",
          },
          { voiceTurnId: input.voiceTurnId, finalize: true }
        );
        console.info(
          "[VOICE_TTS] browser_fallback_skipped reason=%s backend_response_received=%s",
          errorMessage,
          backendResponseReceived
        );
        this.setState("idle");
        this.lifecycleHandlers?.onPlaybackFailed?.({
          voiceTurnId: input.voiceTurnId,
          reason: errorMessage,
          source: this.activePlaybackSource,
        });
        throw error;
      }
      const fallbackSucceeded = await this.playWithSpeechSynthesis(
        runId,
        text,
        errorMessage,
        {
          backendInFlight: backendInFlightAtFailure,
          backendResponseReceived,
          timeoutMs,
          requestedVoice: input.voice,
        }
      );
      if (!fallbackSucceeded) {
        this.emitTraceEvent(
          "tts_fallback_playback_failed",
          {
            route: "/api/kai/voice/tts",
            fallback_triggered: true,
            reason: errorMessage,
            source: "voice_tts_playback",
          },
          { voiceTurnId: input.voiceTurnId, finalize: true }
        );
        this.setState("idle");
        this.lifecycleHandlers?.onPlaybackFailed?.({
          voiceTurnId: input.voiceTurnId,
          reason: errorMessage,
          source: this.activePlaybackSource,
        });
        throw error;
      }
    } finally {
      if (this.inFlightTtsAbortController === ttsAbortController) {
        this.inFlightTtsAbortController = null;
      }
      this.playbackCompletionResolver = null;
      if (!this.isRunActive(runId)) return;
      if (this.audio) {
        this.audio.onended = null;
        this.audio.onerror = null;
        this.audio.onplay = null;
      }
      if (this.audioUrl) {
        URL.revokeObjectURL(this.audioUrl);
      }
      this.audio = null;
      this.audioUrl = null;
      this.activeVoiceTurnId = undefined;
      this.activePlaybackSource = undefined;
    }
  }

  async speakLocally(text: string, voiceTurnId?: string): Promise<void> {
    const cleanText = String(text || "").trim();
    if (!cleanText) return;
    this.stop();
    this.activeVoiceTurnId = voiceTurnId;
    const runId = this.activeRunId;
    const fallbackSucceeded = await this.playWithSpeechSynthesis(
      runId,
      cleanText,
      "VOICE_TTS_LOCAL_ONLY",
      {
        backendInFlight: false,
        backendResponseReceived: false,
        timeoutMs: 0,
        requestedVoice: undefined,
      }
    );
    if (!fallbackSucceeded) {
      this.setState("idle");
      this.activeVoiceTurnId = undefined;
      throw new Error("VOICE_TTS_LOCAL_UNAVAILABLE");
    }
    if (this.isRunActive(runId)) {
      this.activeVoiceTurnId = undefined;
    }
  }
}
