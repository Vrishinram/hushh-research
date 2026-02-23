"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Compass,
  History,
  Search,
  Settings2,
} from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  getTickerUniverseSnapshot,
  preloadTickerUniverse,
  searchTickerUniverseRemote,
  searchTickerUniverse,
  type TickerUniverseRow,
} from "@/lib/kai/ticker-universe-cache";
import { Icon } from "@/lib/morphy-ux/ui";

export type KaiCommandAction =
  | "analyze"
  | "optimize"
  | "manage"
  | "history"
  | "dashboard"
  | "home";

interface KaiCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommand: (command: KaiCommandAction, params?: Record<string, unknown>) => void;
  hasPortfolioData?: boolean;
  portfolioTickers?: Array<{
    symbol: string;
    name?: string;
    asset_type?: string;
    is_investable?: boolean;
    analyze_eligible?: boolean;
  }>;
}

function isPortfolioAnalyzeEligible(row: {
  is_investable?: boolean;
  analyze_eligible?: boolean;
  asset_type?: string;
}): boolean {
  if (typeof row.analyze_eligible === "boolean") return row.analyze_eligible;
  if (row.is_investable !== true) return false;
  const assetType = String(row.asset_type || "").toLowerCase();
  if (
    assetType.includes("cash") ||
    assetType.includes("sweep") ||
    assetType.includes("bond") ||
    assetType.includes("fixed income")
  ) {
    return false;
  }
  return true;
}

function isLikelySecCommonEquityRow(row: TickerUniverseRow): boolean {
  if (row.tradable === false) return false;
  const ticker = String(row.ticker || "").trim().toUpperCase();
  if (!ticker) return false;

  const combined = [
    String(row.title || ""),
    String(row.sector || row.sector_primary || ""),
    String(row.industry || row.industry_primary || ""),
    String(row.sic_description || ""),
  ]
    .join(" ")
    .toLowerCase();

  if (ticker.endsWith("X")) return false;
  if (
    /(?:\betf\b|\bfund\b|\bmutual\b|\btrust\b|\bmoney market\b|\bcash\b|\bsweep\b|\bbond\b|\bfixed income\b|\btreasury\b|\bmunicipal\b|\breit\b|\bcommodity\b|\bgold\b)/i.test(
      combined
    )
  ) {
    return false;
  }
  return true;
}

export function KaiCommandPalette({
  open,
  onOpenChange,
  onCommand,
  hasPortfolioData = true,
  portfolioTickers = [],
}: KaiCommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [universe, setUniverse] = useState<TickerUniverseRow[] | null>(
    getTickerUniverseSnapshot()
  );
  const [loadingUniverse, setLoadingUniverse] = useState<boolean>(!universe);
  const [remoteMatches, setRemoteMatches] = useState<TickerUniverseRow[]>([]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        if (!universe) setLoadingUniverse(true);
        const rows = await preloadTickerUniverse();
        if (!cancelled) {
          setUniverse(rows);
        }
      } catch {
        if (!cancelled) {
          setUniverse((prev) => prev ?? []);
        }
      } finally {
        if (!cancelled) {
          setLoadingUniverse(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [universe]);

  useEffect(() => {
    let cancelled = false;
    const q = query.trim();
    if (q.length < 2) {
      setRemoteMatches([]);
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const rows = await searchTickerUniverseRemote(q, 20);
          if (!cancelled) {
            setRemoteMatches(rows);
          }
        } catch {
          if (!cancelled) {
            setRemoteMatches([]);
          }
        }
      })();
    }, 160);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const portfolioRows = useMemo<TickerUniverseRow[]>(() => {
    const deduped = new Map<string, TickerUniverseRow>();
    for (const row of portfolioTickers) {
      const symbol = String(row.symbol || "").trim().toUpperCase();
      if (!symbol) continue;
      if (!isPortfolioAnalyzeEligible(row)) continue;
      if (deduped.has(symbol)) continue;
      deduped.set(symbol, {
        ticker: symbol,
        title: String(row.name || "").trim() || "Portfolio holding",
        sector_primary: row.asset_type ? String(row.asset_type) : undefined,
        exchange: "Portfolio",
        metadata_confidence: 1,
        tradable: true,
      });
    }
    return Array.from(deduped.values());
  }, [portfolioTickers]);

  const tickerMatches = useMemo(() => {
    const rows = universe ?? [];
    const search = query.trim();
    if (!search) {
      // Default list is portfolio-only so we never silently fall back to non-portfolio symbols.
      return [...portfolioRows]
        .sort((a, b) => Number(b.metadata_confidence || 0) - Number(a.metadata_confidence || 0))
        .slice(0, 12);
    }
    const searchUpper = search.toUpperCase();
    const portfolioMatches = portfolioRows.filter((row) => {
      const title = String(row.title || "").toLowerCase();
      return row.ticker.includes(searchUpper) || title.includes(search.toLowerCase());
    });
    const local = searchTickerUniverse(rows, search, 20).filter((row) =>
      isLikelySecCommonEquityRow(row)
    );
    const merged = [...portfolioMatches, ...local];
    for (const row of remoteMatches) {
      if (!isLikelySecCommonEquityRow(row)) continue;
      if (!merged.some((candidate) => candidate.ticker === row.ticker)) {
        merged.push(row);
      }
    }
    const qUpper = searchUpper;
    return merged
      .filter((row) => row.tradable !== false)
      .sort((a, b) => {
        const aPrefix = a.ticker.startsWith(qUpper) ? 1 : 0;
        const bPrefix = b.ticker.startsWith(qUpper) ? 1 : 0;
        if (aPrefix !== bPrefix) return bPrefix - aPrefix;
        const aScore = Number(a.metadata_confidence || 0);
        const bScore = Number(b.metadata_confidence || 0);
        if (aScore !== bScore) return bScore - aScore;
        return a.ticker.localeCompare(b.ticker);
      })
      .slice(0, 20);
  }, [portfolioRows, query, universe, remoteMatches]);

  function run(command: KaiCommandAction, params?: Record<string, unknown>) {
    onOpenChange(false);
    setQuery("");
    onCommand(command, params);
  }

  const commandItemClass =
    "rounded-lg border border-transparent transition-colors duration-300 hover:bg-primary/10 hover:text-foreground data-[selected=true]:border-primary/25 data-[selected=true]:bg-primary/15 data-[selected=true]:text-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-45";

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Run Kai command or search ticker..."
      />
      <CommandList>
        <CommandEmpty>
          {loadingUniverse ? "Loading commands..." : "No matching commands."}
        </CommandEmpty>

        <CommandGroup heading="Portfolio Actions">
          <CommandItem className={commandItemClass} onSelect={() => run("dashboard")}>
            <Icon icon={BarChart3} size="sm" className="mr-2 text-muted-foreground" />
            Dashboard
          </CommandItem>
          <CommandItem
            className={commandItemClass}
            disabled={!hasPortfolioData}
            onSelect={() => run("optimize")}
          >
            <Icon icon={Activity} size="sm" className="mr-2 text-muted-foreground" />
            Optimize Portfolio
          </CommandItem>
          <CommandItem
            className={commandItemClass}
            disabled={!hasPortfolioData}
            onSelect={() => run("manage")}
          >
            <Icon icon={Settings2} size="sm" className="mr-2 text-muted-foreground" />
            Manage Portfolio
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Intelligence">
          <CommandItem
            className={commandItemClass}
            disabled={!hasPortfolioData}
            onSelect={() => run("history")}
          >
            <Icon icon={History} size="sm" className="mr-2 text-muted-foreground" />
            Analysis History
          </CommandItem>
          <CommandItem className={commandItemClass} onSelect={() => run("home")}>
            <Icon icon={Compass} size="sm" className="mr-2 text-muted-foreground" />
            Kai Home
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Analyze Stock">
          {!hasPortfolioData && (
            <CommandItem className={commandItemClass} disabled>
              Import portfolio to enable stock analysis.
            </CommandItem>
          )}
          {hasPortfolioData && portfolioRows.length === 0 && !query.trim() && (
            <CommandItem className={commandItemClass} disabled>
              No analyzable SEC common equity holdings in current portfolio.
            </CommandItem>
          )}
          {hasPortfolioData && portfolioRows.length === 0 && query.trim() && (
            <CommandItem className={commandItemClass} disabled>
              Showing SEC common equity search results only.
            </CommandItem>
          )}
          {tickerMatches.map((row) => {
            const ticker = row.ticker.toUpperCase();
            const title = row.title || "Unknown company";
            return (
              <CommandItem
                className={commandItemClass}
                key={`${ticker}:${title}`}
                value={`${ticker} ${title} ${row.sector || row.sector_primary || ""} ${row.exchange || ""}`}
                disabled={!hasPortfolioData}
                onSelect={() => run("analyze", { symbol: ticker })}
              >
                <Icon icon={Search} size="sm" className="mr-2 text-muted-foreground" />
                <span className="font-semibold">{ticker}</span>
                <span className="ml-2 text-xs text-muted-foreground truncate">
                  {title}
                  {row.sector || row.sector_primary
                    ? ` • ${row.sector || row.sector_primary}`
                    : ""}
                </span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
