import { describe, it, expect } from "vitest";

import { runFeatureRailTrailAnimation } from "@/lib/morphy-ux/hooks/use-feature-rail-trail";

describe("use-feature-rail-trail", () => {
  it("no-ops safely when window is undefined (SSR-like)", async () => {
    const originalWindow = (globalThis as any).window;
    try {
      Object.defineProperty(globalThis, "window", {
        value: undefined,
        configurable: true,
      });

      await expect(
        runFeatureRailTrailAnimation({
          enabled: true,
          railRefs: {
            activeLineEl: { current: null },
            topDotEl: { current: null },
            bottomDotEl: { current: null },
          },
          chipRefs: { current: [] },
        })
      ).resolves.toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        configurable: true,
      });
    }
  });

  it("applies final active state immediately when reduced motion is enabled", async () => {
    const originalMatchMedia = window.matchMedia;

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: () =>
        ({
          matches: true,
          media: "(prefers-reduced-motion: reduce)",
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }) as MediaQueryList,
    });

    try {
      const line = document.createElement("div");
      const topDot = document.createElement("div");
      const bottomDot = document.createElement("div");
      const chip = document.createElement("div");

      await runFeatureRailTrailAnimation({
        enabled: true,
        railRefs: {
          activeLineEl: { current: line },
          topDotEl: { current: topDot },
          bottomDotEl: { current: bottomDot },
        },
        chipRefs: { current: [chip] },
      });

      expect(topDot.dataset.state).toBe("active");
      expect(bottomDot.dataset.state).toBe("active");
      expect(chip.dataset.state).toBe("active");
      expect(line.style.transform).toContain("scaleY(1)");
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
      });
    }
  });
});
