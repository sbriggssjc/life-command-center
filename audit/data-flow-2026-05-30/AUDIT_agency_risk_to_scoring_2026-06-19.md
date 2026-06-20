# Audit — tenant/agency risk → investment-scoring propagation (gov, 2026-06-19)

**Question (Scott):** as agency/tenant risk is ingested — renewals, footprint reductions,
DOGE/RIF pressure, OPM workforce, agency credit — does it flow into `investment_scores` + risk
flags, or freeze at first computation? The "does the deal grade improve as we learn" loop.

## Verdict: the score RE-RUNS, the signals ARE ingested — but the grade is BLIND to risk (and the one incidental correlation runs backwards)

### What works
- **Scores recompute (not frozen).** `investment_scores`: 19,124 rows, model `v2`, scored
  2026-03-05 → 2026-06-15, ~8,800 rescored in the last 90 days. The engine reruns.
- **Risk signals ARE ingested and propagated to `properties`.** `agency_risk_level` is 100%
  populated with a real distribution (none 5,122 / moderate 5,951 / elevated 1,449 / high 10);
  `opm_headcount` + `hiring_signal_count` 100% populated. Source tables:
  `agency_risk_signals` 8,352 composite rows **fresh today (2026-06-15)**,
  `federal_lease_awards` 9,966 fresh, plus `reduce_footprint` set on 16,352 of 16,609 leases
  (**8,971 = 55% flagged true**).

### The gap (headline) — the score does not consume any of it
The `v2` model has 6 factors — lease_term, credit_quality, location_tier, rent_vs_market,
**renewal_prob**, building_quality — and **none is an agency-risk / footprint-reduction /
workforce factor.** Empirically the grade is blind to risk:
- **Flat/scrambled across `agency_risk_level`:** avg total score none 18.92 < elevated 19.38 <
  moderate 19.76; grades A–D appear at every risk level. No monotonic relationship (if risk fed
  the score, `none` would score highest and `high` lowest).
- **The footprint-reduction correlation runs BACKWARDS:** leases flagged
  `reduce_footprint=true` carry a **higher** renewal_prob (4.42 vs 4.21) and **higher** total
  score (20.01 vs 19.29) than un-flagged ones. A footprint-reduction signal should *lower*
  renewal probability and the grade — instead the grade nudges up. Proof the signal isn't an
  input; the slight delta is unrelated-factor noise pointing the wrong way.

So the most decision-relevant, most-timely risk data — an agency reducing footprint or under
DOGE/RIF pressure, which is *the* story in gov-leased real estate right now — is computed and
stored but never reaches the deal grade the operator/BD uses to prioritize. A property whose
tenant agency just went high-risk looks the same grade as a stable one. Classic
captured-but-not-fed-back break.

### Secondary
- **Stale feeds.** `opm_agency_location_rollups` (last 2026-03-17), `usajobs_market_signals`
  (2026-03-17, only 222 rows), `sam_lease_opportunities` (2026-04-13) are 2–3 months old, while
  `agency_risk_signals` + `federal_lease_awards` are fresh. Even inputs that *could* feed the
  score are partly stale.
- **No visible risk overlay.** The grade is the only headline; with risk excluded there's no
  risk-adjusted view for the operator.

## Fix doctrine → R49 (model-registry discipline; gated)
The natural home is the existing **renewal_prob** factor — agency stability + footprint reduction
*directly* drive renewal probability, which is already a factor but today is lease-history-only.
Make it risk-aware (consume `agency_risk_level` + `reduce_footprint` + workforce trend), keeping
the 0–30 scale. Because this **moves `deal_grade`** for many properties and the grade feeds BD
prioritization:
- **Adopt a new model version (`v3`), don't mutate `v2`** (model-registry discipline) — compute
  v3 alongside v2 so we can diff before promoting it to the live `deal_grade`.
- **Before/after grade-distribution + Scott sign-off** before the risk-aware grade is relied on
  (same posture as published-metric changes).
- **Refresh the stale feeds** (OPM/USAJobs/SAM crons) so the inputs are current.
- **A visible risk overlay/flag now** (no grade change) makes risk actionable immediately,
  independent of the model promotion.

## Scope fork for Scott (asked before building)
- **A — make renewal_prob risk-aware (v3), grade shifts** — the "make the score honest" fix.
- **B — risk overlay only** — keep the 6-factor grade unchanged; surface a separate
  risk flag / risk-adjusted view + refresh stale feeds. Lowest blast radius, no sign-off gate.
- **C — both** — overlay + feed refresh now, v3 model as a gated follow-up after a before/after.

## Bottom line
The scoring engine reruns and the risk signals are ingested and on the property — but the deal
grade ignores them, and the one incidental footprint-reduction correlation points the wrong way.
In the current DOGE/RIF/footprint-reduction environment that's a material gap: the grade should
fall as an agency's stability falls. R49 makes renewal_prob risk-aware as a gated v3 model (don't
mutate v2; before/after; sign-off), refreshes the stale workforce feeds, and adds a visible risk
overlay so risk is actionable immediately.
