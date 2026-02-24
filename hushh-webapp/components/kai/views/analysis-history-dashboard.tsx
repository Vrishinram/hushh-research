"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Search,
  BarChart3,
  MessageSquareText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "@/lib/morphy-ux/ui";
import { Badge } from "@/components/ui/badge";
// Search is provided globally via Kai layout (bottom bar)
import {
  KaiHistoryService,
  type AnalysisHistoryEntry,
  type AnalysisHistoryMap,
} from "@/lib/services/kai-history-service";
import { DataTable } from "@/components/app-ui/data-table";
import { getColumns, type HistoryEntryWithVersion } from "./columns";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/lib/morphy-ux/button";
import { format } from "date-fns";
import { HushhLoader } from "@/components/app-ui/hushh-loader";
import { WorldModelService } from "@/lib/services/world-model-service";
import { mapPortfolioToDashboardViewModel } from "@/components/kai/views/dashboard-data-mapper";
import type { PortfolioData } from "@/components/kai/types/portfolio";
import { DebateReadinessChart } from "@/components/kai/charts/debate-readiness-chart";

// ============================================================================
// Props
// ============================================================================

export interface AnalysisHistoryDashboardProps {
  userId: string;
  vaultKey: string;
  vaultOwnerToken?: string;
  onSelectTicker: (ticker: string) => void;
  onViewHistory: (entry: AnalysisHistoryEntry) => void;
}

interface DebateCoverageRow {
  key: string;
  label: string;
  value: number;
  detail: string;
}

interface DebateInputsSnapshot {
  hasPortfolio: boolean;
  eligibleSymbols: string[];
  coverageRows: DebateCoverageRow[];
  readinessScore: number;
  exclusionSummary: Array<{ reason: string; count: number }>;
}

// ============================================================================
// Helpers
// ============================================================================

/** Map decision string to display color classes */
function decisionStyles(decision: string): {
  bg: string;
  text: string;
  border: string;
  icon: React.ReactNode;
} {
  const d = decision.toLowerCase();
  if (d === "buy") {
    return {
      bg: "bg-emerald-500/10",
      text: "text-emerald-600 dark:text-emerald-400",
      border: "border-emerald-500/30",
      icon: <Icon icon={TrendingUp} size={12} />,
    };
  }
  if (d === "reduce" || d === "sell") {
    return {
      bg: "bg-red-500/10",
      text: "text-red-600 dark:text-red-400",
      border: "border-red-500/30",
      icon: <Icon icon={TrendingDown} size={12} />,
    };
  }
  // hold / other
  return {
    bg: "bg-amber-500/10",
    text: "text-amber-600 dark:text-amber-400",
    border: "border-amber-500/30",
    icon: <Icon icon={Minus} size={12} />,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function normalizeTickerInput(value: string): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");
}

function isTickerLike(value: string): boolean {
  return /^[A-Z][A-Z0-9.-]{0,5}$/.test(value);
}

function buildDebateInputsSnapshot(portfolio: PortfolioData): DebateInputsSnapshot {
  const mapped = mapPortfolioToDashboardViewModel(portfolio);
  const coverageRows: DebateCoverageRow[] = [
    {
      key: "ticker",
      label: "Ticker",
      value: clampPercent(mapped.canonicalModel.quality.tickerCoveragePct * 100),
      detail: "Holdings mapped to tradable symbols",
    },
    {
      key: "sector",
      label: "Sector",
      value: clampPercent(mapped.quality.sectorCoveragePct * 100),
      detail: "Investable positions with mapped sector labels",
    },
    {
      key: "gain-loss",
      label: "P/L",
      value: clampPercent(mapped.quality.gainLossCoveragePct * 100),
      detail: "Positions with gain/loss percentages",
    },
    {
      key: "investable",
      label: "Investable",
      value:
        mapped.canonicalModel.counts.totalPositions > 0
          ? clampPercent(
              (mapped.canonicalModel.counts.investablePositions
                / mapped.canonicalModel.counts.totalPositions)
                * 100
            )
          : 0,
      detail: "Positions eligible for debate runs",
    },
  ];

  const readinessScore =
    coverageRows.length > 0
      ? coverageRows.reduce((sum, row) => sum + row.value, 0) / coverageRows.length
      : 0;

  const reasonMap = new Map<string, number>();
  for (const row of mapped.canonicalModel.debateContext.excludedPositions) {
    const reason = String(row.reason || "unknown");
    reasonMap.set(reason, (reasonMap.get(reason) || 0) + 1);
  }
  const exclusionSummary = Array.from(reasonMap.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  return {
    hasPortfolio: mapped.canonicalModel.counts.totalPositions > 0,
    eligibleSymbols: mapped.canonicalModel.debateContext.eligibleSymbols,
    coverageRows,
    readinessScore,
    exclusionSummary,
  };
}

/**
 * Dedupe history table to one row per ticker.
 *
 * - We still compute a `version` for each entry (oldest=1 ... newest=N)
 * - The table shows ONLY the latest entry per ticker
 * - Older versions are accessible via the row action menu (handled in columns)
 */
function processHistory(map: AnalysisHistoryMap): HistoryEntryWithVersion[] {
  const latestPerTicker: HistoryEntryWithVersion[] = [];
  const epochOf = (value: string): number => {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : 0;
  };

  Object.entries(map).forEach(([tickerKey, entries]) => {
    if (!entries?.length) return;
    const canonicalTicker = String(tickerKey || "").trim().toUpperCase();
    if (!canonicalTicker || canonicalTicker === "UNDEFINED" || canonicalTicker === "NULL") {
      return;
    }

    // Sort entries for this ticker by date ASC to assign version numbers
    const sortedByDateAsc = [...entries].sort(
      (a, b) => epochOf(a.timestamp) - epochOf(b.timestamp)
    );

    const withVersions: HistoryEntryWithVersion[] = sortedByDateAsc.map((entry, index) => ({
      ...entry,
      ticker:
        typeof entry.ticker === "string" && entry.ticker.trim().length > 0
          ? entry.ticker
          : canonicalTicker,
      version: index + 1,
    }));

    // Latest is the newest timestamp
    const latest = withVersions[withVersions.length - 1];
    if (latest) latestPerTicker.push(latest);
  });

  // Sort tickers by latest analysis date DESC
  return latestPerTicker.sort(
    (a, b) => epochOf(b.timestamp) - epochOf(a.timestamp)
  );
}

// ============================================================================
// Empty State
// ============================================================================

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 space-y-6">
      <div className="p-4 rounded-full bg-primary/5 border border-primary/10">
        <Icon icon={BarChart3} size={32} className="text-primary/60" />
      </div>
      <div className="text-center space-y-2 max-w-sm">
        <h3 className="text-lg font-semibold">No analyses yet</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Search for a stock ticker below and let Agent Kai&apos;s multi-agent
          debate engine give you a data-driven recommendation.
        </p>
      </div>
    </div>
  );
}

interface DebateInputsCardProps {
  loading: boolean;
  snapshot: DebateInputsSnapshot | null;
  manualTicker: string;
  onManualTickerChange: (value: string) => void;
  onRunDebate: () => void;
  onSelectTicker: (ticker: string) => void;
  historyTickers: string[];
}

function DebateInputsCard({
  loading,
  snapshot,
  manualTicker,
  onManualTickerChange,
  onRunDebate,
  onSelectTicker,
  historyTickers,
}: DebateInputsCardProps) {
  const hasPortfolio = Boolean(snapshot?.hasPortfolio);
  const eligibleSymbols = snapshot?.eligibleSymbols || [];
  const coverageRows = snapshot?.coverageRows || [];
  const exclusionSummary = snapshot?.exclusionSummary || [];
  const quickStartTickers = eligibleSymbols.length > 0 ? eligibleSymbols : historyTickers;

  return (
    <Card className="rounded-[24px] border border-border/60 bg-card/70 shadow-[0_12px_36px_rgba(15,23,42,0.05)] backdrop-blur">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Icon icon={MessageSquareText} size="sm" className="text-primary" />
            Debate Inputs
          </CardTitle>
          <Badge variant="secondary" className="text-[11px] font-semibold">
            {eligibleSymbols.length} eligible
          </Badge>
        </div>
        <CardDescription>
          Start a debate directly from history using your current vault portfolio context.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={manualTicker}
            onChange={(event) => onManualTickerChange(event.target.value)}
            placeholder="Enter ticker (e.g. NVDA)"
            className="h-10"
          />
          <Button
            variant="blue-gradient"
            effect="fill"
            size="sm"
            className="h-10 min-w-[140px]"
            onClick={onRunDebate}
          >
            Start Debate
          </Button>
        </div>

        {loading ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-background/80 p-3 text-sm text-muted-foreground">
            Loading debate context from vault...
          </div>
        ) : !hasPortfolio ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-background/80 p-3 text-sm text-muted-foreground">
            No imported statement found for this user yet. Import/connect a statement to unlock portfolio-based debate inputs.
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-border/60 bg-background/80 p-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Overall readiness</span>
                <span className="font-semibold text-foreground">
                  {Math.round(snapshot?.readinessScore || 0)} / 100
                </span>
              </div>
              <Progress value={snapshot?.readinessScore || 0} className="mt-2 h-2" />
            </div>

            <DebateReadinessChart
              data={coverageRows.map((row) => ({
                key: row.key,
                label: row.label,
                value: row.value,
              }))}
              className="h-[220px] w-full"
            />

            <div className="grid gap-3 sm:grid-cols-2">
              {coverageRows.map((row) => (
                <div key={row.key} className="rounded-xl border border-border/60 bg-background/80 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold">{row.label}</span>
                    <span className="text-muted-foreground">{Math.round(row.value)}%</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{row.detail}</p>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="rounded-xl border border-border/60 bg-background/80 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Quick Start
          </p>
          {quickStartTickers.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {quickStartTickers.slice(0, 20).map((symbol) => (
                <Button
                  key={symbol}
                  variant="none"
                  effect="fade"
                  size="sm"
                  className="h-7 rounded-full px-2.5 text-xs"
                  onClick={() => onSelectTicker(symbol)}
                >
                  {symbol}
                </Button>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              No eligible symbols yet. Import a statement first or enter a ticker manually above.
            </p>
          )}
        </div>

        {exclusionSummary.length > 0 ? (
          <div className="rounded-xl border border-border/60 bg-background/80 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Exclusion Reasons
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {exclusionSummary.map((row) => (
                <span
                  key={row.reason}
                  className="rounded-full border border-border/60 bg-muted/40 px-2.5 py-1"
                >
                  {row.reason.replace(/_/g, " ")}: {row.count}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function AnalysisHistoryDashboard({
  userId,
  vaultKey,
  vaultOwnerToken,
  onSelectTicker,
  onViewHistory,
}: AnalysisHistoryDashboardProps) {
  const [entries, setEntries] = useState<HistoryEntryWithVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [debateSnapshot, setDebateSnapshot] = useState<DebateInputsSnapshot | null>(null);
  const [debateSnapshotLoading, setDebateSnapshotLoading] = useState(true);
  const [manualTicker, setManualTicker] = useState("");

  const [historyMap, setHistoryMap] = useState<AnalysisHistoryMap>({});
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionsTicker, setVersionsTicker] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    try {
      setLoading(true);
      const nextMap = await KaiHistoryService.getAllHistory({
        userId,
        vaultKey,
        vaultOwnerToken,
      });
      setHistoryMap(nextMap);
      setEntries(processHistory(nextMap));
    } catch (err) {
      console.error("[AnalysisHistoryDashboard] Failed to load history:", err);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [userId, vaultKey, vaultOwnerToken]);

  const fetchDebateSnapshot = useCallback(async () => {
    try {
      setDebateSnapshotLoading(true);
      const blob = await WorldModelService.loadFullBlob({
        userId,
        vaultKey,
        vaultOwnerToken,
      });

      const financialDomain = isRecord(blob.financial) ? blob.financial : null;
      const portfolioCandidate = financialDomain && isRecord(financialDomain.portfolio)
        ? financialDomain.portfolio
        : financialDomain;

      if (!isRecord(portfolioCandidate) || !Array.isArray(portfolioCandidate.holdings)) {
        setDebateSnapshot({
          hasPortfolio: false,
          eligibleSymbols: [],
          coverageRows: [],
          readinessScore: 0,
          exclusionSummary: [],
        });
        return;
      }

      const snapshot = buildDebateInputsSnapshot(portfolioCandidate as unknown as PortfolioData);
      setDebateSnapshot(snapshot);
    } catch (err) {
      console.warn("[AnalysisHistoryDashboard] Failed to load debate inputs context:", err);
      setDebateSnapshot({
        hasPortfolio: false,
        eligibleSymbols: [],
        coverageRows: [],
        readinessScore: 0,
        exclusionSummary: [],
      });
    } finally {
      setDebateSnapshotLoading(false);
    }
  }, [userId, vaultKey, vaultOwnerToken]);

  // ----- Delete Handlers -----

  const handleDeleteEntry = useCallback(async (entry: AnalysisHistoryEntry) => {
    const rawCard = entry.raw_card as Record<string, unknown> | undefined;
    const diagnostics = rawCard?.stream_diagnostics as Record<string, unknown> | undefined;
    const streamId = typeof diagnostics?.stream_id === "string" ? diagnostics.stream_id : null;
    const success = await KaiHistoryService.deleteEntry({
      userId,
      vaultKey,
      vaultOwnerToken,
      ticker: entry.ticker,
      timestamp: entry.timestamp,
      streamId,
    });

    if (success) {
      toast.success("Analysis deleted");
      fetchHistory();
    } else {
      toast.error("Failed to delete analysis");
    }
  }, [userId, vaultKey, vaultOwnerToken, fetchHistory]);

  const handleDeleteTicker = useCallback(async (ticker: string) => {
    const canonicalTicker = String(ticker || "").trim().toUpperCase();
    if (!canonicalTicker || canonicalTicker === "UNDEFINED" || canonicalTicker === "NULL") {
      toast.error("Failed to delete history: invalid ticker");
      return;
    }
    const success = await KaiHistoryService.deleteTickerHistory({
      userId,
      vaultKey,
      vaultOwnerToken,
      ticker: canonicalTicker,
    });

    if (success) {
      toast.success(`All history for ${canonicalTicker} deleted`);
      fetchHistory();
    } else {
      toast.error(`Failed to delete history for ${canonicalTicker}`);
    }
  }, [userId, vaultKey, vaultOwnerToken, fetchHistory]);

  // ----- Columns -----
  const openVersions = useCallback((ticker: string) => {
    setVersionsTicker(ticker);
    setVersionsOpen(true);
  }, []);

  const columns = getColumns({
    onView: onViewHistory,
    onDelete: handleDeleteEntry,
    onDeleteTicker: handleDeleteTicker,
    onViewVersions: openVersions,
  });

  const versionsForTicker: HistoryEntryWithVersion[] = useMemo(() => {
    if (!versionsTicker) return [];
    const list = historyMap[versionsTicker] || [];

    // Oldest -> newest for version numbering
    const sortedAsc = [...list].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const withVersions = sortedAsc.map((entry, index) => ({
      ...entry,
      version: index + 1,
    }));

    // Show newest first in the modal
    return withVersions.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [historyMap, versionsTicker]);

  useEffect(() => {
    if (userId && vaultKey) {
      fetchHistory();
      void fetchDebateSnapshot();
    } else {
      setLoading(false);
      setDebateSnapshotLoading(false);
    }
  }, [userId, vaultKey, fetchDebateSnapshot, fetchHistory]);

  const historyTickers = useMemo(() => {
    const unique = new Set<string>();
    for (const row of entries) {
      const ticker = String(row.ticker || "").trim().toUpperCase();
      if (!ticker || ticker === "UNDEFINED" || ticker === "NULL") continue;
      unique.add(ticker);
      if (unique.size >= 20) break;
    }
    return Array.from(unique);
  }, [entries]);

  const normalizedManualTicker = useMemo(
    () => normalizeTickerInput(manualTicker),
    [manualTicker]
  );

  const handleRunDebate = useCallback(() => {
    if (!isTickerLike(normalizedManualTicker)) {
      toast.error("Enter a valid ticker symbol to start debate");
      return;
    }
    onSelectTicker(normalizedManualTicker);
    setManualTicker("");
  }, [normalizedManualTicker, onSelectTicker]);

  // ----- Loading state -----
  if (loading) {
    return (
      <div className="px-4 sm:px-6 pb-safe max-w-4xl mx-auto">
        <div className="flex min-h-52 items-center justify-center rounded-2xl border border-border/40 bg-card/60">
          <HushhLoader variant="inline" label="Loading analysis history…" />
        </div>
      </div>
    );
  }

  // ----- Empty state -----
  if (entries.length === 0) {
    return (
      <div className="space-y-6 px-4 sm:px-6 pb-safe max-w-4xl mx-auto">
        <EmptyState />
        <DebateInputsCard
          loading={debateSnapshotLoading}
          snapshot={debateSnapshot}
          manualTicker={manualTicker}
          onManualTickerChange={setManualTicker}
          onRunDebate={handleRunDebate}
          onSelectTicker={onSelectTicker}
          historyTickers={historyTickers}
        />
      </div>
    );
  }

  // ----- Populated state -----
  return (
    <div className="space-y-6 px-4 sm:px-6 pb-safe max-w-4xl mx-auto">
      {/* Header (search is global in Kai layout) */}
      <div className="flex items-center gap-2">
        <Icon icon={Search} size="sm" className="text-muted-foreground" />
        <h2 className="app-section-heading text-muted-foreground uppercase tracking-[0.12em]">
          Analysis History
        </h2>
        <Badge variant="secondary" className="text-[10px]">
          {entries.length}
        </Badge>
      </div>

      {/* Data Table */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-10">
        <DataTable
          columns={columns}
          data={entries}
          searchKey="ticker"
          enableSearch={false}
          filterKey="decision"
          filterOptions={[
            { label: "Buy", value: "buy" },
            { label: "Hold", value: "hold" },
            { label: "Reduce", value: "reduce" },
          ]}
        />
      </div>

      <DebateInputsCard
        loading={debateSnapshotLoading}
        snapshot={debateSnapshot}
        manualTicker={manualTicker}
        onManualTickerChange={setManualTicker}
        onRunDebate={handleRunDebate}
        onSelectTicker={onSelectTicker}
        historyTickers={historyTickers}
      />

      {/* Versions Modal */}
      <Dialog
        open={versionsOpen}
        onOpenChange={(open) => {
          setVersionsOpen(open);
          if (!open) setVersionsTicker(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {versionsTicker ? `${versionsTicker} — Previous Versions` : "Previous Versions"}
            </DialogTitle>
          </DialogHeader>

          {versionsForTicker.length === 0 ? (
            <div className="text-sm text-muted-foreground">No previous versions found.</div>
          ) : (
            <div className="space-y-2">
              {versionsForTicker.map((entry) => {
                const styles = decisionStyles(entry.decision);
                const ts = entry.timestamp ? new Date(entry.timestamp) : null;

                return (
                  <Button
                    key={`${entry.ticker}-${entry.timestamp}`}
                    type="button"
                    variant="none"
                    effect="fade"
                    size="sm"
                    showRipple={false}
                    className="w-full justify-between h-auto py-3 px-3 border border-transparent hover:border-border/40"
                    onClick={() => {
                      onViewHistory(entry);
                      setVersionsOpen(false);
                      setVersionsTicker(null);
                    }}
                  >
                    <div className="flex flex-col items-start gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">v{entry.version}</span>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                            styles.bg,
                            styles.text,
                            styles.border
                          )}
                        >
                          {styles.icon}
                          {entry.decision}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {ts ? format(ts, "PPpp") : ""}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">Open</span>
                  </Button>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default AnalysisHistoryDashboard;
