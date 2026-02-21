# Kai Retro Change Map (2026-02-21)

Retroactive mapping for the current integrated Kai branch.

## Scope

This map captures runtime, contract, cache, world-model, and UI changes introduced in the current branch and identifies compatibility/rollback considerations.

## Change Inventory by Subsystem

### Backend: Kai Routes + Services

- `consent-protocol/api/routes/kai/market_insights.py` (new)
- `consent-protocol/hushh_mcp/services/market_insights_cache.py` (new)
- `consent-protocol/api/routes/kai/portfolio.py`
- `consent-protocol/api/routes/kai/stream.py`
- `consent-protocol/hushh_mcp/agents/kai/debate_engine.py`
- `consent-protocol/hushh_mcp/operons/kai/llm.py`
- `consent-protocol/hushh_mcp/operons/kai/fetchers.py`
- `consent-protocol/api/routes/world_model.py`
- `consent-protocol/hushh_mcp/services/world_model_service.py`
- `consent-protocol/hushh_mcp/services/domain_registry_service.py`

### Backend: Symbol/Ticker Data Plane

- `consent-protocol/hushh_mcp/services/symbol_master_service.py` (new)
- `consent-protocol/hushh_mcp/services/ticker_db.py`
- `consent-protocol/hushh_mcp/services/ticker_cache.py`
- `consent-protocol/db/migrate.py`
- `consent-protocol/scripts/import_tickers.py`
- `consent-protocol/scripts/enrich_ticker_metadata.py` (new)

### Frontend: Kai UI + Contracts

- `hushh-webapp/components/kai/views/kai-market-preview-view.tsx`
- `hushh-webapp/components/kai/home/*` (new home modules)
- `hushh-webapp/components/kai/kai-flow.tsx`
- `hushh-webapp/components/kai/debate-stream-view.tsx`
- `hushh-webapp/components/kai/views/decision-card.tsx`
- `hushh-webapp/components/kai/views/dashboard-master-view.tsx`
- `hushh-webapp/components/kai/views/dashboard-data-mapper.ts`
- `hushh-webapp/lib/services/api-service.ts`
- `hushh-webapp/lib/services/kai-token-guard.ts` (new)
- `hushh-webapp/lib/navigation/kai-bottom-chrome-visibility.ts` (new)
- `hushh-webapp/lib/cache/cache-sync-service.ts`
- `hushh-webapp/lib/services/cache-service.ts`
- `hushh-webapp/lib/utils/portfolio-normalize.ts`

### Tooling / Ops / Guardrails

- `scripts/ops/audit-world-model-user.mjs`
- `scripts/ops/reconcile_financial_domain.py`
- `scripts/ops/kai-system-audit.py`
- `scripts/verify-doc-runtime-parity.cjs`
- `scripts/verify-pre-launch.sh`

### Docs

- `docs/reference/*` additions/updates
- `consent-protocol/docs/reference/world-model.md`
- `docs/audits/*` updates

## Contract Deltas

### API Payload Additions

- `GET /api/kai/market/insights/{user_id}`:
  - `layout_version`, `hero`, `watchlist`, `movers`, `sector_rotation`, `news_tape`, `signals`
  - `meta.symbol_quality`, `meta.filtered_symbols`, provider status metadata
- `GET /api/tickers/search`, `GET /api/tickers/all`:
  - `sic_code`, `sic_description`, `sector_primary`, `industry_primary`, `sector_tags`, `metadata_confidence`, `tradable`
- `GET/POST /api/kai/analyze/stream` terminal decision payload:
  - `short_recommendation`, `analysis_degraded`, `degraded_agents`
  - stream diagnostics: `stream_id`, `llm_calls_count`, `provider_calls_count`, `retry_counts`, `analysis_mode`

### Type / Interface Additions

- Web decision/result types extended for degraded metadata and diagnostics.
- Ticker universe row types extended with enrichment fields.
- Kai home market typings expanded for v2 payload sections.

### Cache Key / Policy Deltas

- Added/enforced world-model blob keys and domain blob keys in memory cache surface.
- Market home uses 3-minute fresh cache behavior plus stale fallback metadata.
- Provider cooldown state introduced to avoid hammering known failing endpoints.

### Route Behavior Deltas

- `/kai` surface transitioned to live market-home contract with cache-first refresh behavior.
- Onboarding/import/debate flows now rely on centralized chrome/token/cache guard paths.
- Debate stream guarantees terminal decision under degraded conditions.

## Migration and Data-Shape Implications

### Ticker Enrichment Columns (`db/migrate.py`)

Added additive columns:
- `sic_code`, `sic_description`
- `sector_primary`, `industry_primary`
- `sector_tags`
- `metadata_confidence`
- `tradable`, `last_enriched_at`

### Compatibility for Pre-Migration DBs

- `ticker_db.py` and `ticker_cache.py` include runtime fallbacks when enriched columns are unavailable.
- Search/all endpoints continue to return baseline rows even before migration.

## Rollback Notes by Change Cluster

- **Market insights v2**: keep additive fields; if UI issue appears, retain endpoint and fallback to compatibility blocks.
- **Debate diagnostics/degraded metadata**: do not remove backend fields; disable UI rendering selectively if needed.
- **World-model summary normalization**: never rollback sanitization; add read compatibility instead.
- **Ticker enrichment**: if migration lag exists, rely on legacy fallback path and postpone strict metadata usage.
- **Scroll/chrome behavior**: rollback can be isolated to visibility helper while keeping route/token/cache fixes.

## Verification Snapshot (Current Branch)

Key gates already exercised in this branch include:
- route/parity/cache/docs verification scripts
- world-model audit and reconciliation scripts
- Kai system runtime audit

Release must still pass strict pre-launch gate with clean tree.
