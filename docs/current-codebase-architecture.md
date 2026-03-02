# Current Codebase Architecture (Decision-Ready)

Date: 2026-02-27  
Scope: Current implementation only (no proposed changes in this document)

## 1) System Overview

This repository is a monorepo with two primary runtime systems:

1. `hushh-webapp` (Next.js 16 + React 19 + Capacitor bridge)
2. `consent-protocol` (FastAPI backend + Hushh MCP agent/services stack)

High-level runtime topology:

```text
UI Components
  -> Frontend Service Layer (ApiService, WorldModelService, Kai services)
  -> Next.js API proxy routes (/app/api/*) on web
  -> FastAPI routes (/api/*) in consent-protocol
  -> Service layer (hushh_mcp/services + operons)
  -> DB layer (db/db_client.py + Supabase/Postgres)
  -> External providers (Gemini, market/news data providers)
```

For native platforms, many calls bypass Next API routes via Capacitor plugins.

## 2) Frontend Architecture (`hushh-webapp`)

## 2.1 App Shell and Composition

Root composition:

- `app/layout.tsx` -> `app/layout-client.tsx` -> `app/providers.tsx`
- `Providers` mounts global cross-cutting layers:
  - auth (`AuthProvider`)
  - vault (`VaultProvider`)
  - cache (`CacheProvider`)
  - navigation/back handling (`NavigationProvider`)
  - consent notifications
  - progress system (`StepProgressProvider`)
  - global nav (`Navbar`)
  - global command bar (`KaiCommandBarGlobal`)

Key implication: command/navigation primitives are globally available and not page-local.

## 2.2 Routing and Navigation Flow

Canonical route contract is centralized in:

- `lib/navigation/routes.ts`

Primary app routes:

- `/` marketing onboarding
- `/login`
- `/kai/onboarding`
- `/kai/import`
- `/kai`
- `/kai/dashboard`
- `/kai/analysis`
- `/kai/optimize`
- `/consents`
- `/profile`

Kai route shell:

- `app/kai/layout.tsx` wraps all `/kai/*` pages in:
  - `VaultLockGuard`
  - `KaiOnboardingGuard`

Global route guards:

- `proxy.ts` intentionally does not enforce server-side Firebase auth.
- Authentication/vault enforcement is client-side via guards and context state.

Navigation surfaces:

- Bottom nav (`components/navbar.tsx`): Kai, Consents, Profile.
- Kai route tabs (`components/kai/layout/dashboard-route-tabs.tsx`): Market, Dashboard, Analysis.
- Global command bar + palette (`KaiCommandBarGlobal`, `KaiSearchBar`, `KaiCommandPalette`).

## 2.3 State Management Model

State strategy is mixed but disciplined:

1. React Context for global security/runtime state:
   - Auth: `lib/firebase/auth-context.tsx`
   - Vault: `lib/vault/vault-context.tsx`
   - Navigation: `lib/navigation/navigation-context.tsx`
   - Cache: `lib/cache/cache-context.tsx`
2. Single Zustand store for Kai session:
   - `lib/stores/kai-session-store.ts`
   - Holds `analysisParams`, `losersInput`, `busyOperations`, `lastKaiPath`.
3. In-memory cache singleton:
   - `lib/services/cache-service.ts`
   - TTL + invalidation events + user-scope invalidation.

Security-relevant state property:

- Vault key and `VAULT_OWNER` token are memory-only in `VaultContext` (not localStorage/sessionStorage).

## 2.4 Screen / Service / Controller Structure

Practical frontend layering pattern:

1. Screens/pages: `app/**/page.tsx`
2. Orchestrator components (controller-like):
   - `components/kai/kai-flow.tsx` (import/dashboard flow controller)
   - `components/kai/kai-command-bar-global.tsx` (global command execution controller)
3. View components:
   - `components/kai/views/*`
4. Service layer:
   - `lib/services/*` (API, world model, profile, run manager, cache, auth, vault)
5. Backend interface:
   - `app/api/*` proxies + `ApiService`

This pattern is consistent enough to be extendable, but there are overlapping controllers in Kai flows (see constraints section).

## 2.5 API Integration Pattern (Web vs Native)

Core transport abstraction:

- `lib/services/api-service.ts`

Behavior:

- Web: relative calls to Next API routes (`/api/...`).
- Native: direct backend base URL + Capacitor HTTP/plugin flows.

Proxy structure:

- Catch-all Kai proxy: `app/api/kai/[...path]/route.ts`
- Domain-specific proxies for consent, world-model, tickers, vault, notifications.
- Backend URL resolution: `app/api/_utils/backend.ts`.

Result: components mostly avoid direct `fetch`, relying on services.

## 3) Backend Architecture (`consent-protocol`)

## 3.1 FastAPI Entry and Router Aggregation

Entry point:

- `consent-protocol/server.py`

It mounts:

- core routes (`consent`, `world_model`, `session`, `notifications`, etc.)
- Kai router package (`api/routes/kai/__init__.py`)
- tickers, investors, account, sync, etc.

## 3.2 Route Layer (Controller Layer)

Route modules act as controllers, with heavy logic pushed into services/operons.

Important route groups:

- Consent: `api/routes/consent.py`
- World model: `api/routes/world_model.py`
- Kai package:
  - `chat.py`
  - `portfolio.py` (import + stream)
  - `analyze.py` (non-stream)
  - `stream.py` (SSE + resumable runs)
  - `losers.py` (optimize/losers analysis)
  - `market_insights.py`
  - `decisions.py`, `consent.py`, etc.

## 3.3 Auth and Consent Enforcement

Security dependencies:

- `api/middleware.py`
  - `require_firebase_auth`
  - `require_vault_owner_token`

Consent token mechanics:

- `hushh_mcp/consent/token.py`
  - issue, validate, revoke, DB-aware validation path.

Most sensitive Kai and world-model endpoints enforce `VAULT_OWNER` token checks with user_id matching.

## 3.4 Service and Data Layer

Service layer examples:

- `hushh_mcp/services/world_model_service.py`
- `hushh_mcp/services/consent_db.py`
- `hushh_mcp/services/kai_chat_service.py`
- `hushh_mcp/services/ticker_cache.py`

DB access layer:

- `db/db_client.py` (SQLAlchemy-based query abstraction, fail-fast DB execution).

Compatibility shim:

- `consent_db.py` re-exports DB helpers for older call sites.

## 3.5 Agent / LLM Stack Already Implemented

LLM/agent stack is Gemini-centric today.

Core modules:

- Agent implementations:
  - `hushh_mcp/agents/kai/*`
  - `hushh_mcp/agents/orchestrator/*`
  - `hushh_mcp/agents/portfolio_import/*`
- Kai operons:
  - `hushh_mcp/operons/kai/llm.py`
  - `analysis.py`, `fetchers.py`, `calculators.py`, `storage.py`

Key behavior:

- Multi-agent stock analysis (fundamental + sentiment + valuation + debate synthesis).
- SSE streaming analysis events.
- Resumable/cancelable run manager for analysis sessions.
- Chat service with Gemini + intent classification + attribute learning hooks.

Important note:

- Current codebase has no OpenAI runtime integration for STT/TTS/LLM in existing production paths; LLM execution is currently Gemini-driven.

## 4) End-to-End Flow: Stock Analysis (Current)

Current analysis trigger path:

1. Command bar command selection in `KaiCommandPalette`.
2. Execution in `KaiCommandBarGlobal`:
   - validates portfolio availability
   - blocks when active run exists
   - sets `useKaiSession().setAnalysisParams({ ticker, userId, riskProfile })`
   - navigates to `/kai/analysis`
3. `app/kai/analysis/page.tsx` consumes fresh intent and orchestrates workspace.
4. `DebateStreamView` delegates run lifecycle to `DebateRunManagerService`.
5. `DebateRunManagerService` calls API service methods:
   - start run
   - stream events
   - resume active run
   - cancel run
6. Frontend API calls `api-service.ts` -> `/api/kai/*` proxy -> backend `api/routes/kai/stream.py`.
7. Backend `KaiAnalyzeRunManager` (`run_manager.py`) manages session lock and buffered SSE replay.

## 5) What Is Already Implemented

## 5.1 Fully Implemented (Production-grade core)

- Consent-first security model with `VAULT_OWNER` token validation.
- Memory-only vault key/token handling in frontend vault context.
- Multi-route Kai app shell with onboarding and vault guards.
- Portfolio import pipeline with streaming progress and review.
- Stock analysis streaming pipeline with resumable run management.
- Analysis history persistence and replay plumbing.
- Ticker universe cache + local/remote search support.
- Market home insights endpoints and frontend rendering pipeline.
- Extensive test suites in both frontend and backend directories.

## 5.2 Implemented but Legacy/Compatibility Paths Present

- Legacy ADK agent endpoints and route shims still exist (`api/routes/agents.py`).
- Identity routes intentionally retained but disabled (410) (`api/routes/identity.py`).
- Some legacy redirects retained under old Kai dashboard subroutes.

## 6) What Is Partially Implemented

- Voice UI entry point exists but is placeholder only:
  - mic button in `components/kai/kai-search-bar.tsx` -> "Coming soon Hushh Voice Feature".
- Optimize command in command palette/global handler is exposed as "coming soon", while `/kai/optimize` page exists.
- Route contract includes `/privacy` and `/docs`, but app route tree currently has `/api-docs` page and no full `/privacy` or `/docs` page implementations.
- `losersInput` plumbing exists in `kai-session-store`, but active setter usage is not currently wired from main UI paths.

## 7) Reusable Assets for Voice Integration

The following are immediately reusable for voice command execution:

1. Command action taxonomy and UX contract:
   - `KaiCommandPalette` action model and grouping.
2. Existing command execution logic:
   - `KaiCommandBarGlobal` route + guard + analysis intent setup.
3. Analysis trigger mechanism:
   - `useKaiSession.setAnalysisParams(...)` + `/kai/analysis` intent consumption.
4. Resumable run infrastructure:
   - `DebateRunManagerService` + backend run manager endpoints.
5. Ticker resolution primitives:
   - `ticker-universe-cache.ts` + `/api/tickers/search`.
6. Existing toast/error surface and busy-operation flags:
   - `busyOperations` in `kai-session-store`.
7. Existing proxy/security boundary:
   - frontend never requires exposing provider API keys; backend routes can hold provider keys.

## 8) Constraints and Limitations (Architectural)

## 8.1 Security and Auth Constraints

- No reliable server-side Firebase session enforcement in Next proxy (`proxy.ts`), by design.
- Access control depends on client context + backend token checks.
- Vault key/token are memory-only; full page reload resets unlock state and can force re-unlock.

## 8.2 Flow/State Constraints

- Analysis intent freshness window in `/kai/analysis` is short-lived (15s), requiring immediate navigation coupling.
- Run manager is session-scoped and allows one active run per `(user, debate_session_id)`.
- Mixed orchestration surfaces exist (`KaiFlow` plus dedicated `/kai/analysis` flow), increasing coordination complexity.

## 8.3 Feature Completeness Constraints

- Voice stack is not implemented (no STT/TTS/intent pipeline in code).
- Command-level optimize is intentionally blocked despite existing optimize page, creating UX-policy mismatch risk.
- Legacy routes/shims and redirects increase surface area for command mapping edge cases.

## 8.4 Platform Constraints

- Web and native execution paths differ (Next proxy vs direct native HTTP/plugins), so any new voice transport must account for both.
- Backend LLM path is Gemini-first today; OpenAI integration would be a new provider path.

## 9) Architectural Readiness for Voice Decision

Overall readiness is good for voice command integration because:

- navigation and action execution primitives already exist,
- stock-analysis trigger pipeline is already event-driven and state-based,
- ticker lookup and analysis run-control APIs are mature.

Main architectural caution areas for the deciding agent:

1. unify command execution in one shared module before adding voice dispatch,
2. keep security boundary strict (provider keys backend-only),
3. avoid adding parallel state paths; reuse existing session/run manager patterns,
4. explicitly define behavior for partially implemented surfaces (optimize/docs/privacy).

