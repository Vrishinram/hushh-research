"use client";

import { ApiService } from "@/lib/services/api-service";
import { normalizeClarifyToolCall, validateVoicePlanPayload } from "@/lib/voice/voice-json-validator";
import { createVoiceTurnId } from "@/lib/voice/voice-telemetry";
import { buildStructuredScreenContext, type StructuredScreenContext } from "@/lib/voice/screen-context-builder";
import {
  type DurableMemoryItem,
  type DurableMemoryWriteCandidate,
  type ShortTermTurn,
  voiceMemoryStore,
} from "@/lib/voice/voice-memory-store";
import type { AppRuntimeState, VoiceMemoryHint, VoiceResponse } from "@/lib/voice/voice-types";

export type VoiceOrchestratorSource = "microphone" | "example_chip" | "replay";

export type VoiceSpeakSegmentType = "ack" | "final";

export type VoiceTurnOrchestratorSpeakInput = {
  text: string;
  turnId: string;
  responseId: string;
  segmentType: VoiceSpeakSegmentType;
};

export type VoiceTurnOrchestratorInput = {
  transcript: string;
  source: VoiceOrchestratorSource;
};

type VoicePlannerV2Envelope = {
  turn_id?: unknown;
  response_id?: unknown;
  intent?: { name?: unknown; confidence?: unknown } | null;
  action?: { type?: unknown; payload?: unknown } | null;
  needs_confirmation?: unknown;
  ack_text?: unknown;
  final_text?: unknown;
  is_long_running?: unknown;
  memory_write_candidates?: unknown;
  response?: unknown;
  tool_call?: unknown;
  memory?: unknown;
  elapsed_ms?: unknown;
  openai_http_ms?: unknown;
  model?: unknown;
};

function parsePlannerMemoryWriteCandidates(
  raw: unknown
): DurableMemoryWriteCandidate[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value) => {
      if (!value || typeof value !== "object") return null;
      const row = value as Record<string, unknown>;
      const category = String(row.category || "").trim();
      const summary = String(row.summary || row.text || "").trim();
      if (!category || !summary) return null;
      return {
        category,
        summary,
      } as DurableMemoryWriteCandidate;
    })
    .filter((value): value is DurableMemoryWriteCandidate => Boolean(value));
}

function plannerSafeText(raw: unknown): string | null {
  const text = String(raw || "").trim();
  return text ? text : null;
}

function makeResponseId(turnId: string): string {
  return `vrsp_${turnId.replace(/^vturn_/, "")}`;
}

export type VoiceTurnOrchestratorConfig = {
  userId: string;
  vaultOwnerToken: string;
  getAppRuntimeState: () => AppRuntimeState | undefined;
  getVoiceContext: () => Record<string, unknown> | undefined;
  onVoiceResponse: (payload: {
    transcript: string;
    response: VoiceResponse;
    memory?: VoiceMemoryHint;
  }) => Promise<unknown> | unknown;
  speak: (input: VoiceTurnOrchestratorSpeakInput) => Promise<void>;
  onStageChange?: (stage: "planning" | "dispatch" | "speaking_ack" | "speaking_final" | "idle") => void;
  onDebug?: (event: string, payload?: Record<string, unknown>) => void;
  onAssistantText?: (payload: {
    text: string;
    kind: VoiceResponse["kind"] | "ack";
    turnId: string;
    responseId: string;
    segmentType: VoiceSpeakSegmentType;
  }) => void;
};

export type VoiceTurnOrchestratorResult = {
  turnId: string;
  responseId: string;
  response: VoiceResponse;
  source: VoiceOrchestratorSource;
};

export class VoiceTurnOrchestrator {
  private config: VoiceTurnOrchestratorConfig;
  private activeToken = 0;
  private activeAbortController: AbortController | null = null;

  constructor(config: VoiceTurnOrchestratorConfig) {
    this.config = config;
  }

  updateConfig(config: VoiceTurnOrchestratorConfig): void {
    this.config = config;
  }

  isBusy(): boolean {
    return Boolean(this.activeAbortController);
  }

  cancelActiveTurn(reason: string): void {
    this.activeToken += 1;
    const active = this.activeAbortController;
    this.activeAbortController = null;
    if (active) {
      active.abort(reason);
    }
    this.config.onStageChange?.("idle");
    this.config.onDebug?.("orchestrator_turn_cancelled", { reason });
  }

  private isTokenActive(token: number): boolean {
    return token === this.activeToken;
  }

  async processTranscript(input: VoiceTurnOrchestratorInput): Promise<VoiceTurnOrchestratorResult | null> {
    const cleanTranscript = String(input.transcript || "").trim();
    if (!cleanTranscript) return null;

    this.cancelActiveTurn("new_turn_started");
    const token = ++this.activeToken;
    const turnId = createVoiceTurnId();
    const abortController = new AbortController();
    this.activeAbortController = abortController;

    const appRuntimeState = this.config.getAppRuntimeState();
    const voiceContext = this.config.getVoiceContext() || {};
    const structuredContext: StructuredScreenContext = buildStructuredScreenContext({
      appRuntimeState,
      voiceContext,
    });

    const memoryShort: ShortTermTurn[] = voiceMemoryStore.getShortTerm(this.config.userId, 20);
    const memoryRetrieved: DurableMemoryItem[] = voiceMemoryStore.retrieveDurable(
      this.config.userId,
      cleanTranscript,
      8
    );

    this.config.onDebug?.("orchestrator_turn_started", {
      turn_id: turnId,
      source: input.source,
      transcript_chars: cleanTranscript.length,
      memory_short_count: memoryShort.length,
      memory_retrieved_count: memoryRetrieved.length,
    });

    try {
      this.config.onStageChange?.("planning");
      const planningResponse = await ApiService.planKaiVoiceIntent({
        userId: this.config.userId,
        vaultOwnerToken: this.config.vaultOwnerToken,
        transcript: cleanTranscript,
        context: {
          ...(voiceContext || {}),
          structured_screen_context: structuredContext,
          memory_short: memoryShort,
          memory_retrieved: memoryRetrieved,
          planner_v2_enabled: true,
          planner_turn_id: turnId,
        },
        appState: appRuntimeState,
        voiceTurnId: turnId,
        signal: abortController.signal,
      });
      if (!this.isTokenActive(token)) return null;

      const plannerEnvelope = (await planningResponse
        .json()
        .catch(() => ({}))) as VoicePlannerV2Envelope;
      const validatedPlan = validateVoicePlanPayload(plannerEnvelope);
      const normalizedPlan =
        validatedPlan ||
        validateVoicePlanPayload({
          response: {
            kind: "clarify",
            reason: "stt_unusable",
            message: "I couldn’t understand that clearly. Could you repeat it?",
            speak: true,
          },
          tool_call: normalizeClarifyToolCall("I couldn’t understand that clearly. Could you repeat it?"),
          memory: {
            allow_durable_write: false,
          },
          model: "clarify_fallback",
        });

      if (!normalizedPlan) {
        throw new Error("VOICE_ORCHESTRATOR_INVALID_PLAN_PAYLOAD");
      }

      const response = normalizedPlan.response;
      const responseId =
        plannerSafeText(plannerEnvelope.response_id) || makeResponseId(turnId);
      const isLongRunning = plannerEnvelope.is_long_running === true;
      const ackText = plannerSafeText(plannerEnvelope.ack_text);
      const finalText = plannerSafeText(plannerEnvelope.final_text) || response.message;
      const memoryWriteCandidates = parsePlannerMemoryWriteCandidates(
        plannerEnvelope.memory_write_candidates
      );

      if (isLongRunning && ackText) {
        this.config.onStageChange?.("speaking_ack");
        this.config.onAssistantText?.({
          text: ackText,
          kind: "ack",
          turnId,
          responseId,
          segmentType: "ack",
        });
        await this.config.speak({
          text: ackText,
          turnId,
          responseId,
          segmentType: "ack",
        });
      }

      if (!this.isTokenActive(token)) return null;

      this.config.onStageChange?.("dispatch");
      await Promise.resolve(
        this.config.onVoiceResponse({
          transcript: cleanTranscript,
          response,
          memory: normalizedPlan.memory,
        })
      );

      if (!this.isTokenActive(token)) return null;

      const shouldSpeakFinal =
        response.speak && (!isLongRunning || !ackText || ackText.trim() !== finalText.trim());

      if (shouldSpeakFinal) {
        this.config.onStageChange?.("speaking_final");
        this.config.onAssistantText?.({
          text: finalText,
          kind: response.kind,
          turnId,
          responseId,
          segmentType: "final",
        });
        await this.config.speak({
          text: finalText,
          turnId,
          responseId,
          segmentType: "final",
        });
      }

      if (!this.isTokenActive(token)) return null;

      voiceMemoryStore.appendShortTerm(this.config.userId, {
        turn_id: turnId,
        transcript_final: cleanTranscript,
        response_text: finalText,
        response_kind: response.kind,
        created_at_ms: Date.now(),
      });

      if (normalizedPlan.memory?.allow_durable_write && memoryWriteCandidates.length > 0) {
        voiceMemoryStore.writeDurable(this.config.userId, memoryWriteCandidates);
      }

      return {
        turnId,
        responseId,
        response,
        source: input.source,
      };
    } finally {
      if (this.activeAbortController === abortController) {
        this.activeAbortController = null;
      }
      this.config.onStageChange?.("idle");
    }
  }
}
