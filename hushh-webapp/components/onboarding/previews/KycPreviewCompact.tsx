"use client";

import { CheckCircle2, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/lib/morphy-ux/card";

export function KycPreviewCompact() {
  return (
    <Card
      variant="none"
      effect="glass"
      preset="hero"
      showRipple={false}
    >
      <div className="p-6 space-y-4">
        <p className="text-center font-extrabold text-base">
          Status: KYC Complete
        </p>
        <div className="space-y-3">
          <KycRow label="Identity verified" />
          <KycRow label="Address verified" />
          <KycRow label="Bank account linked" />
        </div>
        <div className="flex justify-center pt-1">
          <Badge className="rounded-full bg-[var(--brand-50)] text-[var(--brand-700)] border border-[var(--brand-200)]">
            SPEED: INSTANT
          </Badge>
        </div>
      </div>
    </Card>
  );
}

function KycRow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-muted/40 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-2xl bg-emerald-500/10 grid place-items-center">
          <ShieldCheck className="h-5 w-5 text-emerald-600" />
        </div>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
    </div>
  );
}
