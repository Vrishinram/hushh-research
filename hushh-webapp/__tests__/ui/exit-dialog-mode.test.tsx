import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/vault/vault-context", async () => {
  const ReactModule = await import("react");
  return {
    VaultContext: ReactModule.createContext(null),
  };
});

import { ExitDialog } from "@/components/exit-dialog";

describe("ExitDialog mode behavior", () => {
  it("renders lock-only copy on iOS mode", () => {
    const onConfirm = vi.fn();

    render(
      <ExitDialog
        open
        mode="lock_only"
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByRole("heading", { name: "Lock Vault" })).toBeTruthy();
    expect(screen.queryByText("Exit Hushh")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Lock Vault" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
