"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { HushhLoader } from "@/components/ui/hushh-loader";
import { KaiProfileService } from "@/lib/services/kai-profile-service";
import { PreVaultOnboardingService } from "@/lib/services/pre-vault-onboarding-service";
import { VaultService } from "@/lib/services/vault-service";
import { useAuth } from "@/hooks/use-auth";
import { useVault } from "@/lib/vault/vault-context";
import {
  isOnboardingRequiredCookieEnabled,
  setOnboardingRequiredCookie,
} from "@/lib/services/onboarding-route-cookie";

export function KaiOnboardingGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading: authLoading } = useAuth();
  const { vaultKey, vaultOwnerToken, isVaultUnlocked } = useVault();

  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const onOnboardingRoute = pathname.startsWith("/kai/onboarding");

    async function run() {
      if (authLoading) return;

      // VaultLockGuard handles unauthenticated states.
      if (!user) {
        setChecking(false);
        return;
      }

      try {
        const hasVault = await VaultService.checkVault(user.uid);
        if (cancelled) return;

        if (!hasVault) {
          const pending = await PreVaultOnboardingService.load(user.uid);
          if (cancelled) return;

          const onboardingIncomplete = !pending?.completed;
          setOnboardingRequiredCookie(onboardingIncomplete);

          if (onboardingIncomplete && !onOnboardingRoute) {
            router.replace("/kai/onboarding");
            return;
          }

          if (!onboardingIncomplete && onOnboardingRoute) {
            router.replace("/kai");
            return;
          }

          setChecking(false);
          return;
        }

        // If vault exists but is not currently unlocked, rely on lock-guard and last known cookie.
        if (!isVaultUnlocked || !vaultKey || !vaultOwnerToken) {
          if (!onOnboardingRoute && isOnboardingRequiredCookieEnabled()) {
            router.replace("/kai/onboarding");
            return;
          }
          setChecking(false);
          return;
        }

        const profile = await KaiProfileService.getProfile({
          userId: user.uid,
          vaultKey,
          vaultOwnerToken,
        });

        if (cancelled) return;

        const onboardingIncomplete = !profile.onboarding.completed;
        setOnboardingRequiredCookie(onboardingIncomplete);

        if (onboardingIncomplete && !onOnboardingRoute) {
          router.replace("/kai/onboarding");
          return;
        }

        if (!onboardingIncomplete && onOnboardingRoute) {
          router.replace("/kai");
          return;
        }
      } catch (error) {
        console.warn("[KaiOnboardingGuard] Failed to check onboarding state:", error);
        // Fail open (don't block access) if the world-model read fails.
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [
    authLoading,
    user?.uid,
    isVaultUnlocked,
    vaultKey,
    vaultOwnerToken,
    pathname,
    router,
  ]);

  if (checking) {
    return <HushhLoader label="Loading Kai..." />;
  }

  return <>{children}</>;
}
