# CM TTM Methodology Audit

User asked 2026-05-22: *"the January datapoint to be a sum or the average of the
12 months prior's activity ... (January 1, 2025 to December 31, 2025 for the
fourth quarter data point, February 1, 2025 to January 31, 2026 for the next
month's data point, etc.). Is this how the data is being calculated for all
categories? Sums? Averages? Counts? Quartiles? etc.?"*

## TL;DR

**Yes — every TTM-cadenced chart uses your exact formula.** The canonical SQL
pattern across all views is:

```sql
WHERE event_date > (period_end - interval '1 year')::date
  AND event_date <= period_end
```

For `period_end = '2026-01-31'`:
- `period_end - 1 year` = `'2025-01-31'`
- `event_date > '2025-01-31'::date` ≡ `event_date >= '2025-02-01'`
- `event_date <= '2026-01-31'`
- **Window: Feb 1, 2025 → Jan 31, 2026** ✓ MATCHES your formula

For `period_end = '2025-12-31'` (4Q-2025 anchor):
- `period_end - 1 year` = `'2024-12-31'`
- Window: **Jan 1, 2025 → Dec 31, 2025** ✓ MATCHES

Verified pattern present in 9+ dia views + 9+ gov views (every view that does
its own TTM aggregation). Views that are simple passthroughs from the master
mat view inherit it.

**Two charts** have a 5-month smoothing layer added on top of TTM (R48). For
those, the visible value is a 5-period centered moving avg of the TTM values.
Documented in detail below.

## Canonical TTM pattern

The master_m materialized view (`cm_dialysis_market_quarterly_master_m` and
`cm_gov_market_quarterly_master_m_mat`) — which feeds ~15 of the chart-data
views via passthrough — uses:

```sql
ttm_per_month AS (
  SELECT m.period_end, cs.sold_price, cs.cap_rate, ...
  FROM month_anchors m
  JOIN classified_sales cs
    ON cs.sale_date >  (m.period_end - '1 year'::interval)::date
   AND cs.sale_date <= m.period_end
)
```

`month_anchors` is generated from `2001-01-01` through the last completed
quarter, with `period_end` = last day of each month.

## Per-chart calculation catalog

### TTM rolling — canonical pattern, sales-based

| Chart (dia tab) | Source view | Aggregation type | Notes |
| --- | --- | --- | --- |
| `Data_Volume_TTM` | master_m | **SUM**(sold_price) | TTM dollar volume |
| `Data_Txn_Count` | master_m | **COUNT**(*) | TTM transaction count |
| `Data_Avg_Deal` | master_m | **AVG**(sold_price), filtered to $100K-$200M | TTM avg deal size |
| `Data_YoY_Change` | master_m | (ttm_volume / lag(ttm_volume, 12)) - 1 | YoY % using two TTM anchors |
| `Data_Volume_Quarterly` | master_m | **SUM**(sold_price) GROUP BY quarter | Per-quarter (not TTM) |
| `Data_Cap_Avg` | master_m → cap_ttm_m | **AVG**(cap_rate), 4-12% filter | TTM avg cap rate |
| `Data_Cap_Quartile` | master_m → cap_quartile_m | `percentile_cont(0.25/0.50/0.75)` | TTM Q1/median/Q3 |
| `Data_Returns_Idx` | master_m → returns_indexes_m | Cash_return = TTM avg cap; Lev. return = mid loan const × LTV | Derived from TTM cap |
| `Data_Cost_Capital` | master_m → cost_of_capital_m | TTM avg cap + treasury + 10+yr cohort cap + low/high loan constants | Multi-line; cap parts use TTM |
| `Data_NM_vs_Market` | master_m → **nm_vs_market_m (smoothed)** | nm = **5-mo centered AVG of TTM AVG**; market = TTM AVG | **R48 added smoothing on NM line** (see Smoothing section) |
| `Data_Sold_Cap_by_Term` | master_m → **sold_cap_by_term_dot (smoothed)** | Per-cohort TTM AVG of cap rate, **then 5-mo centered moving avg** | **R48 added smoothing**; cohorts: 12+yr / 8-12yr / 6-8yr / ≤5yr (dia) |
| `Data_Ask_Cap_by_Term` | asking_cap_by_term_m | Per-cohort TTM AVG with HAVING ≥5/cohort + 3-mo centered smoothing | (smoothing was always there, pre-R48) |
| `Data_Bid_Ask` | bid_ask_spread_m | TTM AVG of \|last_cap - sold_cap\|; pct_price_change = TTM % | HAVING ≥5 |
| `Data_DOM_Ask` | dom_pct_ask_m | TTM AVG(sold_date - listing_date); TTM AVG(sold_price/last_price) | Median variants also percentile_cont(0.5) |
| `Data_Sentiment` | seller_sentiment_m | TTM % of sales with price_change; TTM last_ask_cap AVG | All cohort + 8+yr cohort variants |
| `Data_Market_Turnover` | market_turnover_m | TTM sales count / active leases (point-in-time at period_end) | Numerator TTM, denominator snapshot |
| `Data_Inventory_Backlog` | inventory_backlog_m | TTM count of listings added + TTM count of sales | active_count is point-in-time |
| `Data_Val_Index` | valuation_index_m | TTM-based composite of cap + price/SF (or chair) | |
| `Data_Vol_Cap_Combo` | (synthetic) → master_m | Combines TTM volume + TTM cap + TTM upper/lower quartile | All series TTM |
| `Data_Rent_Price_Chair` | rent_price_per_chair_q | TTM AVG(annual_rent / total_chairs) + TTM AVG(sold_price / total_chairs) | HAVING ≥5 |
| `Data_Rent_Price_PSF` | rent_price_psf_q (R40 — dia) | TTM AVG(annual_rent / building_size) + TTM AVG(sold_price / building_size) | HAVING ≥5 |
| `Data_Buyer_Pool_M` | master_m | TTM count by buyer_class | Private / REIT / Cross-Border / Institutional |
| `Data_Buyer_Pool` (annual) | buyer_share_y | **Per-calendar-year** count by buyer_class | NOT TTM — year-by-year |
| `Data_Txn_AvgDeal_Combo` | master_m | TTM count (bar) + TTM AVG deal size (line) | |

### TTM rolling — leases-based

| Chart | Source view | Aggregation | Notes |
| --- | --- | --- | --- |
| `Data_Renewal_Growth` | renewal_rent_growth_m | TTM AVG of new_rent / prior_rent ratios | |
| `Data_CPI_CAGR` | cpi_vs_renewal_cagr | CPI YoY + GSA renewal CAGR | |
| `Data_Renewal_Rate` (gov) | lease_renewal_rate_m | TTM count by lease outcome | Renewed / Succeeding / Expired / Terminated |
| `Data_Term_Rate` (gov) | lease_termination_rate_m | TTM termination rate | |

### Active-listing — POINT-IN-TIME (not TTM)

| Chart | Source view | Aggregation | Notes |
| --- | --- | --- | --- |
| `Data_Active_Cap_Quart` | asking_cap_quartiles_active_m | `percentile_cont(0.25/0.75)` over **active listings AT period_end** | NOT TTM — current snapshot |
| `Data_Active_DOM_PC` | dom_price_change_active_m | AVG DOM at period_end; % with price change | NOT TTM |
| `Data_Avail_Cap_Dot` | core_cap_rate_dots / available_cap_dot | Per-listing dot snapshot | NOT TTM — point cloud |
| `Data_Avail_Tenant_CountD/VolD` | top_tenants snapshot at last_quarter_end | Latest-quarter share by tenant | NOT TTM — single snapshot |

### Per-quarter / per-month (no rolling)

| Chart | Source view | Aggregation | Notes |
| --- | --- | --- | --- |
| `Data_Volume_Quarterly` | master_m | SUM(sold_price) where quarter_end matches | Per-quarter total (used to show quarterly bars in TTM-bar combo) |
| `Data_Pace_Cap_Expand` | (synthetic) | curr_TTM_cap - prev_TTM_cap (lag 12 months) | YoY delta of TTM values |

### Static reference data

| Chart | Source view | Aggregation | Notes |
| --- | --- | --- | --- |
| `Data_Top_Buyers` / `Data_Top_Sellers` | top_buyers / top_sellers | COUNT all-time | Rank by total over full history |
| `Data_NM_Notable_Txns` | notable_transactions | Rank by sale price within rotation window | |
| `Data_FF_vs_10Y` | macro_rates_m | Point-in-time at period_end | Fed Funds + 10Y Treasury (snapshots, not TTM) |
| `Data_Rent_PSF_Box` | rent_box_q | Quarterly min/Q1/median/Q3/max | Per-quarter box-plot stats |
| `Data_Rent_Year_Built` | rent_by_year_built | All-time by year-built decade | |

## Smoothing layers added in R48 (2026-05-22)

Two charts now have a 5-month centered moving average **on top of** the TTM
calculation. The visible value is no longer a pure single-window TTM — it's
the average of 5 overlapping TTMs centered on the period_end.

### What this means for `Data_NM_vs_Market` and `Data_Sold_Cap_by_Term`

For `period_end = 2026-01-31` with R48 smoothing:

```
displayed_value = AVG(
  TTM_2025-11-30,   # covers Dec 1, 2024 → Nov 30, 2025
  TTM_2025-12-31,   # covers Jan 1, 2025 → Dec 31, 2025
  TTM_2026-01-31,   # covers Feb 1, 2025 → Jan 31, 2026   ← pure TTM at this anchor
  TTM_2026-02-28,   # covers Mar 1, 2025 → Feb 28, 2026
  TTM_2026-03-31    # covers Apr 1, 2025 → Mar 31, 2026
)
```

Effective coverage: Dec 2024 → Mar 2026 = ~16 months. The "12 months prior"
interpretation breaks for these two charts.

**Why R48 added it:** the underlying TTM was correctly computed but extremely
noisy because the TTM sample sizes were small (8-30 NM sales/window vs 80-220
non-NM; 10-30 cohort sales in 2024 low-volume periods). The R48 smoothing
absorbs single-sale swings.

**Trade-off you should know about:**

| Approach | Pros | Cons |
| --- | --- | --- |
| **Current (5-mo smoothed TTM)** | Smooth line matches master Excel visual; absorbs single-sale noise | ~2-month lag on real inflections; not pure "12 months prior" math |
| **Pure TTM (revert R48)** | Exact "12 months prior" math per your formula | Noisy line — single new sale can swing NM cap 30-50 bps |
| **Wider TTM window (e.g. 24-mo)** | Pure rolling AVG, more samples per window | Even more lag; older data weighted equally with newer |

If "pure 12-months-prior" is the strict interpretation, R48 should be reverted
and `nm_vs_market` + `sold_cap_by_term_dot` go back to raw TTM (acknowledging
the noise that was the user's original complaint).

If "smoothness over strict interpretation" is OK for these two visual charts,
R48 stays.

## Cross-vertical confirmation

Same canonical TTM pattern verified across **both gov + dia** for every view
that does its own aggregation:

```
DIA:                                          GOV:
- bid_ask_spread_m              ✓             - bid_ask_spread_m              ✓
- dom_pct_ask_m                 ✓             - dom_pct_ask_m                 ✓
- seller_sentiment_m            ✓             - seller_sentiment_m            ✓
- inventory_backlog_m           ✓             - inventory_backlog_m           ✓
- market_turnover_m             ✓             - market_turnover_m             ✓
- valuation_index_m             ✓             - valuation_index_m             ✓
- rent_price_per_chair_q (dia)  ✓             - rent_price_psf_q              ✓
- rent_price_psf_q (R40)        ✓             - cap_by_credit_q               ✓
- asking_cap_by_term_m          ✓             - market_quarterly_master_m_mat ✓
- market_quarterly_master_m     ✓
```

Plus all chart views that are passthroughs from the master mat view inherit
the pattern (cap_quartile_m, cap_ttm_m, cost_of_capital_m, returns_indexes_m,
nm_vs_market_m before R48 smoothing, sold_cap_by_term_dot before R48
smoothing).

## Aggregation type summary

To answer your question directly — for the 14 user-flagged charts in the
2026-05-21 notes:

| Chart | Aggregation | Match your formula? |
| --- | --- | --- |
| Volume_TTM | **SUM** of sold_price | ✓ Pure TTM |
| Txn_Count | **COUNT** of sales | ✓ Pure TTM |
| Avg_Deal | **AVG** of sold_price | ✓ Pure TTM |
| Cap_Avg | **AVG** of cap_rate (4-12% filter) | ✓ Pure TTM |
| Cap_Quartile | `percentile_cont(0.25/0.50/0.75)` | ✓ Pure TTM, real quartiles |
| Returns_Idx | TTM avg cap → modeled leveraged return | ✓ Cap part is pure TTM |
| Cost_Capital | TTM avg cap + treasury (snapshot) + loan const (snapshot) | ✓ Cap part is pure TTM |
| DOM_Ask | TTM **AVG** of (days_on_market, sold_price/list_price); medians via percentile_cont(0.5) | ✓ Pure TTM |
| NM_vs_Market | NM = **5-mo smoothed TTM AVG** (R48); market = pure TTM AVG | ⚠ NM line is smoothed |
| Sentiment | TTM **% / AVG** of price_change + last_ask_cap | ✓ Pure TTM |
| Rent_PSF_Box | Per-quarter **min/Q1/median/Q3/max** of rent_psf | ✗ NOT TTM — per-quarter stats |
| Bid_Ask | TTM **AVG** of \|bid-ask\| spread | ✓ Pure TTM |
| Inventory_Backlog | TTM **COUNT** added + TTM **COUNT** sold | ✓ Pure TTM |
| Market_Turnover | TTM sales **COUNT** / active leases (snapshot) | ⚠ Numerator TTM, denominator snapshot |
| Sold_Cap_by_Term | Per-cohort **5-mo smoothed TTM AVG** (R48) | ⚠ Smoothed |
| Ask_Cap_by_Term | Per-cohort TTM **AVG** with HAVING≥5, 3-mo smoothing | ⚠ 3-mo smoothed |
| Vol_Cap_Combo | TTM **SUM** volume + TTM **AVG** cap + TTM quartiles | ✓ Pure TTM (no smoothing) |

## User decisions (2026-05-22)

After reviewing this audit + sample data, Scott confirmed each chart's
calculation methodology:

| Chart | Treatment | Decision |
| --- | --- | --- |
| NM_vs_Market | NM line smoothed (5-mo) + market line pure TTM | **Keep** smoothing on NM — small-sample noise needs absorbing |
| Sold_Cap_by_Term (4 cohorts) | All cohorts smoothed (5-mo) | **Keep** smoothing — 2024 low-volume window otherwise jagged |
| Ask_Cap_by_Term (4 cohorts) | HAVING ≥ 5 + 3-mo smoothing | **Keep** current; gate + smooth both serve the visual |
| Market_Turnover | TTM sales / point-in-time active leases | **Current mix correct** — this is conventional turnover definition |
| Inventory_Backlog | TTM added + TTM sold + point-in-time active | **Current mix correct** — conventional inventory snapshot |
| All other 20 TTM charts | Pure 12-months-prior TTM, no smoothing | Already correct, no change |

**Implication for future readers:** any chart in this catalog NOT tagged
"smoothed" computes a strict "12 months prior" window ending at the chart's
period_end anchor.

## Confidence

- TTM math: **high** — every view verified against the canonical pattern via
  direct SQL inspection.
- Aggregation types: **high** — read directly from view definitions.
- R48 smoothing trade-off: surfaced for you to confirm direction.
- Per-chart catalog: **complete** for the ~25 chart templates currently in the
  dia + gov catalogs.
