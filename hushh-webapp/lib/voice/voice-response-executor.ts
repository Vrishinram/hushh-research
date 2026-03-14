import { morphyToast as toast } from "@/lib/morphy-ux/morphy";
import type { AnalysisParams } from "@/lib/stores/kai-session-store";
import { dispatchVoiceToolCall } from "@/lib/voice/voice-action-dispatcher";
import type { VoiceResponse } from "@/lib/voice/voice-types";
import type { ExecuteKaiCommandResult } from "@/lib/kai/command-executor";

type RouterLike = {
  push: (href: string) => void;
};

export type ExecuteVoiceResponseInput = {
  response: VoiceResponse;
  userId: string;
  vaultOwnerToken?: string;
  vaultKey?: string;
  router: RouterLike;
  handleBack: () => void;
  executeKaiCommand: () => ExecuteKaiCommandResult;
  setAnalysisParams: (params: AnalysisParams | null) => void;
};

export type ExecuteVoiceResponseResult = {
  shortTermMemoryWrite: boolean;
  toolName: string | null;
  ticker: string | null;
  responseKind: VoiceResponse["kind"];
};

function extractTickerFromExecute(response: VoiceResponse): string | null {
  if (response.kind !== "execute") return null;
  const toolCall = response.tool_call;
  if (toolCall.tool_name !== "execute_kai_command") return null;
  if (toolCall.args.command !== "analyze") return null;
  return toolCall.args.params?.symbol ?? null;
}

export async function executeVoiceResponse(
  input: ExecuteVoiceResponseInput
): Promise<ExecuteVoiceResponseResult> {
  const { response } = input;

  if (response.kind === "execute") {
    await dispatchVoiceToolCall({
      toolCall: response.tool_call,
      userId: input.userId,
      vaultOwnerToken: input.vaultOwnerToken,
      vaultKey: input.vaultKey,
      router: input.router,
      handleBack: input.handleBack,
      executeKaiCommand: input.executeKaiCommand,
      setAnalysisParams: input.setAnalysisParams,
    });
    return {
      shortTermMemoryWrite: true,
      toolName: response.tool_call.tool_name,
      ticker: extractTickerFromExecute(response),
      responseKind: response.kind,
    };
  }

  if (response.kind === "background_started") {
    toast.success(response.message, {
      description: `Run ${response.run_id} started for ${response.ticker}.`,
    });
    return {
      shortTermMemoryWrite: true,
      toolName: "background_started",
      ticker: response.ticker,
      responseKind: response.kind,
    };
  }

  if (response.kind === "already_running") {
    toast.info(response.message);
    return {
      shortTermMemoryWrite: true,
      toolName: "already_running",
      ticker: response.ticker ?? null,
      responseKind: response.kind,
    };
  }

  if (response.kind === "clarify") {
    toast.info(response.message);
    return {
      shortTermMemoryWrite: response.reason !== "stt_unusable",
      toolName: response.reason === "stt_unusable" ? null : "clarify",
      ticker: null,
      responseKind: response.kind,
    };
  }

  if (response.kind === "blocked") {
    toast.info(response.message);
    return {
      shortTermMemoryWrite: false,
      toolName: null,
      ticker: null,
      responseKind: response.kind,
    };
  }

  toast.info(response.message);
  return {
    shortTermMemoryWrite: false,
    toolName: null,
    ticker: null,
    responseKind: response.kind,
  };
}
