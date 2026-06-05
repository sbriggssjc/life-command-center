# Round 68-A — Task 3: 10+ cohort gate re-test + rolling pooling (coverage report)

Run **after** Tasks 1+2 landed (1,207 synthetic + 212 linked listings live). Per
Scott's decision: **rolling-3-(quarter) pooling on the 10+ series only**; the
all-cohort series stays single-period gated; label the 10+ series **"3-mo pooled"**
in the chart note.

## What was wrong with the 10+ asking-cap quartile series

`cm_dialysis_asking_cap_quartiles_active_q` computed `upper_q_core` / `lower_q_core`
(firm term ≥ 10y) with **no core-count gate** — `percentile_cont` over 1–3 listings
emits a meaningless "quartile". Only the all-cohort total was gated (n≥4). So the
42 quarters that "had" a core quartile included **16 single-/low-n garbage** ones.

Synthetic rows never touch this series (they carry NULL `last_cap_rate`, dropped by
the cap band filter), so Task 2 did not lift it — it needed the gate + pooling.

## Fix

Migration `20260605_cm_round68a_task3_core10_pooled_quartiles.sql`:
- **All-cohort total** (`upper_q_total`/`lower_q_total`): single-quarter, gated
  `tot_n ≥ 4` — **unchanged** (verified: 47/53 present, identical to before).
- **10+ core** (`upper_q_core`/`lower_q_core`): pooled over a **rolling 3-quarter
  window**, gated on **pooled core n ≥ 4** (a real, meaningful gate).

## Before / after coverage (53 quarters, 2013-2026)

| 10+ core asking-cap quartile | quarters with a value | note |
|---|--:|---|
| Prior view (no core gate) | 42 | **includes 16 meaningless n=1–3 quartiles** |
| Proper single-quarter gate (n≥4) | **26** | meaningful, but thin coverage |
| **Rolling-3-quarter pooled, n≥4 (shipped)** | **34** | **+8 recovered** vs single-quarter gate |
| Remaining gap | 19 | **11 genuinely empty** (zero 10+ priced listings even pooled) + **8** still < n=4 even pooled |

All-cohort total series: **47/53, unchanged** (single-quarter, not pooled).

## The remaining 19 gaps are genuine, not suppression

Of the 19 quarters without a pooled core quartile: **11 have zero 10+ priced active
listings even across a 3-quarter window** (early-history quarters, 2013-2016, before
the long-term-lease cohort had market depth), and **8** carry only 1–3 such listings
even pooled. These are documented as genuine market thinness, **not fabricated** — a
quartile is simply not defined on < 4 observations.

## Other 10+ series (checked, no pooling needed)

- `cm_dialysis_available_market_size_q.avg_cap_core_10plus` — already 47/53 present
  under its n≥3 gate; not the binding gap.
- `cm_dialysis_seller_sentiment_q/m.last_ask_cap_long_term` — already smoothed over a
  centered multi-period window (53/53 present); already effectively pooled.

The asking-cap quartile series was the binding 10+ gap; it is the one pooled here.
Extending the same rolling-pool to `available_market_size` is a one-line follow-up if
uniform treatment is wanted.

## Chart note requirement

The export must label the 10+ quartile band **"3-mo pooled"** (rolling 3-quarter)
so the reader knows the core series uses a wider window than the single-quarter
all-cohort band.
