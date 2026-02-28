"use client";

import { LineChart } from "lucide-react";

import { Card, CardContent } from "@/lib/morphy-ux/card";
import { Icon } from "@/lib/morphy-ux/ui";
import { cn } from "@/lib/utils";

type SpotlightDecision = "BUY" | "HOLD" | "WATCH" | "REDUCE";

export function SpotlightCard(props: {
  title: string;
  price: string;
  decision: SpotlightDecision;
  summary: string;
  context: string;
}) {
  const decisionTone =
    props.decision === "BUY"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : props.decision === "WATCH"
        ? "bg-blue-500/10 text-blue-700 dark:text-blue-300"
      : props.decision === "HOLD"
        ? "bg-blue-500/10 text-blue-700 dark:text-blue-300"
        : "bg-orange-500/10 text-orange-700 dark:text-orange-300";

  return (
    <Card variant="none" effect="glass" className="rounded-xl p-0">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-base font-black tracking-tight leading-tight">{props.title}</h3>
            <p className="text-sm text-muted-foreground">{props.price}</p>
          </div>
          <span
            className={cn(
              "inline-flex items-center rounded-full px-3 py-1 text-[11px] font-extrabold tracking-wide",
              decisionTone
            )}
          >
            {props.decision}
          </span>
        </div>

        <p className="text-sm font-medium leading-relaxed">{props.summary}</p>

        <div className="flex items-center gap-2 border-t border-border/40 pt-3 text-xs text-muted-foreground">
          <Icon icon={LineChart} size="sm" />
          <span>{props.context}</span>
        </div>
      </CardContent>
    </Card>
  );
}
