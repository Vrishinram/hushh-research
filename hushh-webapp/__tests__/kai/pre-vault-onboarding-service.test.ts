import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: store.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      store.set(key, value);
    }),
    remove: vi.fn(async ({ key }: { key: string }) => {
      store.delete(key);
    }),
  },
}));

import { PreVaultOnboardingService } from "@/lib/services/pre-vault-onboarding-service";

describe("PreVaultOnboardingService", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it("stores states per user key", async () => {
    await PreVaultOnboardingService.saveDraft("user-a", {
      answers: { investment_horizon: "medium_term" },
    });
    await PreVaultOnboardingService.saveDraft("user-b", {
      answers: { investment_horizon: "long_term" },
    });

    const a = await PreVaultOnboardingService.load("user-a");
    const b = await PreVaultOnboardingService.load("user-b");

    expect(a?.answers.investment_horizon).toBe("medium_term");
    expect(b?.answers.investment_horizon).toBe("long_term");
  });

  it("marks completed + skipped and then marks synced", async () => {
    await PreVaultOnboardingService.saveDraft("user-c", {
      answers: {
        investment_horizon: "short_term",
        drawdown_response: "reduce",
        volatility_preference: "small",
      },
      risk_score: 0,
      risk_profile: "conservative",
    });

    const completed = await PreVaultOnboardingService.markCompleted("user-c", {
      skipped: true,
    });

    expect(completed.completed).toBe(true);
    expect(completed.skipped).toBe(true);
    expect(completed.completed_at).toBeTruthy();

    const synced = await PreVaultOnboardingService.markSynced("user-c");
    expect(synced?.synced_to_vault_at).toBeTruthy();
  });
});
