# Claude Code prompt — cap-by-term round 2: reconcile ALL cohorts + propagate to the views the chart reads (dialysis)

> Run in **DialysisProject**. Follow-up to the deck-repro pass, which got the
> ≤5 cohort right but (a) pushed 12+ too high / left 6–8 too low, and (b) only
> updated `cm_dialysis_cap_by_term_m` — which is NOT the view the chart reads.
> The export pipeline reads `cm_dialysis_sold_cap_by_term_dot` (and the dia
> master_m cohort columns), so the fix never reaches the workbook. This is the
> same two-view trap that hit NM-vs-Market (R66w).

```
GOAL: one cap-by-term definition that matches ALL FOUR deck cohorts at the
labelled dates, applied consistently to EVERY view the charts consume.

## Deck targets (ground truth, p.22 "The Dialysis Market Filter", Dec-2025 TTM)
  12+ yr = 6.89%   8-12 yr = 6.84%   6-8 yr = 7.28%   <=5 yr = 8.29%
Also: <=5 peak 9.46% (Nov-2019) / trough 6.06% (Aug-2022); 12+ 5.84% (2019) /
5.08% (2022). Term premium longest->shortest ~140 bps.

## Current state (live, Dec-2025) — three sources disagree
| view                                | 12+   | 8-12  | 6-8   | <=5   |
|-------------------------------------|-------|-------|-------|-------|
| deck (target)                       | 6.89  | 6.84  | 7.28  | 8.29  |
| cm_dialysis_cap_by_term_m (repro'd) | 7.25✗ | 6.70  | 6.87✗ | 8.23✓ |
| cm_dialysis_sold_cap_by_term_dot    | 6.80✓ | 6.70  | 6.81✗ | 7.34✗ |
| dia master_m cohort cols (export)   | ~7.2x | ~6.7x | ~6.9x | ~7.8x |
Note the diagnostic: the OLD definition's 12+ (6.80) matches the deck; the NEW
definition's <=5 (8.23) matches the deck. The repro's cap-field/bucketing change
fixed the short cohorts but DEGRADED 12+ (+36 bps) and didn't lift 6-8. Likely a
per-cohort interaction (e.g. the cap field that's correct for short-remaining-term
deals differs from what long-term deals carry, or the bucketing change moved some
low-cap deals out of 12+).

## Tasks
1. RECONCILE. Starting from the repro'd definition, find why 12+ rose +45 bps vs
   the old definition (which deals entered/left the 12+ bucket, or which cap
   values changed). Adjust so ALL FOUR cohorts land within ~15-20 bps of the deck
   at Dec-2025 AND the 2019/2022 labelled points. Document the final cap-of-record
   rule + bucket edges. Do not accept a definition that fixes one cohort by
   breaking another.
2. PROPAGATE to every consumer (this is mandatory — the chart does NOT read
   cap_by_term_m):
   - cm_dialysis_sold_cap_by_term_dot  (the sold_cap_by_term_dot_plot chart source)
   - cm_dialysis_cap_by_term_m / _q
   - the dia master_m cohort columns (cap_12plus / cap_8to12 / cap_6to8 /
     cap_5orless in cm_dialysis_market_quarterly_master_m) — the export's dia
     cap_rate_by_lease_term verticalMapper reads THESE
   - cm_dialysis_asking_cap_by_term_m if the same cap-of-record rule applies
   All four series must return IDENTICAL cohort values for the same period
   (one definition, several grains).
3. ACCEPTANCE EVIDENCE in the migration: before/after cohort values at Dec-2025
   and the 2019/2022 labelled points for EACH view, vs the deck targets.

## Validate
- All consumer views agree with each other and with deck p.22 within ~20 bps at
  the labelled dates; cohorts fan out ~140 bps with <=5 highest, 12+ lowest.
- A fresh workbook export shows the deck-matching values on Data_Sold_Cap_by_Term
  (i.e., the values reached the view the chart actually reads).
```
