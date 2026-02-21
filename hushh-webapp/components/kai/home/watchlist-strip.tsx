"use client";

import { Card, CardContent } from "@/lib/morphy-ux/card";
import type { KaiHomeWatchlistItem } from "@/lib/services/api-service";
import { cn } from "@/lib/utils";

interface WatchlistStripProps {
  items: KaiHomeWatchlistItem[];
}

function formatCurrency(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

export function WatchlistStrip({ items }: WatchlistStripProps) {
  if (!items.length) {
    return (
      <Card variant="muted" effect="fill" className="rounded-xl p-0">
        <CardContent className="p-4 text-sm text-muted-foreground">
          No watchlist/holdings data available yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2">
      <div className="flex min-w-0 gap-3">
        {items.map((item) => {
          const positive = typeof item.change_pct === "number" && item.change_pct >= 0;
          return (
            <Card key={item.symbol} variant="none" effect="glass" className="w-[182px] shrink-0 rounded-xl p-0">
              <CardContent className="space-y-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black">{item.symbol}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{item.company_name}</p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide",
                      item.degraded ? "bg-muted text-muted-foreground" : "bg-background/70 text-foreground/80"
                    )}
                  >
                    {item.recommendation}
                  </span>
                </div>

                <div>
                  <p className="text-base font-extrabold tracking-tight">{formatCurrency(item.price)}</p>
                  <p
                    className={cn(
                      "text-xs font-semibold",
                      positive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                    )}
                  >
                    {typeof item.change_pct === "number" ? `${item.change_pct >= 0 ? "+" : ""}${item.change_pct.toFixed(2)}%` : "--"}
                  </p>
                </div>

                <div className="flex flex-wrap gap-1">
                  {(item.source_tags || []).slice(0, 2).map((tag) => (
                    <span key={`${item.symbol}-${tag}`} className="rounded-full bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground">
                      {tag}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
