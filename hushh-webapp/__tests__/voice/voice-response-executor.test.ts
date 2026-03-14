import { beforeEach, describe, expect, it, vi } from "vitest";

const dispatchVoiceToolCallMock = vi.fn();
const toastInfoMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock("@/lib/voice/voice-action-dispatcher", () => ({
  dispatchVoiceToolCall: (...args: unknown[]) => dispatchVoiceToolCallMock(...args),
}));

vi.mock("@/lib/morphy-ux/morphy", () => ({
  morphyToast: {
    info: (...args: unknown[]) => toastInfoMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

import { executeVoiceResponse } from "@/lib/voice/voice-response-executor";

function baseInput() {
  return {
    userId: "user_1",
    vaultOwnerToken: "vault_token",
    vaultKey: "vault_key",
    router: {
      push: vi.fn(),
    },
    handleBack: vi.fn(),
    executeKaiCommand: vi.fn(() => ({ status: "executed" as const })),
    setAnalysisParams: vi.fn(),
  };
}

describe("executeVoiceResponse", () => {
  beforeEach(() => {
    dispatchVoiceToolCallMock.mockReset();
    dispatchVoiceToolCallMock.mockResolvedValue(undefined);
    toastInfoMock.mockReset();
    toastSuccessMock.mockReset();
  });

  it("dispatches execute response through voice tool dispatcher", async () => {
    const result = await executeVoiceResponse({
      ...baseInput(),
      response: {
        kind: "execute",
        message: "Starting analysis for NVDA.",
        speak: true,
        tool_call: {
          tool_name: "execute_kai_command",
          args: {
            command: "analyze",
            params: {
              symbol: "NVDA",
            },
          },
        },
      },
    });

    expect(dispatchVoiceToolCallMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      shortTermMemoryWrite: true,
      toolName: "execute_kai_command",
      ticker: "NVDA",
      responseKind: "execute",
    });
  });

  it("does not write short-term memory for stt_unusable clarify", async () => {
    const result = await executeVoiceResponse({
      ...baseInput(),
      response: {
        kind: "clarify",
        reason: "stt_unusable",
        message: "I couldn’t understand what you said, please repeat.",
        speak: true,
      },
    });

    expect(toastInfoMock).toHaveBeenCalledTimes(1);
    expect(result.shortTermMemoryWrite).toBe(false);
    expect(result.toolName).toBeNull();
  });

  it("returns already_running as short-term memory eligible", async () => {
    const result = await executeVoiceResponse({
      ...baseInput(),
      response: {
        kind: "already_running",
        task: "analysis",
        ticker: "AAPL",
        run_id: "run_1",
        message: "Analysis is already running for AAPL.",
        speak: true,
      },
    });

    expect(result).toEqual({
      shortTermMemoryWrite: true,
      toolName: "already_running",
      ticker: "AAPL",
      responseKind: "already_running",
    });
  });

  it("treats background_started as non-blocking and memory-eligible", async () => {
    const result = await executeVoiceResponse({
      ...baseInput(),
      response: {
        kind: "background_started",
        task: "analysis",
        ticker: "MSFT",
        run_id: "run_2",
        message: "Started analysis for MSFT in background.",
        speak: true,
      },
    });

    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      shortTermMemoryWrite: true,
      toolName: "background_started",
      ticker: "MSFT",
      responseKind: "background_started",
    });
  });
});
