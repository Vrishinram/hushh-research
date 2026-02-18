import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/services/vault-service", () => {
  return {
    VaultService: {
      checkVault: vi.fn(),
      getOrIssueVaultOwnerToken: vi.fn(),
    },
  };
});

import { VaultService } from "@/lib/services/vault-service";
import { resolveDeleteAccountAuth } from "@/lib/flows/delete-account";

describe("resolveDeleteAccountAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("issues a VAULT_OWNER token directly when no vault exists", async () => {
    (VaultService.checkVault as any).mockResolvedValue(false);
    (VaultService.getOrIssueVaultOwnerToken as any).mockResolvedValue({
      token: "issued-token",
      expiresAt: Date.now() + 60_000,
      scope: "VAULT_OWNER",
    });

    const res = await resolveDeleteAccountAuth({
      userId: "uid-1",
      existingVaultOwnerToken: null,
    });

    expect(VaultService.checkVault).toHaveBeenCalledWith("uid-1");
    expect(VaultService.getOrIssueVaultOwnerToken).toHaveBeenCalledWith(
      "uid-1",
      null,
      null
    );
    expect(res).toEqual({
      kind: "issue_token",
      token: "issued-token",
      hasVault: false,
    });
  });

  it("uses existing token when vault exists and token already present", async () => {
    (VaultService.checkVault as any).mockResolvedValue(true);

    const res = await resolveDeleteAccountAuth({
      userId: "uid-2",
      existingVaultOwnerToken: "existing-token",
    });

    expect(VaultService.checkVault).toHaveBeenCalledWith("uid-2");
    expect(VaultService.getOrIssueVaultOwnerToken).not.toHaveBeenCalled();
    expect(res).toEqual({
      kind: "use_existing_token",
      token: "existing-token",
      hasVault: true,
    });
  });

  it("requires unlock when vault exists and no token is present", async () => {
    (VaultService.checkVault as any).mockResolvedValue(true);

    const res = await resolveDeleteAccountAuth({
      userId: "uid-3",
      existingVaultOwnerToken: null,
    });

    expect(VaultService.checkVault).toHaveBeenCalledWith("uid-3");
    expect(VaultService.getOrIssueVaultOwnerToken).not.toHaveBeenCalled();
    expect(res).toEqual({
      kind: "needs_unlock",
      hasVault: true,
    });
  });
});

