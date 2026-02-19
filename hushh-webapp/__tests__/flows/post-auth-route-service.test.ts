import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/vault-service", () => ({
  VaultService: {
    checkVault: vi.fn(),
  },
}));

vi.mock("@/lib/services/pre-vault-onboarding-service", () => ({
  PreVaultOnboardingService: {
    load: vi.fn(),
  },
}));

import { VaultService } from "@/lib/services/vault-service";
import { PreVaultOnboardingService } from "@/lib/services/pre-vault-onboarding-service";
import { PostAuthRouteService } from "@/lib/services/post-auth-route-service";

describe("PostAuthRouteService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes first-time no-vault users to pre-vault onboarding", async () => {
    (VaultService.checkVault as any).mockResolvedValue(false);
    (PreVaultOnboardingService.load as any).mockResolvedValue(null);

    const path = await PostAuthRouteService.resolveAfterLogin({
      userId: "uid-1",
      redirectPath: "/kai",
    });

    expect(path).toBe("/kai/onboarding");
  });

  it("routes completed local pre-vault users to kai home", async () => {
    (VaultService.checkVault as any).mockResolvedValue(false);
    (PreVaultOnboardingService.load as any).mockResolvedValue({
      completed: true,
      skipped: false,
    });

    const path = await PostAuthRouteService.resolveAfterLogin({
      userId: "uid-2",
      redirectPath: "/kai",
    });

    expect(path).toBe("/kai");
  });

  it("preserves redirect path when vault already exists", async () => {
    (VaultService.checkVault as any).mockResolvedValue(true);

    const path = await PostAuthRouteService.resolveAfterLogin({
      userId: "uid-3",
      redirectPath: "/consents",
    });

    expect(path).toBe("/consents");
    expect(PreVaultOnboardingService.load).not.toHaveBeenCalled();
  });
});
