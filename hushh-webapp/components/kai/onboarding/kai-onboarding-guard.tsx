"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { HushhLoader } from "@/components/ui/hushh-loader";
import { KaiProfileService } from "@/lib/services/kai-profile-service";
import { useAuth } from "@/hooks/use-auth";
import { useVault } from "@/lib/vault/vault-context";

export function KaiOnboardingGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading: authLoading } = useAuth();
  const { vaultKey, vaultOwnerToken, isVaultUnlocked } = useVault();

  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (authLoading) return;

      // VaultLockGuard handles unauthenticated + locked vault states.
      if (!user || !isVaultUnlocked || !vaultKey || !vaultOwnerToken) {
        setChecking(false);
        return;
      }

      // Allow the onboarding route itself.
      if (pathname.startsWith("/kai/onboarding")) {
        setChecking(false);
        return;
      }

      try {
        const profile = await KaiProfileService.getProfile({
          userId: user.uid,
          vaultKey,
          vaultOwnerToken,
        });

        if (cancelled) return;

        if (!profile.onboarding.completed) {
          router.replace("/kai/onboarding");
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

