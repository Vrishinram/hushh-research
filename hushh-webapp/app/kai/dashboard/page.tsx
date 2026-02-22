"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { KaiFlow, type FlowState } from "@/components/kai/kai-flow";
import { ManagePortfolioView } from "@/components/kai/views/manage-portfolio-view";
import { Button } from "@/lib/morphy-ux/button";
import { useAuth } from "@/lib/firebase/auth-context";
import { useStepProgress } from "@/lib/progress/step-progress-context";
import { cn } from "@/lib/utils";
import { useVault } from "@/lib/vault/vault-context";

const DASHBOARD_TABS = ["overview", "holdings"] as const;
type DashboardTab = (typeof DASHBOARD_TABS)[number];

function normalizeDashboardTab(value: string | null): DashboardTab {
  return value === "holdings" ? "holdings" : "overview";
}

export default function KaiDashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const { user, loading: authLoading } = useAuth();
  const { vaultOwnerToken } = useVault();
  const { registerSteps, completeStep, reset } = useStepProgress();

  const [initialized, setInitialized] = useState(false);
  const [flowState, setFlowState] = useState<FlowState>("checking");

  const activeTab = useMemo(
    () => normalizeDashboardTab(searchParams.get("tab")),
    [searchParams]
  );

  useEffect(() => {
    if (authLoading) return;
    if (!initialized) {
      registerSteps(2);
      setInitialized(true);
    }
    if (user) {
      completeStep();
    }
    return () => reset();
  }, [authLoading, completeStep, initialized, registerSteps, reset, user]);

  useEffect(() => {
    if (!initialized) return;
    if (activeTab === "holdings" || flowState !== "checking") {
      completeStep();
    }
  }, [activeTab, completeStep, flowState, initialized]);

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    if (requestedTab && requestedTab !== activeTab) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", activeTab);
      router.replace(`/kai/dashboard?${params.toString()}`);
    }
  }, [activeTab, router, searchParams]);

  const handleTabChange = useCallback(
    (tab: DashboardTab) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", tab);
      router.replace(`/kai/dashboard?${params.toString()}`);
    },
    [router, searchParams]
  );

  if (authLoading || !user) {
    return null;
  }

  return (
    <div className="relative w-full">
      <div className="mx-auto w-full max-w-6xl px-4 py-4 pb-2 sm:px-6 sm:py-6">
        <div className="inline-flex rounded-full border border-border/70 bg-background/70 p-1">
          {DASHBOARD_TABS.map((tab) => {
            const selected = activeTab === tab;
            return (
              <Button
                key={tab}
                variant="none"
                effect={selected ? "fill" : "fade"}
                size="sm"
                onClick={() => handleTabChange(tab)}
                className={cn(
                  "rounded-full px-4 capitalize",
                  selected ? "font-semibold" : "text-muted-foreground"
                )}
              >
                {tab}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="w-full pb-32">
        {activeTab === "overview" ? (
          <KaiFlow
            userId={user.uid}
            mode="dashboard"
            vaultOwnerToken={vaultOwnerToken ?? ""}
            onStateChange={setFlowState}
          />
        ) : (
          <ManagePortfolioView />
        )}
      </div>
    </div>
  );
}
