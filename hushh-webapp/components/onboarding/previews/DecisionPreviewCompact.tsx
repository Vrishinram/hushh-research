"use client";

import { Minus, Sparkles, TrendingDown, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { DecisionResult } from "@/components/kai/views/decision-card";
import { Card } from "@/lib/morphy-ux/card";
import { cn } from "@/lib/utils";

type Decision = DecisionResult["decision"];

export function DecisionPreviewCompact() {
  const decision: Decision = "BUY";

  return (
    <Card
      variant="none"
      effect="glass"
      preset="hero"
      showRipple={false}
    >
      <div className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-2xl bg-muted/40 grid place-items-center">
                <Sparkles className="h-4 w-4 text-[var(--brand-600)]" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-widest">
                  TSLA
                </p>
                <p className="text-sm font-semibold">Analysis</p>
              </div>
            </div>
          </div>

          <Badge
            variant="outline"
            className={cn(
              "rounded-full px-3 py-1 text-xs font-extrabold tracking-wider",
              decisionTone(decision).badge
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              {renderDecisionIcon(decision, "h-3.5 w-3.5")}
              {decision}
            </span>
          </Badge>
        </div>

        <div className="space-y-2">
          <Point
            title="Company strength"
            text="Expanding margins with resilient demand."
            tone="good"
          />
          <Point
            title="Market trend"
            text="Momentum supported by institutional flow."
            tone="good"
          />
          <Point
            title="Price value"
            text="Attractive entry for long-term growth."
            tone="neutral"
          />
        </div>

        <div className="pt-1 text-xs text-muted-foreground">
          Conviction: High · Horizon: 12+ months
        </div>
      </div>
    </Card>
  );
}

function decisionTone(decision: Decision): { badge: string; icon: string } {
  switch (decision) {
    case "BUY":
      return { badge: "border-emerald-500/30 text-emerald-600 bg-emerald-500/10", icon: "text-emerald-600" };
    case "REDUCE":
      return { badge: "border-red-500/30 text-red-600 bg-red-500/10", icon: "text-red-600" };
    default:
      return { badge: "border-amber-500/30 text-amber-700 bg-amber-500/10", icon: "text-amber-700" };
  }
}

function renderDecisionIcon(decision: Decision, className?: string) {
  const tone = decisionTone(decision);
  if (decision === "BUY") return <TrendingUp className={cn(className, tone.icon)} />;
  if (decision === "REDUCE") return <TrendingDown className={cn(className, tone.icon)} />;
  return <Minus className={cn(className, tone.icon)} />;
}

function Point(props: { title: string; text: string; tone: "good" | "neutral" }) {
  const indicator =
    props.tone === "good"
      ? "bg-emerald-500/70"
      : "bg-muted-foreground/40";

  return (
    <div className="rounded-2xl bg-muted/30 px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-[10px] font-extrabold tracking-[0.18em] text-muted-foreground uppercase">
            {props.title}
          </p>
          <p className="text-sm font-semibold leading-snug">{props.text}</p>
        </div>
        <span className={cn("mt-1 h-2.5 w-2.5 rounded-full", indicator)} aria-hidden />
      </div>
    </div>
  );
}
