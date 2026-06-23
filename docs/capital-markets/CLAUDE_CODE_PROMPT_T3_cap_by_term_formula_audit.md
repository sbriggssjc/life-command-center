# Claude Code prompt — T3: verify the cap-by-term bucket formula + storage (are the lines smooth or wrong?)

> Catalog topic **T3** (Scott's recurring deep concern: dia 7/13/14, gov 19/31 — "Are the formulas
> correct for each bucket? Are we storing each sale correctly? TTM avg cap moving monthly per
> lease-term-remaining bucket"). This is a **verification audit** — confirm correctness with receipts;
> only fix if a bug is found. Do NOT manufacture movement. dia `zqzrriwuavgrquhisnoa`, gov
> `scknotsqkcheojiaewwh`.

## Receipts (grounded 2026-06-23 — points to "correct, just small-sample")
Lease-term-remaining-at-close is stored as **`firm_term_years_at_sale`**; cap as **`cap_rate_final`**;
the dia view is **`cm_dialysis_cap_by_term_m`** (gov: the parallel `cm_gov_cap_by_term_m`).
Independent spot-check, dia latest month (2026-03), **12+ bucket**: raw recompute
(TTM trailing-12-mo, `firm_term_years_at_sale>=12`, avg `cap_rate_final`, excl.
`exclude_from_market_metrics`) = **0.0678**, view = **0.0676**, chart = **0.068** — reconciles within
~2bps. The trailing-12-mo 12+ bucket has **n=5 sales** — so the flat line is likely genuine small-n
smoothing, not a bug. The term ladder is sane (≤5yr 7.4% → 12+ 6.8%).

## The audit (both DBs, both sold + asking views)
1. **Full-series recompute & diff.** Recompute the entire cap-by-term monthly series from raw
   `sales_transactions` (bucket by `firm_term_years_at_sale`, TTM trailing-12-mo window, avg
   `cap_rate_final`, exclude flagged) and diff cell-by-cell against `cm_*_cap_by_term_m`. Report any
   cell that diverges > a few bps and the cause (window edge, weighting, bucket boundary, cap-field
   choice). Confirm the bucket boundaries (≤5 / 6-8 / 8-12 / 12+ on dia; the gov cohorts) match the
   chart legend and have no overlap/gap (e.g. a 5-6yr sale must land in exactly one bucket).
2. **Bucketing-input correctness (the thing that silently corrupts buckets).** Verify
   `firm_term_years_at_sale` is computed correctly per sale = (`firm_term_expiration_at_sale` −
   `sale_date`) in years, sourced/locked sanely (`firm_term_source`, `firm_term_locked`). Spot-check
   ~10 sales against their lease. Report how many sales have a NULL/zero/implausible
   `firm_term_years_at_sale` (those silently drop out of every bucket or mis-bucket) — that is the most
   likely real defect if one exists.
3. **Sample-count transparency (answers "why so smooth").** Report **n per bucket per period** over
   time (e.g. annual avg n per bucket). If buckets carry ~5-15 sales per trailing year, the TTM line is
   smooth *correctly* — surface that to Scott rather than forcing movement. If a bucket has so few that
   the line is meaningless in some years, note it (candidate for the existing density floors, not a fix).
4. **Verdict, receipts-first.** State plainly: is the cap-by-term series (a) computed correctly and the
   smoothness is small-sample reality, (b) correct but mis-bucketed for a subset (firm_term nulls), or
   (c) a formula bug. Only (b)/(c) get a code fix; (a) gets documented so we stop re-litigating it.

## Boundaries
Verification first — no view rewrite unless a diff proves a bug. If the only finding is small-n
smoothness, the deliverable is the documented verdict + the per-bucket n table, NOT a manufactured
"smoother→choppier" change. Reversible. No chart-range change (that's T1, done). Keep `cap_rate_final`
as the authoritative cap field unless the diff shows otherwise.
