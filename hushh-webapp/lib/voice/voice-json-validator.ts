import type { KaiCommandAction } from "@/lib/kai/kai-command-types";
import type { VoiceToolCall } from "@/lib/voice/voice-types";

const ALLOWED_COMMANDS = new Set<KaiCommandAction>([
  "analyze",
  "optimize",
  "consent",
  "profile",
  "history",
  "dashboard",
  "home",
]);
const COMMAND_ALIASES: Record<string, KaiCommandAction> = {
  analysis: "history",
  analysis_section: "history",
  analysis_history: "history",
  market: "home",
  market_section: "home",
  kai: "home",
  kai_section: "home",
  kai_home: "home",
  consents: "consent",
  portfolio: "dashboard",
};

const ALLOWED_EXECUTE_ARG_KEYS = new Set(["command", "params"]);
const ALLOWED_EXECUTE_PARAM_KEYS = new Set(["symbol", "focus", "tab"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateVoiceToolCall(input: unknown): VoiceToolCall | null {
  if (!isPlainObject(input)) return null;
  const toolName = input.tool_name;
  const args = input.args;
  if (typeof toolName !== "string" || !isPlainObject(args)) return null;

  if (toolName === "navigate_back" || toolName === "resume_active_analysis") {
    if (Object.keys(args).length > 0) return null;
    return {
      tool_name: toolName,
      args: {},
    };
  }

  if (toolName === "cancel_active_analysis") {
    if (Object.keys(args).length !== 1 || typeof args.confirm !== "boolean") return null;
    return {
      tool_name: "cancel_active_analysis",
      args: { confirm: args.confirm },
    };
  }

  if (toolName === "clarify") {
    const keys = Object.keys(args);
    if (!keys.every((key) => key === "question" || key === "options")) return null;
    if (typeof args.question !== "string" || !args.question.trim()) return null;
    if (args.options !== undefined) {
      if (!Array.isArray(args.options)) return null;
      if (!args.options.every((option) => typeof option === "string")) return null;
    }
    return {
      tool_name: "clarify",
      args: {
        question: args.question.trim(),
        options: Array.isArray(args.options) ? args.options : undefined,
      },
    };
  }

  if (toolName === "execute_kai_command") {
    const argKeys = Object.keys(args);
    if (!argKeys.every((key) => ALLOWED_EXECUTE_ARG_KEYS.has(key))) return null;

    if (typeof args.command !== "string") return null;
    const rawCommand = args.command.trim().toLowerCase().replace(/\s+/g, "_");
    const command = (COMMAND_ALIASES[rawCommand] || rawCommand) as KaiCommandAction;
    if (!ALLOWED_COMMANDS.has(command)) return null;

    const normalized: {
      symbol?: string;
      focus?: "active";
      tab?: "history" | "debate" | "summary" | "transcript";
    } = {};

    if (args.params !== undefined) {
      if (!isPlainObject(args.params)) return null;
      const paramKeys = Object.keys(args.params);
      if (!paramKeys.every((key) => ALLOWED_EXECUTE_PARAM_KEYS.has(key))) return null;

      if (args.params.symbol !== undefined) {
        if (typeof args.params.symbol !== "string" || !args.params.symbol.trim()) return null;
        normalized.symbol = args.params.symbol.trim().toUpperCase();
      }

      if (args.params.focus !== undefined) {
        if (args.params.focus !== "active") return null;
        normalized.focus = "active";
      }

      if (args.params.tab !== undefined) {
        if (
          args.params.tab !== "history" &&
          args.params.tab !== "debate" &&
          args.params.tab !== "summary" &&
          args.params.tab !== "transcript"
        ) {
          return null;
        }
        normalized.tab = args.params.tab;
      }
    }

    if (command === "analyze" && !normalized.symbol) {
      return null;
    }

    return {
      tool_name: "execute_kai_command",
      args: {
        command,
        params: Object.keys(normalized).length > 0 ? normalized : undefined,
      },
    };
  }

  return null;
}
