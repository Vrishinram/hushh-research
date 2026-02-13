// app/kai/dashboard/analysis/page.tsx

/**
 * Kai Analysis Hub — Three-state client-side toggle
 *
 * State 1 (no params, no history):  AnalysisHistoryDashboard
 * State 2 (with params):            DebateStreamView (live streaming analysis)
 * State 3 (with historyEntry):      HistoryDetailView (stored results, no re-debate)
 *
 * No complex routing — Zustand + local state drives the switch.
 */

"use client";

import { useState, useCallback } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { useVault } from "@/lib/vault/vault-context";
import { useKaiSession } from "@/lib/stores/kai-session-store";
import { HushhLoader } from "@/components/ui/hushh-loader";
import { AnalysisHistoryDashboard } from "@/components/kai/views/analysis-history-dashboard";
import { DebateStreamView } from "@/components/kai/debate-stream-view";
import { HistoryDetailView } from "@/components/kai/views/history-detail-view";
import type { AnalysisHistoryEntry } from "@/lib/services/kai-history-service";

export default function KaiAnalysisPage() {
  const { user, userId } = useAuth();
  const { vaultKey, vaultOwnerToken } = useVault();
  const analysisParams = useKaiSession((s) => s.analysisParams);
  const setAnalysisParams = useKaiSession((s) => s.setAnalysisParams);

  // State 3: viewing a stored history entry (no live debate)
  const [historyEntry, setHistoryEntry] = useState<AnalysisHistoryEntry | null>(null);

  // ---- Callbacks for AnalysisHistoryDashboard ----

  /** User picked a ticker from search — start a new analysis */
  const handleSelectTicker = useCallback(
    (ticker: string) => {
      if (!userId) return;
      setHistoryEntry(null); // Clear any history view
      setAnalysisParams({
        ticker,
        userId,
        riskProfile: "balanced",
      });
    },
    [userId, setAnalysisParams],
  );

  /** User tapped a previous analysis card — show stored results (not re-debate) */
  const handleViewHistory = useCallback(
    (entry: AnalysisHistoryEntry) => {
      setAnalysisParams(null); // Clear any live debate
      setHistoryEntry(entry);
    },
    [setAnalysisParams],
  );

  /** Close / back from DebateStreamView → clear params → return to State 1 */
  const handleClose = useCallback(() => {
    setAnalysisParams(null);
  }, [setAnalysisParams]);

  /** Back from HistoryDetailView → return to State 1 */
  const handleHistoryBack = useCallback(() => {
    setHistoryEntry(null);
  }, []);

  /** Re-analyze from HistoryDetailView → start new live debate */
  const handleReanalyze = useCallback(
    (ticker: string) => {
      if (!userId) return;
      setHistoryEntry(null);
      setAnalysisParams({
        ticker,
        userId,
        riskProfile: "balanced",
      });
    },
    [userId, setAnalysisParams],
  );

  // ---- Loading gate ----

  if (!user || !userId || !vaultKey) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <HushhLoader variant="inline" label="Preparing analysis hub…" />
      </div>
    );
  }

  // ---- State 3: Viewing stored history ----

  if (historyEntry) {
    return (
      <HistoryDetailView
        entry={historyEntry}
        onBack={handleHistoryBack}
        onReanalyze={handleReanalyze}
      />
    );
  }

  // ---- State 2: Active analysis ----

  if (analysisParams) {
    return (
      <DebateStreamView
        ticker={analysisParams.ticker}
        userId={analysisParams.userId}
        riskProfile={analysisParams.riskProfile}
        vaultOwnerToken={vaultOwnerToken || ""}
        vaultKey={vaultKey}
        onClose={handleClose}
      />
    );
  }

  // ---- State 1: History dashboard ----

  return (
    <AnalysisHistoryDashboard
      userId={userId}
      vaultKey={vaultKey}
      vaultOwnerToken={vaultOwnerToken || ""}
      onSelectTicker={handleSelectTicker}
      onViewHistory={handleViewHistory}
    />
  );
}

