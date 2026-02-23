"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "@/hooks/use-auth";
import { KaiSearchBar } from "@/components/kai/kai-search-bar";
import { useKaiSession } from "@/lib/stores/kai-session-store";
import { CacheService, CACHE_KEYS } from "@/lib/services/cache-service";
import { morphyToast as toast } from "@/lib/morphy-ux/morphy";
import { ROUTES } from "@/lib/navigation/routes";
import { useVault } from "@/lib/vault/vault-context";
import { getKaiChromeState } from "@/lib/navigation/kai-chrome-state";

function parseMaybeNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  const text = String(value).trim();
  if (!text || ["n/a", "na", "null", "none", "--", "-"].includes(text.toLowerCase())) {
    return undefined;
  }
  const negative = text.startsWith("(") && text.endsWith(")");
  const sanitized = text
    .replace(/[,$\s]/g, "")
    .replace(/%/g, "")
    .replace(/[()]/g, "");
  const parsed = Number(negative ? `-${sanitized}` : sanitized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

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
  const { isVaultUnlocked } = useVault();
  const setAnalysisParams = useKaiSession((s) => s.setAnalysisParams);
  const setLosersInput = useKaiSession((s) => s.setLosersInput);
  const busyOperations = useKaiSession((s) => s.busyOperations);
  const cache = useMemo(() => CacheService.getInstance(), []);
  const [hasPortfolioData, setHasPortfolioData] = useState(false);
  const chromeState = useMemo(() => getKaiChromeState(pathname), [pathname]);

  useEffect(() => {
    if (!user?.uid) {
      setHasPortfolioData(false);
      return;
    }

    const computeHasPortfolio = () => {
      const cachedPortfolio = cache.get<Record<string, unknown>>(
        CACHE_KEYS.PORTFOLIO_DATA(user.uid)
      );
      if (!cachedPortfolio || typeof cachedPortfolio !== "object") {
        setHasPortfolioData(false);
        return;
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
      setHasPortfolioData(holdings.length > 0);
    };

    computeHasPortfolio();
    const unsubscribe = cache.subscribe((event) => {
      if (event.type === "set" || event.type === "invalidate" || event.type === "invalidate_user" || event.type === "clear") {
        computeHasPortfolio();
      }
    });
    return unsubscribe;
  }, [cache, user?.uid]);

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
        asset_type: holding.asset_type ? String(holding.asset_type) : undefined,
        is_investable: typeof holding.is_investable === "boolean" ? holding.is_investable : undefined,
        analyze_eligible: computeAnalyzeEligibilityFromHolding(holding),
      });
    }
    return Array.from(deduped.values());
  }, [cache, user?.uid]);

  // Command palette is vault-gated and hidden on review/save overlays.
  if (loading || !user || !isVaultUnlocked || reviewScreenActive) {
    return null;
  }

  if (chromeState.hideCommandBar) {
    return null;
  }

  const userId = user.uid;

  const launchOptimizeFromCache = () => {
    const cache = CacheService.getInstance();
    const cachedPortfolio = cache.get<Record<string, unknown>>(
      CACHE_KEYS.PORTFOLIO_DATA(userId)
    );
    if (!cachedPortfolio || typeof cachedPortfolio !== "object") {
      toast.info("Import your portfolio to optimize with Kai.");
      router.push(ROUTES.KAI_IMPORT);
      return;
    }

    const nestedPortfolio =
      cachedPortfolio.portfolio &&
      typeof cachedPortfolio.portfolio === "object" &&
      !Array.isArray(cachedPortfolio.portfolio)
        ? (cachedPortfolio.portfolio as Record<string, unknown>)
        : null;
    const sourceHoldingsRaw = (Array.isArray(cachedPortfolio.holdings) && cachedPortfolio.holdings
      ? cachedPortfolio.holdings
      : Array.isArray(nestedPortfolio?.holdings)
        ? nestedPortfolio.holdings
      : []) as Array<Record<string, unknown>>;

    if (sourceHoldingsRaw.length === 0) {
      toast.info("No holdings found. Import your statement first.");
      router.push(ROUTES.KAI_IMPORT);
      return;
    }

    const totalValue = sourceHoldingsRaw.reduce((sum, holding) => {
      const mv = parseMaybeNumber(holding.market_value);
      return sum + (mv ?? 0);
    }, 0);

    const holdings = sourceHoldingsRaw
      .map((holding) => {
        const symbol = String(holding.symbol || "").trim().toUpperCase();
        if (!symbol) return null;
        const marketValue = parseMaybeNumber(holding.market_value);
        const gainLoss = parseMaybeNumber(holding.unrealized_gain_loss);
        const gainLossPct = parseMaybeNumber(holding.unrealized_gain_loss_pct);
        return {
          symbol,
          name: holding.name ? String(holding.name) : undefined,
          gain_loss_pct: gainLossPct,
          gain_loss: gainLoss,
          market_value: marketValue,
          weight_pct:
            totalValue > 0 && marketValue !== undefined
              ? (marketValue / totalValue) * 100
              : undefined,
          sector: holding.sector ? String(holding.sector) : undefined,
          asset_type: holding.asset_type ? String(holding.asset_type) : undefined,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    if (holdings.length === 0) {
      toast.info("No holdings found. Import your statement first.");
      router.push(ROUTES.KAI_IMPORT);
      return;
    }

    const losers = holdings
      .filter((holding) => holding.gain_loss_pct === undefined || holding.gain_loss_pct <= -5)
      .slice(0, 25);
    const forceOptimize = losers.length === 0;

    setLosersInput({
      userId,
      thresholdPct: -5,
      maxPositions: 10,
      losers,
      holdings,
      forceOptimize,
      hadBelowThreshold: losers.length > 0,
    });

    toast.info(
      "Optimizing suggestions using curated rulesets across your portfolio context."
    );
    router.push(ROUTES.KAI_OPTIMIZE);
  };

  return (
    <KaiSearchBar
      onCommand={(command, params) => {
        if (
          reviewDirty &&
          !window.confirm(
            "You have unsaved portfolio changes. Leaving now will discard them."
          )
        ) {
          return;
        }

        if (
          !hasPortfolioData &&
          (command === "analyze" ||
            command === "optimize" ||
            command === "history" ||
            command === "manage")
        ) {
          toast.info("Import your portfolio to unlock this command.");
          router.push(ROUTES.KAI_IMPORT);
          return;
        }

        if (command === "analyze" && params?.symbol) {
          const symbol = String(params.symbol).toUpperCase();
          setAnalysisParams({
            ticker: symbol,
            userId,
            riskProfile: "balanced",
          });
          router.push(ROUTES.KAI_ANALYSIS);
          return;
        }

        if (command === "optimize") {
          launchOptimizeFromCache();
          return;
        }

        if (command === "manage") {
          router.push(ROUTES.KAI_DASHBOARD);
          return;
        }

        if (command === "history") {
          router.push(ROUTES.KAI_ANALYSIS);
          return;
        }

        if (command === "dashboard") {
          router.push(ROUTES.KAI_DASHBOARD);
          return;
        }

        if (command === "home") {
          router.push(ROUTES.KAI_HOME);
        }
      }}
      hasPortfolioData={hasPortfolioData}
      portfolioTickers={portfolioTickers}
    />
  );
}
