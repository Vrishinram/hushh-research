// components/navbar.tsx
// Bottom pill navigation + onboarding theme control.

"use client";

import React, { useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BriefcaseBusiness, Shield, Store, TrendingUp, User } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { usePendingConsentCount } from "@/components/consent/notification-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { useKaiSession } from "@/lib/stores/kai-session-store";
import { getKaiChromeState } from "@/lib/navigation/kai-chrome-state";
import { SegmentedPill, type SegmentedPillOption } from "@/lib/morphy-ux/ui";
import { useKaiBottomChromeVisibility } from "@/lib/navigation/kai-bottom-chrome-visibility";
import { ROUTES } from "@/lib/navigation/routes";
import { cn } from "@/lib/utils";
import { morphyToast as toast } from "@/lib/morphy-ux/morphy";
import { usePersonaState } from "@/lib/persona/persona-context";

type NavKey = "primary" | "market" | "consents" | "profile";

export const Navbar = () => {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const { primaryNavPersona, riaEntryRoute } = usePersonaState();
  const pendingConsents = usePendingConsentCount();
  const pillRef = React.useRef<HTMLDivElement | null>(null);
  const chromeState = useMemo(() => getKaiChromeState(pathname), [pathname]);
  const useOnboardingChrome = chromeState.useOnboardingChrome;
  const preserveBottomChrome = Boolean(
    pathname?.startsWith("/ria") || pathname?.startsWith("/marketplace")
  );
  const allowScrollHide = isAuthenticated && !useOnboardingChrome && !preserveBottomChrome;
  const { hidden: hideBottomChrome, progress: hideBottomChromeProgress } = useKaiBottomChromeVisibility(allowScrollHide);

  const lastKaiPath = useKaiSession((s) => s.lastKaiPath);
  const lastRiaPath = useKaiSession((s) => s.lastRiaPath);
  const busyOperations = useKaiSession((s) => s.busyOperations);

  React.useLayoutEffect(() => {
    const el = pillRef.current;
    if (!el) return;

    const BOTTOM_GAP_PX = isAuthenticated && !useOnboardingChrome ? 14 : 10;

    const update = () => {
      const rect = el.getBoundingClientRect();
      const height = Math.max(0, rect.height);
      const px = Math.round(height + BOTTOM_GAP_PX);
      document.documentElement.style.setProperty("--app-bottom-fixed-ui", `${px}px`);
    };

    update();
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => update())
        : null;
    ro?.observe(el);

    window.addEventListener("resize", update, { passive: true });
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [isAuthenticated, useOnboardingChrome]);

  useEffect(() => {
    if (!pathname) return;
    if (pathname.startsWith("/kai")) {
      useKaiSession.getState().setLastKaiPath(pathname);
      return;
    }
    if (pathname.startsWith("/ria")) {
      useKaiSession.getState().setLastRiaPath(pathname);
    }
  }, [pathname]);
  const primaryPersona =
    pathname?.startsWith("/ria")
      ? "ria"
      : pathname?.startsWith("/kai")
        ? "investor"
        : primaryNavPersona;
  const primaryNavLabel = primaryPersona === "ria" ? "RIA" : "Investor";
  const primaryNavIcon = primaryPersona === "ria" ? BriefcaseBusiness : TrendingUp;
  const primaryHref =
    primaryPersona === "ria" ? lastRiaPath || riaEntryRoute : lastKaiPath || "/kai";

  if (pathname?.startsWith(ROUTES.LABS_PROFILE_APPEARANCE)) {
    return null;
  }

  const navOptions = useMemo<SegmentedPillOption[]>(
    () => [
      {
        value: "primary",
        label: primaryNavLabel,
        icon: primaryNavIcon,
        dataTourId: "nav-kai",
      },
      {
        value: "market",
        label: "Market",
        icon: Store,
        dataTourId: "nav-marketplace",
      },
      {
        value: "consents",
        label: "Consents",
        icon: Shield,
        badge: pendingConsents,
        dataTourId: "nav-consents",
      },
      {
        value: "profile",
        label: "Profile",
        icon: User,
        dataTourId: "nav-profile",
      },
    ],
    [pendingConsents, primaryNavIcon, primaryNavLabel]
  );

  if (!isAuthenticated || useOnboardingChrome) {
    return (
      <nav
        className="fixed left-0 right-0 z-50 flex justify-center px-4 pointer-events-none"
        style={{
          bottom:
            "calc(max(var(--app-safe-area-bottom-effective), 0.5rem) + var(--app-bottom-chrome-lift, 0px))",
        }}
      >
        <div ref={pillRef} className="pointer-events-auto">
          <ThemeToggle className="bg-white/85 dark:bg-black/85" />
        </div>
      </nav>
    );
  }

  const normalizedPathname = pathname?.replace(/\/$/, "") || "";
  const activeNav: NavKey = normalizedPathname.startsWith("/consents")
    ? "consents"
    : normalizedPathname.startsWith("/marketplace")
      ? "market"
    : normalizedPathname.startsWith("/profile")
      ? "profile"
      : "primary";

  const navigateTo = (value: string) => {
    if (busyOperations["portfolio_save"]) {
      toast.info("Saving to vault. Please wait until encryption completes.");
      return;
    }

    const reviewDirty = Boolean(
      busyOperations["portfolio_review_active"] && busyOperations["portfolio_review_dirty"]
    );
    if (
      reviewDirty &&
      !window.confirm("You have unsaved portfolio changes. Leaving now will discard them.")
    ) {
      return;
    }

    switch (value as NavKey) {
      case "primary":
        router.push(primaryHref);
        return;
      case "market":
        router.push("/marketplace");
        return;
      case "consents":
        router.push("/consents");
        return;
      case "profile":
        router.push("/profile");
        return;
      default:
        return;
    }
  };

  return (
    <nav
      className={cn(
        "fixed inset-x-0 z-[120] flex justify-center px-4 transform-gpu",
        hideBottomChrome
          ? "pointer-events-none opacity-0"
          : "pointer-events-none opacity-100"
      )}
      style={{
        bottom:
          "calc(max(var(--app-safe-area-bottom-effective), 0.75rem) + var(--app-bottom-chrome-lift, 0px))",
        transform: `translate3d(0, calc(${100 * hideBottomChromeProgress}% + ${10 * hideBottomChromeProgress}px), 0)`,
        opacity: Math.max(0, 1 - hideBottomChromeProgress),
      }}
    >
      <SegmentedPill
        ref={pillRef}
        size="compact"
        value={activeNav}
        options={navOptions}
        onValueChange={navigateTo}
        ariaLabel="Main navigation"
        className="pointer-events-auto w-full max-w-[460px]"
      />
    </nav>
  );
};
