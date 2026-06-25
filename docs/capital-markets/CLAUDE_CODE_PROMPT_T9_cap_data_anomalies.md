# Claude Code prompt — T9: cap-rate data anomalies (investigate, then fix; data before axis)

> Scott's June-25 review flagged three cap-data integrity issues. Each is INVESTIGATE-then-fix — resolve
> the data first; axis changes only after. Receipts below are grounded live. gov `scknotsqkcheojiaewwh`,
> dia `zqzrriwuavgrquhisnoa`. Reversible; surface findings before destructive edits; don't fabricate.

## Unit 1 — gov core-cap dot-plot outliers (the concrete one)
`cm_gov_core_cap_dot_q` ← `cm_gov_core_cap_rate_dots`, filtered firm_term ≥6, cap 0.04–0.12. Distribution:
n=503, p50 **6.95%**, p90 7.89%, p95 **8.0%**, max 11.97%. **6 sales sit in the 9–12% band** (the
visible outliers), and **13 more above 12%** (up to 26.8%) are already filtered out by the ≤0.12 bound.
The 6 in view (sale_date, cap, sold_price, firm_term):
- 2023-04-06 · 12.0% · $4.55M · 7.0yr
- 2007-04-01 · 11.2% · $19.5M · 10.7yr
- 2016-02-12 · 10.75% · $56.6M · 7.3yr
- 2004-08-12 · 10.7% · $5.65M · 9.3yr
- 2006-06-16 · 10.5% · $7.58M · 9.7yr
- 2015-07-01 · 10.1% · $19.4M · 8.8yr

**Do:** join each (and the 13 >12%) to `sales_transactions` for address/tenant/NOI, and **re-derive cap =
NOI / sold_price**. Where the stored cap ≠ NOI/price (a calc/ingest error), correct or exclude it
(reversible, provenance-tagged). Where it's a genuine high-cap deal (distressed / short effective term /
secondary market), KEEP it — don't delete real comps. **Report the error-vs-real split.** Then set the
core-cap dot plot (and the gov `sold_cap_by_term_dot` it feeds) y-axis ceiling to **~9%** (data-fit
excluding confirmed errors, via the T2 `fitDataAxisRange`), so the trendline reads with robust movement.
A 10–12% cap on 6+ firm-term gov is atypical (p95 is 8%), so expect several to be errors — but confirm,
don't assume.

## Unit 2 — gov cap-by-term duplicate/erratic cohorts
`cm_gov_cap_by_term_m` recent rows show **`cap_6to10` == `cap_5to10` (identical values)**, both pinned on
round numbers (0.075 repeated), `cap_outside_firm` all NULL, and `cap_10plus` the only cohort that moves.
That's why the chart reads erratic/flat depending on period. **Do:** (a) resolve the **duplicate cohort
columns** — determine the intended gov bucket scheme (the chart legend is 10+/6-10/<5/Outside) and make
each column a DISTINCT cohort (the `cap_5to10`/`cap_6to10` overlap is a view bug); (b) report **n per
bucket per period** — the round-number pins (exact 0.075) signal 1–2-sale buckets; add/raise the
**density floor** (mirror the dia n≥5 gate) so thin buckets gap rather than print a pinned value; (c)
check `cap_outside_firm` (all NULL — is the cohort populated at all?). Apply the same review to
`cm_gov_cap_by_term_q` / `cm_gov_sold_cap_by_term_dot` (both carry a window MA — confirm the smoothing
isn't masking the small-sample problem). Surface the bucket-n table before changing the scheme.

## Unit 3 — dia asking-cap quartiles static (investigate; axis deferred)
`cm_dialysis_asking_cap_quartiles_active_m` quartiles barely move — `lower_q_core` pinned at exactly
**0.061** and `lower_q_total` at ~**0.0586** for many consecutive months; `upper_q_total` ~7.0–7.1%.
**Investigate the cause before any axis change** (Scott: "resolve the data first"): (a) are active
listings carrying **stale asking caps** (a cap captured once and never refreshed as price/listing
changes)? check the spread + last-update of `last_cap_rate` on the active pool over time; (b) are asking
caps **clustered on round values** (data-entry artifact) so the percentile boundary lands on the same
value repeatedly? (c) is the active pool too small/stable for quartiles to move? **Report which.** If it's
stale/clustered data, remediate at the source (refresh asking caps / dedupe round-value clustering); if
it's genuinely a sticky-asking-pool reality, document it (and only then consider the axis). Do NOT adjust
the y-axis until the data question is answered.

## Gate
- Unit 1: the 6 (+13) outliers triaged error-vs-real with re-derived caps; confirmed errors corrected/
  excluded (reversible, provenance), real ones kept; core-cap + gov sold-cap-by-term ceiling ~9%
  (data-fit). Report the split + the new fit.
- Unit 2: gov cap-by-term cohort columns are distinct (no dup), density-floored (thin buckets gap, no
  round-number pins), bucket-n table reported; cap_outside_firm explained.
- Unit 3: root cause of the flat asking quartiles identified with receipts (stale / clustered / small-pool);
  remediated if a data bug, documented if real; axis untouched pending that answer.
- Reversible; no fabricated caps; real comps not deleted; ≤12 api/*.js. dia + gov.

## Boundaries
Investigate before edit; surface receipts (error-vs-real split, bucket-n table, asking-cap staleness)
before destructive changes. Keep real high-cap comps; exclude only confirmed calc/ingest errors. Cap
basis (NOI/price) and term basis unchanged except to CORRECT a proven error. Axis fits reuse the T2
`fitDataAxisRange` helper.
