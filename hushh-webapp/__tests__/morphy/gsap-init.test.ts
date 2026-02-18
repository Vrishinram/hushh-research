import { describe, it, expect } from "vitest";

import { ensureMorphyGsapReady, getMorphyEaseName } from "@/lib/morphy-ux/gsap-init";

describe("gsap-init", () => {
  it("no-ops safely when window is undefined (SSR-like)", async () => {
    const original = (globalThis as any).window;
    try {
      Object.defineProperty(globalThis, "window", {
        value: undefined,
        configurable: true,
      });
      await expect(ensureMorphyGsapReady()).resolves.toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, "window", {
        value: original,
        configurable: true,
      });
    }
  });

  it("returns a valid ease string even before init", () => {
    const ease = getMorphyEaseName("emphasized");
    expect(typeof ease).toBe("string");
    expect(ease.length).toBeGreaterThan(0);
  });
});

