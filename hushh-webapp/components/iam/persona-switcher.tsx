"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "@/hooks/use-auth";
import { usePersonaState } from "@/lib/persona/persona-context";
import { ROUTES } from "@/lib/navigation/routes";
import { type Persona } from "@/lib/services/ria-service";
import { SegmentedPill, type SegmentedPillOption } from "@/lib/morphy-ux/ui";
import { cn } from "@/lib/utils";

function routeForPersona(persona: Persona): string {
  return persona === "ria" ? ROUTES.RIA_HOME : ROUTES.KAI_HOME;
}

export function PersonaSwitcher({ className }: { className?: string }) {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const {
    personaState: state,
    activePersona,
    riaCapability,
    riaEntryRoute,
    switchPersona,
  } = usePersonaState();
  const [switching, setSwitching] = useState<Persona | null>(null);

  if (!isAuthenticated || !state) {
    return null;
  }

  const riaAvailable = riaCapability === "switch";
  const riaSetupAvailable = riaCapability === "setup";

  async function onSwitch(target: Persona) {
    if (target === "ria" && !riaAvailable && !riaSetupAvailable) {
      return;
    }
    if (!state || target === activePersona) {
      if (state && target !== activePersona) {
        router.push(target === "ria" ? riaEntryRoute : routeForPersona(target));
      }
      return;
    }

    setSwitching(target);
    try {
      const nextRoute = routeForPersona(target);
      await switchPersona(target);
      if (!pathname.startsWith(nextRoute)) {
        router.push(nextRoute);
      }
    } catch (error) {
      console.warn("[PersonaSwitcher] switch failed", error);
    } finally {
      setSwitching(null);
    }
  }

  const options: SegmentedPillOption[] = [
    { value: "investor", label: "Investor" },
    {
      value: "ria",
      label: riaAvailable ? "RIA" : riaSetupAvailable ? "Set up RIA" : "RIA",
      tone: riaSetupAvailable ? "accent" : "default",
      disabled: !riaAvailable && !riaSetupAvailable,
    },
  ];

  return (
    <SegmentedPill
      size="default"
      value={activePersona}
      options={options}
      onValueChange={(next) => void onSwitch(next as Persona)}
      ariaLabel="Persona selector"
      className={cn("w-full max-w-[320px]", switching !== null && "opacity-70", className)}
    />
  );
}
