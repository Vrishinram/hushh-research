"use client";

import { Preferences } from "@capacitor/preferences";

const ONBOARDING_MARKETING_SEEN_KEY = "onboarding_marketing_seen_v1";

export class OnboardingLocalService {
  static async hasSeenMarketing(): Promise<boolean> {
    try {
      const { value } = await Preferences.get({ key: ONBOARDING_MARKETING_SEEN_KEY });
      return value === "true";
    } catch (error) {
      console.warn("[OnboardingLocalService] Failed to read local onboarding flag:", error);
      return false;
    }
  }

  static async markMarketingSeen(): Promise<void> {
    try {
      await Preferences.set({
        key: ONBOARDING_MARKETING_SEEN_KEY,
        value: "true",
      });
    } catch (error) {
      console.warn("[OnboardingLocalService] Failed to persist local onboarding flag:", error);
    }
  }

  static async clearMarketingSeen(): Promise<void> {
    try {
      await Preferences.remove({ key: ONBOARDING_MARKETING_SEEN_KEY });
    } catch (error) {
      console.warn("[OnboardingLocalService] Failed to clear local onboarding flag:", error);
    }
  }
}

