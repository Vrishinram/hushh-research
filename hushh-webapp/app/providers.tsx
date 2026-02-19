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

import { ReactNode, useEffect, useRef } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/lib/firebase";
import { VaultProvider } from "@/lib/vault/vault-context";
import { NavigationProvider } from "@/lib/navigation/navigation-context";
import { StepProgressProvider } from "@/lib/progress/step-progress-context";
import { StepProgressBar } from "@/components/ui/step-progress-bar";
import { CacheProvider } from "@/lib/cache/cache-context";
import { ConsentNotificationProvider } from "@/components/consent/notification-provider";
import { StatusBarBlur, TopAppBar, TopBarBackground } from "@/components/ui/top-app-bar";
import { Navbar } from "@/components/navbar";
import { Toaster } from "@/components/ui/sonner";
import { StatusBarManager } from "@/components/status-bar-manager";
import { usePathname } from "next/navigation";
import { ensureMorphyGsapReady } from "@/lib/morphy-ux/gsap-init";
import { usePageEnterAnimation } from "@/lib/morphy-ux/hooks/use-page-enter";
import { PostAuthOnboardingSyncBridge } from "@/components/onboarding/PostAuthOnboardingSyncBridge";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const pathname = usePathname();
  const hideGlobalChrome = pathname === "/" || pathname.startsWith("/login");
  const isKaiOnboarding = pathname === "/kai/onboarding" || pathname.startsWith("/kai/onboarding/");
  const pageRef = useRef<HTMLDivElement | null>(null);

  // One-time GSAP init (non-blocking).
  useEffect(() => {
    void ensureMorphyGsapReady();
  }, []);

  // App-wide page enter fade.
  usePageEnterAnimation(pageRef, { enabled: true, key: pathname });

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
                  <div className="flex flex-col flex-1 min-h-0">
                    <Navbar />
                    <StatusBarBlur />
                    <TopBarBackground />
                    <TopAppBar />
                    <PostAuthOnboardingSyncBridge />
                    {/* Main scroll container: extends under fixed bar so content can scroll behind it; padding clears bar height */}
                    <div
                      className={
                        hideGlobalChrome
                          ? // Landing is a full-screen onboarding flow: no page scroll, no extra top inset.
                            "flex-1 overflow-hidden relative z-10 min-h-0"
                          : isKaiOnboarding
                          ? // Keep /kai/onboarding single-screen; step components handle their own safe-area/footer inset.
                            "flex-1 overflow-hidden relative z-10 min-h-0 pt-[45px]"
                          : "flex-1 overflow-y-auto pb-[var(--app-bottom-inset)] relative z-10 min-h-0 pt-[45px]"
                      }
                    >
                      <div
                        ref={pageRef}
                        key={pathname}
                        className={isKaiOnboarding ? "min-h-0 h-full" : "min-h-0"}
                      >
                        {children}
                      </div>
                    </div>
                  </div>
                  <Toaster />
                </NavigationProvider>
              </ConsentNotificationProvider>
            </VaultProvider>
          </CacheProvider>
        </AuthProvider>
      </StepProgressProvider>
    </ThemeProvider>
  );
}
