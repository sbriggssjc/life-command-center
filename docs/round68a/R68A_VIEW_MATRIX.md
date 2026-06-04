# Round 68-A — View-Replacement Matrix (verification gate)

> Migration: `supabase/migrations/20260605_cm_round68a_synthetic_listing_views.sql`.
> **Safety property asserted:** `data_source='synthetic_from_sale'` reaches
> **zero** price/DOM/cap-derived charts.

## How synthetic rows behave

Synthetic rows carry **NULL** `initial_price` / `last_price` / all `*cap_rate*`,
`status='sold'`, `is_active=false`, and `listing_date` + `off_market_date`
(= sale_date). So:
- **count/universe views** that key off `listing_date` / the active window
  naturally pick them up → INCLUDE (intended).
- **price/cap views** that `FILTER ... last_price/last_cap_rate IS NOT NULL`
  naturally drop them → safe. We still add an **explicit** `data_source IS
  DISTINCT FROM 'synthetic_from_sale'` guard on the two genuinely-at-risk views
  and on all price views for a structural guarantee.

## Direct views (reference `available_listings`)

| # | view | synthetic? | exact guard added | consuming chart |
|--:|---|:--:|---|---|
| 1 | `cm_dialysis_active_listings_m` | **INCLUDE** | status disjunction `OR al.data_source='synthetic_from_sale'`; `days_on_market` NULLed for synthetic | Active Listings (monthly), feeds cap/term children |
| 2 | `cm_dialysis_active_listings_q` | **INCLUDE** | same as #1 | Active Listings (quarterly), tenant-bucket, feeds children |
| 3 | `cm_dialysis_market_turnover_m` | **INCLUDE** | flows in via `eff`; sentinel CTE computed on non-synthetic only; `OR al.data_source='synthetic_from_sale'` so a synthetic date-cluster is never sentinel-dropped | Market Turnover, TTM turnover |
| 4 | `cm_dialysis_inventory_backlog_m` | **INCLUDE** | same sentinel handling as #3 | Inventory Backlog, months-of-supply |
| 5 | `cm_dialysis_available_market_size_q` | **INCLUDE** (counts) | flows in via listing_date window; sentinel handling as #3; `avg_cap_*` unaffected (synthetic cap NULL, dropped by 0.04–0.12 band) | Available Market Size |
| 6 | `cm_dialysis_dom_pct_ask_m` | **EXCLUDE** | `AND al.data_source IS DISTINCT FROM 'synthetic_from_sale'` on the sold join | DOM & % of Ask (monthly) |
| 7 | `cm_dialysis_dom_pct_ask_q` | **EXCLUDE** | guard on anchors + sold join | DOM & % of Ask (quarterly) |
| 8 | `cm_dialysis_bid_ask_spread_m` | **EXCLUDE** | guard on the ttm_sold join | Bid-Ask Spread (monthly) |
| 9 | `cm_dialysis_bid_ask_spread_q` | **EXCLUDE** | guard on anchors + ttm_sold join | Bid-Ask Spread (quarterly) |
| 10 | `cm_dialysis_seller_sentiment_m` | **EXCLUDE** | guard on both `sale_transaction_id` correlated subqueries | Seller Sentiment (monthly) |
| 11 | `cm_dialysis_seller_sentiment_q` | **EXCLUDE** | guard on both correlated subqueries | Seller Sentiment (quarterly) |

**#6 `dom_pct_ask` is the one genuine leak**: it filters on `sold_price>0` (which
synthetic rows have) and computes DOM from `sold_date − listing_date` (both set on
synthetic) — without the guard it would inject the imputed median DOM into the
real DOM distribution. The guard is load-bearing here, defensive on the others.

## Inherited views (build on `active_listings_*`, NOT edited)

Cap/price-safe **without** a guard because each FILTERs on `last_cap_rate` or
`last_price IS NOT NULL`, and synthetic rows are NULL there:

| view | builds on | why synthetic can't leak |
|---|---|---|
| `cm_dialysis_asking_cap_quartiles_active_m/q` | `active_listings_*` | `FILTER (WHERE last_cap_rate ...)`; `HAVING count(*) FILTER (last_cap_rate IS NOT NULL)>=4` |
| `cm_dialysis_asking_cap_by_term_m` | `active_listings_m` | base `WHERE last_cap_rate IS NOT NULL` |
| `cm_dialysis_available_cap_dot` | `active_listings_q` | `WHERE last_cap_rate IS NOT NULL` |
| `cm_dialysis_on_market_snapshot_q` | `active_listings_q` | `WHERE last_price IS NOT NULL AND >=100000` → synthetic (NULL price) dropped, so their `days_on_market`/`had_price_change` never reach it |

Net: synthetic rows raise the **count** of active listings (the universe) but
contribute **nothing** to any cap, price, DOM, or price-change aggregate, in
either the direct or inherited views.

## Known residual (Task 1)

2026-captured actives whose CREXi/CoStar/LoopNet pages carry no marketing-start
marker keep their capture date → a known **undercount of the 2025 active
universe** on the count/universe charts above. **Partially self-healing** as the
availability-checker re-probes pages and recovers `listing_date` via
`listing_date_source='page_marker'` (see `R68A_RE_DATE_PLAN.md`). Not fabricated.

## Verification (byte-identical price/DOM, after the backfill)

```sql
-- price/DOM/cap charts must be unchanged vs a pre-backfill snapshot:
SELECT * FROM cm_dialysis_dom_pct_ask_q ORDER BY period_end;       -- identical
SELECT * FROM cm_dialysis_bid_ask_spread_q ORDER BY period_end;    -- identical
SELECT * FROM cm_dialysis_seller_sentiment_q ORDER BY period_end;  -- identical
-- no synthetic row may appear in any price/DOM/cap view (must return 0):
SELECT count(*) FROM cm_dialysis_active_listings_q
 WHERE last_price IS NULL AND last_cap_rate IS NULL AND days_on_market IS NOT NULL;
```
