"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { HushhLoader } from "@/components/ui/hushh-loader";
import { KaiPersonaScreen } from "@/components/kai/onboarding/KaiPersonaScreen";
import { KaiPreferencesWizard } from "@/components/kai/onboarding/KaiPreferencesWizard";
import { KaiProfileService, type KaiProfileV2, type RiskProfile } from "@/lib/services/kai-profile-service";
import { useAuth } from "@/hooks/use-auth";
import { useVault } from "@/lib/vault/vault-context";

type Stage = "loading" | "wizard" | "persona";

export default function KaiOnboardingPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { vaultKey, vaultOwnerToken, isVaultUnlocked } = useVault();

  const [profile, setProfile] = useState<KaiProfileV2 | null>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (authLoading) return;
      if (!user || !isVaultUnlocked || !vaultKey || !vaultOwnerToken) return;

      setStage("loading");
      try {
        const p = await KaiProfileService.getProfile({
          userId: user.uid,
          vaultKey,
          vaultOwnerToken,
        });
        if (cancelled) return;
        setProfile(p);

        if (p.onboarding.completed) {
          router.replace("/kai");
          return;
        }

        // Resume on persona step if questionnaire already computed a persona.
        if (p.preferences.risk_profile && !p.onboarding.skipped_preferences) {
          setStage("persona");
        } else {
          setStage("wizard");
        }
      } catch (error) {
        console.warn("[KaiOnboardingPage] Failed to load profile:", error);
        if (!cancelled) {
          setProfile(null);
          setStage("wizard");
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.uid, isVaultUnlocked, vaultKey, vaultOwnerToken, router]);

  if (authLoading || !user || !isVaultUnlocked || !vaultKey || !vaultOwnerToken) {
    return <HushhLoader label="Preparing Kai..." variant="fullscreen" />;
  }

  if (stage === "loading") {
    return <HushhLoader label="Loading onboarding..." variant="fullscreen" />;
  }

  const safeProfile: KaiProfileV2 =
    profile ??
    ({
      schema_version: 2,
      onboarding: {
        completed: false,
        completed_at: null,
        skipped_preferences: false,
        version: 2,
      },
      preferences: {
        investment_horizon: null,
        investment_horizon_selected_at: null,
        investment_horizon_anchor_at: null,
        drawdown_response: null,
        drawdown_response_selected_at: null,
        volatility_preference: null,
        volatility_preference_selected_at: null,
        risk_score: null,
        risk_profile: null,
        risk_profile_selected_at: null,
      },
      updated_at: new Date().toISOString(),
    } as KaiProfileV2);

  if (stage === "persona") {
    const risk = safeProfile.preferences.risk_profile ?? "balanced";
    return (
      <KaiPersonaScreen
        riskProfile={risk as RiskProfile}
        onEditAnswers={() => setStage("wizard")}
        onLaunchDashboard={async () => {
          if (saving) return;
          try {
            setSaving(true);
            const next = await KaiProfileService.setOnboardingCompleted({
              userId: user.uid,
              vaultKey,
              vaultOwnerToken,
              skippedPreferences: false,
            });
            setProfile(next);
            toast.success("You're all set.");
            router.replace("/kai");
          } catch (error) {
            console.error("[KaiOnboardingPage] Failed to complete onboarding:", error);
            toast.error("Couldn't complete onboarding. Please retry.");
          } finally {
            setSaving(false);
          }
        }}
      />
    );
  }

  return (
    <KaiPreferencesWizard
      mode="onboarding"
      layout="page"
      initialAnswers={{
        investment_horizon: safeProfile.preferences.investment_horizon,
        drawdown_response: safeProfile.preferences.drawdown_response,
        volatility_preference: safeProfile.preferences.volatility_preference,
      }}
      onSkip={async () => {
        if (saving) return;
        try {
          setSaving(true);
          const next = await KaiProfileService.setOnboardingCompleted({
            userId: user.uid,
            vaultKey,
            vaultOwnerToken,
            skippedPreferences: true,
          });
          setProfile(next);
          toast.info("Preferences skipped. You can edit them later.");
          router.replace("/kai");
        } catch (error) {
          console.error("[KaiOnboardingPage] Skip failed:", error);
          toast.error("Couldn't skip onboarding. Please retry.");
        } finally {
          setSaving(false);
        }
      }}
      onComplete={async (payload) => {
        if (saving) return;
        try {
          setSaving(true);
          const next = await KaiProfileService.savePreferences({
            userId: user.uid,
            vaultKey,
            vaultOwnerToken,
            updates: {
              investment_horizon: payload.investment_horizon,
              drawdown_response: payload.drawdown_response,
              volatility_preference: payload.volatility_preference,
            },
            mode: "onboarding",
          });
          setProfile(next);
          setStage("persona");
        } catch (error) {
          console.error("[KaiOnboardingPage] Failed to save preferences:", error);
          toast.error("Couldn't save preferences. Please retry.");
        } finally {
          setSaving(false);
        }
      }}
    />
  );
}
