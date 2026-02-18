"use client";

import { LineChart } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { Card } from "@/lib/morphy-ux/card";
import { PortfolioMetricsCard } from "@/components/kai/cards/portfolio-metrics-card";

type MetricsHolding = Parameters<typeof PortfolioMetricsCard>[0]["holdings"][number];

const MOCK_HOLDINGS = [
  { symbol: "TSLA", name: "Tesla", market_value: 52000, est_yield: 0, sector: "Automotive" },
  { symbol: "AAPL", name: "Apple", market_value: 38000, est_yield: 0, sector: "Technology" },
  { symbol: "MSFT", name: "Microsoft", market_value: 28000, est_yield: 0.8, sector: "Technology" },
  { symbol: "BND", name: "Vanguard Total Bond Market", market_value: 14000, est_yield: 3.4, sector: "Bonds" },
  { symbol: "CASH", name: "Cash", market_value: 10893, est_yield: 0, sector: "Cash" },
] as const;

export function PortfolioPreviewCompact() {
  const totalValue = 142_893;
  const allocationEquityPct = 72;

  return (
    <div className="space-y-4">
      <Card
        variant="none"
        effect="glass"
        preset="hero"
        showRipple={false}
      >
        <div className="p-6 space-y-5">
          <div className="text-center">
            <p className="text-xs tracking-widest text-muted-foreground uppercase">
              Total value
            </p>
            <p className="text-4xl font-black tracking-tight mt-1">$142,893</p>
            <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-[var(--brand-50)] px-3 py-1 text-xs font-bold text-[var(--brand-700)]">
              <LineChart className="h-4 w-4" />
              +2.4%
              <span className="font-medium text-muted-foreground">Overall</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold">Allocation</span>
              <span className="text-muted-foreground">Equity Heavy</span>
            </div>
            <Progress value={allocationEquityPct} className="h-2" />
            <div className="flex items-center gap-6 text-xs text-muted-foreground pt-1">
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-foreground/80" /> Stocks
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-foreground/30" /> Bonds
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-foreground/10" /> Cash
              </span>
            </div>
          </div>
        </div>
      </Card>

      <PortfolioMetricsCard
        // Compact preview only; Kai dashboard uses real holdings.
        holdings={MOCK_HOLDINGS as unknown as MetricsHolding[]}
        totalValue={totalValue}
      />
    </div>
  );
}
