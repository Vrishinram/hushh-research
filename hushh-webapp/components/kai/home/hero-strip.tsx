"use client";

import { Button } from "@/lib/morphy-ux/button";

interface HeroStripProps {
  onOpenDashboard: () => void;
}

export function HeroStrip({ onOpenDashboard }: HeroStripProps) {
  return (
    <div className="flex justify-end">
      <Button variant="blue-gradient" effect="fill" size="sm" onClick={onOpenDashboard}>
        Open Dashboard
      </Button>
    </div>
  );
}
