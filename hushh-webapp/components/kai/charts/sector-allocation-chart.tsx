// components/kai/charts/sector-allocation-chart.tsx

/**
 * Sector Allocation Chart
 * 
 * Features:
 * - Horizontal bar chart showing portfolio allocation by sector
 * - Interactive bars with hover effects
 * - Responsive design with shadcn ChartContainer
 * - Theme-aware colors from design system
 * - Shows both value and percentage
 */

"use client";

import { useMemo, useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell,
  LabelList,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/lib/morphy-ux/card";
import { PieChart as PieChartIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

interface Holding {
  symbol: string;
  name: string;
  market_value: number;
  sector?: string;
  asset_type?: string;
}

interface SectorAllocationChartProps {
  holdings: Holding[];
  className?: string;
  responsive?: boolean;
  title?: string;
  subtitle?: string;
}

interface SectorHoldingItem {
  symbol: string;
  name: string;
  marketValue: number;
}

interface SectorDatum {
  name: string;
  value: number;
  count: number;
  percent: number;
  color: string;
  holdings: SectorHoldingItem[];
}

// Distinct palette so neighboring sectors are easy to scan.
const CHART_COLORS = [
  "#2563eb",
  "#0ea5e9",
  "#14b8a6",
  "#22c55e",
  "#f59e0b",
  "#f97316",
  "#8b5cf6",
  "#ec4899",
];

const HOLDINGS_PAGE_SIZE = 10;

function formatCurrency(value: number): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  return `$${value.toFixed(0)}`;
}

function _formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function compactSectorLabel(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 17)}…`;
}

export function SectorAllocationChart({
  holdings,
  className,
  responsive = true,
  title = "Sector Allocation",
  subtitle,
}: SectorAllocationChartProps) {
  const [windowWidth, setWindowWidth] = useState<number>(
    typeof window !== "undefined" ? window.innerWidth : 1024
  );
  const [sectorHoldingPages, setSectorHoldingPages] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!responsive) return;

    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [responsive]);
  // Aggregate holdings by sector
  const sectorData = useMemo(() => {
    const sectorMap = new Map<
      string,
      { value: number; count: number; holdings: SectorHoldingItem[] }
    >();
    
    holdings.forEach((holding) => {
      const normalizedSector = String(holding.sector || "").trim() || "Unclassified";
      
      const existing = sectorMap.get(normalizedSector) || { value: 0, count: 0, holdings: [] };
      sectorMap.set(normalizedSector, {
        value: existing.value + (holding.market_value || 0),
        count: existing.count + 1,
        holdings: [
          ...existing.holdings,
          {
            symbol: String(holding.symbol || "").trim().toUpperCase() || "—",
            name: String(holding.name || "").trim() || "Unnamed security",
            marketValue: Number(holding.market_value || 0),
          },
        ],
      });
    });

    const totalValue = Array.from(sectorMap.values()).reduce((sum, s) => sum + s.value, 0);
    
    // Convert to array and sort by value, assign colors by index
    const data: SectorDatum[] = Array.from(sectorMap.entries())
      .map(([name, { value, count, holdings }]) => ({
        name,
        value,
        count,
        percent: totalValue > 0 ? (value / totalValue) * 100 : 0,
        holdings: holdings
          .slice()
          .sort((a, b) => b.marketValue - a.marketValue),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8) // Top 8 sectors
      .map((item, index) => ({
        ...item,
        color: CHART_COLORS[index % CHART_COLORS.length] ?? "#2563eb",
      }));

    return { data, total: totalValue };
  }, [holdings]);

  useEffect(() => {
    setSectorHoldingPages((prev) => {
      const next: Record<string, number> = {};
      for (const sector of sectorData.data) {
        const totalPages = Math.max(1, Math.ceil(sector.holdings.length / HOLDINGS_PAGE_SIZE));
        const prevPage = prev[sector.name] ?? 0;
        next[sector.name] = Math.min(Math.max(prevPage, 0), totalPages - 1);
      }
      return next;
    });
  }, [sectorData.data]);

  // Responsive dimensions
  const chartHeight = useMemo(() => {
    if (!responsive) return 184;
    // Leaner chart heights for dense dashboard cards.
    if (windowWidth < 640) return 128;
    if (windowWidth < 1024) return 148;
    return 184;
  }, [responsive, windowWidth]);

  const leftMargin = useMemo(() => {
    if (!responsive) return 96;
    // Reserve more room for sector labels in horizontal bars.
    if (windowWidth < 640) return 72;
    if (windowWidth < 1024) return 88;
    return 96;
  }, [responsive, windowWidth]);

  const rightMargin = useMemo(() => {
    if (!responsive) return 56;
    // Reserve right space for inline value labels (especially mobile)
    if (windowWidth < 640) return 66;
    return 56;
  }, [responsive, windowWidth]);

  const showInlineValueLabels = windowWidth < 768;

  // Chart config for shadcn ChartContainer
  const chartConfig = useMemo<ChartConfig>(() => {
    const config: ChartConfig = {};
    sectorData.data.forEach((sector) => {
      config[sector.name] = {
        label: sector.name,
        color: sector.color,
      };
    });
    return config;
  }, [sectorData.data]);

  if (sectorData.data.length === 0) {
    return null;
  }

  return (
    <Card variant="none" effect="glass" className={className}>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <PieChartIcon className="w-5 h-5 text-primary" />
          {title}
        </CardTitle>
        {subtitle ? (
          <p className="text-xs text-muted-foreground pt-1">{subtitle}</p>
        ) : null}
      </CardHeader>
      <CardContent className="px-4 pb-4 min-w-0 overflow-hidden">
        <ChartContainer config={chartConfig} className="w-full min-w-0" style={{ height: `${chartHeight}px` }}>
          <BarChart
            data={sectorData.data}
            layout="vertical"
            margin={{ top: 5, right: rightMargin, left: leftMargin, bottom: 5 }}
          >
            <XAxis
              type="number"
              tickFormatter={(value) => formatCurrency(value)}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "hsl(var(--foreground) / 0.72)" }}
            />
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--foreground) / 0.22)"
              strokeOpacity={0.55}
            />
            <YAxis
              type="category"
              dataKey="name"
              tickFormatter={(value) => compactSectorLabel(String(value))}
              axisLine={false}
              tickLine={false}
              width={92}
              tick={{ fontSize: 10, fill: "hsl(var(--foreground) / 0.72)" }}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  hideLabel
                  formatter={(value, name, item) => {
                    const payload = item.payload as {
                      name: string;
                      value: number;
                      count: number;
                    };
                    return (
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Sector Allocation
                        </span>
                        <span className="text-sm font-semibold">{payload.name}</span>
                        <span className="text-foreground text-base font-bold">{formatCurrency(payload.value)}</span>
                        <span className="text-muted-foreground text-xs">
                          {payload.count} holding{payload.count !== 1 ? "s" : ""}
                        </span>
                      </div>
                    );
                  }}
                />
              }
            />
            <Bar
              dataKey="value"
              radius={[0, 4, 4, 0]}
              animationDuration={800}
              maxBarSize={16}
            >
              {showInlineValueLabels ? (
                <LabelList
                  dataKey="value"
                  position="right"
                  className="fill-foreground"
                  fontSize={10}
                  formatter={(value: number) => formatCurrency(Number(value))}
                />
              ) : null}
              {sectorData.data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.color}
                  style={{ cursor: "pointer" }}
                />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>

        {/* Summary - simplified legend */}
        <div className="mt-3 pt-3 border-t border-border/50">
          <div className="space-y-2">
            {sectorData.data.map((sector) => {
              const totalPages = Math.max(1, Math.ceil(sector.holdings.length / HOLDINGS_PAGE_SIZE));
              const currentPage = sectorHoldingPages[sector.name] ?? 0;
              const clampedPage = Math.min(Math.max(currentPage, 0), totalPages - 1);
              const start = clampedPage * HOLDINGS_PAGE_SIZE;
              const end = start + HOLDINGS_PAGE_SIZE;
              const visibleHoldings = sector.holdings.slice(start, end);

              return (
                <div
                  key={sector.name}
                  className="rounded-lg border border-border/60 bg-background/70 p-2.5"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: sector.color }}
                    />
                    <span className="text-foreground font-medium">{sector.name}</span>
                    <span className="text-foreground/80 text-xs font-medium">
                      {formatCurrency(sector.value)} ({sector.percent.toFixed(1)}%)
                    </span>
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {sector.count} holding{sector.count !== 1 ? "s" : ""}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {visibleHoldings.map((holding) => (
                      <span
                        key={`${sector.name}-${holding.symbol}-${holding.name}`}
                        className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/60 bg-background/90 px-2 py-0.5 text-[11px]"
                        title={`${holding.symbol} · ${holding.name} · ${formatCurrency(holding.marketValue)}`}
                      >
                        <span className="font-semibold">{holding.symbol}</span>
                        <span className="truncate text-muted-foreground">{holding.name}</span>
                      </span>
                    ))}
                  </div>

                  {totalPages > 1 ? (
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground">
                        Showing {start + 1}-{Math.min(end, sector.holdings.length)} of {sector.holdings.length}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[11px]"
                          disabled={clampedPage === 0}
                          onClick={() =>
                            setSectorHoldingPages((prev) => ({
                              ...prev,
                              [sector.name]: Math.max(0, (prev[sector.name] ?? 0) - 1),
                            }))
                          }
                        >
                          Prev
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[11px]"
                          disabled={clampedPage >= totalPages - 1}
                          onClick={() =>
                            setSectorHoldingPages((prev) => ({
                              ...prev,
                              [sector.name]: Math.min(totalPages - 1, (prev[sector.name] ?? 0) + 1),
                            }))
                          }
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default SectorAllocationChart;
