"use client";

/**
 * Unified Client Providers
 *
 * Wraps all client-side providers in a single "use client" boundary
 * to ensure proper hydration and avoid server/client mismatch issues.
 *
 * Uses StepProgressProvider for step-based loading progress tracking.
 * Pages register their loading steps and the progress bar shows real progress.
 *
 * CacheProvider enables data sharing across page navigations to reduce API calls.
 */

import { CSSProperties, ReactNode, useEffect, useMemo, useRef } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/lib/firebase";
import { VaultProvider } from "@/lib/vault/vault-context";
import { NavigationProvider } from "@/lib/navigation/navigation-context";
import { StepProgressProvider } from "@/lib/progress/step-progress-context";
import { StepProgressBar } from "@/components/app-ui/step-progress-bar";
import { CacheProvider } from "@/lib/cache/cache-context";
import { ConsentNotificationProvider } from "@/components/consent/notification-provider";
import { resolveTopShellRouteProfile } from "@/components/app-ui/top-shell-metrics";
import { TopAppBar } from "@/components/app-ui/top-app-bar";
import { Navbar } from "@/components/navbar";
import { Toaster } from "@/components/ui/sonner";
import { StatusBarManager } from "@/components/status-bar-manager";
import { usePathname } from "next/navigation";
import { ensureMorphyGsapReady } from "@/lib/morphy-ux/gsap-init";
import { usePageEnterAnimation } from "@/lib/morphy-ux/hooks/use-page-enter";
import { PostAuthOnboardingSyncBridge } from "@/components/onboarding/PostAuthOnboardingSyncBridge";
import { KaiCommandBarGlobal } from "@/components/kai/kai-command-bar-global";
import { useScrollReset } from "@/lib/navigation/use-scroll-reset";
import { Capacitor } from "@capacitor/core";
import {
  resetKaiBottomChromeVisibility,
  useKaiBottomChromeVisibility,
} from "@/lib/navigation/kai-bottom-chrome-visibility";
import { getKaiChromeState } from "@/lib/navigation/kai-chrome-state";
import { cn } from "@/lib/utils";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const pathname = usePathname();
  const isImportRoute = pathname.startsWith("/kai/import");
  const chromeState = useMemo(() => getKaiChromeState(pathname), [pathname]);
  const topShellRouteProfile = useMemo(
    () => resolveTopShellRouteProfile(pathname),
    [pathname]
  );
  const topShellMetrics = topShellRouteProfile.metrics;
  const hideGlobalChrome = !topShellMetrics.shellVisible;
  const isFullscreenTopFlow = topShellMetrics.contentOffsetMode === "fullscreen-flow";
  const shouldLockFullscreenRoot = isFullscreenTopFlow && !isImportRoute;
  const shouldRenderTopSpacer =
    topShellMetrics.shellVisible && (!isFullscreenTopFlow || isImportRoute);
  const topShellRouteStyle = useMemo(
    () =>
      ({
        "--top-tabs-gap": topShellMetrics.hasTabs ? "2px" : "0px",
        "--top-tabs-total": topShellMetrics.hasTabs
          ? "calc(var(--top-tabs-h) + var(--top-tabs-gap))"
          : "0px",
        "--top-fade-active": topShellMetrics.hasTabs ? "28px" : "14px",
        "--kai-route-content-gap": topShellMetrics.hasTabs ? "12px" : "8px",
        "--kai-route-content-gap-sm": topShellMetrics.hasTabs ? "16px" : "12px",
        "--app-top-shell-visible": topShellMetrics.shellVisible ? "1" : "0",
        "--app-top-has-tabs": topShellMetrics.hasTabs ? "1" : "0",
        "--app-top-offset-mode":
          topShellMetrics.contentOffsetMode === "fullscreen-flow" ? "fullscreen-flow" : "normal",
        "--app-scroll-bottom-pad": chromeState.hideCommandBar
          ? "var(--app-bottom-inset)"
          : "calc(var(--app-bottom-inset) + var(--kai-command-fixed-ui) + var(--kai-command-bottom-gap, 12px) + 10px)",
      } as CSSProperties),
    [
      chromeState.hideCommandBar,
      topShellMetrics.contentOffsetMode,
      topShellMetrics.hasTabs,
      topShellMetrics.shellVisible,
    ]
  );
  const showSharedBottomChromeGlass = topShellMetrics.shellVisible && !isFullscreenTopFlow;
  const { hidden: hideBottomChromeGlass } = useKaiBottomChromeVisibility(
    showSharedBottomChromeGlass
  );
  const pageRef = useRef<HTMLDivElement | null>(null);
  const pageAnimationKey = useMemo(
    () => (pathname.startsWith("/kai") ? "/kai-stable-shell" : pathname),
    [pathname]
  );

  // One-time GSAP init (non-blocking).
  useEffect(() => {
    void ensureMorphyGsapReady();
  }, []);

  // Add a root platform class for native-iOS specific CSS hooks.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const isNativeIOS =
      Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
    root.classList.toggle("native-ios", isNativeIOS);
    return () => root.classList.remove("native-ios");
  }, []);

  // App-wide page enter fade.
  usePageEnterAnimation(pageRef, { enabled: true, key: pageAnimationKey });
  useScrollReset(pathname, { enabled: true, behavior: "auto" });

  useEffect(() => {
    resetKaiBottomChromeVisibility();
  }, [pathname]);

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <StepProgressProvider>
        <StatusBarManager />
        {/* Step-based progress bar at top of viewport */}
        <StepProgressBar />
        <AuthProvider>
          <CacheProvider>
            <VaultProvider>
              <ConsentNotificationProvider>
                <NavigationProvider>
                  {/* Flex container for proper scroll behavior */}
                  <div
                    className="flex flex-col flex-1 min-h-0"
                    style={topShellRouteStyle}
                    data-top-shell-profile={topShellRouteProfile.id}
                  >
                    <Navbar />
                    <TopAppBar />
                    {showSharedBottomChromeGlass ? (
                      <div
                        aria-hidden
                        className={cn(
                          "pointer-events-none fixed inset-x-0 bottom-0 z-[108] transform-gpu transition-all duration-300 ease-out",
                          hideBottomChromeGlass ? "opacity-0" : "opacity-100"
                        )}
                        style={{
                          transform: hideBottomChromeGlass
                            ? "translate3d(0, calc(100% + 18px), 0)"
                            : "translate3d(0, 0, 0)",
                        }}
                      >
                        <div className="h-[calc(var(--app-bottom-inset)+var(--kai-command-fixed-ui)+36px)] w-full bar-glass bar-glass-bottom" />
                      </div>
                    ) : null}
                    <PostAuthOnboardingSyncBridge />
                    <KaiCommandBarGlobal />
                    {/* Main scroll container: extends under fixed bar so content can scroll behind it; padding clears bar height */}
                    <div
                      data-app-scroll-root="true"
                      className={
                        hideGlobalChrome
                          ? // Landing is a full-screen onboarding flow: no page scroll, no extra top inset.
                            "flex-1 overflow-hidden relative z-10 min-h-0"
                          : shouldLockFullscreenRoot
                          ? // Keep onboarding fullscreen routes single-screen; import stays scrollable.
                            "flex-1 overflow-hidden relative z-10 min-h-0"
                          : "flex-1 overflow-y-auto overflow-x-hidden overscroll-x-none touch-pan-y pb-[var(--app-scroll-bottom-pad,var(--app-bottom-inset))] relative z-10 min-h-0"
                      }
                    >
                      {shouldRenderTopSpacer ? (
                        <div
                          aria-hidden
                          className="w-full shrink-0"
                          style={{ height: "var(--top-content-pad)" }}
                        />
                      ) : null}
                      <div
                        ref={pageRef}
                        className={shouldLockFullscreenRoot ? "min-h-0 h-full" : "min-h-0"}
                      >
                        {children}
                      </div>
                    </div>
                  </div>
                  <Toaster
                    position="top-center"
                    closeButton
                    offset={{
                      top: "calc(var(--top-inset, 0px) + 12px)",
                    }}
                    mobileOffset={{
                      top: "calc(var(--top-inset, 0px) + 12px)",
                    }}
                  />
                </NavigationProvider>
              </ConsentNotificationProvider>
            </VaultProvider>
          </CacheProvider>
        </AuthProvider>
      </StepProgressProvider>
    </ThemeProvider>
  );
}
