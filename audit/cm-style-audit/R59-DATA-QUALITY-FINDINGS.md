# R59 — data quality audit (2026-05-22 batch 4 deferred items)

User flagged 4 chart-level anomalies suspected to be formula bugs or
duplicate data. Investigation results:

## 1. Volume_TTM Aug→Sept 2024 cliff (REAL DATA ERROR — fixed)

**User**: _"Huge volume drop in 2024 that suggests the formula is wrong
for TTM data, shouldn't fall off a cliff like that from one month to
another (August 2024 is $1.5B and Sept is $400M)."_

**Investigation**: TTM volume confirmed:
| period_end | ttm_vol | transaction_count_ttm |
| --- | ---: | ---: |
| 2024-07-31 | $1500.6M | 136 |
| 2024-08-31 | $1469.1M | 126 |
| 2024-09-30 | $404.9M | 87 |
| 2024-10-31 | $355.3M | 86 |

Sept-2024 rolled 39 transactions and $1.06B out of the TTM window. The
rolled-off month was Sept-2023, which had 43 sales totaling $1071M.

**Smoking gun**: sale_id 13357 — `$950,000,000` attributed to a single
Houston address (8621 Fulton St) on 2023-09-12. Reference stats for
all dialysis sales:
- median sold_price: $3.17M
- p95: $9.80M
- p99: $22.59M
- **this row : p99 = 42×**

`data_source` is `costar_sidebar` with NO buyer/seller names and NO
notes. Almost certainly a CoStar portfolio-summary row that was
mis-attributed to a single property record during ingestion.

**Fix**: `UPDATE sales_transactions SET exclude_from_market_metrics=true WHERE sale_id=13357`.

Post-fix: 2024-08-31 TTM volume drops from $1469M to $519M; Sept→Aug
cliff is now a normal $114M month-over-month variation.

## 2. Volume_Quarterly Jul 2023 spike (REAL DATA ERROR — same fix)

**User**: _"huge jump in quarterly deals in Jul 2023 ish, looks like
a formula error or duplicate data."_

**Investigation**: Q3-2023 quarterly volume was inflated by the same
$950M sale_id 13357 (sale_date 2023-09-12 falls in Q3-2023). Q3-2023
quarterly_volume drops from $1163M to $213M after the exclusion.

**Same fix as #1** — single root cause for two complaints.

## 3. Bid_Ask 2015-2016 jumps (REAL MARKET DATA — not a bug)

**User**: _"The 2015-2016 data jumps really quickly and suggests
maybe some inconsistent data or outliers or problems with the formulas."_

**Investigation**: per-quarter `avg_bid_ask_spread` + `n_with_spread`:
| Quarter | Spread (bps) | n |
| --- | ---: | ---: |
| 2014-Q1 | 102 | 5 |
| 2014-Q2 | 22 | 8 |
| 2015-Q3 | 48 | 16 |
| **2015-Q4** | **121** | **24** |
| **2016-Q2** | **133** | **21** |
| 2016-Q4 | 48 | 17 |

The 2015-Q4 → 2016-Q2 widening is supported by a robust sample size
(n=17-26). The data IS real — likely reflects the cap-rate
widening that accompanied the 2015-16 oil price collapse + rate
volatility. Not a formula bug.

Documented as not-a-bug. If the user wants the chart to smooth out
this volatility they can apply the same 5-month centered MA we
already apply to NM_vs_Market (R48) — separate ask.

## 4. Avg_Deal_Size Jun 2006 spike (SMALL-SAMPLE TTM VOLATILITY)

**User**: _"the data appears to jump disproportionate to the balance
in Jun 2006."_

**Investigation**: avg_deal_size by month around Jun-2006:
| period_end | avg_deal_size | transaction_count_ttm |
| --- | ---: | ---: |
| 2006-04-30 | $5.40M | 13 |
| 2006-05-31 | $5.38M | 12 |
| **2006-06-30** | **$6.91M** | **11** |
| 2006-07-31 | $4.46M | 18 |
| 2006-08-31 | $4.46M | 18 |
| 2006-09-30 | $3.91M | 15 |

With TTM transaction counts of 11-13, a single $20-30M deal entering
the window swings the average by ~$1.5M. The chart correctly shows
real data; the volatility is a sample-size artifact (same pattern as
R48's cohort cap-rate volatility).

**Documented as not-a-bug**. A `transaction_count_ttm >= 15` gate
could smooth the early years; deferred unless explicitly requested.

## Summary

| # | Complaint | Verdict | Fix |
| --- | --- | --- | --- |
| 1 | Volume_TTM Aug→Sept 2024 cliff | REAL BAD DATA | exclude sale_id 13357 |
| 2 | Volume_Quarterly Jul 2023 spike | Same as #1 | exclude sale_id 13357 |
| 3 | Bid_Ask 2015-2016 jumps | Real market data | not-a-bug, documented |
| 4 | Avg_Deal_Size Jun 2006 spike | Small-sample TTM volatility | not-a-bug, documented |
