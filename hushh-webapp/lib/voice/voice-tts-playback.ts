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
};

export type VoicePlaybackSource = "backend_openai_audio" | "browser_speech_synthesis";

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
};

function toBlobFromBase64(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType || "audio/mpeg" });
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

    const timeoutMs = resolveTtsTimeoutMs(input.timeoutMs);
    const ttsAbortController = new AbortController();
    this.inFlightTtsAbortController = ttsAbortController;
    let backendResponseReceived = false;

    try {
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

      const payload = (await response.json().catch(() => ({}))) as {
        audio_base64?: unknown;
        mime_type?: unknown;
        model?: unknown;
        voice?: unknown;
        format?: unknown;
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
      });

      const blob = toBlobFromBase64(
        payload.audio_base64,
        typeof payload.mime_type === "string" ? payload.mime_type : "audio/mpeg"
      );
      if (!this.isRunActive(runId)) return;

      this.audioUrl = URL.createObjectURL(blob);
      this.audio = new Audio(this.audioUrl);
      this.activePlaybackSource = "backend_openai_audio";

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
          this.setState("playing");
          this.lifecycleHandlers?.onPlaybackStarted?.({
            voiceTurnId: input.voiceTurnId,
            source: "backend_openai_audio",
          });
        };
        const playResult = this.audio.play();
        if (playResult) {
          void playResult.catch((error: unknown) =>
            safeReject(error instanceof Error ? error : new Error("VOICE_TTS_AUDIO_PLAYBACK"))
          );
        }
      });

      if (!this.isRunActive(runId)) return;
      this.setState("idle");
      this.lifecycleHandlers?.onPlaybackEnded?.({
        voiceTurnId: input.voiceTurnId,
        source: "backend_openai_audio",
      });
    } catch (error) {
      if (!this.isRunActive(runId)) return;

      const errorMessage = error instanceof Error ? error.message : "VOICE_TTS_UNKNOWN";
      const backendInFlightAtFailure =
        !backendResponseReceived &&
        (errorMessage === "VOICE_TTS_TIMEOUT" ||
          (error instanceof DOMException && error.name === "AbortError"));
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
