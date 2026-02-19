"use client";

import { useEffect, useRef } from "react";

import { useAuth } from "@/hooks/use-auth";
import { KaiProfileSyncService } from "@/lib/services/kai-profile-sync-service";
import { useVault } from "@/lib/vault/vault-context";

/**
 * Syncs locally captured pre-vault onboarding answers into encrypted kai_profile
 * after vault creation/unlock succeeds.
 */
export function PostAuthOnboardingSyncBridge() {
  const { user, loading } = useAuth();
  const { isVaultUnlocked, vaultKey, vaultOwnerToken } = useVault();
  const syncingRef = useRef(false);

  useEffect(() => {
    if (loading || !user || !isVaultUnlocked || !vaultKey || !vaultOwnerToken) {
      return;
    }

    if (syncingRef.current) {
      return;
    }

    syncingRef.current = true;

    void KaiProfileSyncService.syncPendingToVault({
      userId: user.uid,
      vaultKey,
      vaultOwnerToken,
    })
      .catch((error) => {
        console.warn("[PostAuthOnboardingSyncBridge] Sync failed, will retry later:", error);
      })
      .finally(() => {
        syncingRef.current = false;
      });
  }, [loading, user?.uid, isVaultUnlocked, vaultKey, vaultOwnerToken]);

  return null;
}
