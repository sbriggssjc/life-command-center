# R54 — Cap_Quartile sample-size gate audit

## User complaint (2026-05-22 batch 3)

> "the bands move is perfect proportion to the median in both directions — equal distance from the median to the upper quartile and same distance from the median to the lower quartile"
>
> "The data labels in the legend at the bottom are mislabeled and all the same number — honestly a number that doesn't make sense for the time period; cap rates in 2005 were no where near a 4.73% cap rate even on the lower quartile"

R48 verified the SQL uses real `percentile_cont(0.25/0.50/0.75)` and concluded "narrow IQR is a data feature, not a bug". That conclusion was WRONG for early-period data.

## Smoking gun

Direct query of `cm_dialysis_cap_quartile_m` for early 2005:

| period_end | Q3 | Median | Q1 |
| --- | --- | --- | --- |
| 2005-01-31 | 0.0473 | 0.0473 | 0.0473 |
| 2005-02-28 | 0.0473 | 0.0473 | 0.0473 |
| 2005-03-31 | 0.0473 | 0.0473 | 0.0473 |

All three quartiles are exactly **4.73%** — the number the user called out. That's because the TTM (rolling 12-month) window for early 2005 contained exactly ONE valid cap-rate sample, so Q1 = Med = Q3 = the single sample mathematically.

Per-period band-filtered sample counts (4-12% sane band, TTM):

| period_end | n samples in band |
| --- | --- |
| 2005-01 to 2005-04 | 1 each |
| 2005-05 to 2005-12 | 1 each (one outlier sample now joined) |
| 2006-01 | 1 |
| 2006-02 | 2 |
| 2006-03 to 2006-06 | 3 |
| 2006-07 onward | 4+ (chart starts being statistically meaningful) |

## Why R48 missed it

R48 looked at 2006-onward sample counts (which started filling out by mid-2006) and concluded the percentile output was correct. R48 didn't gate on a minimum sample-size threshold and didn't audit pre-2006 specifically. The 4.73% degenerate rows were sitting in plain sight at the start of the chart.

## R54 fix

**SQL** — both verticals (`cm_dialysis_cap_quartile_m` and `cm_gov_cap_quartile_m`) rewrapped to NULL out Q1/Med/Q3 when fewer than 4 cap-rate samples exist within the TTM window's 4-12% sane band. This is computed via a `LATERAL` subquery against `sales_transactions` rather than a column in master_m (master_m doesn't expose the band-filtered count).

**Chart axis trim** — `MIN_YEAR_BY_TEMPLATE['cap_rate_top_bottom_quartile']` bumped from 2005 to 2007. The view-level gate is the canonical fix; the trim is a visual cleanup so the chart doesn't show a NULL gap-line at the start. Data tab keeps every row from 2001 onward.

## Asymmetry confirmation

With the gate applied, the bands ARE asymmetric across periods. Sample year-over-year:

| year | avg(Q3−Med) | avg(Med−Q1) |
| --- | ---: | ---: |
| 2020 | 60bps | 83bps (lower wider) |
| 2022 | 83bps | 69bps (upper wider) |
| 2024 | 103bps | 94bps (slightly upper wider) |
| 2025 | 79bps | 74bps (close to symmetric) |

So the user's other concern ("bands move in perfect proportion") was a perception artifact of the degenerate early-period rows + tight overall IQR scaled against a wide y-axis. After R54 the early rows go to NULL, the chart shows only meaningful data, and the asymmetry should be more visible.

## What this doesn't fix

- The `Active_Cap_Quart` chart (asking-cap quartiles on active listings) uses a different view and may need the same gate. Will inspect post-R54 deploy.
- The cap_rate_ttm_by_quarter chart (Data_Cap_Avg) uses a weighted-average not percentile; the user's "4.73% in legend" complaint there is likely a separate issue (R37 P3 data label showing the same series-min value).
