# T9 — cap-rate data anomalies (investigate → fix; data before axis)

> Scott's June-25 review. Three INVESTIGATE-then-fix items. gov `scknotsqkcheojiaewwh`,
> dia `zqzrriwuavgrquhisnoa`. All changes reversible; receipts below are grounded live.
> JS ships on the Railway redeploy; DB applied live + committed
> (`supabase/migrations/20260625_cm_t9_gov_cap_data_integrity.sql`).

## Unit 1 — gov core-cap dot-plot outliers → ALL derived errors (0 real)

**Triage (error-vs-real, re-derived):** the visible **6** sales (9–12%) + the **13**
filtered out by the ≤0.12 bound (up to 26.8%) = **19 outliers, ALL derived
`cap_rate_history` errors — 0 real high-cap comps.** Every outlier's
`sales_transactions.sold_cap_rate` is reasonable (4.3–8.0%) and, where a sale NOI
exists, matches `NOI / sold_price` (24/26 of the broader anomaly set with NOI confirm
within 1pp). The inflation lived only in the **derived** `cap_rate_history.cap_rate`,
which the dot view preferred via `COALESCE(crh.cap_rate, sold_cap_rate, …)`.

Two error mechanisms:
- **Portfolio price-splits (28 rows):** a partial *allocated* price paired with the
  *full* property NOI. e.g. prop **14197** (CBP Ashburn): the real **$65.5M** sale was
  ALSO recorded as $21.6M / $25.6M / $18.3M slices, each ÷ the full **$4.03M** NOI →
  18–22% derived caps. (The partial *sales* rows are correctly
  `exclude_from_market_metrics=true`, but their inflated `sold_cap_rate` also masked
  some crh rows from a naive per-sale anchor — see the robust anchor below.)
- **Gross-rent-as-NOI / stale `properties.noi` (148 rows):** FS leases not haircut, or
  a wrong confirmed-NOI, inflating the modeled cap above the validated market cap.

**Full anomaly population:** **176 derived `sale` rows across ~132 properties**
(28 `price_split` + 148 `income_gt_validated`). Criterion = derived cap exceeds the
**robust anchor** (MIN `sold_cap_rate` among the NON-excluded sales at that
property+date = the real full-price comp) by `>1.20×` AND `>1.2pp`. This only fires
when the derived value inflates ABOVE a reliable lower sold cap, so a genuinely-high
real cap (where derived ≈ sold) is never tagged.

**Fix (reversible, provenance-tagged — errors excluded, real comps KEPT):**
- New reversible `cap_rate_history.is_anomaly` / `anomaly_reason` / `anomaly_tagged_at`
  columns; the 176 rows tagged. Reverse with `SET is_anomaly=false`.
- `cm_gov_core_cap_rate_dots` now skips `is_anomaly` crh rows and the
  `sold_cap_rate` fallback moved OUTSIDE the crh subquery, so an excluded/absent
  derived value falls back to the validated market cap instead of dropping the dot.
  Non-anomalous sales are byte-identical.

**The new fit (receipts):**
| | before | after |
|---|---|---|
| visible dots (6+yr, 0.04–0.12) | 503 | **682** (real comps previously hidden out-of-band by inflated caps re-appear at their true cap) |
| max cap in view | 11.97% (and 13 hidden up to 26.8%) | **8.76%** |
| p50 / p90 / p95 | 6.95 / 7.89 / 8.0% | 6.88 / 7.80 / 7.99% |
| dots > 9% | 6 visible + 13 filtered | **0** |

**Axis:** `core_cap_rate_dot_plot` added to `CAP_AXIS_FIT_TEMPLATES`; the injector
(`capFit || CAP_RATE_DOT_RANGE`) + the PNG renderer both data-fit the cap axis over the
plotted dots (snap to 0.5% grid). Post-fix max 8.76% → **ceiling fits to ~9%** (was a
static 4–12%). `cm_gov_sold_cap_by_term_dot` already reads `sold_cap_rate` (clean) and
is already in the fit set → its ceiling already fits ≤8% (≤9% satisfied, no change).

## Unit 2 — gov cap-by-term duplicate/erratic cohorts

**Receipts (bucket-n table, `cm_gov_cap_by_term_m`, monthly, the chart source):**

| period_end | n_10+ | n_6to10 | n_[5,6) | n_<5 | n_outside | cap_6to10 | cap_5to10 |
|---|---|---|---|---|---|---|---|
| 2024-06 | 16 | 20 | 8 | 29 | 6 | 0.0721 | 0.0705 |
| 2025-06 | 8 | 12 | 5 | 26 | 3 | 0.0751 | 0.0722 |
| 2025-10 | 9 | 8 | 0 | 20 | 4 | 0.0738 | **0.0738** |
| 2025-12 | 5 | 6 | 0 | 20 | 4 | **0.0750** | **0.0750** |
| 2026-01 | 6 | 5 | 0 | 18 | 4 | **0.0750** | **0.0750** |
| 2026-02 | 5 | 4 | 0 | 15 | 3 | **0.0750** | **0.0750** |

Three confirmed problems, all in **`cm_gov_cap_by_term_m`** (the gov "Cap Rate by
Remaining Lease Term" chart reads `cm_{vertical}_cap_by_term_m`):
1. **Duplicate/overlapping cohorts:** the view carried BOTH `cap_6to10` ([6,10)) AND
   `cap_5to10` ([5,10)). They DIVERGE when [5,6)yr sales exist and become **identical**
   once `n_[5,6)=0` (2025-10 on) — exactly the "identical values" Scott saw. The export
   + master_m mapper already COALESCE `['cap_6to10','cap_5to10']` as ONE "6-10 Year"
   cohort, so the two columns were never meant to be separate cohorts.
2. **Round-number pins from thin buckets:** the view had **NO density floor** → 4–6-sale
   buckets pinned `cap_6to10` on **0.0750** for three straight months.
3. **`cap_outside_firm`:** NOT a bug — it IS populated historically (0.070–0.073 through
   2025-05); it went NULL only in recent periods because outside-firm (holdover) sales
   are sparse and fell out of the narrow 1-yr window.

**`cm_gov_cap_by_term_q` is already healthy** (2-yr window, median, n≥5 gate, ±1Q MA,
single `cap_6to10`) — confirmed the smoothing is NOT masking small samples (the n≥5 gate
runs *before* the MA). `cm_gov_sold_cap_by_term_dot` is likewise already gated n≥5. Both
left as-is.

**Fix:** rebuilt `cm_gov_cap_by_term_m` as the **monthly twin of `_q`** — 2-yr TTM
window, median, **n≥5 density floor per cohort** (thin buckets GAP instead of printing a
pinned value), ±3-mo MA, canonical cohorts **10+/6-10/<5/Outside** (matches the legend +
export header). `cap_5to10` retained as a **non-divergent alias** of the canonical 6-10
cohort (so the export coalescing + the column shape are unchanged → grants and the
`v_property_value_signal` dependent untouched). Live after: cohorts move smoothly
(0.0707–0.0728), **0 round-number pins**, `cap_outside_firm` repopulated, `cap_5to10 ==
cap_6to10` always.

**Surfaced (NOT changed — pre-existing, label decision for Scott):** `_m`/`_q` already
exclude [5,6)yr sales from the displayed cohorts (the "6-10" line is [6,10); "<5" is
(0,5]). Up to ~12 sales/period fall in [5,6) and are not shown. Closing that gap
(relabel "<5"→"<6", or "6-10"→"5-10") is a legend/scheme decision, deliberately left
for Scott per "surface the bucket-n table before changing the scheme."

## Unit 3 — dia asking-cap quartiles static → genuinely sticky pool (axis UNTOUCHED)

Root cause identified with receipts; **NO axis change** (per Scott: resolve the data
question first). The flat quartiles are **real**, not a data bug:
- **Sticky long-dwell pool:** the current active dialysis listing pool = **119
  listings**, **median DOM 392 days** (avg 432) — net-lease dialysis listings sit on
  market 13+ months.
- **Static prices:** only **4 / 119** active listings ever had a price change.
- **Frozen caps:** **0 / 141** active listings ever change `last_cap_rate` across their
  (avg 12.4, max 24) monthly snapshots — the asking cap is captured once and, with the
  price static, legitimately never moves.
- **NOT round-value clustering:** 83 distinct cap values across 140 listings; the pinned
  quartile values (0.0586 / 0.0610) carry only ~2.9% of listings each — they're just
  where the 25th-percentile boundary of a stable multiset lands, not a data-entry spike.
- **Amplified (not caused) by the 2-yr replicated window:** the view percentiles run over
  1,734 snapshot rows but only **140 distinct listings** (each replicated ~12×), over-
  weighting long dwellers. Even **current-month-only** quartiles are nearly as flat
  (lq 0.0586→0.0578), so replication is a secondary amplifier, not the root.

**Verdict:** sticky-asking reality. Documented; axis left as-is. *Optional* future
methodology refinement (not a data fix): dedup the quartile to the current-month active
pool (or DISTINCT listing) so the line responds to pool turnover without fabricating
movement — a separate call, gated on Scott. (Secondary observation: median DOM 392d
suggests some listings may be stale-active / zombie — a listing-freshness concern beyond
cap-rate scope.)

## Boundaries / reversibility
Investigated before editing; receipts surfaced (error-vs-real split, bucket-n table,
asking-cap staleness) before any destructive change. Real high-cap comps KEPT; only
confirmed derived calc/ingest errors excluded (reversible flag). Cap basis (NOI/price) +
term basis unchanged. Axis fits reuse the T2 data-fit pattern. ≤12 api/*.js (only
`_shared` injector/renderer + DB views touched). No dia DB change.
