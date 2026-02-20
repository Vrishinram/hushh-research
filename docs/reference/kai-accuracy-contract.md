# Kai Accuracy Contract (v6.0)

This document defines production behavior for Kai analysis/import surfaces.

## Non-Negotiables
- Real data only for portfolio decisions and recommendations.
- No mock fallback on decision-critical paths.
- Fail closed when required realtime dependencies are missing.
- Every dashboard KPI must map to explicit provenance.

## Realtime Provider Matrix
- Quotes/market snapshot: `Finnhub` -> `PMP/FMP` -> `yfinance` -> Yahoo quote fallback.
- News sentiment: `Finnhub` -> `PMP/FMP` -> NewsAPI -> Google News RSS.
- SEC fundamentals: SEC EDGAR `companyfacts` and filings.
- Renaissance policy context: Supabase `renaissance_*` tables.

## Fail-Closed Policy
- Analyze/optimize routes return `REALTIME_DATA_UNAVAILABLE` when required sources fail.
- No speculative recommendation should be emitted after this code path.
- Client should render actionable retry messaging and avoid confidence claims.

## Portfolio Parser Quality Gates
- `placeholder_symbol_count == 0`
- `account_header_row_count == 0`
- `zero_qty_zero_price_nonzero_value_count == 0`
- `aggregated_holdings_count > 0` for benchmark corpus docs
- No retained row with empty `symbol` and unknown `name`

## Stream Contract Signals
`/api/kai/portfolio/import/stream` includes:
- `holdings_raw_count`
- `holdings_validated_count`
- `holdings_aggregated_count`
- `holdings_dropped_reasons`
- per-holding `confidence` and `provenance`

## Dashboard Rendering Contract
- Render only validated holdings from `portfolio_data.holdings`.
- Surface parser confidence and statement provenance in UI.
- Never display static/mock financial claims in production mode.

## Benchmark and Compliance Commands
```bash
# Portfolio parser corpus benchmark (offline QA)
python consent-protocol/scripts/eval_portfolio_stream_quality.py

# SEC payload extraction and normalization (offline)
python scripts/dump_sec_payloads.py
python scripts/extract_sec_features.py

# ADK + Google A2A static compliance checks
python consent-protocol/scripts/verify_adk_a2a_compliance.py
```
