# Voice Navigation and Stock Analysis Architecture Plan

Date: 2026-02-27
Status: Planning only (no implementation in this document)

## 1) Objective

Add microphone-driven commands so users can:

1. Navigate by voice across existing app surfaces.
2. Trigger existing stock analysis flow by voice (for example: "Analyze Nvidia").
3. Optionally receive spoken confirmations (TTS).

Primary architecture target:

STT -> Intent Parsing -> Action Mapping -> Navigation or Feature Trigger

## 2) Current System Snapshot (what already exists)

Frontend command and navigation surfaces already implemented:

- Global command bar host: `hushh-webapp/app/providers.tsx` (mounts `KaiCommandBarGlobal`).
- Mic button placeholder: `hushh-webapp/components/kai/kai-search-bar.tsx` (currently toast only).
- Command palette action model: `hushh-webapp/components/kai/kai-command-palette.tsx`.
- Command execution (route push + analysis param setup): `hushh-webapp/components/kai/kai-command-bar-global.tsx`.
- Canonical route contract: `hushh-webapp/lib/navigation/routes.ts`.
- Kai top tabs route contract: `hushh-webapp/lib/navigation/kai-route-tabs.ts`.

Analysis flow already implemented:

- Intent state for analysis trigger: `hushh-webapp/lib/stores/kai-session-store.ts`.
- Analysis page consumes fresh intent and starts debate workspace: `hushh-webapp/app/kai/analysis/page.tsx`.
- Debate stream UI and run orchestration: `hushh-webapp/components/kai/debate-stream-view.tsx`.
- Resumable run manager (frontend): `hushh-webapp/lib/services/debate-run-manager.ts`.
- Backend analyze endpoints and run manager:
  - `consent-protocol/api/routes/kai/analyze.py`
  - `consent-protocol/api/routes/kai/stream.py`
  - `consent-protocol/api/routes/kai/run_manager.py`

Ticker/company resolution already available:

- Frontend cache + remote search: `hushh-webapp/lib/kai/ticker-universe-cache.ts`.
- Frontend proxy: `hushh-webapp/app/api/tickers/search/route.ts`.
- Backend ticker search: `consent-protocol/api/routes/tickers.py`.

Guard behavior already active and must remain intact:

- Vault guard: `hushh-webapp/components/vault/vault-lock-guard.tsx`.
- Kai onboarding guard: `hushh-webapp/components/kai/onboarding/kai-onboarding-guard.tsx`.
- Kai layout wraps with both guards: `hushh-webapp/app/kai/layout.tsx`.

## 3) Voice Navigation Coverage (recommended V1 scope)

These commands should map directly to existing routes/actions.

| Voice intent ID | Example utterances | Target action | Current route/action |
|---|---|---|---|
| `nav.kai_home` | "Take me to Kai", "Go home", "Open market" | Navigate to Kai home | `/kai` |
| `nav.dashboard` | "Open dashboard", "Go to Kai dashboard" | Navigate to dashboard | `/kai/dashboard` |
| `nav.analysis_history` | "Go to analysis", "Open analysis history" | Navigate to analysis/history view | `/kai/analysis?tab=history` |
| `nav.consents` | "Open consents", "Take me to permissions" | Navigate to consents | `/consents` |
| `nav.profile` | "Open profile", "Go to account" | Navigate to profile | `/profile` |
| `nav.import_portfolio` | "Import portfolio", "Connect holdings" | Navigate to import flow | `/kai/import` |
| `nav.onboarding` | "Open onboarding", "Kai setup" | Navigate to onboarding | `/kai/onboarding` |
| `nav.optimize` | "Open optimize" | Navigate to optimize page (feature may still be gated) | `/kai/optimize` |
| `nav.active_analysis` | "Show active analysis", "Resume current analysis" | Jump to analysis workspace focused on active run | `/kai/analysis?focus=active` |

Notes:

- `nav.optimize` should return a clear "coming soon" response if feature remains disabled in product policy.
- Guard redirects (vault lock/onboarding checks) will still apply automatically after navigation.

## 4) Stock Analysis Voice Actions (recommended V1 scope)

| Voice intent ID | Example utterances | Required data extraction | Existing trigger path |
|---|---|---|---|
| `analysis.start` | "Analyze Nvidia", "Analyze NVDA", "Run analysis for Apple" | `ticker` (resolve from symbol or company name) | `setAnalysisParams(...)` then route `/kai/analysis` |
| `analysis.reanalyze_current` | "Reanalyze this", "Run that analysis again" | active ticker from state/workspace | Same as start, reusing current ticker |
| `analysis.open_history` | "Open analysis history" | none | Route `/kai/analysis?tab=history` |
| `analysis.resume_active` | "Resume my running analysis" | none (find active run) | Route `/kai/analysis?focus=active` + existing resume |
| `analysis.cancel_active` | "Stop analysis", "Cancel current run" | active run id | `DebateRunManagerService.cancelRun(...)` |

Ticker resolution behavior for `analysis.start`:

1. Try direct symbol parse (`NVDA`).
2. If company name, query ticker search (`/api/tickers/search`).
3. If one high-confidence match, continue.
4. If ambiguous, ask user clarification ("Did you mean NVDA or NVDL?").

## 5) Proposed Voice Architecture

### 5.1 Runtime flow

1. Capture audio from mic (push-to-talk in V1).
2. Send audio to STT endpoint (OpenAI-backed).
3. Parse transcript into strict intent schema (rules first, LLM fallback).
4. Map intent to app action.
5. Execute action through a shared command executor.
6. Optional TTS confirmation ("Opening dashboard", "Analyzing NVDA now").

### 5.2 Intent contract (normalized JSON)

```json
{
  "intent": "navigate|analysis|unknown",
  "action": "nav.dashboard|analysis.start|analysis.cancel_active|...",
  "entities": {
    "ticker": "NVDA",
    "company": "Nvidia",
    "risk_profile": "balanced"
  },
  "confidence": 0.0,
  "requires_confirmation": false,
  "clarification_question": null
}
```

### 5.3 Parser strategy

- Layer 1: deterministic phrase matcher for known commands (fast, low cost).
- Layer 2: OpenAI intent parse only when Layer 1 fails or confidence is low.
- Layer 3: fallback to command palette open state plus typed query if unresolved.

This hybrid avoids over-reliance on LLM for obvious commands and keeps latency low.

## 6) Required Code Changes (file-level plan)

## Frontend changes

1. Update mic trigger in `hushh-webapp/components/kai/kai-search-bar.tsx`.
   - Replace placeholder toast with voice orchestrator start/stop.
2. Extract reusable command execution from `hushh-webapp/components/kai/kai-command-bar-global.tsx`.
   - Create shared executor so palette and voice use identical behavior.
3. Add voice orchestrator module (new file, recommended):
   - `hushh-webapp/lib/voice/voice-orchestrator.ts`
   - Handles audio capture, STT call, intent parse call, and dispatch.
4. Add voice intent/action schema and mapper (new files, recommended):
   - `hushh-webapp/lib/voice/intent-types.ts`
   - `hushh-webapp/lib/voice/intent-mapper.ts`
   - `hushh-webapp/lib/voice/phrase-rules.ts`
5. Add shared command executor (new file, recommended):
   - `hushh-webapp/lib/kai/command-executor.ts`
   - Inputs: command id + optional params + runtime context.
   - Should reuse existing guards: portfolio required, active run blocking, etc.
6. Add Next.js proxy routes for voice backend calls (new files, recommended):
   - `hushh-webapp/app/api/voice/stt/route.ts`
   - `hushh-webapp/app/api/voice/intent/route.ts`
   - `hushh-webapp/app/api/voice/tts/route.ts`
7. Optional UI state store (new file, recommended):
   - `hushh-webapp/lib/stores/voice-session-store.ts`
   - Track listening, transcript draft, error, confidence.

## Backend changes

1. Add voice route module:
   - `consent-protocol/api/routes/voice.py`
   - Endpoints:
     - `POST /api/voice/stt`
     - `POST /api/voice/intent`
     - `POST /api/voice/tts`
2. Register router in `consent-protocol/server.py`.
3. Add OpenAI voice service abstraction (new file, recommended):
   - `consent-protocol/hushh_mcp/services/openai_voice_service.py`
4. Add environment variables in `consent-protocol/.env.example`:
   - `OPENAI_API_KEY`
   - `OPENAI_STT_MODEL`
   - `OPENAI_INTENT_MODEL`
   - `OPENAI_TTS_MODEL`
5. Add request/response schemas with strict validation in `voice.py`.

## 7) Action Mapping Design

Single source of truth should be a registry, not duplicated `if` trees.

Recommended action registry shape:

```ts
type VoiceActionDefinition = {
  id: string;
  aliases: string[];
  execute: (ctx: ActionContext, entities?: Record<string, unknown>) => Promise<void>;
  requiresPortfolio?: boolean;
  requiresActiveRun?: boolean;
  requiresConfirmation?: boolean;
};
```

Benefits:

- Voice and command palette can share one executor.
- Easy to add future commands without editing many files.
- Centralized guard logic and telemetry.

## 8) Additional Voice Features to Add After V1

1. Context-aware commands:
   - "Analyze this again" uses current ticker in workspace.
2. Clarification dialog:
   - Ambiguous company name prompts top 2-3 ticker choices.
3. Voice confirmations and errors via TTS:
   - "I found no active analysis run."
4. Conversation memory for short follow-ups:
   - "Now analyze AMD" right after NVDA analysis.
5. Multilingual command aliases:
   - Keep action IDs same, expand phrase dictionaries.
6. Safety gates for destructive actions:
   - Require confirmation for "cancel run" or "log out".
7. Analytics:
   - Track recognition confidence, fallback rates, and failed intents.

## 9) Rollout Plan

1. Phase 1: Navigation only (`nav.*` actions).
2. Phase 2: `analysis.start` with ticker/company resolution.
3. Phase 3: Analysis controls (`resume`, `cancel`, `reanalyze`) + TTS acknowledgments.
4. Phase 4: Advanced context memory and multilingual alias expansion.

## 10) Key Risks and Controls

- Risk: LLM misclassification of commands.
  - Control: deterministic parser first, confidence threshold, and clarification prompts.
- Risk: executing blocked action (no portfolio, active run conflict).
  - Control: reuse existing command executor guard checks.
- Risk: key exposure.
  - Control: OpenAI key only on backend; frontend uses proxy endpoints only.
- Risk: inconsistent behavior between command palette and voice.
  - Control: one shared action execution module.

## 11) Acceptance Criteria for V1

1. "Take me to Kai dashboard" navigates to `/kai/dashboard`.
2. "Go to analysis" navigates to `/kai/analysis?tab=history`.
3. "Open profile" navigates to `/profile`.
4. "Analyze Nvidia" resolves `NVDA`, navigates to analysis page, and starts existing run flow.
5. Ambiguous or unknown stock names produce a clarification response, not a wrong action.
6. No bypass of vault/onboarding guards.

