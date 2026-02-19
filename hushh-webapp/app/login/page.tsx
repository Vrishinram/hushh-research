"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { AuthStep } from "@/components/onboarding/AuthStep";
import { HushhLoader } from "@/components/ui/hushh-loader";

function LoginContent() {
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get("redirect") || "/kai";

  return (
    <AuthStep
      redirectPath={redirectPath}
      compact
    />
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<HushhLoader label="Loading login..." variant="fullscreen" />}>
      <LoginContent />
    </Suspense>
  );
}
