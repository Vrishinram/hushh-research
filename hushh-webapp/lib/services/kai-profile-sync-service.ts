"use client";

import {
  KaiProfileService,
  computeRiskScore,
  mapRiskProfile,
} from "@/lib/services/kai-profile-service";
import { PreVaultOnboardingService } from "@/lib/services/pre-vault-onboarding-service";

export class KaiProfileSyncService {
  static async syncPendingToVault(params: {
    userId: string;
    vaultKey: string;
    vaultOwnerToken?: string;
  }): Promise<{ synced: boolean; reason?: string }> {
    const pending = await PreVaultOnboardingService.load(params.userId);

    if (!pending) {
      return { synced: false, reason: "no_pending_state" };
    }

    if (!pending.completed) {
      return { synced: false, reason: "not_completed" };
    }

    if (pending.synced_to_vault_at) {
      return { synced: false, reason: "already_synced" };
    }

    if (pending.skipped) {
      await KaiProfileService.setOnboardingCompleted({
        userId: params.userId,
        vaultKey: params.vaultKey,
        vaultOwnerToken: params.vaultOwnerToken,
        skippedPreferences: true,
      });
      await PreVaultOnboardingService.markSynced(params.userId);
      return { synced: true };
    }

    const answers = pending.answers;
    const riskScore = computeRiskScore(answers);
    if (
      !answers.investment_horizon ||
      !answers.drawdown_response ||
      !answers.volatility_preference ||
      riskScore === null
    ) {
      return { synced: false, reason: "incomplete_answers" };
    }

    const riskProfile = pending.risk_profile ?? mapRiskProfile(riskScore);

    await KaiProfileService.savePreferences({
      userId: params.userId,
      vaultKey: params.vaultKey,
      vaultOwnerToken: params.vaultOwnerToken,
      mode: "onboarding",
      updates: {
        investment_horizon: answers.investment_horizon,
        drawdown_response: answers.drawdown_response,
        volatility_preference: answers.volatility_preference,
      },
    });

    await KaiProfileService.setOnboardingCompleted({
      userId: params.userId,
      vaultKey: params.vaultKey,
      vaultOwnerToken: params.vaultOwnerToken,
      skippedPreferences: false,
    });

    await PreVaultOnboardingService.markCompleted(params.userId, {
      skipped: false,
      answers,
      risk_score: riskScore,
      risk_profile: riskProfile,
    });
    await PreVaultOnboardingService.markSynced(params.userId);

    return { synced: true };
  }
}
