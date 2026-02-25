import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/pre-vault-onboarding-service", () => ({
  PreVaultOnboardingService: {
    load: vi.fn(),
    markCompleted: vi.fn(),
    markSynced: vi.fn(),
  },
}));

vi.mock("@/lib/services/kai-profile-service", () => {
  return {
    computeRiskScore: vi.fn((answers: any) => {
      const scoreMap = {
        short_term: 0,
        medium_term: 1,
        long_term: 2,
        reduce: 0,
        stay: 1,
        buy_more: 2,
        small: 0,
        moderate: 1,
        large: 2,
      } as const;

      if (
        !answers?.investment_horizon ||
        !answers?.drawdown_response ||
        !answers?.volatility_preference
      ) {
        return null;
      }

      return (
        scoreMap[answers.investment_horizon as keyof typeof scoreMap] +
        scoreMap[answers.drawdown_response as keyof typeof scoreMap] +
        scoreMap[answers.volatility_preference as keyof typeof scoreMap]
      );
    }),
    mapRiskProfile: vi.fn((score: number) => {
      if (score <= 2) return "conservative";
      if (score <= 4) return "balanced";
      return "aggressive";
    }),
    KaiProfileService: {
      syncOnboardingAndNavState: vi.fn(),
    },
  };
});

vi.mock("@/lib/services/kai-nav-tour-local-service", () => ({
  KaiNavTourLocalService: {
    load: vi.fn().mockResolvedValue(null),
    markSynced: vi.fn(),
  },
}));

import { PreVaultOnboardingService } from "@/lib/services/pre-vault-onboarding-service";
import { KaiProfileService } from "@/lib/services/kai-profile-service";
import { KaiNavTourLocalService } from "@/lib/services/kai-nav-tour-local-service";
import { KaiProfileSyncService } from "@/lib/services/kai-profile-sync-service";

describe("KaiProfileSyncService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("syncs skipped onboarding by setting completion only", async () => {
    (PreVaultOnboardingService.load as any).mockResolvedValue({
      completed: true,
      skipped: true,
      synced_to_vault_at: null,
      answers: {
        investment_horizon: null,
        drawdown_response: null,
        volatility_preference: null,
      },
      risk_score: null,
      risk_profile: null,
    });

    const result = await KaiProfileSyncService.syncPendingToVault({
      userId: "uid-1",
      vaultKey: "key-1",
      vaultOwnerToken: "token-1",
    });

    expect(result.synced).toBe(true);
    expect(KaiProfileService.syncOnboardingAndNavState).toHaveBeenCalledWith(
      expect.objectContaining({
        onboarding: expect.objectContaining({ skippedPreferences: true }),
      })
    );
    expect(PreVaultOnboardingService.markSynced).toHaveBeenCalledWith("uid-1");
    expect(KaiNavTourLocalService.markSynced).not.toHaveBeenCalled();
  });

  it("syncs answered onboarding with one persistence write", async () => {
    (PreVaultOnboardingService.load as any).mockResolvedValue({
      completed: true,
      skipped: false,
      synced_to_vault_at: null,
      answers: {
        investment_horizon: "long_term",
        drawdown_response: "buy_more",
        volatility_preference: "large",
      },
      risk_score: 6,
      risk_profile: "aggressive",
    });

    const result = await KaiProfileSyncService.syncPendingToVault({
      userId: "uid-2",
      vaultKey: "key-2",
      vaultOwnerToken: "token-2",
    });

    expect(result.synced).toBe(true);
    expect(KaiProfileService.syncOnboardingAndNavState).toHaveBeenCalledTimes(1);
    expect(KaiProfileService.syncOnboardingAndNavState).toHaveBeenCalledWith(
      expect.objectContaining({
        onboarding: expect.objectContaining({
          skippedPreferences: false,
          answers: expect.objectContaining({
            investment_horizon: "long_term",
            drawdown_response: "buy_more",
            volatility_preference: "large",
          }),
        }),
      })
    );
    expect(PreVaultOnboardingService.markSynced).toHaveBeenCalledWith("uid-2");
  });

  it("syncs onboarding + nav pending state through one combined write", async () => {
    (PreVaultOnboardingService.load as any).mockResolvedValue({
      completed: true,
      skipped: false,
      synced_to_vault_at: null,
      completed_at: "2026-02-19T00:00:00.000Z",
      answers: {
        investment_horizon: "medium_term",
        drawdown_response: "stay",
        volatility_preference: "moderate",
      },
      risk_score: 3,
      risk_profile: "balanced",
    });
    (KaiNavTourLocalService.load as any).mockResolvedValue({
      completed_at: "2026-02-20T00:00:00.000Z",
      skipped_at: null,
      synced_to_vault_at: null,
    });

    const result = await KaiProfileSyncService.syncPendingToVault({
      userId: "uid-2b",
      vaultKey: "key-2b",
      vaultOwnerToken: "token-2b",
    });

    expect(result.synced).toBe(true);
    expect(KaiProfileService.syncOnboardingAndNavState).toHaveBeenCalledTimes(1);
    expect(KaiProfileService.syncOnboardingAndNavState).toHaveBeenCalledWith(
      expect.objectContaining({
        onboarding: expect.any(Object),
        navTour: expect.objectContaining({
          completedAt: "2026-02-20T00:00:00.000Z",
          skippedAt: null,
        }),
      })
    );
    expect(PreVaultOnboardingService.markSynced).toHaveBeenCalledWith("uid-2b");
    expect(KaiNavTourLocalService.markSynced).toHaveBeenCalledWith("uid-2b");
  });

  it("does not mark synced when combined persistence fails", async () => {
    (PreVaultOnboardingService.load as any).mockResolvedValue({
      completed: true,
      skipped: false,
      synced_to_vault_at: null,
      answers: {
        investment_horizon: "medium_term",
        drawdown_response: "stay",
        volatility_preference: "moderate",
      },
      risk_score: 3,
      risk_profile: "balanced",
    });

    (KaiProfileService.syncOnboardingAndNavState as any).mockRejectedValue(new Error("save failed"));

    await expect(
      KaiProfileSyncService.syncPendingToVault({
        userId: "uid-3",
        vaultKey: "key-3",
        vaultOwnerToken: "token-3",
      })
    ).rejects.toThrow("save failed");

    expect(PreVaultOnboardingService.markSynced).not.toHaveBeenCalled();
    expect(KaiNavTourLocalService.markSynced).not.toHaveBeenCalled();
  });
});
