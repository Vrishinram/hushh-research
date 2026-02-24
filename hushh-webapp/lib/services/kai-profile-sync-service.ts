"use client";

import {
  KaiProfileService,
  computeRiskScore,
  mapRiskProfile,
} from "@/lib/services/kai-profile-service";
import { KaiNavTourLocalService } from "@/lib/services/kai-nav-tour-local-service";
import { PreVaultOnboardingService } from "@/lib/services/pre-vault-onboarding-service";

export class KaiProfileSyncService {
  static async syncPendingToVault(params: {
    userId: string;
    vaultKey: string;
    vaultOwnerToken?: string;
  }): Promise<{ synced: boolean; reason?: string }> {
    const [pendingOnboarding, pendingNavTour] = await Promise.all([
      PreVaultOnboardingService.load(params.userId),
      KaiNavTourLocalService.load(params.userId),
    ]);

    let onboardingReason: string | undefined;
    let navReason: string | undefined;

    let onboardingPayload:
      | {
          completed: boolean;
          skippedPreferences: boolean;
          completedAt?: string | null;
          answers?: {
            investment_horizon: "short_term" | "medium_term" | "long_term" | null;
            drawdown_response: "reduce" | "stay" | "buy_more" | null;
            volatility_preference: "small" | "moderate" | "large" | null;
          };
        }
      | undefined;

    if (!pendingOnboarding) {
      onboardingReason = "no_pending_state";
    } else if (!pendingOnboarding.completed) {
      onboardingReason = "not_completed";
    } else if (pendingOnboarding.synced_to_vault_at) {
      onboardingReason = "already_synced";
    } else if (pendingOnboarding.skipped) {
      onboardingPayload = {
        completed: true,
        skippedPreferences: true,
        completedAt: pendingOnboarding.completed_at ?? undefined,
      };
    } else {
      const answers = pendingOnboarding.answers;
      const riskScore = computeRiskScore(answers);
      if (
        !answers.investment_horizon ||
        !answers.drawdown_response ||
        !answers.volatility_preference ||
        riskScore === null
      ) {
        onboardingReason = "incomplete_answers";
      } else {
        onboardingPayload = {
          completed: true,
          skippedPreferences: false,
          completedAt: pendingOnboarding.completed_at ?? undefined,
          answers,
        };
      }
    }

    let navPayload:
      | {
          completedAt?: string | null;
          skippedAt?: string | null;
        }
      | undefined;
    if (!pendingNavTour) {
      navReason = "no_pending_state";
    } else if (pendingNavTour.synced_to_vault_at) {
      navReason = "already_synced";
    } else if (!pendingNavTour.completed_at && !pendingNavTour.skipped_at) {
      navReason = "not_completed";
    } else {
      navPayload = {
        completedAt: pendingNavTour.completed_at,
        skippedAt: pendingNavTour.skipped_at,
      };
    }

    if (!onboardingPayload && !navPayload) {
      return {
        synced: false,
        reason:
          navReason && navReason !== "no_pending_state"
            ? `nav_tour_${navReason}`
            : onboardingReason ?? "no_pending_state",
      };
    }

    await KaiProfileService.syncOnboardingAndNavState({
      userId: params.userId,
      vaultKey: params.vaultKey,
      vaultOwnerToken: params.vaultOwnerToken,
      onboarding: onboardingPayload,
      navTour: navPayload,
    });

    if (onboardingPayload && pendingOnboarding && !pendingOnboarding.skipped) {
      const answers = pendingOnboarding.answers;
      const riskScore = computeRiskScore(answers);
      if (
        answers.investment_horizon &&
        answers.drawdown_response &&
        answers.volatility_preference &&
        riskScore !== null
      ) {
        const riskProfile = pendingOnboarding.risk_profile ?? mapRiskProfile(riskScore);
        await PreVaultOnboardingService.markCompleted(params.userId, {
          skipped: false,
          answers,
          risk_score: riskScore,
          risk_profile: riskProfile,
        });
      }
    }

    if (onboardingPayload) {
      await PreVaultOnboardingService.markSynced(params.userId);
    }
    if (navPayload) {
      await KaiNavTourLocalService.markSynced(params.userId);
    }

    return { synced: true };
  }
}
