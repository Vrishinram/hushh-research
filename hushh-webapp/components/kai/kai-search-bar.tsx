"use client";

import { useState } from "react";
import { Mic, Search } from "lucide-react";

import { KaiCommandPalette, type KaiCommandAction } from "@/components/kai/kai-command-palette";
import { Button } from "@/lib/morphy-ux/button";
import { morphyToast as toast } from "@/lib/morphy-ux/morphy";
import { Icon } from "@/lib/morphy-ux/ui";
import { cn } from "@/lib/utils";
import { useKaiBottomChromeVisibility } from "@/lib/navigation/kai-bottom-chrome-visibility";

interface KaiSearchBarProps {
  onCommand: (command: KaiCommandAction, params?: Record<string, unknown>) => void;
  disabled?: boolean;
  hasPortfolioData?: boolean;
  portfolioTickers?: Array<{
    symbol: string;
    name?: string;
    sector?: string;
    asset_type?: string;
    is_investable?: boolean;
    analyze_eligible?: boolean;
  }>;
}

export function KaiSearchBar({
  onCommand,
  disabled = false,
  hasPortfolioData = true,
  portfolioTickers = [],
}: KaiSearchBarProps) {
  const [open, setOpen] = useState(false);
  const { hidden: hideBottomChrome } = useKaiBottomChromeVisibility(true);

  return (
    <>
      <div
        className={cn(
          "fixed inset-x-0 z-[130] flex justify-center px-4 transition-all duration-300 ease-out",
          hideBottomChrome
            ? "pointer-events-none opacity-0"
            : "pointer-events-none opacity-100"
        )}
        style={{
          bottom: "calc(var(--app-bottom-inset) + var(--kai-command-bottom-gap, 18px))",
          transform: hideBottomChrome
            ? "translate3d(0, calc(100% + 24px), 0)"
            : "translate3d(0, 0, 0)",
        }}
      >
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[72px] bottom-bar-glass" />
        <div className="pointer-events-auto w-full max-w-[420px]">
          <div className="relative">
            <Button
              variant="none"
              effect="fade"
              fullWidth
              size="default"
              className={cn(
                "h-12 justify-start rounded-full px-4 pr-12 text-sm text-muted-foreground",
                disabled && "pointer-events-none opacity-50"
              )}
              onClick={() => setOpen(true)}
            >
              <Icon icon={Search} size="sm" className="mr-2 text-muted-foreground" />
              Analyze, dashboard, consent with Kai
            </Button>
            <button
              type="button"
              aria-label="Hushh Voice (Coming soon)"
              data-no-route-swipe
              className="absolute right-2 top-1/2 z-10 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toast.info("Coming soon Hushh Voice Feature");
              }}
            >
              <Icon icon={Mic} size="sm" />
            </button>
          </div>
        </div>
      </div>

      <KaiCommandPalette
        open={open}
        onOpenChange={setOpen}
        onCommand={onCommand}
        hasPortfolioData={hasPortfolioData}
        portfolioTickers={portfolioTickers}
      />
    </>
  );
}
