import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
let authState: { user: { uid: string } | null; loading: boolean } = {
  user: { uid: "uid-1" },
  loading: false,
};
let vaultState: { isVaultUnlocked: boolean } = {
  isVaultUnlocked: false,
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => authState,
}));

vi.mock("@/lib/vault/vault-context", () => ({
  useVault: () => vaultState,
}));

vi.mock("@/lib/services/vault-service", () => ({
  VaultService: {
    checkVault: vi.fn(),
  },
}));

vi.mock("@/components/vault/vault-flow", () => ({
  VaultFlow: () => <div data-testid="vault-flow">VaultFlow</div>,
}));

import { VaultService } from "@/lib/services/vault-service";
import { VaultLockGuard } from "@/components/vault/vault-lock-guard";

describe("VaultLockGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState = { user: { uid: "uid-1" }, loading: false };
    vaultState = { isVaultUnlocked: false };
  });

  it("renders children directly when no vault exists", async () => {
    (VaultService.checkVault as any).mockResolvedValue(false);

    render(
      <VaultLockGuard>
        <div>guard-children</div>
      </VaultLockGuard>
    );

    await waitFor(() => {
      expect(screen.getByText("guard-children")).toBeTruthy();
    });
  });

  it("renders unlock flow when vault exists and is locked", async () => {
    (VaultService.checkVault as any).mockResolvedValue(true);

    render(
      <VaultLockGuard>
        <div>guard-children</div>
      </VaultLockGuard>
    );

    await waitFor(() => {
      expect(screen.getByTestId("vault-flow")).toBeTruthy();
    });
  });
});
