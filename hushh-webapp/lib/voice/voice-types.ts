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
