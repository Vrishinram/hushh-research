"use client";

import { useEffect, useState } from "react";
import {
  Capacitor,
  SystemBars,
  SystemBarsStyle,
  SystemBarType,
} from "@capacitor/core";
import { useTheme } from "next-themes";

/**
 * measureSafeAreaInsetTop
 *
 * Reads the real env(safe-area-inset-top) value via a probe element and
 * writes it to --top-inset on <html>.  This sidesteps the WebKit bug where
 * env() assigned to a CSS custom-property at :root level can evaluate to 0
 * if the WKWebView hasn't committed its safe-area values by parse time.
 *
 * Called once on mount, and again after orientation changes.
 */
function measureSafeAreaInsetTop() {
  if (typeof document === "undefined") return;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;top:0;left:0;width:0;padding-top:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none;";
  document.body.appendChild(probe);
  // Force layout so the browser resolves env().
  const px = probe.offsetHeight;
  probe.remove();
  document.documentElement.style.setProperty("--top-inset", `${px}px`);
}

/**
 * StatusBarManager - Native-only runtime bridge that synchronizes
 * Capacitor v8 SystemBars style with the app theme.
 *
 * Also measures and sets --top-inset at runtime so all top-shell
 * layout tokens (--top-shell-h, --top-glass-h, --top-content-pad)
 * resolve correctly on every platform.
 *
 * Migration note:
 * - This component name is retained for import stability.
 * - Runtime control now uses SystemBars for both StatusBar and NavigationBar.
 */
export function StatusBarManager() {
  const { resolvedTheme, theme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Wait for theme to be mounted to avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // ── Measure env(safe-area-inset-top) and write --top-inset ──────────
  useEffect(() => {
    // Initial measurement (after a frame so WKWebView has committed insets).
    const raf = requestAnimationFrame(() => measureSafeAreaInsetTop());

    // Re-measure on orientation / resize changes.
    const onResize = () => measureSafeAreaInsetTop();
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", onResize, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !mounted) return;

    async function updateSystemBars() {
      try {
        // Keep bars visible in immersive edge-to-edge mode.
        await SystemBars.show({});
        const effectiveTheme = resolvedTheme || theme || "dark";
        const style =
          effectiveTheme === "dark"
            ? SystemBarsStyle.Dark
            : SystemBarsStyle.Light;

        await SystemBars.setStyle({
          bar: SystemBarType.StatusBar,
          style,
        });
        await SystemBars.setStyle({
          bar: SystemBarType.NavigationBar,
          style,
        });
      } catch (err) {
        console.error("[StatusBarManager] Failed to update system bars:", err);
      }
    }

    void updateSystemBars();
  }, [resolvedTheme, theme, mounted]);

  return null;
}
