"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Search,
  BarChart3,
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
import { Button } from "@/lib/morphy-ux/button";
import { format } from "date-fns";
import { HushhLoader } from "@/components/app-ui/hushh-loader";

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

// ============================================================================
// Main Component
// ============================================================================

export function AnalysisHistoryDashboard({
  userId,
  vaultKey,
  vaultOwnerToken,
  onSelectTicker: _onSelectTicker,
  onViewHistory,
}: AnalysisHistoryDashboardProps) {
  const [entries, setEntries] = useState<HistoryEntryWithVersion[]>([]);
  const [loading, setLoading] = useState(true);

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
    } else {
      setLoading(false);
    }
  }, [userId, vaultKey, fetchHistory]);

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
    return <EmptyState />;
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
          filterKey="decision"
          filterOptions={[
            { label: "Buy", value: "buy" },
            { label: "Hold", value: "hold" },
            { label: "Reduce", value: "reduce" },
          ]}
        />
      </div>

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
