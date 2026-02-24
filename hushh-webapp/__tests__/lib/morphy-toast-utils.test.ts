import { beforeEach, describe, expect, it, vi } from "vitest";

const sonnerSpies = vi.hoisted(() => ({
  base: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
  promise: vi.fn(),
}));

vi.mock("sonner", () => {
  const toast = Object.assign(sonnerSpies.base, {
    success: sonnerSpies.success,
    error: sonnerSpies.error,
    warning: sonnerSpies.warning,
    info: sonnerSpies.info,
    dismiss: sonnerSpies.dismiss,
    promise: sonnerSpies.promise,
  });

  return { toast };
});

import { morphyToast } from "@/lib/morphy-ux/toast-utils";

describe("morphyToast variant styling", () => {
  beforeEach(() => {
    sonnerSpies.base.mockClear();
    sonnerSpies.success.mockClear();
    sonnerSpies.error.mockClear();
    sonnerSpies.warning.mockClear();
    sonnerSpies.info.mockClear();
  });

  it("uses accent classes for typed toasts instead of fill variant classes", () => {
    morphyToast.success("Saved", { variant: "blue-gradient" });

    expect(sonnerSpies.success).toHaveBeenCalledTimes(1);
    const options = sonnerSpies.success.mock.calls[0][1] as {
      className?: string;
    };
    const className = options.className ?? "";

    expect(className).toContain("morphy-sonner-toast");
    expect(className).toContain("morphy-sonner-tone-success");
    expect(className).toContain("morphy-sonner-accent-blue-gradient");
    expect(className).not.toContain("bg-gradient-to-r");
    expect(className).not.toContain("shadow-[0_18px_60px");
  });

  it("keeps custom toast variant styling as subtle accents", () => {
    morphyToast.custom("Portfolio imported", { variant: "yellow" });

    expect(sonnerSpies.base).toHaveBeenCalledTimes(1);
    const options = sonnerSpies.base.mock.calls[0][1] as {
      className?: string;
    };
    const className = options.className ?? "";

    expect(className).toContain("morphy-sonner-toast");
    expect(className).toContain("morphy-sonner-accent-yellow");
    expect(className).not.toContain("bg-gradient-to-r");
    expect(className).not.toContain("text-black shadow-md");
  });
});
