# Claude Code prompt — R2-C: data-integrity (cohort 2025+ gaps, outliers, term-rate 2013, renewal-rate magnitude)

> June-29 round, data-integrity items. Each grounded live. Honest gaps over fake values; investigate outliers;
> re-base inflated magnitudes to true exits. dia `zqzrriwuavgrquhisnoa`, gov `scknotsqkcheojiaewwh`.
> Reversible; no fabrication; ≤12 api/*.js.

## Unit 1 — 10+/core cohort price-change "goes straight to zero" 2025+ (dia Sentiment + Active_DOM_PC; gov Sentiment)
**Grounded:** dia `cm_dialysis_dom_price_change_active_m.pct_price_change_core` = exactly 0.0000 for
2025-12→2026-03 (it had real values through 2025-11). Cause: the recent 10+/core ACTIVE pool is depleted
(T9d moved the undated mass-import OMs off-axis), so the cohort denominator is tiny/empty and the metric
collapses to a hard 0 — which renders as a misleading "straight to zero" cliff. **Fix:** apply a **density
floor** to the cohort metrics — when the cohort's active-listing denominator is below a floor (e.g. n<5),
emit **NULL (gap)**, not 0. Apply to the dia core price-change + the 10+ cap cohort (dia Sentiment), the dia
Active_DOM_PC 10+ price-change, and the gov Sentiment core price-change. So the line ENDS honestly where the
cohort thins, rather than diving to zero. (The underlying recent sparsity is refilled by the date-recovery
project R2-D — this is the honest interim rendering.) Report the periods that flip 0→NULL.

## Unit 2 — outliers (dia Rent_PSF 2023; gov Rent_by_Year_Built 2018 + coverage)
- **dia `cm_dialysis_rent_box_q`:** 2023 upper-quartile = **$68.42 on n=11** (a ~$75 max dragging it; other
  years' uq ~$22-29) — investigate the high-rent outlier(s): is it a **unit error** (annual total rent or a
  mis-parsed value stored as rent/SF) or a real premium lease? If a unit/parse error, correct/exclude it
  (reversible, provenance); if real, keep it but **apply a density floor** (n≥ threshold, e.g. 12) so
  tiny-sample years (2023 n=11, 2026 n=4) gap or are flagged rather than showing a noise-driven box. Report
  the outlier verdict + which years gate.
- **gov `cm_gov_rent_by_year_built`:** Scott — "missing 2021-2026 + several years; 2018 avg rent == upper
  quartile." Investigate: the missing recent build-years (2021-2026) are likely REAL (few gov leases on
  newly-built buildings) — confirm via n_leases and **annotate honestly** (gap, not fabricate). The 2018
  avg==upper-q is a **small-sample** artifact — apply the same density floor so thin year-built cohorts gap.
  Report n_leases per year + which gate.

## Unit 3 — gov Term_Rate 2013 = flat zero (T8-U3 boundary)
**Grounded:** `cm_gov_lease_termination_rate_m` has 12 rows for 2013 all with rate **0.0000** (first non-zero
2014-01) — the snapshot-departure numerator needs a 12mo-prior snapshot, and 2013 (the first snapshot year)
has none, so it computes 0 spuriously. **Fix:** NULL the rate (gap) for any period whose 12mo-prior comparison
snapshot doesn't exist (the first ~12 months / 2013), so the line STARTS at 2014 (first real rate) instead of
showing a fake flat-zero 2013. Combine with the R2-B dataStart so the chart begins at first-real-data. Also
check for any interior "missing year" from a snapshot gap and gap it honestly (don't carry a 0).

## Unit 4 — gov Renewal_Rate magnitudes (the turnover sanity check)
**Grounded:** `cm_gov_lease_renewal_rate_m` recent = 92 first-gen / 113 renewed / **927 expired / 498
terminated** per period — Scott: "huge turnover for ~8,000 leases, is this accurate?" It is NOT: "expired"
counts **firm-term (option-date) expirations**, the vast majority of which RENEW or hold over rather than
leave (same option-date overcounting as T8). 1,425 "out" vs 205 "in" on a stable ~7,500 portfolio is
impossible. **Fix:** re-base the renewal/turnover counts to TRUE lifecycle events — distinguish (a) firm-term
expirations (many, mostly continue) from (b) actual departures (the **snapshot-departure** count from T8-U3)
and (c) renewals/holdovers. The chart should reflect real net turnover (departures ≈ the T8-U3 basis ~600/yr,
not 1,425), with renewals/holdovers shown as continuation, not loss. Reconcile so commencements + renewals
roughly balance true departures on a stable portfolio. Report the re-based magnitudes. (If a full re-base is
large, at minimum relabel/scope so "expired" isn't presented as "left the portfolio" — surface the holdover
share.)

## Gate
- Cohort price-change/cap metrics gap (NULL) below the density floor instead of diving to 0 (periods reported).
- dia 2023 rent outlier triaged (corrected/excluded if error, kept+floored if real); gov rent-by-year-built
  thin years gated/annotated, missing build-years confirmed real. gov Term_Rate 2013 gaps (line starts 2014).
  gov Renewal_Rate re-based to true exits (or at minimum holdover-vs-departure surfaced); magnitudes reported.
- Reversible; no fabricated values (gaps where thin, corrections only on proven errors); ≤12 api/*.js.

## Boundaries
Honest gaps + outlier triage + magnitude re-basing. The recurring theme — option-date expirations are NOT
departures (T8/renewal), and thin cohorts must gap not zero — is the same accuracy doctrine throughout. No
fabricated points.
