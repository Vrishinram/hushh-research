# Kai Figma End-to-End Execution Plan (Real-User Bound, No Mock Data)

## Summary
This plan is now locked to your mandates:
1. Figma parity is required across available screens (`kai.html`, `dashboard.html`, `debate_analysis.html`).
2. Any unsupported Figma value must be made doable via real backend/UI contract changes (not mocked).
3. Implementation and validation must be grounded on your real user context:
- `user_id`: `xm5IGgJtgGa1I6JlXRYWj5gliFz2`
- passphrase-based unlock context
- brokerage statement corpus at `data/brokerage_statements/` (including `Brokerage_March2021.pdf`).
4. `/kai/dashboard/manage` is removed and fused into dashboard.
5. Analysis remains on `/kai/dashboard/analysis` with tabbed routing and deep links using query param `debate_id`.
6. Unknown UI routes redirect to `/` (API routes keep proper HTTP semantics).

## Mandatory Non-Negotiables
1. No dummy values anywhere in Kai market, dashboard, or analysis surfaces.
2. All KPI values must be real-source or deterministic from real-source with explicit provenance.
3. Unsupported Figma fields are implemented via additive backend contracts where needed.
4. If any field is still impossible after contract uplift, block the UI section and report exact blocker with source gap.
5. Design system remains centralized (Morphy props-first usage; no ad-hoc visual drift).

## Current Real-Data Baseline (Already Verified)
1. User world model decrypted successfully and contains domains:
- `financial`, `financial_documents`, `kai_analysis_history`, `kai_profile`.
2. `financial.holdings` count is 20 and includes tradable + cash entries.
3. `kai_analysis_history` contains persisted debate entries with `raw_card.stream_diagnostics.stream_id`, suitable for `debate_id`.
4. Market cache exists in `kai_market_cache_entries` for this user and includes:
- `hero`, `watchlist`, `movers`, `sector_rotation`, `news_tape`, `signals`, plus backward-compatible `spotlights`, `market_overview`, `themes`.

## Milestone 0: Freeze Plan + Evidence Artifacts in `plans/`
1. Write a frozen execution plan file:
- `plans/kai-figma-e2e-execution-plan.md`
2. Write decrypted world model dump artifacts for the specified user:
- `plans/kai-figma-world-model-xm5IGgJtgGa1I6JlXRYWj5gliFz2.json`
- `plans/kai-figma-world-model-xm5IGgJtgGa1I6JlXRYWj5gliFz2.md`
3. Write market cache evidence dump:
- `plans/kai-market-cache-home-xm5IGgJtgGa1I6JlXRYWj5gliFz2.json`
4. Include provenance section in each artifact:
- extraction time (UTC), source tables/endpoints, decryption method used, and redaction policy.
5. Keep these artifacts as temporary working truth until end-to-end completion.

## Milestone 1: Backend Contract Uplift for Figma-Specific Missing Values
1. Add additive, real-data decision summary fields to analyze terminal payload (`/api/kai/analyze/stream`):
- `company_strength_score` (0-10)
- `market_trend_label`, `market_trend_score`
- `fair_value_label`, `fair_value_score`, `fair_value_gap_pct`
- `analysis_updated_at`
2. Derive above fields deterministically from existing decision data (`confidence`, sentiment metrics, valuation/price targets, tracked price inputs).
3. Add dashboard profile-picks real-data endpoint (or equivalent service contract) to support Figma “Based on your profile” ticker cards:
- source from `financial` holdings + `kai_profile` + Renaissance datasets + live quote context.
- no synthetic/mock ticker suggestions.
4. Keep all changes additive and documented in:
- `docs/reference/api-contracts.md`
- `docs/reference/streaming-contract.md`
- `docs/reference/kai-interconnection-map.md`

## Milestone 2: `/kai` Home Figma Parity (Cache-Backed)
1. Recompose `/kai` to Figma section order using real payloads:
- spotlight, market overview, scenario insight, themes, news.
2. Keep `Open Dashboard` as primary top action.
3. Remove oversized top holdings/overview treatment from current `/kai` home surface.
4. `Connect Portfolio` block logic:
- show only when portfolio is not linked/unavailable.
- hide for users with linked `financial` domain.
5. Increase outer padding and soften card shadow edge for watchlist/news areas.
6. Preserve neutral white/black root background behavior (no strong gradient cast).

## Milestone 3: `/kai/dashboard` + Manage Fusion (Route-Based)
1. Merge full manage functionality into dashboard:
- holdings list, CRUD, pagination, save flow.
2. Introduce dashboard tab state via query:
- `?tab=overview` and `?tab=holdings`.
3. Remove manage route as functional surface; keep compatibility redirect:
- `/kai/dashboard/manage` -> `/kai/dashboard?tab=holdings`.
4. Map dashboard layout to Figma visual intent with real data blocks:
- hero value/risk/holdings, allocation strip/chart, holdings cards, profile-based picks.
5. Profile-based picks behavior:
- show skeleton while real picks resolve.
- never show placeholder/mock cards.

## Milestone 4: `/kai/dashboard/analysis` Routing + Short/Detailed Views
1. Keep single analysis route with tabs:
- `?tab=history|summary|debate`
2. Deep-link contract:
- `?debate_id=<id>` using stored stream identifier.
3. Use `debate_analysis.html` as the canonical short-format summary style.
4. Keep detailed debate form in dedicated tab with existing rich detail structure.
5. Hide internal/developer-oriented sections from end-user views:
- world-model protocol trace blocks, alpha protocol internals, fallback diagnostics wording, and similar technical artifacts.
6. Rewrite user-visible fallback/status copy into non-technical language.

## Milestone 5: Invalid URL Behavior
1. Apply UI-only fallback policy:
- unknown app routes redirect to `/`.
2. Keep API routes as normal HTTP errors (no redirecting API paths).
3. Implement via app-router not-found handling and verify no loop/regression in auth landing flow.

## Design System Centralization Rules (Implementation Guardrails)
1. Card usage standardized by intent:
- glass surfaces: `Card variant="none" effect="glass"`
- solid/neutral blocks: `Card variant="muted" effect="fill"`
- no ad-hoc transparent card hacks.
2. CTA usage standardized:
- primary actions: Morphy `Button` with design-system-approved variants.
3. Create Kai color token mapping from Figma palette and bind through centralized tokens, not per-component hardcoded hex.
4. Use shadcn/Recharts primitives for applicable quantitative visuals (allocation, trend, score/history charts), with real data only.

## Public API / Interface / Route Changes
1. Analyze stream terminal payload gains additive summary KPI fields (decision metadata extension).
2. New profile-picks contract for dashboard (backend + typed frontend service).
3. Analysis route query contract:
- `tab` and `debate_id`.
4. Dashboard route query contract:
- `tab=overview|holdings`.
5. Legacy manage route becomes redirect-only compatibility path.

## Test Cases and Scenarios
1. Real-user data validation:
- unlock context, decrypt blob, verify holdings and analysis history consistency.
2. `/kai` parity tests:
- spotlight/overview/themes/news render real cache values only.
3. Dashboard fusion tests:
- CRUD/pagination/save flows work from dashboard tab without `/manage`.
4. Analysis deep-link tests:
- direct open by `debate_id` lands correct analysis tab/content.
5. Internal-data suppression tests:
- no world-model/protocol/debug sections visible in user-facing analysis UI.
6. URL fallback tests:
- unknown UI path redirects to `/`; unknown API path remains HTTP error.

## Documentation and Runtime Audit Requirements
1. Keep contracts/docs updated with every additive field/route behavior change.
2. Run existing runtime parity/audit checks after each milestone.
3. Keep a change ledger in `plans/` tying UI elements to source endpoints/fields and fallback behavior.

## Assumptions and Defaults
1. `analysis.html` is not present on disk; `debate_analysis.html` is the short-format source for this cycle.
2. Detailed debate view remains in current route/tab structure and is refined, not replaced.
3. UI-only invalid URL redirect policy is authoritative.
4. Plan artifact and decrypted dump file creation is part of Milestone 0 execution deliverables.

## Provenance
- Frozen at: 2026-02-22T02:21:54Z (UTC)
- Source references used for baseline checks:
  - `world_model_index_v2`
  - `world_model_data`
  - `kai_market_cache_entries`
- Decryption method target: passphrase wrapper unlock (PBKDF2-SHA256 + AES-256-GCM) and AES-256-GCM blob decrypt
- Redaction policy: do not store passphrase or secret credentials in plan artifacts
