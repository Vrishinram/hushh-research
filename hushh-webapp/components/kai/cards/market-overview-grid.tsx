"use client";

import { Activity, ChartColumnIncreasing, TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent } from "@/lib/morphy-ux/card";
import { Icon } from "@/lib/morphy-ux/ui";
import { cn } from "@/lib/utils";

const METRICS = [
  {
    label: "S&P 500",
    value: "4,450",
    delta: "+0.8%",
    tone: "positive" as const,
    icon: TrendingUp,
  },
  {
    label: "NASDAQ",
    value: "13,780",
    delta: "-0.3%",
    tone: "negative" as const,
    icon: TrendingDown,
  },
  {
    label: "10Y Yield",
    value: "4.2%",
    delta: "Rising",
    tone: "neutral" as const,
    icon: ChartColumnIncreasing,
  },
  {
    label: "Volatility",
    value: "Moderate",
    delta: "VIX 15.4",
    tone: "warning" as const,
    icon: Activity,
  },
];

export function MarketOverviewGrid() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {METRICS.map((metric) => (
        <Card
          key={metric.label}
          variant="muted"
          effect="fill"
          className="rounded-xl p-0"
        >
          <CardContent className="flex h-[110px] flex-col justify-between p-4">
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-semibold text-muted-foreground">{metric.label}</span>
              <Icon icon={metric.icon} size="sm" className="text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="text-lg font-black tracking-tight leading-none">{metric.value}</p>
              <p
                className={cn(
                  "text-xs font-bold",
                  metric.tone === "positive" && "text-emerald-600 dark:text-emerald-400",
                  metric.tone === "negative" && "text-rose-600 dark:text-rose-400",
                  metric.tone === "warning" && "text-orange-600 dark:text-orange-400",
                  metric.tone === "neutral" && "text-muted-foreground"
                )}
              >
                {metric.delta}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
