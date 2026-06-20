# Claude Code — R49: make gov investment scoring risk-aware (overlay now + gated v3 model)

## Why (audit live 2026-06-19 — see AUDIT_agency_risk_to_scoring_2026-06-19.md)
The gov investment score RE-RUNS (19,124 scored, model `v2`, last 2026-06-15, ~8,800 in 90d) and
the risk signals ARE ingested + on `properties` — but **the deal grade is blind to risk**:
- `v2` 6 factors (lease_term, credit_quality, location_tier, rent_vs_market, **renewal_prob**,
  building_quality) include NO agency-risk / footprint / workforce factor.
- Grade is flat/scrambled across `agency_risk_level` (none 18.92 < elevated 19.38 < moderate
  19.76) — no monotonic risk relationship.
- **The footprint-reduction correlation runs BACKWARDS:** `reduce_footprint=true` leases score
  *higher* (renewal_prob 4.42 vs 4.21, total 20.01 vs 19.29) than un-flagged — proof the signal
  isn't an input.
- Signals available: `properties.agency_risk_level` (none/moderate/elevated/high, 100% pop),
  `reduce_footprint` (8,971/16,352 leases = 55% true), `agency_risk_signals` (8,352 composite,
  fresh), `opm_headcount`/`hiring_signal_count` (100% pop). Stale feeds:
  `opm_agency_location_rollups` (2026-03-17), `usajobs_market_signals` (2026-03-17, 222 rows),
  `sam_lease_opportunities` (2026-04-13).

**Scope (Scott, 2026-06-19): BOTH — overlay now + gated v3 model.** This is a **GovernmentProject**
(Python) change (`src/investment_scorer.py` et al.), not the LCC 12-function repo.

## House rules
Model-registry discipline (DialysisProject doctrine): **adopt a new model version, don't mutate
v2** — v2 rows/logic stay intact; v3 is computed ALONGSIDE. The risk-aware grade does NOT replace
`deal_grade` / `properties.deal_grade` until Scott signs off (gated behind config, mirror the
`DECISION_*_WRITEBACK` pattern). Reversible. Before/after grade-distribution required. gov-only
(dia scoring is a separate financial-estimate model — out of scope). Branch/PR per GovernmentProject
CLAUDE.md; `python -m pytest tests/ -x -q` green; `py_compile` clean. Cap rates / published CM
numbers untouched.

## Unit 1 — risk overlay + feed refresh (ships now, no grade change, no sign-off)
1. **Visible tenant-risk overlay** that does NOT touch `total_score`/`deal_grade`: a derived
   `risk_flag` (e.g. none/watch/elevated/high) + `risk_reasons` (agency composite risk +
   `reduce_footprint` + workforce trend) per property, surfaced ALONGSIDE the grade (a view
   `v_property_risk_overlay` and/or columns the gov UI + any LCC grade surface can show). This
   makes risk actionable immediately while v3 is validated.
2. **Refresh the stale feeds** so inputs are current: re-run / fix the ingestion crons for
   `ingest_opm_workforce` (OPM rollups), `ingest_usajobs` (only 222 rows — confirm the pull is
   working, not just stale), `ingest_sam_opportunities`. Report row-count + recency before/after.
3. Optional (flag if cheap): surface the overlay as a signal on the LCC side so a high-risk,
   high-value property reads as a disposition-urgency cue — but do NOT change the rent-based
   queue rank.

## Unit 2 — risk-aware renewal_prob as a gated v3 model (don't mutate v2)
The natural home is the existing **renewal_prob** factor — agency stability + footprint reduction
directly drive renewal probability. Build `v3`:
- `renewal_prob` v3 consumes `agency_risk_level` + `reduce_footprint` (+ workforce trend where
  available) so an unstable/footprint-reducing tenant LOWERS renewal_prob (fix the current
  backwards behavior). Keep the 0–30 total scale + the other 5 factors unchanged.
- Compute v3 ALONGSIDE v2 (`scoring_model='v3'` rows, or a parallel `total_score_v3`/`deal_grade_v3`
  — your call, but v2 stays readable for the diff). Do NOT overwrite v2 rows.
- **`properties.deal_grade` / `investment_score` stay on v2** until promotion. Gate the promotion
  behind config (e.g. `SCORING_MODEL_ACTIVE=v3` / a model_registry `is_current` flip) so flipping
  it is a one-line, reversible change once Scott signs off.
- Produce a **before/after grade-distribution** (v2 vs v3: A/B/C/D counts, how many properties
  move grade, the biggest movers — especially high-risk/footprint-reduction properties that
  SHOULD drop). That diff is what Scott reviews before promotion.

## Verify (report back)
- Unit 1: overlay view live + a spot-check (a high-risk + reduce_footprint property reads
  `risk_flag=high/elevated`); feed-refresh row-count + recency before/after.
- Unit 2: v3 computed alongside v2 (v2 untouched — same row count/values); before/after grade
  distribution; confirm `reduce_footprint=true` / `agency_risk='elevated'/'high'` now scores
  LOWER on renewal_prob under v3 (the backwards correlation corrected); `deal_grade` still v2
  (promotion gated, unflipped); reversible.

## Bottom line
The grade reruns and the risk data is on the property — it just never reaches the score. R49 makes
risk visible immediately (overlay + fresh feeds, no grade change), and builds a risk-aware v3
renewal_prob computed alongside v2 with a before/after diff, promoting to the live deal_grade only
on Scott's sign-off — so the grade finally falls as a tenant agency's stability falls, gated and
reversible.
