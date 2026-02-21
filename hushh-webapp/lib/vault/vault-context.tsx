/**
 * Vault Context - Memory-Only Vault Key & Token Storage
 * =====================================================
 *
 * SECURITY MODEL (BYOK - Bring Your Own Key):
 * - Vault Key: Stored in React state (memory only) - XSS cannot access
 * - VAULT_OWNER Token: Stored in React state (memory only) - XSS cannot access
 *
 * CRITICAL: Neither vault key NOR token are stored in sessionStorage/localStorage.
 * This prevents XSS attacks from stealing credentials.
 *
 * Services that need the token MUST receive it as a parameter from components
 * that have access to useVault() hook. This ensures the token never leaves
 * the React component tree's memory space.
 *
 * PERFORMANCE:
 * - Prefetches common data (world model, vault status, consents) on vault unlock
 * - Data is cached via CacheService for faster page loads
 */

"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { WorldModelService } from "@/lib/services/world-model-service";
import { ApiService } from "@/lib/services/api-service";
import { CacheService, CACHE_KEYS, CACHE_TTL } from "@/lib/services/cache-service";
import { CacheSyncService } from "@/lib/cache/cache-sync-service";
import { normalizeStoredPortfolio } from "@/lib/utils/portfolio-normalize";

// ============================================================================
// Types
// ============================================================================

interface VaultContextType {
  /** The decrypted vault key (hex string) - ONLY IN MEMORY */
  vaultKey: string | null;

  /** VAULT_OWNER consent token - ONLY IN MEMORY */
  vaultOwnerToken: string | null;

  /** Token expiry timestamp (ms) */
  tokenExpiresAt: number | null;

  /** Whether the vault is currently unlocked */
  isVaultUnlocked: boolean;

  /** Set the vault key and VAULT_OWNER token after successful authentication */
  unlockVault: (key: string, token: string, expiresAt: number) => void;

  /** Clear the vault key and token (on logout or timeout) */
  lockVault: () => void;

  /** Get the vault key for encryption operations */
  getVaultKey: () => string | null;

  /** Get the VAULT_OWNER token for agent requests */
  getVaultOwnerToken: () => string | null;
}

// ============================================================================
// Context
// ============================================================================

// Export context for components that need optional access (e.g., ExitDialog)
export const VaultContext = createContext<VaultContextType | null>(null);

// ============================================================================
// Provider
// ============================================================================

interface VaultProviderProps {
  children: ReactNode;
}

export function VaultProvider({ children }: VaultProviderProps) {
  // Access Auth Context to listen for logout
  const { user } = useAuth();

  // SECURITY: Vault key stored in React state = memory only
  // This is NOT accessible via sessionStorage.getItem() - XSS protection
  const [vaultKey, setVaultKey] = useState<string | null>(null);

  // VAULT_OWNER consent token (also memory-only for security)
  const [vaultOwnerToken, setVaultOwnerToken] = useState<string | null>(null);
  const [tokenExpiresAt, setTokenExpiresAt] = useState<number | null>(null);

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const lockVault = useCallback(() => {
    console.log("🔒 Vault locked (key + token cleared from memory)");
    setVaultKey(null);
    setVaultOwnerToken(null);
    setTokenExpiresAt(null);

    if (user?.uid) {
      CacheSyncService.onVaultStateChanged(user.uid);
    }
  }, [user?.uid]);

  // Auto-Lock on Sign Out
  // If AuthContext reports no user, we MUST clear the decrypted key from memory immediately.
  useEffect(() => {
    if (!user && vaultKey) {
      console.log("🔒 [VaultProvider] User signed out - Formatting memory...");
      lockVault();
    }
  }, [user, vaultKey, lockVault]);

  // Listen for vault-lock-requested events (e.g., when VAULT_OWNER token is revoked)
  useEffect(() => {
    const handleLockRequest = (event: Event) => {
      const customEvent = event as CustomEvent<{ reason: string }>;
      console.log(
        `🔒 [VaultProvider] Lock requested: ${customEvent.detail?.reason}`
      );
      lockVault();
    };

    window.addEventListener("vault-lock-requested", handleLockRequest);
    return () =>
      window.removeEventListener("vault-lock-requested", handleLockRequest);
  }, [lockVault]);

  /**
   * Prefetch common data after vault unlock to speed up page loads.
   * Runs in background - errors are logged but don't block UI.
   * Declared before unlockVault so it can be called from it (react-hooks/immutability).
   */
  const prefetchDashboardData = useCallback(
    async (userId: string, token: string, key: string) => {
      console.log("[VaultContext] Prefetching dashboard data...");
      const cache = CacheService.getInstance();
      const KAI_HOME_PREFETCH_TTL_MS = 3 * 60 * 1000;

      try {
        const [
          ,
          vaultStatusResult,
          consentsResult,
          pendingResult,
          auditResult,
        ] = await Promise.allSettled([
          WorldModelService.getMetadata(userId, false, token),
          ApiService.getVaultStatus(userId, token),
          ApiService.getActiveConsents(userId, token),
          ApiService.getPendingConsents(userId, token),
          ApiService.getConsentHistory(userId, token, 1, 50),
        ]);

        if (vaultStatusResult.status === "fulfilled" && vaultStatusResult.value.ok) {
          const statusData = await vaultStatusResult.value.json();
          cache.set(CACHE_KEYS.VAULT_STATUS(userId), statusData, CACHE_TTL.SHORT);
          console.log("[VaultContext] Cached vault status");
        }

        if (consentsResult.status === "fulfilled" && consentsResult.value.ok) {
          const consentsData = await consentsResult.value.json();
          cache.set(CACHE_KEYS.ACTIVE_CONSENTS(userId), consentsData.active || [], CACHE_TTL.SHORT);
          console.log("[VaultContext] Cached active consents");
        }

        if (pendingResult.status === "fulfilled" && pendingResult.value.ok) {
          const pendingData = (await pendingResult.value.json()).pending || [];
          cache.set(CACHE_KEYS.PENDING_CONSENTS(userId), pendingData, CACHE_TTL.SHORT);
          console.log("[VaultContext] Cached pending consents");
        }

        if (auditResult.status === "fulfilled" && auditResult.value.ok) {
          const data = await auditResult.value.json();
          const auditData = Array.isArray(data) ? data : data?.items ?? data?.history ?? [];
          cache.set(CACHE_KEYS.CONSENT_AUDIT_LOG(userId), auditData, CACHE_TTL.SHORT);
          console.log("[VaultContext] Cached consent audit log");
        }

        try {
          const fullBlob = await WorldModelService.loadFullBlob({
            userId,
            vaultKey: key,
            vaultOwnerToken: token,
          });
          const financialRaw = fullBlob?.financial;
          if (financialRaw && typeof financialRaw === "object" && !Array.isArray(financialRaw)) {
            const normalized = normalizeStoredPortfolio(
              financialRaw as Record<string, unknown>
            );
            CacheSyncService.onPortfolioUpserted(userId, normalized, {
              invalidateMetadata: false,
            });

            const holdings = (
              (Array.isArray(normalized.holdings) && normalized.holdings) ||
              (Array.isArray(normalized.detailed_holdings) && normalized.detailed_holdings) ||
              []
            ) as Array<Record<string, unknown>>;
            const symbols = holdings
              .filter((holding) => {
                const assetType = String(holding.asset_type || "").trim().toLowerCase();
                const name = String(holding.name || "").trim().toLowerCase();
                if (assetType.includes("cash") || assetType.includes("sweep")) return false;
                if (name.includes("cash") || name.includes("sweep")) return false;
                return true;
              })
              .map((holding) => String(holding.symbol || "").trim().toUpperCase())
              .filter((symbol, index, arr) => Boolean(symbol) && arr.indexOf(symbol) === index)
              .slice(0, 8);
            const symbolsKey = symbols.length > 0 ? symbols.join("-") : "default";

            const kaiHome = await ApiService.getKaiMarketInsights({
              userId,
              vaultOwnerToken: token,
              symbols,
              daysBack: 7,
            });
            cache.set(
              CACHE_KEYS.KAI_MARKET_HOME(userId, symbolsKey, 7),
              kaiHome,
              KAI_HOME_PREFETCH_TTL_MS
            );
            cache.set(
              CACHE_KEYS.KAI_MARKET_HOME(userId, "default", 7),
              kaiHome,
              KAI_HOME_PREFETCH_TTL_MS
            );
            console.log("[VaultContext] Prefetched Kai market home cache");
          }
        } catch (error) {
          console.warn("[VaultContext] Market prefetch warm-up failed:", error);
        }

        console.log("[VaultContext] Prefetch complete");
      } catch (err) {
        console.warn("[VaultContext] Prefetch error (non-blocking):", err);
      }
    },
    []
  );

  const unlockVault = useCallback(
    (key: string, token: string, expiresAt: number) => {
      console.log(
        "🔓 Vault unlocked (key + token in memory only - XSS protected)"
      );
      setVaultKey(key);
      setVaultOwnerToken(token);
      setTokenExpiresAt(expiresAt);

      if (user?.uid) {
        prefetchDashboardData(user.uid, token, key);
      }
    },
    [user, prefetchDashboardData]
  );

  const getVaultKey = useCallback(() => {
    return vaultKey;
  }, [vaultKey]);

  const getVaultOwnerToken = useCallback(() => {
    // Check expiry
    if (tokenExpiresAt && Date.now() > tokenExpiresAt) {
      console.warn("⚠️ VAULT_OWNER token expired");
      return null;
    }
    return vaultOwnerToken;
  }, [vaultOwnerToken, tokenExpiresAt]);

  const value: VaultContextType = {
    vaultKey,
    vaultOwnerToken,
    tokenExpiresAt,
    isVaultUnlocked: !!vaultKey && !!vaultOwnerToken,
    unlockVault,
    lockVault,
    getVaultKey,
    getVaultOwnerToken,
  };

  return (
    <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useVault(): VaultContextType {
  const context = useContext(VaultContext);
  if (!context) {
    throw new Error("useVault must be used within a VaultProvider");
  }
  return context;
}

/**
 * HOC for components that need vault access
 * Wraps component to ensure vault is available
 */
export function withVaultRequired<T extends object>(
  Component: React.ComponentType<T>
): React.FC<T> {
  return function VaultRequiredComponent(props: T) {
    const { isVaultUnlocked } = useVault();

    if (!isVaultUnlocked) {
      return (
        <div className="flex items-center justify-center min-h-[200px]">
          <p className="text-muted-foreground">
            🔒 Vault locked. Please unlock to continue.
          </p>
        </div>
      );
    }

    return <Component {...props} />;
  };
}
