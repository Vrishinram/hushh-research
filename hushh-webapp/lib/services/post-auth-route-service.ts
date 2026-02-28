"use client";

import { PreVaultOnboardingService } from "@/lib/services/pre-vault-onboarding-service";
import { PreVaultUserStateService } from "@/lib/services/pre-vault-user-state-service";
import { ROUTES } from "@/lib/navigation/routes";

const PRE_VAULT_ROUTE = ROUTES.KAI_ONBOARDING;
const NO_VAULT_DEFAULT_ROUTE = ROUTES.KAI_HOME;

function normalizeRedirectPath(path: string | null | undefined): string {
  if (!path || !path.trim()) return ROUTES.KAI_HOME;
  return path;
}

export class PostAuthRouteService {
  static async resolveAfterLogin(params: {
    userId: string;
    redirectPath?: string;
  }): Promise<string> {
    const fallbackRoute = normalizeRedirectPath(params.redirectPath);
    const remoteState = await PreVaultUserStateService.bootstrapState(params.userId);

    if (remoteState.hasVault) {
      return fallbackRoute;
    }

    let onboardingResolved = PreVaultUserStateService.isOnboardingResolved(remoteState);
    if (!onboardingResolved) {
      const pending = await PreVaultOnboardingService.load(params.userId);
      const remoteUnset =
        remoteState.preOnboardingCompleted === null &&
        remoteState.preOnboardingSkipped === null &&
        remoteState.preOnboardingCompletedAt === null;
      if (remoteUnset && pending?.completed) {
        const completedAtMs =
          pending.completed_at && !Number.isNaN(Date.parse(pending.completed_at))
            ? Date.parse(pending.completed_at)
            : Date.now();
        try {
          await PreVaultUserStateService.updatePreVaultState(params.userId, {
            preOnboardingCompleted: true,
            preOnboardingSkipped: pending.skipped,
            preOnboardingCompletedAt: completedAtMs,
          });
        } catch (error) {
          console.warn(
            "[PostAuthRouteService] Failed local->remote pre-vault onboarding bridge:",
            error
          );
        }
        onboardingResolved = true;
      }
    }

    return onboardingResolved ? NO_VAULT_DEFAULT_ROUTE : PRE_VAULT_ROUTE;
  }
}
