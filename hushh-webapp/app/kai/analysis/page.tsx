"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { DebateStreamView, type AgentState } from "@/components/kai/debate-stream-view";
import { HushhLoader } from "@/components/app-ui/hushh-loader";
import { AnalysisHistoryDashboard } from "@/components/kai/views/analysis-history-dashboard";
import { AnalysisSummaryView } from "@/components/kai/views/analysis-summary-view";
import { HistoryDetailView } from "@/components/kai/views/history-detail-view";
import { Button } from "@/lib/morphy-ux/button";
import { Icon } from "@/lib/morphy-ux/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/firebase/auth-context";
import { KaiHistoryService, type AnalysisHistoryEntry } from "@/lib/services/kai-history-service";
import { useKaiSession } from "@/lib/stores/kai-session-store";
import { useVault } from "@/lib/vault/vault-context";
import { RoundTabsCard } from "@/components/kai/views/round-tabs-card";

const ANALYSIS_INTENT_FRESH_MS = 15_000;
const WORKSPACE_TABS = ["debate", "summary", "detailed"] as const;
type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

function extractDebateId(entry: AnalysisHistoryEntry | null): string | null {
  if (!entry || typeof entry !== "object") return null;
  const rawCard = (entry.raw_card || {}) as Record<string, unknown>;
  const diagnostics = rawCard.stream_diagnostics as Record<string, unknown> | undefined;
  const streamId = diagnostics?.stream_id;
  if (typeof streamId === "string" && streamId.trim()) {
    return streamId.trim();
  }
  return null;
}

function HistoryDebateReplay({ entry }: { entry: AnalysisHistoryEntry }) {
  const [collapsedRounds, setCollapsedRounds] = useState<Record<number, boolean>>({
    1: true,
    2: false,
  });

  if (!entry.debate_transcript) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-dashed border-border/60 bg-background/80 p-4 text-sm text-muted-foreground">
        Debate transcript unavailable for this run.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 pb-safe">
      <RoundTabsCard
        roundNumber={1}
        title="Initial Deep Analysis"
        description="Agents analyzed raw data independently."
        isCollapsed={collapsedRounds[1] ?? true}
        onToggleCollapse={() => setCollapsedRounds((prev) => ({ ...prev, 1: !prev[1] }))}
        agentStates={entry.debate_transcript.round1 as Record<string, AgentState>}
      />
      {entry.debate_transcript.round2 &&
      Object.keys(entry.debate_transcript.round2).length > 0 ? (
        <RoundTabsCard
          roundNumber={2}
          title="Strategic Debate"
          description="Agents challenged and refined positions."
          isCollapsed={collapsedRounds[2] ?? false}
          onToggleCollapse={() => setCollapsedRounds((prev) => ({ ...prev, 2: !prev[2] }))}
          agentStates={entry.debate_transcript.round2 as Record<string, AgentState>}
        />
      ) : null}
    </div>
  );
}

export default function KaiAnalysisPage() {
  const pageOpenedAtRef = useRef(Date.now());
  const workspaceTopRef = useRef<HTMLDivElement | null>(null);

  const router = useRouter();
  const searchParams = useSearchParams();

  const { user, userId } = useAuth();
  const { vaultKey, vaultOwnerToken } = useVault();

  const analysisParams = useKaiSession((s) => s.analysisParams);
  const analysisParamsUpdatedAt = useKaiSession((s) => s.analysisParamsUpdatedAt);
  const setAnalysisParams = useKaiSession((s) => s.setAnalysisParams);
  const setBusyOperation = useKaiSession((s) => s.setBusyOperation);

  const debateId = searchParams.get("debate_id");

  const [resolvedEntry, setResolvedEntry] = useState<AnalysisHistoryEntry | null>(null);
  const [resolvingEntry, setResolvingEntry] = useState(false);
  const [liveEntry, setLiveEntry] = useState<AnalysisHistoryEntry | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("debate");

  const hasFreshAnalysisIntent =
    Boolean(analysisParams) &&
    Boolean(analysisParamsUpdatedAt) &&
    (analysisParamsUpdatedAt || 0) >= pageOpenedAtRef.current - ANALYSIS_INTENT_FRESH_MS;

  const liveIntentReady =
    hasFreshAnalysisIntent &&
    Boolean(analysisParams?.userId) &&
    analysisParams?.userId !== "__pending__";

  const setDebateIdParam = useCallback(
    (nextDebateId?: string | null) => {
      const params = new URLSearchParams();
      if (nextDebateId) {
        params.set("debate_id", nextDebateId);
      }
      const query = params.toString();
      router.replace(query ? `/kai/analysis?${query}` : "/kai/analysis");
    },
    [router]
  );

  useEffect(() => {
    if (!searchParams.has("tab")) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("tab");
    const query = params.toString();
    router.replace(query ? `/kai/analysis?${query}` : "/kai/analysis");
  }, [router, searchParams]);

  useEffect(() => {
    if (!analysisParams) return;
    if (!userId) return;
    if (!analysisParams.userId || analysisParams.userId === "__pending__") {
      setAnalysisParams({
        ...analysisParams,
        userId,
      });
    }
  }, [analysisParams, setAnalysisParams, userId]);

  useEffect(() => {
    if (!analysisParams || !analysisParamsUpdatedAt) return;
    const isFresh = analysisParamsUpdatedAt >= pageOpenedAtRef.current - ANALYSIS_INTENT_FRESH_MS;
    if (!isFresh) {
      setAnalysisParams(null);
    }
  }, [analysisParams, analysisParamsUpdatedAt, setAnalysisParams]);

  useEffect(() => {
    setBusyOperation("stock_analysis_active", Boolean(liveIntentReady));
    return () => {
      setBusyOperation("stock_analysis_active", false);
    };
  }, [liveIntentReady, setBusyOperation]);

  useEffect(() => {
    if (liveIntentReady) {
      setWorkspaceTab("debate");
      return;
    }
    if (resolvedEntry) {
      setWorkspaceTab("summary");
    }
  }, [liveIntentReady, resolvedEntry]);

  useEffect(() => {
    if (!debateId || !userId || !vaultKey) {
      setResolvedEntry(null);
      setResolvingEntry(false);
      return;
    }
    const resolvedUserId = userId;
    const resolvedVaultKey = vaultKey;

    let cancelled = false;
    setResolvingEntry(true);

    async function resolveEntry() {
      try {
        const allHistory = await KaiHistoryService.getAllHistory({
          userId: resolvedUserId,
          vaultKey: resolvedVaultKey,
          vaultOwnerToken: vaultOwnerToken || "",
        });
        if (cancelled) return;

        const match = Object.values(allHistory)
          .flat()
          .find((entry) => extractDebateId(entry) === debateId);
        setResolvedEntry(match || null);
      } finally {
        if (!cancelled) {
          setResolvingEntry(false);
        }
      }
    }

    void resolveEntry();

    return () => {
      cancelled = true;
    };
  }, [debateId, userId, vaultKey, vaultOwnerToken]);

  const handleSelectTicker = useCallback(
    (ticker: string) => {
      if (!userId) return;
      setResolvedEntry(null);
      setLiveEntry(null);
      setAnalysisParams({
        ticker,
        userId,
        riskProfile: "balanced",
      });
      setWorkspaceTab("debate");
      setDebateIdParam(null);
    },
    [setAnalysisParams, setDebateIdParam, userId]
  );

  const handleViewHistory = useCallback(
    (entry: AnalysisHistoryEntry) => {
      setAnalysisParams(null);
      setLiveEntry(null);
      setResolvedEntry(entry);
      setWorkspaceTab("summary");
      setDebateIdParam(extractDebateId(entry));
    },
    [setAnalysisParams, setDebateIdParam]
  );

  const handleCloseLiveDebate = useCallback(() => {
    setAnalysisParams(null);
    setLiveEntry(null);
    setDebateIdParam(null);
  }, [setAnalysisParams, setDebateIdParam]);

  const handleBackToHistory = useCallback(() => {
    setAnalysisParams(null);
    setLiveEntry(null);
    setResolvedEntry(null);
    setDebateIdParam(null);
  }, [setAnalysisParams, setDebateIdParam]);

  const handleReanalyze = useCallback(
    (ticker: string) => {
      if (!userId) return;
      setResolvedEntry(null);
      setLiveEntry(null);
      setAnalysisParams({
        ticker,
        userId,
        riskProfile: "balanced",
      });
      setWorkspaceTab("debate");
      setDebateIdParam(null);
    },
    [setAnalysisParams, setDebateIdParam, userId]
  );

  const handleWorkspaceTabChange = useCallback((value: string) => {
    setWorkspaceTab(value as WorkspaceTab);
    requestAnimationFrame(() => {
      workspaceTopRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
    });
  }, []);

  if (!user || !userId || !vaultKey) {
    return (
      <div className="flex min-h-96 items-center justify-center">
        <HushhLoader variant="inline" label="Preparing analysis hub…" />
      </div>
    );
  }

  const activeEntry = liveIntentReady ? liveEntry : resolvedEntry;
  const showWorkspace = Boolean(liveIntentReady || resolvedEntry);

  return (
    <div className="pt-4">
      {showWorkspace ? (
        <div ref={workspaceTopRef} className="mx-auto w-full max-w-6xl space-y-4 px-4 sm:px-6">
          <div className="space-y-3">
            <div className="flex items-center justify-start">
              <Button variant="none" effect="fade" size="sm" onClick={handleBackToHistory}>
                <Icon icon={ArrowLeft} size="sm" className="mr-1" />
                Back to history
              </Button>
            </div>
            <Tabs
              value={workspaceTab}
              onValueChange={handleWorkspaceTabChange}
              className="w-full"
            >
              <div className="flex justify-center">
                <TabsList className="mx-auto grid h-10 w-full max-w-md grid-cols-3">
                  <TabsTrigger value="debate">Debate</TabsTrigger>
                  <TabsTrigger value="summary">Summary</TabsTrigger>
                  <TabsTrigger value="detailed">Detailed View</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="debate" className="mt-4" forceMount>
                {liveIntentReady && analysisParams ? (
                  <DebateStreamView
                    ticker={analysisParams.ticker}
                    userId={analysisParams.userId}
                    riskProfile={analysisParams.riskProfile}
                    vaultOwnerToken={vaultOwnerToken || ""}
                    vaultKey={vaultKey}
                    onClose={handleCloseLiveDebate}
                    onDecisionSaved={setLiveEntry}
                  />
                ) : activeEntry ? (
                  <HistoryDebateReplay entry={activeEntry} />
                ) : (
                  <div className="rounded-2xl border border-dashed border-border/60 bg-background/80 p-4 text-sm text-muted-foreground">
                    Debate stream unavailable for this selection.
                  </div>
                )}
              </TabsContent>
              <TabsContent value="summary" className="mt-4">
                {activeEntry ? (
                  <AnalysisSummaryView
                    entry={activeEntry}
                    onReanalyze={handleReanalyze}
                    embedded
                    userId={userId}
                    vaultOwnerToken={vaultOwnerToken || undefined}
                  />
                ) : (
                  <div className="rounded-2xl border border-dashed border-border/60 bg-background/80 p-4 text-sm text-muted-foreground">
                    Summary will appear after the first decision is produced.
                  </div>
                )}
              </TabsContent>
              <TabsContent value="detailed" className="mt-4">
                {activeEntry ? (
                  <HistoryDetailView
                    entry={activeEntry}
                    onReanalyze={handleReanalyze}
                    embedded
                    userId={userId}
                    vaultOwnerToken={vaultOwnerToken || undefined}
                  />
                ) : (
                  <div className="rounded-2xl border border-dashed border-border/60 bg-background/80 p-4 text-sm text-muted-foreground">
                    Detailed view will appear after the first decision is produced.
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      ) : !resolvingEntry ? (
        <div className="pt-2">
          <AnalysisHistoryDashboard
            userId={userId}
            vaultKey={vaultKey}
            vaultOwnerToken={vaultOwnerToken || ""}
            onSelectTicker={handleSelectTicker}
            onViewHistory={handleViewHistory}
          />
        </div>
      ) : null}

      {resolvingEntry ? (
        <div className="flex min-h-64 items-center justify-center">
          <HushhLoader variant="inline" label="Loading analysis record…" />
        </div>
      ) : null}
    </div>
  );
}
