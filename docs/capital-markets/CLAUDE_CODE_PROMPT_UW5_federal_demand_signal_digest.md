# Claude Code prompt — UW#5: federal demand-signal DIGEST (FRPP / SAM / USASpending / USAJOBS → gov properties)

> From the underwriting data-quality audit. The federal demand-signal layer that powers the gov
> OM/BOV narrative AND agency-credit / renewal-risk underwriting is **richly ingested but thinly
> digested** onto gov.properties — the SAME pattern as UW#1 (county). Apply the UW#1 discipline:
> ground the link path + real-value rate in a DRY-RUN before trusting any raw count; fill-blanks;
> provenance-gated; reversible; no fabrication. **Watch for zero-sentinels and unlinked rows — the
> UW#1 "6,365 → 64 real" lesson is the prior here.**

## Grounding (live, 2026-06-20)
Raw demand-signal tables are full: `frpp_annual_snapshots` 579,781, `frpp_facility_trends` 365,622,
`frpp_records` 21,947, `opm_agency_location_rollups` 31,365, `opm_workforce_monthly` 31,365,
`federal_lease_awards` 9,966, `agency_risk_signals` 8,352, `sam_lease_opportunities` 6,465,
`usajobs_postings` 797, `usajobs_market_signals` 479, `mv_doge_agency_summary` 26.
But gov.properties (n≈12,559 active) carries: **opm_headcount 98% + workforce_trend 98% (already
digested — leave alone)**; federal_employee_count **11%**, sam_active_opportunities **20%**,
total_federal_investment **2%**, hiring_signal_count **0%**, agency_canonical 35%. So the OPM
agency-level signal is done; the **building-level (FRPP) + activity (SAM / USASpending / USAJOBS)**
signals are the digest gap.

## DRY-RUN FIRST (the gate — do this before any write, report the real fillable counts)
For each target field, compute how many properties resolve to a REAL (non-zero, non-sentinel) source
value via an actual link — do NOT report raw table row counts as the lever:
1. **federal_employee_count** ← FRPP. Resolve property→FRPP via `linked_frpp_id` (and/or address);
   count properties where the FRPP record carries a real employee/occupancy figure AND the property
   field is NULL. (FRPP has 22k records but verify how many LINK + carry a real headcount — UW#1's
   parcel rows were 85% "populated" but 2% real.)
2. **sam_active_opportunities** ← `sam_lease_opportunities`, matched by agency + location/proximity.
3. **total_federal_investment** ← `federal_lease_awards` / USASpending, by agency + location.
4. **hiring_signal_count** ← `usajobs_postings` / `usajobs_market_signals`, by agency + metro.
5. **agency_risk_level / renewal_risk_tier** ← `agency_risk_signals` / `mv_doge_agency_summary`
   (the DOGE/workforce-trend signal — materially relevant to 2026 federal-workforce/RIF credit).
Report the per-field real-fillable counts to the gate. If a source is thin (e.g. usajobs_postings is
only 797) or mostly unlinked, SAY SO — under-deliver honestly rather than write sentinels.

## Build (after the dry-run gate passes)
A digest pass mirroring UW#1's `*_digest_property` pattern:
- A per-property `gov_demand_digest_property(property_id)` function + a one-shot backfill, resolving
  each source by the link path above, **fill-blanks only**, routed through the gov provenance gate
  (`check_provenance_allows_write` / `field_value_provenance`, `source='federal_demand'` at a
  sensible authority rank — public-feed tier), **rejecting ≤0 / sentinel values** (the explicit
  UW#1 fix). Reversible log. Idempotent (re-run = 0).
- Forward path: call the digest on each property after a new FRPP/SAM/award/USAJOBS ingest (or a
  gentle cron), so the signals stay current — the federal-workforce picture moves.
- Where it feeds underwriting: surface the digested signals in the property context packet / the gov
  OM-master + BOV demand narrative (agency, headcount + trend, hiring, solicitations, investment,
  DOGE/risk) — the "why this tenant stays" story + the renewal-risk input. (Wiring to the work
  products can be a thin follow-up if it balloons scope; the digest is the deliverable.)

## Boundaries / gate
- Dry-run real-fillable counts FIRST, to me, before any write (non-negotiable — UW#1 rule).
- Fill-blanks only; provenance-gated; reject ≤0/sentinels; reversible; idempotent; ≤12 api/*.js.
- Leave opm_headcount / workforce_trend alone (already 98%). No fabrication — a property that doesn't
  resolve to a real source value stays NULL. dia untouched (federal demand is gov-only).
- My gate: dry-run counts are honest (real links, not raw rows; sentinels excluded); real write lifts
  the target fields without clobbering curated values; idempotent re-run = 0; load-bearing caches
  rebuild clean; the values spot-check as real (e.g. a known DC/agency building shows a plausible
  headcount + agency + risk tier).

## Why it matters (the underwriting case)
gov rent/term/cap is already strong; what the OM/BOV narrative + renewal-risk lacks is the DEMAND
story — who occupies, how big, whether the agency is growing/shrinking, hiring, soliciting, funded,
and the DOGE/workforce-trend credit signal. In the 2026 federal-workforce environment that signal is
genuinely material to gov-leased renewal risk, not just marketing color.
