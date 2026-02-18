# Kai Analysis Layout + Review Mode Notes

## Analysis History Top Spacing
- Keep global layout unchanged (`providers.tsx` keeps `pt-[45px]`).
- Apply additional top offset only on Analysis History page state:
  - `app/kai/dashboard/analysis/page.tsx` wraps `AnalysisHistoryDashboard` with `pt-4`.
- This avoids shifting all other pages while fixing history-header overlap.

## Analysis History Mobile Actions
- The 3-dot actions menu is the first table column:
  - `components/kai/views/columns.tsx`
- Menu trigger stops row click propagation for reliable touch behavior.

## Kai Preferences (World Model)
- Preferences are persisted to encrypted world model domain `kai_profile` via:
  - `lib/services/kai-profile-service.ts` (`KaiProfileService.savePreferences`, `KaiProfileService.setOnboardingCompleted`)
- Onboarding flow (post-auth + vault unlock):
  - `app/kai/onboarding/page.tsx` (wizard -> persona -> dashboard)
  - `components/kai/onboarding/KaiPreferencesWizard.tsx`
  - `components/kai/onboarding/KaiPersonaScreen.tsx`
- Dashboard editing uses a bottom sheet:
  - `components/kai/onboarding/KaiPreferencesSheet.tsx`

## App Review Mode Source of Truth
- Login screen now fetches review-mode config from backend at runtime:
  - `ApiService.getAppReviewModeConfig()`
- Reviewer login session token:
  - `ApiService.createAppReviewModeSession()` -> `AuthService.signInWithCustomToken(...)`
- Web path:
  - `GET /api/app-config/review-mode` (Next route proxy)
  - `app/api/app-config/review-mode/route.ts`
- Native path (iOS/Android):
  - `ApiService` points directly to backend, bypassing Next proxy.

## Native Auth Compatibility
- Reviewer login uses `AuthService.signInWithCustomToken(...)` (same on web + native).
