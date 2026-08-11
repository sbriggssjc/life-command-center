# Government Market Turnover Worklog

## 2026-08-11 — Pre-2012 On-Market Artifact Fix

Objective: fix gov Capital Markets `market_turnover` so pre-2012 on-market artifacts are handled at the source, not only masked in the export.

Context read:
- `CLAUDE.md` confirms gov Supabase view changes are live immediately and `on_market_date` is the canonical market-entry date.
- Supabase changelog checked for current breaking changes; none affect ordinary Postgres view/migration work here.
- Existing source view `cm_gov_market_turnover_m` already uses `available_listings.on_market_date`.

Live verification before patch:
- `cm_gov_market_turnover_m` had 84 pre-2012 rows.
- 80 pre-2012 rows had non-null `active_count` and `months_of_supply`.
- 84 pre-2012 rows had non-null `turnover_rate` and `market_universe`.
- `cm_view_registry` had no row for `cm_gov_market_turnover_m` / `market_turnover`.

Implementation plan:
- Rebuild `cm_gov_market_turnover_m` to null the universe-derived on-market fields before `2012-01-01`: `market_universe`, `turnover_rate`, `active_count`, `months_of_supply`.
- Preserve sales-only history columns (`ttm_sales_count`, `annual_sales_rate`, `monthly_sales_count`) before 2012 for audit/history.
- Register `cm_gov_market_turnover_m` in `cm_view_registry` with curated `display_from = '2012-01-01'` so exports and packet builds crop the chart/data tab at the same source-owned floor.

Expected verification:
- Pre-2012 `active_count`, `months_of_supply`, `turnover_rate`, and `market_universe` all return zero non-null rows.
- The first non-null `active_count` remains on/after January 2012.
- Registry row exists with `display_from = 2012-01-01`.

Applied live:
- Supabase project: Government (`scknotsqkcheojiaewwh`).
- Migration name: `gov_market_turnover_display_from_source_crop`.
- Result: success.

Live verification after patch:
- `pre2012Rows`: 84.
- `pre2012ActiveNonNull`: 0.
- `pre2012MonthsSupplyNonNull`: 0.
- `pre2012TurnoverNonNull`: 0.
- `pre2012MarketUniverseNonNull`: 0.
- First non-null active row: `2012-01-31`.
- Registry row: `cm_gov_market_turnover_m`, `chart_template_id = market_turnover`, `vertical = gov`, `display_from = 2012-01-01`.
