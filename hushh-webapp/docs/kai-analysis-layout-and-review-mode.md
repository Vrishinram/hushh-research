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

## Kai Intro Preferences Save UX
- Preferences are persisted to world model domain `kai_profile` using:
  - `KaiIntroService.saveProfile()` -> `WorldModelService.storeMergedDomain(...)`.
- Save button now shows spinner state:
  - `components/kai/onboarding/kai-intro-modal.tsx`
- Skip/Skip All now close immediately and save in background to remove perceived delay.

## App Review Mode Source of Truth
- Login screen now fetches review-mode config from backend at runtime:
  - `ApiService.getAppReviewModeConfig()`
- Web path:
  - `GET /api/app-config/review-mode` (Next route proxy)
  - `app/api/app-config/review-mode/route.ts`
- Native path (iOS/Android):
  - `ApiService` points directly to backend, bypassing Next proxy.

## Native Auth Compatibility
- Reviewer login now uses platform-aware `AuthService.signInWithEmailAndPassword(...)`
  instead of direct Firebase web SDK call.
- This keeps native and web login behavior aligned.
