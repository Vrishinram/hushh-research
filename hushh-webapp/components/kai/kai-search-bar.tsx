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
import { Mic, Search, Square, Sparkles } from "lucide-react";

import { KaiCommandPalette } from "@/components/kai/kai-command-palette";
import { VoiceEqualizer } from "@/components/kai/voice-equalizer";
import type { KaiCommandAction } from "@/lib/kai/kai-command-types";
import { Button } from "@/lib/morphy-ux/button";
import { morphyToast as toast } from "@/lib/morphy-ux/morphy";
import { Icon } from "@/lib/morphy-ux/ui";
import { useKaiBottomChromeVisibility } from "@/lib/navigation/kai-bottom-chrome-visibility";
import { KAI_COMMAND_BAR_OPEN_EVENT } from "@/lib/navigation/kai-command-bar-events";
import { ApiService } from "@/lib/services/api-service";
import { cn } from "@/lib/utils";
import { useAmplitudeMeter } from "@/lib/voice/use-amplitude-meter";
import { validateVoiceToolCall } from "@/lib/voice/voice-json-validator";
import type { VoiceToolCall } from "@/lib/voice/voice-types";

type VoiceUiState = "idle" | "listening" | "processing" | "error";
const VOICE_MIC_INTRO_KEY = "kai_voice_mic_intro_seen_v1";
const VOICE_MIC_CAPABILITIES = [
  "Navigate with voice: \"Open dashboard\", \"Go to profile\", \"Open consents\"",
  "Run analysis: \"Analyze Nvidia\" or \"Analyze AMD\"",
  "Follow-ups: \"Now do AMD\", \"Resume it\", \"Stop it\", \"Go back\"",
  "Tap mic again anytime to stop listening",
] as const;

interface KaiSearchBarProps {
  onCommand: (command: KaiCommandAction, params?: Record<string, unknown>) => void;
  onVoiceToolCall?: (toolCall: VoiceToolCall, transcript: string) => Promise<void> | void;
  disabled?: boolean;
  hasPortfolioData?: boolean;
  userId?: string;
  vaultOwnerToken?: string;
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

export function KaiSearchBar({
  onCommand,
  onVoiceToolCall,
  disabled = false,
  hasPortfolioData = true,
  userId,
  vaultOwnerToken,
  voiceContext,
  portfolioTickers = [],
}: KaiSearchBarProps) {
  const [open, setOpen] = useState(false);
  const { hidden: hideBottomChrome, progress: hideBottomChromeProgress } =
    useKaiBottomChromeVisibility(true);

  const [voiceUiState, setVoiceUiState] = useState<VoiceUiState>("idle");
  const [voiceErrorMessage, setVoiceErrorMessage] = useState<string | null>(null);
  const [micIntroSeen, setMicIntroSeen] = useState(false);
  const [showMicIntro, setShowMicIntro] = useState(false);
  const [introVisibleLines, setIntroVisibleLines] = useState(0);

  const barRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingCancelledRef = useRef(false);

  const { rawRms, normalizedLevel, smoothedLevel, start, stop } = useAmplitudeMeter({
    sensitivity: 11,
    smoothingFactor: 0.2,
    logIntervalMs: 500,
  });

  const setVoiceState = useCallback((next: VoiceUiState, reason?: string) => {
    setVoiceUiState((prev) => {
      if (prev !== next) {
        console.info(`[VOICE_UI] state=${next}${reason ? ` reason=${reason}` : ""}`);
      }
      return next;
    });
  }, []);

  const setVoiceError = useCallback(
    (message: string, userMessage?: string) => {
      console.error(`[VOICE_UI] error="${message}"`);
      setVoiceErrorMessage(message);
      setVoiceState("error", message);
      toast.error(userMessage || message);
    },
    [setVoiceState]
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
            // ignore track stop failures
          }
        });
      }
      mediaStreamRef.current = null;
      audioChunksRef.current = [];

      console.info(`[VOICE_UI] mic_cleanup_complete reason=${reason}`);
    },
    [stop]
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
    if (typeof window === "undefined") return;
    const seen = window.localStorage.getItem(VOICE_MIC_INTRO_KEY) === "1";
    setMicIntroSeen(seen);
  }, []);

  useEffect(() => {
    console.info(`[VOICE_UI] mic_button_render_state=${voiceUiState}`);
  }, [voiceUiState]);

  useEffect(() => {
    if (voiceUiState !== "error") return;
    const timer = window.setTimeout(() => {
      setVoiceErrorMessage(null);
      setVoiceState("idle", "error_recovered");
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [setVoiceState, voiceUiState]);

  useEffect(() => {
    return () => {
      recordingCancelledRef.current = true;
      cleanupAudioResources("component_unmount");
    };
  }, [cleanupAudioResources]);

  useEffect(() => {
    if (!showMicIntro) {
      setIntroVisibleLines(0);
      return;
    }

    setIntroVisibleLines(0);
    let current = 0;
    const timer = window.setInterval(() => {
      current += 1;
      setIntroVisibleLines(Math.min(current, VOICE_MIC_CAPABILITIES.length));
      if (current >= VOICE_MIC_CAPABILITIES.length) {
        window.clearInterval(timer);
      }
    }, 180);

    return () => {
      window.clearInterval(timer);
    };
  }, [showMicIntro]);

  const processVoiceRecording = useCallback(
    async (audioBlob: Blob) => {
      if (!onVoiceToolCall) {
        setVoiceError(
          "Voice command callback is not configured",
          "Voice command failed. Try again."
        );
        return;
      }

      if (!userId || !vaultOwnerToken) {
        setVoiceError("Vault token is missing for voice flow", "Unlock your vault to use voice.");
        return;
      }

      setVoiceState("processing", "transcription_started");

      try {
        console.info("[VOICE_STT] transcription_started");
        const sttStartedAt = performance.now();
        const sttResponse = await ApiService.transcribeKaiVoice({
          userId,
          vaultOwnerToken,
          audioBlob,
          mimeType: audioBlob.type || undefined,
        });

        const sttPayload = (await sttResponse.json().catch(() => ({}))) as {
          transcript?: unknown;
          detail?: unknown;
          error?: unknown;
        };

        if (!sttResponse.ok) {
          const message =
            (typeof sttPayload.detail === "string" && sttPayload.detail) ||
            (typeof sttPayload.error === "string" && sttPayload.error) ||
            "Voice transcription failed";
          console.error(`[VOICE_STT] error="${message}"`);
          throw new Error(message);
        }
        const sttElapsedMs = Math.round(performance.now() - sttStartedAt);
        console.info(`[VOICE_STT] elapsed_ms=${sttElapsedMs}`);

        const transcript = String(sttPayload.transcript || "").trim();
        console.info(`[VOICE_STT] final="${transcript}"`);

        if (!transcript) {
          throw new Error("Transcription returned empty text");
        }

        console.info("[VOICE_STT] partial=" + '"(not-supported)"');
        console.info("[VOICE_UI] intent_planning_started");
        const planStartedAt = performance.now();

        const planResponse = await ApiService.planKaiVoiceIntent({
          userId,
          vaultOwnerToken,
          transcript,
          context: voiceContext,
        });

        const planPayload = (await planResponse.json().catch(() => ({}))) as {
          tool_call?: unknown;
          detail?: unknown;
          error?: unknown;
        };

        if (!planResponse.ok) {
          const message =
            (typeof planPayload.detail === "string" && planPayload.detail) ||
            (typeof planPayload.error === "string" && planPayload.error) ||
            "Voice command planning failed";
          throw new Error(message);
        }
        const planElapsedMs = Math.round(performance.now() - planStartedAt);
        console.info(`[VOICE_UI] intent_planning_elapsed_ms=${planElapsedMs}`);
        console.info(
          "[VOICE_UI] tool_call_raw=",
          planPayload.tool_call && typeof planPayload.tool_call === "object"
            ? planPayload.tool_call
            : planPayload
        );

        const normalizedCall = validateVoiceToolCall(planPayload.tool_call);
        if (!normalizedCall) {
          throw new Error("Voice tool response was invalid");
        }
        console.info("[VOICE_UI] tool_call_validated=", normalizedCall);

        const dispatchStartedAt = performance.now();
        await onVoiceToolCall(normalizedCall, transcript);
        const dispatchElapsedMs = Math.round(performance.now() - dispatchStartedAt);
        const totalElapsedMs = Math.round(performance.now() - sttStartedAt);
        console.info(
          `[VOICE_UI] dispatch_elapsed_ms=${dispatchElapsedMs} total_voice_pipeline_ms=${totalElapsedMs}`
        );
        setVoiceErrorMessage(null);
        setVoiceState("idle", "transcription_complete");
      } catch (error) {
        const message = (error as Error).message || "Voice command failed";
        console.error(`[VOICE_STT] error="${message}"`);
        setVoiceError(message, "Transcription failed. Try again.");
      }
    },
    [onVoiceToolCall, setVoiceError, setVoiceState, userId, vaultOwnerToken, voiceContext]
  );

  const startListening = useCallback(async () => {
    console.info("[VOICE_UI] mic_button_tapped action=start");
    setVoiceErrorMessage(null);
    recordingCancelledRef.current = false;

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setVoiceError("Microphone API is not available", "Could not access microphone.");
      return;
    }

    try {
      if (navigator.permissions?.query) {
        try {
          const result = await navigator.permissions.query({ name: "microphone" as PermissionName });
          console.info(`[VOICE_UI] permission_status=${result.state}`);
          if (result.state === "denied") {
            setVoiceError("Microphone permission denied", "Microphone permission denied");
            return;
          }
        } catch {
          console.info("[VOICE_UI] permission_status=unknown");
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];

      console.info("[VOICE_UI] mic_stream_started");
      await start(stream);

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = (event: Event) => {
        const errorMessage =
          event && "type" in event ? `MediaRecorder error event: ${String(event.type)}` : "MediaRecorder failed";
        setVoiceError(errorMessage, "Couldn\'t access microphone");
        cleanupAudioResources("recorder_error");
      };

      recorder.onstop = () => {
        console.info("[VOICE_UI] mic_stop_invoked");
        const recordedChunks = [...audioChunksRef.current];
        const mimeType = recorder.mimeType || "audio/webm";

        cleanupAudioResources("recorder_stop");

        if (recordingCancelledRef.current) {
          setVoiceState("idle", "recording_cancelled");
          return;
        }

        const audioBlob = new Blob(recordedChunks, { type: mimeType });
        if (audioBlob.size === 0) {
          setVoiceError("Recorded audio was empty", "Couldn\'t access microphone");
          return;
        }

        void processVoiceRecording(audioBlob);
      };

      recorder.start(150);
      setVoiceState("listening", "mic_stream_started");
    } catch (error) {
      cleanupAudioResources("start_failed");
      if (isPermissionDeniedError(error)) {
        setVoiceError("Microphone permission denied", "Microphone permission denied");
        return;
      }
      setVoiceError(
        (error as Error).message || "Could not access microphone",
        "Couldn\'t access microphone"
      );
    }
  }, [cleanupAudioResources, processVoiceRecording, setVoiceError, setVoiceState, start]);

  const stopListening = useCallback(() => {
    console.info("[VOICE_UI] mic_button_tapped action=stop");
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      setVoiceState("processing", "stop_requested");
      recorder.stop();
      return;
    }

    cleanupAudioResources("stop_without_active_recorder");
    setVoiceState("idle", "stop_without_active_recorder");
  }, [cleanupAudioResources, setVoiceState]);

  const handleMicTap = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      console.info(`[VOICE_UI] mic_button_tapped state=${voiceUiState}`);

      if (disabled) return;
      if (voiceUiState === "processing") return;
      if (showMicIntro) return;

      if (!micIntroSeen) {
        setMicIntroSeen(true);
        setShowMicIntro(true);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(VOICE_MIC_INTRO_KEY, "1");
        }
        console.info("[VOICE_UI] mic_intro_shown first_time=true");
        return;
      }

      if (voiceUiState === "listening") {
        stopListening();
        return;
      }

      await startListening();
    },
    [disabled, micIntroSeen, showMicIntro, startListening, stopListening, voiceUiState]
  );

  const dismissMicIntro = useCallback(() => {
    setShowMicIntro(false);
    console.info("[VOICE_UI] mic_intro_dismissed");
  }, []);

  const startFromMicIntro = useCallback(async () => {
    setShowMicIntro(false);
    console.info("[VOICE_UI] mic_intro_start_listening");
    await startListening();
  }, [startListening]);

  const voiceSurfaceVisible = voiceUiState === "listening" || voiceUiState === "processing";
  const showVoiceDebug = useMemo(
    () => voiceSurfaceVisible || voiceUiState === "error",
    [voiceSurfaceVisible, voiceUiState]
  );

  const voiceDebugLabel =
    voiceUiState === "listening"
      ? `Listening... level=${Math.round(smoothedLevel * 100)}%`
      : voiceUiState === "processing"
        ? "Processing voice command..."
        : voiceUiState === "error"
          ? `Error: ${voiceErrorMessage || "Voice failed"}`
          : "";

  return (
    <>
      <div
        className={cn(
          "fixed inset-x-0 z-[130] flex justify-center px-4",
          hideBottomChrome ? "pointer-events-none opacity-0" : "pointer-events-none opacity-100"
        )}
        style={{
          bottom: "calc(var(--app-bottom-inset) + var(--kai-command-bottom-gap, 18px))",
          transform: `translate3d(0, calc(${100 * hideBottomChromeProgress}% + ${12 * hideBottomChromeProgress}px), 0)`,
          opacity: Math.max(0, 1 - hideBottomChromeProgress),
        }}
      >
        <div ref={barRef} className="pointer-events-auto w-full max-w-[420px]">
          <div
            className={cn(
              "mb-2 overflow-hidden rounded-2xl border border-border/70 bg-background/95 shadow-lg backdrop-blur transition-all duration-300",
              showMicIntro
                ? "max-h-64 translate-y-0 opacity-100"
                : "pointer-events-none max-h-0 -translate-y-1 opacity-0"
            )}
          >
            <div className="px-4 py-3">
              <div className="mb-2 flex items-center gap-2 text-foreground">
                <Icon icon={Sparkles} size="sm" />
                <p className="text-sm font-semibold">Use Voice with Kai</p>
              </div>
              <div className="space-y-1.5">
                {VOICE_MIC_CAPABILITIES.map((line, index) => {
                  const visible = index < introVisibleLines;
                  return (
                    <p
                      key={line}
                      className={cn(
                        "text-xs text-muted-foreground transition-all duration-300",
                        visible ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
                      )}
                    >
                      • {line}
                    </p>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="rounded-full border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60"
                  onClick={dismissMicIntro}
                >
                  Not now
                </button>
                <button
                  type="button"
                  className="rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background transition-opacity hover:opacity-90"
                  onClick={() => void startFromMicIntro()}
                >
                  Got it, start voice
                </button>
              </div>
            </div>
          </div>

          <div className="relative h-12">
            <div
              className={cn(
                "absolute inset-0 transition-all duration-250 ease-out",
                voiceSurfaceVisible ? "scale-[0.98] opacity-0 blur-[1px]" : "scale-100 opacity-100"
              )}
            >
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
              <button
                type="button"
                aria-label="Start voice recording"
                data-no-route-swipe
                disabled={disabled}
                className={cn(
                  "absolute right-2 top-1/2 z-10 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground",
                  disabled && "cursor-not-allowed opacity-60"
                )}
                onClick={handleMicTap}
              >
                <Icon icon={Mic} size="sm" />
              </button>
            </div>

            <div
              className={cn(
                "absolute inset-0 overflow-hidden rounded-full border border-border/60 bg-background/85 shadow-sm backdrop-blur-sm transition-all duration-250 ease-out",
                voiceSurfaceVisible
                  ? "pointer-events-auto scale-100 opacity-100"
                  : "pointer-events-none scale-[0.97] opacity-0"
              )}
            >
              <VoiceEqualizer
                state={voiceUiState === "processing" ? "processing" : "listening"}
                level={smoothedLevel}
              />
            </div>
          </div>

          <div
            className={cn(
              "mt-2 flex justify-center overflow-hidden transition-[max-height,opacity,transform] duration-250 ease-out",
              voiceSurfaceVisible
                ? "max-h-16 translate-y-0 opacity-100"
                : "max-h-0 -translate-y-1 opacity-0"
            )}
          >
            <button
              type="button"
              data-no-route-swipe
              aria-label={voiceUiState === "processing" ? "Processing voice" : "Stop voice recording"}
              disabled={voiceUiState === "processing"}
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-full border border-border/70 bg-background/95 px-4 text-xs font-semibold text-foreground shadow-sm transition-colors",
                voiceUiState === "listening" && "border-primary/50 bg-primary/10",
                voiceUiState === "processing" && "cursor-not-allowed opacity-70"
              )}
              onClick={handleMicTap}
            >
              <Icon icon={voiceUiState === "processing" ? Mic : Square} size="sm" />
              {voiceUiState === "processing" ? "Processing..." : "Tap to stop"}
            </button>
          </div>

          {showVoiceDebug && voiceDebugLabel ? (
            <p className="mt-1 text-center text-[10px] text-muted-foreground">{voiceDebugLabel}</p>
          ) : null}

          {voiceUiState === "listening" ? (
            <p className="mt-1 text-center text-[10px] text-muted-foreground/70">
              raw={rawRms.toFixed(4)} level={normalizedLevel.toFixed(3)} smoothed={smoothedLevel.toFixed(3)}
            </p>
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
    </>
  );
}
