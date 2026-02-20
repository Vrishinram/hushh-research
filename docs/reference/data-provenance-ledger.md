# Data Provenance Ledger

Mapping of user-visible KPI surfaces to source systems and freshness rules.

| KPI / Surface | Source | Freshness / TTL | Fallback Policy |
| --- | --- | --- | --- |
| Holdings table | Parsed brokerage statement (`portfolio/import/stream`) | Statement-time snapshot | Hard validation; invalid rows dropped |
| Total portfolio value | `portfolio_data.total_value` (derived from validated holdings when missing) | Statement-time snapshot | Never synthesize from mock |
| Allocation strips/charts | `portfolio_data.asset_allocation` + validated holdings | Statement-time snapshot | Show explicit empty state |
| Holding confidence | Parser normalization (`confidence`) | Generated per import | If missing, treat as low confidence |
| Statement metadata | `account_info.brokerage_name`, statement period | Statement-time snapshot | Display unknown source label |
| Realtime quote | `fetch_market_data` | ~60s target (`ttl_seconds`) | Fail closed (`REALTIME_DATA_UNAVAILABLE`) |
| Sentiment/news context | `fetch_market_news` | provider-dependent (~minutes-hours) | Fail closed for decision-critical routes |
| SEC fundamentals | `fetch_sec_filings` / offline SEC features | Filing cadence (10-K/10-Q) | Continue only with explicit missing-data annotation |
| Renaissance tier/avoid context | Supabase `renaissance` dataset | managed update process | Fail closed for optimize decision if unavailable |

## Notes
- Offline benchmark scripts do not affect runtime UX latency.
- Runtime UIs should expose provenance chips and confidence where practical.
- Missing critical realtime data must terminate recommendation paths safely.
