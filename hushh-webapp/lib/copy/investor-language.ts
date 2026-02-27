export type InvestorMessageCode =
  | "ACCOUNT_STATE_UNAVAILABLE"
  | "ONBOARDING_STATE_UNAVAILABLE"
  | "VAULT_STATUS_UNAVAILABLE"
  | "VAULT_UNLOCK_FAILED"
  | "VAULT_PASSKEY_ENROLL_REQUIRED"
  | "MARKET_DATA_UNAVAILABLE"
  | "ANALYSIS_UNAVAILABLE"
  | "NETWORK_RECOVERY"
  | "SAVE_IN_PROGRESS";

export type InvestorLoadingStage =
  | "SESSION_CHECK"
  | "ACCOUNT_STATE"
  | "ONBOARDING"
  | "MARKET"
  | "ANALYSIS"
  | "VAULT";

export type DecisionDisplayLabel = "BUY" | "HOLD" | "WATCH" | "REDUCE" | "REVIEW";

export interface InvestorDecisionDisplay {
  label: DecisionDisplayLabel;
  tone: "positive" | "neutral" | "negative";
  guidance: string;
}

export const INVESTOR_BANNED_TERMS = [
  "prf",
  "native prf",
  "fallback",
  "runtime",
  "token",
  "wrapper",
  "decrypt",
  "encrypted",
  "debug",
  "stream degraded",
] as const;

export function toInvestorMessage(
  code: InvestorMessageCode,
  context?: { ticker?: string; reason?: string | null }
): string {
  switch (code) {
    case "ACCOUNT_STATE_UNAVAILABLE":
      return "We could not load your account details right now. Please try again.";
    case "ONBOARDING_STATE_UNAVAILABLE":
      return "We could not load your onboarding progress. Please try again.";
    case "VAULT_STATUS_UNAVAILABLE":
      return "We could not check your Vault status right now. Please try again.";
    case "VAULT_UNLOCK_FAILED":
      return "We could not unlock your Vault. Please confirm your details and try again.";
    case "VAULT_PASSKEY_ENROLL_REQUIRED":
      return "Use your passphrase once on this device, then enable passkey for faster sign-in.";
    case "MARKET_DATA_UNAVAILABLE":
      return "Live market data is temporarily unavailable. Showing the latest available view.";
    case "ANALYSIS_UNAVAILABLE":
      return context?.ticker
        ? `Analysis for ${context.ticker} is not available yet.`
        : "Analysis is not available yet.";
    case "NETWORK_RECOVERY":
      return "Connection was interrupted. We are restoring your session.";
    case "SAVE_IN_PROGRESS":
      return "Your portfolio is being secured. This may take a moment.";
    default:
      return "Please try again.";
  }
}

export function toInvestorLoading(stage: InvestorLoadingStage): string {
  switch (stage) {
    case "SESSION_CHECK":
      return "Checking your session...";
    case "ACCOUNT_STATE":
      return "Loading your account...";
    case "ONBOARDING":
      return "Preparing your guided setup...";
    case "MARKET":
      return "Loading market view...";
    case "ANALYSIS":
      return "Preparing your analysis...";
    case "VAULT":
      return "Opening your Vault...";
    default:
      return "Loading...";
  }
}

export function toInvestorDecisionLabel(
  decision: string | null | undefined,
  ownsPosition?: boolean | null
): InvestorDecisionDisplay {
  const normalized = String(decision || "").trim().toLowerCase();
  if (normalized === "buy") {
    return {
      label: "BUY",
      tone: "positive",
      guidance: "Build or add to position based on your plan.",
    };
  }
  if (normalized === "reduce" || normalized === "sell") {
    return {
      label: "REDUCE",
      tone: "negative",
      guidance: "Trim exposure to align with your risk limits.",
    };
  }
  if (normalized === "hold") {
    if (ownsPosition === true) {
      return {
        label: "HOLD",
        tone: "neutral",
        guidance: "Maintain position and monitor key updates.",
      };
    }
    return {
      label: "WATCH",
      tone: "neutral",
      guidance: "Track the name and wait for a clearer entry setup.",
    };
  }
  return {
    label: "REVIEW",
    tone: "neutral",
    guidance: "Review the full analysis before taking action.",
  };
}
