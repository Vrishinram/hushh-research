// components/navbar.tsx
// Bottom pill navigation + onboarding theme control.

"use client";

import React, { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BriefcaseBusiness, Shield, TrendingUp, User } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { usePendingConsentCount } from "@/components/consent/notification-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { useKaiSession } from "@/lib/stores/kai-session-store";
import { getKaiChromeState } from "@/lib/navigation/kai-chrome-state";
import { SegmentedPill, type SegmentedPillOption } from "@/lib/morphy-ux/ui";
import { useKaiBottomChromeVisibility } from "@/lib/navigation/kai-bottom-chrome-visibility";
import { cn } from "@/lib/utils";
import { morphyToast as toast } from "@/lib/morphy-ux/morphy";
import { RiaService, type Persona } from "@/lib/services/ria-service";

type NavKey = "home" | "consents" | "profile";

export const Navbar = () => {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, user } = useAuth();
  const pendingConsents = usePendingConsentCount();
  const pillRef = React.useRef<HTMLDivElement | null>(null);
  const [kaiHref, setKaiHref] = useState("/kai");
  const [riaHref, setRiaHref] = useState("/ria");
  const [primaryPersona, setPrimaryPersona] = useState<Persona>("investor");
  const chromeState = useMemo(() => getKaiChromeState(pathname), [pathname]);
  const useOnboardingChrome = chromeState.useOnboardingChrome;
  const preserveBottomChrome = Boolean(
    pathname?.startsWith("/ria") || pathname?.startsWith("/marketplace")
  );
  const allowScrollHide = isAuthenticated && !useOnboardingChrome && !preserveBottomChrome;
  const { hidden: hideBottomChrome, progress: hideBottomChromeProgress } = useKaiBottomChromeVisibility(allowScrollHide);

  const lastKaiPath = useKaiSession((s) => s.lastKaiPath);
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
    if (lastKaiPath) setKaiHref(lastKaiPath);
  }, [lastKaiPath]);

  useEffect(() => {
    if (!pathname) return;
    if (pathname.startsWith("/kai")) {
      useKaiSession.getState().setLastKaiPath(pathname);
      setKaiHref(pathname);
      setPrimaryPersona("investor");
    }
    if (pathname.startsWith("/ria")) {
      setRiaHref(pathname);
      setPrimaryPersona("ria");
    }
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;

    async function loadPersona() {
      if (!isAuthenticated || !user) return;
      try {
        const idToken = await user.getIdToken();
        const state = await RiaService.getPersonaState(idToken);
        if (!cancelled) {
          setPrimaryPersona(state.last_active_persona);
        }
      } catch {
        if (!cancelled) {
          setPrimaryPersona(pathname?.startsWith("/ria") ? "ria" : "investor");
        }
      }
    }

    void loadPersona();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, pathname, user]);

  const primaryNavLabel = primaryPersona === "ria" ? "RIA" : "Kai";
  const primaryNavIcon = primaryPersona === "ria" ? BriefcaseBusiness : TrendingUp;
  const primaryHref = primaryPersona === "ria" ? riaHref : kaiHref;

  const navOptions = useMemo<SegmentedPillOption[]>(
    () => [
      {
        value: "home",
        label: primaryNavLabel,
        icon: primaryNavIcon,
        dataTourId: "nav-kai",
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
    : normalizedPathname.startsWith("/profile")
      ? "profile"
      : "home";

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
      case "home":
        router.push(primaryHref);
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
