"use client";

import { ArrowRight, Shield, Target, TrendingUp } from "lucide-react";

import type { RiskProfile } from "@/lib/services/kai-profile-service";
import { Button } from "@/lib/morphy-ux/button";
import { cn } from "@/lib/utils";

const PERSONA_CONFIG: Record<
  RiskProfile,
  {
    pill: string;
    title: string;
    description: string;
    subtext: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  conservative: {
    pill: "YOU VALUE STABILITY",
    title: "Ready for\nsteady growth?",
    description: "You prefer steady progress without unnecessary swings.",
    subtext: "Smart growth. Less stress.",
    icon: Shield,
  },
  balanced: {
    pill: "YOU PLAY IT SMART",
    title: "Ready to\nmove ahead?",
    description:
      "You're comfortable with some ups and downs for consistent long-term growth.",
    subtext: "Progress, without overexposure.",
    icon: Target,
  },
  aggressive: {
    pill: "YOU'RE BUILT FOR GROWTH",
    title: "Ready to\nlevel up?",
    description:
      "You're comfortable with market swings when the potential reward justifies it.",
    subtext: "Let's build momentum.",
    icon: TrendingUp,
  },
};

export function KaiPersonaScreen(props: {
  riskProfile: RiskProfile;
  onLaunchDashboard: () => void;
  onEditAnswers?: () => void;
}) {
  const cfg = PERSONA_CONFIG[props.riskProfile];
  const Icon = cfg.icon;

  return (
    <main className="h-[100dvh] w-full bg-transparent flex flex-col overflow-hidden px-6 pt-[calc(20px+env(safe-area-inset-top))] pb-[calc(16px+env(safe-area-inset-bottom))]">
      <div className="w-full max-w-sm mx-auto flex-1 flex flex-col">
        <div className="space-y-5">
          <div className="h-12 w-12 rounded-2xl bg-[var(--brand-50)] border border-[var(--brand-200)] grid place-items-center">
            <Icon className="h-6 w-6 text-[var(--brand-600)]" />
          </div>

          <div className="space-y-3">
            <p className="text-[10px] font-extrabold tracking-[0.18em] text-[var(--brand-600)]">
              {cfg.pill}
            </p>
            <h1 className="text-4xl font-black tracking-tight leading-[1.05] whitespace-pre-line">
              {cfg.title}
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-[22rem]">
              {cfg.description}
            </p>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            Kai helps you stay aligned with your horizon and tolerance. {cfg.subtext}
          </p>

          {props.onEditAnswers && (
            <Button
              variant="link"
              effect="fill"
              size="sm"
              className="self-start"
              onClick={props.onEditAnswers}
              showRipple={false}
            >
              Edit answers
            </Button>
          )}
        </div>

        <div className="mt-auto pt-10">
          <Button
            size="lg"
            fullWidth
            onClick={props.onLaunchDashboard}
            showRipple
          >
            Launch Dashboard
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </div>
    </main>
  );
}
