"use client";

import { ArrowLeft, BarChart3, RefreshCw, Scale } from "lucide-react";

import { Button } from "@/lib/morphy-ux/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/lib/morphy-ux/card";
import { Icon } from "@/lib/morphy-ux/ui";
import type { AnalysisHistoryEntry } from "@/lib/services/kai-history-service";
import { cn } from "@/lib/utils";

interface AnalysisSummaryViewProps {
  entry: AnalysisHistoryEntry;
  onBack: () => void;
  onOpenDebate: () => void;
  onReanalyze: (ticker: string) => void;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return "Updated recently";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Updated recently";
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ScoreBar({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | null;
  tone: "neutral" | "positive" | "warning";
}) {
  const clamped = value === null ? null : Math.max(0, Math.min(10, value));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-sm font-bold tabular-nums">
          {clamped === null ? "N/A" : `${clamped.toFixed(1)} / 10`}
        </p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            tone === "positive" && "bg-emerald-500",
            tone === "warning" && "bg-blue-500",
            tone === "neutral" && "bg-zinc-900 dark:bg-zinc-100"
          )}
          style={{ width: `${clamped === null ? 0 : clamped * 10}%` }}
        />
      </div>
    </div>
  );
}

export function AnalysisSummaryView({
  entry,
  onBack,
  onOpenDebate,
  onReanalyze,
}: AnalysisSummaryViewProps) {
  const rawCard = (entry.raw_card || {}) as Record<string, unknown>;
  const companyStrength = readNumber(rawCard.company_strength_score);
  const marketTrendScore = readNumber(rawCard.market_trend_score);
  const fairValueScore = readNumber(rawCard.fair_value_score);
  const marketTrendLabel = String(rawCard.market_trend_label || "Trend unavailable");
  const fairValueLabel = String(rawCard.fair_value_label || "Fair value unavailable");
  const shortRecommendation = String(
    rawCard.short_recommendation || entry.final_statement || "Recommendation unavailable."
  );
  const updatedAt = formatTimestamp(String(rawCard.analysis_updated_at || entry.timestamp || ""));

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 pb-safe pt-4">
      <div className="flex items-center justify-between gap-3">
        <Button variant="none" effect="fade" size="sm" onClick={onBack}>
          <Icon icon={ArrowLeft} size="sm" className="mr-1" />
          History
        </Button>
        <Button variant="none" effect="fade" size="sm" onClick={() => onReanalyze(entry.ticker)}>
          <Icon icon={RefreshCw} size="sm" className="mr-1" />
          Re-analyze
        </Button>
      </div>

      <Card variant="none" effect="glass" className="rounded-2xl p-0">
        <CardHeader className="pb-1">
          <div className="space-y-1">
            <CardTitle className="text-xl font-black tracking-tight">{entry.ticker} Insight</CardTitle>
            <p className="text-xs text-muted-foreground">{updatedAt}</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pt-3">
          <ScoreBar label="Company Strength" value={companyStrength} tone="neutral" />
          <div className="space-y-1">
            <ScoreBar label={`Market Trend (${marketTrendLabel})`} value={marketTrendScore} tone="positive" />
          </div>
          <div className="space-y-1">
            <ScoreBar label={`Fair Value (${fairValueLabel})`} value={fairValueScore} tone="warning" />
          </div>
        </CardContent>
      </Card>

      <Card variant="muted" effect="fill" className="rounded-2xl p-0">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            <Icon icon={BarChart3} size="xs" />
            Recommendation Summary
          </div>
          <p className="text-sm leading-relaxed">{shortRecommendation}</p>
          <Button variant="blue-gradient" effect="fill" size="sm" onClick={onOpenDebate}>
            <Icon icon={Scale} size="sm" className="mr-1" />
            Open Detailed Debate
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
