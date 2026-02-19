"use client";

import { ChevronRight, Cpu, Percent, Zap } from "lucide-react";

import { Card, CardContent } from "@/lib/morphy-ux/card";
import { Icon } from "@/lib/morphy-ux/ui";

const THEMES = [
  {
    title: "AI Infrastructure",
    subtitle: "Semiconductors and data center demand",
    icon: Cpu,
  },
  {
    title: "Rate Outlook",
    subtitle: "Fed policy impact on growth names",
    icon: Percent,
  },
  {
    title: "Energy Rotation",
    subtitle: "Renewables and efficiency acceleration",
    icon: Zap,
  },
];

export function ThemeFocusList() {
  return (
    <div className="space-y-3">
      {THEMES.map((theme) => (
        <Card key={theme.title} variant="none" effect="glass" className="rounded-xl p-0">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-background/80">
              <Icon icon={theme.icon} size="md" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold leading-tight">{theme.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{theme.subtitle}</p>
            </div>
            <Icon icon={ChevronRight} size="sm" className="text-muted-foreground" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
