"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { HushhLoader } from "@/components/ui/hushh-loader";
import { useAuth } from "@/lib/firebase/auth-context";
import { OnboardingLocalService } from "@/lib/services/onboarding-local-service";
import { IntroStep } from "@/components/onboarding/IntroStep";
import { PreviewCarouselStep } from "@/components/onboarding/PreviewCarouselStep";
import { AuthStep } from "@/components/onboarding/AuthStep";

type HomeStep = "intro" | "preview" | "auth";

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get("redirect") || "/kai";

  const { user, loading } = useAuth();
  const [step, setStep] = useState<HomeStep | null>(null);

  const forceOnboardingInDev =
    process.env.NODE_ENV !== "production" &&
    (process.env.NEXT_PUBLIC_ENVIRONMENT_MODE ?? "").toLowerCase() ===
      "development";

  // Debug helper (browser console): resets Steps 1-2 visibility flag.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (typeof window === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).resetOnboardingMarketing = async () => {
      await OnboardingLocalService.clearMarketingSeen();
      window.location.href = "/";
    };

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).resetOnboardingMarketing;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (loading) return;

    if (user) {
      router.push(redirectPath);
      return;
    }

    (async () => {
      if (forceOnboardingInDev) {
        setStep("intro");
        return;
      }

      const hasSeen = await OnboardingLocalService.hasSeenMarketing();
      if (cancelled) return;
      setStep(hasSeen ? "auth" : "intro");
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, user, redirectPath, router, forceOnboardingInDev]);

  if (loading || step === null) {
    return <HushhLoader label="Loading..." variant="fullscreen" />;
  }

  if (step === "intro") {
    return <IntroStep onNext={() => setStep("preview")} />;
  }

  if (step === "preview") {
    return <PreviewCarouselStep onContinue={() => setStep("auth")} />;
  }

  return <AuthStep redirectPath={redirectPath} />;
}

export default function Home() {
  return (
    <Suspense fallback={<HushhLoader label="Loading..." variant="fullscreen" />}>
      <HomeContent />
    </Suspense>
  );
}
