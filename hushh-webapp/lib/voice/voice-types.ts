import type { KaiCommandAction, KaiWorkspaceTab } from "@/lib/kai/kai-command-types";

export type VoiceExecuteKaiCommandCall = {
  tool_name: "execute_kai_command";
  args: {
    command: KaiCommandAction;
    params?: {
      symbol?: string;
      focus?: "active";
      tab?: KaiWorkspaceTab;
    };
  };
};

export type VoiceNavigateBackCall = {
  tool_name: "navigate_back";
  args: Record<string, never>;
};

export type VoiceResumeActiveAnalysisCall = {
  tool_name: "resume_active_analysis";
  args: Record<string, never>;
};

export type VoiceCancelActiveAnalysisCall = {
  tool_name: "cancel_active_analysis";
  args: {
    confirm: boolean;
  };
};

export type VoiceClarifyCall = {
  tool_name: "clarify";
  args: {
    question: string;
    options?: string[];
  };
};

export type VoiceToolCall =
  | VoiceExecuteKaiCommandCall
  | VoiceNavigateBackCall
  | VoiceResumeActiveAnalysisCall
  | VoiceCancelActiveAnalysisCall
  | VoiceClarifyCall;

export type AppRuntimeState = {
  auth: {
    signed_in: boolean;
    user_id: string | null;
  };
  vault: {
    unlocked: boolean;
    token_available: boolean;
    token_valid: boolean;
  };
  route: {
    pathname: string;
    screen: string;
    subview?: string | null;
  };
  runtime: {
    analysis_active: boolean;
    analysis_ticker?: string | null;
    analysis_run_id?: string | null;
    import_active: boolean;
    import_run_id?: string | null;
    busy_operations: string[];
  };
  portfolio: {
    has_portfolio_data: boolean;
  };
  voice: {
    available: boolean;
    tts_playing: boolean;
    last_tool_name?: string | null;
    last_ticker?: string | null;
  };
};

export type VoiceBlockedResponse = {
  kind: "blocked";
  reason: "auth_required" | "vault_required";
  message: string;
  speak: true;
};

export type VoiceClarifyResponse = {
  kind: "clarify";
  reason: "stt_unusable" | "ticker_ambiguous" | "ticker_unknown";
  message: string;
  candidate?: string | null;
  speak: true;
};

export type VoiceAlreadyRunningResponse = {
  kind: "already_running";
  task: "analysis" | "import";
  ticker?: string | null;
  run_id?: string | null;
  message: string;
  speak: true;
};

export type VoiceExecuteResponse = {
  kind: "execute";
  tool_call: VoiceToolCall;
  message: string;
  speak: true;
};

export type VoiceBackgroundStartedResponse = {
  kind: "background_started";
  task: "analysis";
  ticker: string;
  run_id: string;
  message: string;
  speak: true;
};

export type VoiceSpeakOnlyResponse = {
  kind: "speak_only";
  message: string;
  speak: true;
};

export type VoiceResponse =
  | VoiceBlockedResponse
  | VoiceClarifyResponse
  | VoiceAlreadyRunningResponse
  | VoiceExecuteResponse
  | VoiceBackgroundStartedResponse
  | VoiceSpeakOnlyResponse;

export type VoiceMemoryHint = {
  allow_durable_write: boolean;
};

export type VoicePlanPayload = {
  response: VoiceResponse;
  tool_call?: VoiceToolCall;
  memory?: VoiceMemoryHint;
  elapsed_ms?: number;
  openai_http_ms?: number;
  model?: string;
};
