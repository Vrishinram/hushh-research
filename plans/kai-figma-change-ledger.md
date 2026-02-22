# Kai Figma Change Ledger (Real-Data Only)

## Scope
- User context: `xm5IGgJtgGa1I6JlXRYWj5gliFz2`
- Session rule: no dummy/mock UI values; all cards are real payload or explicit empty-state.
- Last updated (UTC): 2026-02-22T03:07:00Z

## UI -> Source Mapping

| UI Surface | UI File | Source Endpoint / Domain | Data Fields Used | Fallback Behavior |
| --- | --- | --- | --- | --- |
| `/kai` Spotlight | `hushh-webapp/components/kai/views/kai-market-preview-view.tsx` | `GET /api/kai/market/insights/{user_id}` | `spotlights[]` | Hide section when list empty; no synthetic cards |
| `/kai` Market Overview | `hushh-webapp/components/kai/views/kai-market-preview-view.tsx` | `GET /api/kai/market/insights/{user_id}` | `market_overview[]` | Render neutral empty-state card; no default metrics |
| `/kai` Scenario Insight | `hushh-webapp/components/kai/views/kai-market-preview-view.tsx` | `GET /api/kai/market/insights/{user_id}` | `signals[]` | Show nothing when absent |
| `/kai` Themes | `hushh-webapp/components/kai/views/kai-market-preview-view.tsx` | `GET /api/kai/market/insights/{user_id}` | `themes[]` | Render neutral empty-state card; no defaults |
| `/kai` News Tape | `hushh-webapp/components/kai/home/news-tape.tsx` | `GET /api/kai/market/insights/{user_id}` | `news_tape[]` | Empty list UI only |
| `/kai` Connect Portfolio CTA | `hushh-webapp/components/kai/views/kai-market-preview-view.tsx` | decrypted `financial` domain in cache | `financial.holdings` count | CTA shown only when no linked holdings |
| Dashboard Hero + Holdings | `hushh-webapp/components/kai/views/dashboard-master-view.tsx` | decrypted `financial` domain | account summary + holdings rows | Empty holding state card |
| Dashboard Profile Picks | `hushh-webapp/components/kai/cards/profile-based-picks-list.tsx` | `GET /api/kai/dashboard/profile-picks/{user_id}` | `picks[]`, `risk_profile`, `context` | Skeleton while loading; empty text when no picks |
| Analysis Summary KPI bars | `hushh-webapp/components/kai/views/analysis-summary-view.tsx` | terminal `decision` payload from `/api/kai/analyze/stream` | `company_strength_score`, `market_trend_*`, `fair_value_*`, `analysis_updated_at` | `N/A` score labels if field missing |
| Analysis Detailed Debate | `hushh-webapp/components/kai/views/history-detail-view.tsx` | `kai_analysis_history` decrypted records | `raw_card`, per-agent blocks | History empty state when debate not found |

## Route Contract Ledger

| Contract | Status | Notes |
| --- | --- | --- |
| `/kai/dashboard?tab=overview|holdings` | Active | Manage functionality merged into holdings tab |
| `/kai/dashboard/manage` | Compatibility redirect | Redirects to `/kai/dashboard?tab=holdings` |
| `/kai/dashboard/analysis?tab=history|summary|debate&debate_id=<stream_id>` | Active | `debate_id` resolves via `raw_card.stream_diagnostics.stream_id` |
| Unknown UI routes -> `/` | Active | Implemented in `hushh-webapp/app/not-found.tsx` |

## Backend Additive Contract Ledger

| Endpoint | Additive Fields / Behavior |
| --- | --- |
| `GET /api/kai/analyze/stream` terminal `decision` | `company_strength_score`, `market_trend_label`, `market_trend_score`, `fair_value_label`, `fair_value_score`, `fair_value_gap_pct`, `analysis_updated_at` |
| `GET /api/kai/dashboard/profile-picks/{user_id}` | risk-aware picks blended from `kai_profile` + provided holdings symbols + Renaissance + live quote context |

## Validation Ledger

| Check | Result |
| --- | --- |
| `hushh-webapp`: `npm run typecheck` | pass |
| `hushh-webapp`: `npm run verify:cache` | pass |
| `hushh-webapp`: `npm run verify:design-system` | pass (warnings only) |
| `hushh-webapp`: `npm run verify:routes` | pass |
| `consent-protocol`: `ruff check api/routes/kai/stream.py api/routes/kai/portfolio.py api/routes/kai/__init__.py` | pass |
