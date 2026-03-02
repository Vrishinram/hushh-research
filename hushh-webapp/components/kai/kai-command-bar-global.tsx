"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "@/hooks/use-auth";
import { KaiSearchBar } from "@/components/kai/kai-search-bar";
import { useKaiSession } from "@/lib/stores/kai-session-store";
import { CacheService, CACHE_KEYS } from "@/lib/services/cache-service";
import { useVault } from "@/lib/vault/vault-context";
import { getKaiChromeState } from "@/lib/navigation/kai-chrome-state";
import { WorldModelService } from "@/lib/services/world-model-service";
import { executeKaiCommand } from "@/lib/kai/command-executor";
import type { KaiCommandAction } from "@/lib/kai/kai-command-types";
import { useNavigation } from "@/lib/navigation/navigation-context";
import { dispatchVoiceToolCall } from "@/lib/voice/voice-action-dispatcher";
import { useVoiceSession } from "@/lib/voice/voice-session-store";

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

function computeAnalyzeEligibilityFromHolding(holding: Record<string, unknown>): boolean {
  const isInvestable = toBoolean(holding.is_investable) === true;
  if (!isInvestable) return false;

  const listingStatus = String(holding.security_listing_status || "")
    .trim()
    .toLowerCase();
  const symbolKind = String(holding.symbol_kind || "")
    .trim()
    .toLowerCase();
  const isSecCommon = toBoolean(holding.is_sec_common_equity_ticker) === true;

  if (listingStatus === "non_sec_common_equity") return false;
  if (listingStatus === "fixed_income") return false;
  if (listingStatus === "cash_or_sweep") return false;

  if (isSecCommon) return true;
  if (listingStatus === "sec_common_equity") return true;
  if (symbolKind === "us_common_equity_ticker") return true;

  return false;
}

export function KaiCommandBarGlobal() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const { isVaultUnlocked, vaultOwnerToken, vaultKey } = useVault();
  const { handleBack } = useNavigation();
  const setAnalysisParams = useKaiSession((s) => s.setAnalysisParams);
  const busyOperations = useKaiSession((s) => s.busyOperations);
  const analysisParams = useKaiSession((s) => s.analysisParams);
  const { lastTranscript, lastToolName, lastTicker, setLastVoiceTurn } = useVoiceSession();
  const cache = useMemo(() => CacheService.getInstance(), []);
  const [hasPortfolioData, setHasPortfolioData] = useState(false);
  const chromeState = useMemo(() => getKaiChromeState(pathname), [pathname]);

  useEffect(() => {
    if (!user?.uid) {
      setHasPortfolioData(false);
      return;
    }

    const computeHasPortfolioFromCache = (): boolean | null => {
      const cachedPortfolio = cache.get<Record<string, unknown>>(
        CACHE_KEYS.PORTFOLIO_DATA(user.uid)
      );
      if (!cachedPortfolio || typeof cachedPortfolio !== "object") {
        return null;
      }
      const nestedPortfolio =
        cachedPortfolio.portfolio &&
        typeof cachedPortfolio.portfolio === "object" &&
        !Array.isArray(cachedPortfolio.portfolio)
          ? (cachedPortfolio.portfolio as Record<string, unknown>)
          : null;
      const holdings = (Array.isArray(cachedPortfolio.holdings) && cachedPortfolio.holdings
        ? cachedPortfolio.holdings
        : Array.isArray(nestedPortfolio?.holdings)
          ? nestedPortfolio.holdings
        : []) as Array<Record<string, unknown>>;
      return holdings.length > 0;
    };

    let cancelled = false;

    const computeHasPortfolio = async () => {
      const cachedHasPortfolio = computeHasPortfolioFromCache();
      if (cachedHasPortfolio !== null) {
        if (!cancelled) {
          setHasPortfolioData(cachedHasPortfolio);
        }
        return;
      }

      if (!isVaultUnlocked || !vaultOwnerToken) {
        if (!cancelled) {
          setHasPortfolioData(false);
        }
        return;
      }

      try {
        const metadata = await WorldModelService.getMetadata(
          user.uid,
          false,
          vaultOwnerToken
        );
        if (cancelled) return;
        const financialDomain = metadata.domains.find((domain) => domain.key === "financial");
        const hasPortfolioFromMetadata = Boolean(
          financialDomain && Number(financialDomain.attributeCount || 0) > 0
        );

        setHasPortfolioData(hasPortfolioFromMetadata);
      } catch {
        if (!cancelled) {
          setHasPortfolioData(false);
        }
      }
    };

    void computeHasPortfolio();
    const unsubscribe = cache.subscribe((event) => {
      if (event.type === "set" || event.type === "invalidate" || event.type === "invalidate_user" || event.type === "clear") {
        void computeHasPortfolio();
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [cache, isVaultUnlocked, user?.uid, vaultOwnerToken]);

  const reviewScreenActive = Boolean(
    busyOperations["portfolio_review_active"] || busyOperations["portfolio_save"]
  );
  const reviewDirty = Boolean(
    busyOperations["portfolio_review_active"] && busyOperations["portfolio_review_dirty"]
  );

  const portfolioTickers = useMemo(() => {
    if (!user?.uid) return [] as Array<{
      symbol: string;
      name?: string;
      sector?: string;
      asset_type?: string;
      is_investable?: boolean;
      analyze_eligible?: boolean;
    }>;

    const cachedPortfolio =
      cache.get<Record<string, unknown>>(CACHE_KEYS.PORTFOLIO_DATA(user.uid)) ??
      cache.get<Record<string, unknown>>(CACHE_KEYS.DOMAIN_DATA(user.uid, "financial"));
    const nestedPortfolio =
      cachedPortfolio?.portfolio &&
      typeof cachedPortfolio.portfolio === "object" &&
      !Array.isArray(cachedPortfolio.portfolio)
        ? (cachedPortfolio.portfolio as Record<string, unknown>)
        : null;
    const holdings = (
      (Array.isArray(cachedPortfolio?.holdings) && cachedPortfolio.holdings) ||
      (Array.isArray(nestedPortfolio?.holdings) && nestedPortfolio.holdings) ||
      []
    ) as Array<Record<string, unknown>>;

    const deduped = new Map<
      string,
      {
        symbol: string;
        name?: string;
        sector?: string;
        asset_type?: string;
        is_investable?: boolean;
        analyze_eligible?: boolean;
      }
    >();
    for (const holding of holdings) {
      const symbol = String(holding.symbol || "").trim().toUpperCase();
      if (!symbol) continue;
      if (deduped.has(symbol)) continue;
      deduped.set(symbol, {
        symbol,
        name: holding.name ? String(holding.name) : undefined,
        sector: holding.sector ? String(holding.sector) : undefined,
        asset_type: holding.asset_type ? String(holding.asset_type) : undefined,
        is_investable: typeof holding.is_investable === "boolean" ? holding.is_investable : undefined,
        analyze_eligible: computeAnalyzeEligibilityFromHolding(holding),
      });
    }
    return Array.from(deduped.values());
  }, [cache, user?.uid]);

  const userId = user?.uid ?? "";
  // Command palette is hidden only during loading/review overlays.
  const voiceContext = useMemo(
    () => ({
      route: pathname,
      busy_operations: Object.keys(busyOperations),
      stock_analysis_active: Boolean(busyOperations["stock_analysis_active"]),
      last_tool_name: lastToolName,
      last_ticker: lastTicker,
      last_transcript: lastTranscript,
      current_ticker: analysisParams?.ticker || null,
      has_portfolio_data: hasPortfolioData,
    }),
    [
      analysisParams?.ticker,
      busyOperations,
      hasPortfolioData,
      lastTicker,
      lastToolName,
      lastTranscript,
      pathname,
    ]
  );

  const runKaiCommand = (command: KaiCommandAction, params?: Record<string, unknown>) => {
    const result = executeKaiCommand({
      command,
      params,
      router,
      userId,
      hasPortfolioData,
      reviewDirty,
      busyOperations,
      setAnalysisParams,
    });
    console.info(
      `[VOICE_UI] execute_kai_command command=${command} status=${result.status}${result.reason ? ` reason=${result.reason}` : ""}`
    );
    return result;
  };

  if (loading || !user || reviewScreenActive) {
    return null;
  }

  if (chromeState.hideCommandBar) {
    return null;
  }

  return (
    <KaiSearchBar
      onCommand={(command, params) => {
        runKaiCommand(command, params);
      }}
      onVoiceToolCall={async (toolCall, transcript) => {
        console.info("[VOICE_UI] onVoiceToolCall_received=", toolCall, "transcript=", transcript);
        const tickerFromTool =
          toolCall.tool_name === "execute_kai_command" &&
          toolCall.args.command === "analyze" &&
          toolCall.args.params?.symbol
            ? toolCall.args.params.symbol
            : null;
        setLastVoiceTurn({
          transcript,
          toolName: toolCall.tool_name,
          ticker: tickerFromTool,
        });
        await dispatchVoiceToolCall({
          toolCall,
          userId,
          vaultOwnerToken: vaultOwnerToken || undefined,
          vaultKey: vaultKey || undefined,
          router,
          handleBack,
          executeKaiCommand: () =>
            toolCall.tool_name === "execute_kai_command"
              ? runKaiCommand(toolCall.args.command, toolCall.args.params)
              : { status: "invalid", reason: "not_execute_tool" },
          setAnalysisParams,
        });
      }}
      hasPortfolioData={hasPortfolioData}
      userId={userId}
      vaultOwnerToken={vaultOwnerToken || undefined}
      voiceContext={voiceContext}
      portfolioTickers={portfolioTickers}
    />
  );
}
