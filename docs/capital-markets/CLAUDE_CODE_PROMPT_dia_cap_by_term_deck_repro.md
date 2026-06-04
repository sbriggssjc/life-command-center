# Claude Code prompt — reproduce the deck's Cap-Rate-by-Lease-Term numbers (dialysis)

> Run in **DialysisProject**. This is EXPLORATION-FIRST: the published deck
> ("The Dialysis Market Filter" p.22) shows specific cohort cap rates that our
> export does not match. The deck is built from the same universe of sales, so
> the data exists — the task is to find the cap field + term bucketing +
> smoothing that REPRODUCES the deck, then point the chart view at it. Do NOT
> conclude "data missing" until you've proven the deck's numbers can't be
> reconstructed from `sales_transactions`.

```
GOAL: make cm_dialysis_cap_by_term (the Sold-Cap-by-Term / Cap-Rate-by-Lease-
Term chart) reproduce the published deck values, because the deck proves the
data exists and we are computing it wrong.

## Ground truth (deck p.22, "Cap Rate Comparison: The Value of Lease Term")
At year-end 2025 (Dec-2025), TTM averages:
  12+ yr  = 6.89%
  8-12 yr = 6.84%
  6-8  yr = 7.28%
  <=5  yr = 8.29%   (term premium longest->shortest ~140 bps)
Earlier reference points the deck labels: <=5 hit 9.46% (Nov-2019) and 6.06%
(Aug-2022); 12+ hit 5.84% (2019) and 5.08% (2022). Use these as fixed targets.

OUR CURRENT OUTPUT (same dates) reads the SHORTER cohorts progressively too LOW:
  12+ 6.86% (ok)  /  8-12 6.61% (-23bp)  /  6-8 6.68% (-60bp)  /  <=5 7.39% (-90bp)
Pattern: high-cap short-term deals are landing in longer-term buckets (or being
dropped), which both starves <=5 of its high-cap deals and flattens the spread.

## Environment
- Supabase "Dialysis_DB", ref zqzrriwuavgrquhisnoa, schema public.
- View today: cm_dialysis_cap_by_term_q / _m. Cap source COALESCE(cap_rate_final,
  calculated_cap_rate, stated_cap_rate); term = firm_term_years_at_sale; TTM
  pooled; smoothed. Migrations live in this repo (feature branch, PR).

## Exploration tasks (do these in order, report findings before changing views)
1. CAP FIELD. For dia sales, tabulate the four candidate cap fields
   (cap_rate_final, calculated_cap_rate, stated_cap_rate, raw cap_rate) by
   cohort and date. Which field (or COALESCE order) makes the <=5 cohort reach
   ~8.3% at Dec-2025 and ~9.5% at the 2019 peak? The deck's <=5 is HIGH, so the
   current COALESCE may be picking a too-low (e.g. inflated-denominator
   calculated) cap for short-term deals. Find the field that matches the deck.
2. TERM BUCKETING. For the sales in each quarter, print the firm_term_years_at_sale
   distribution and spot-check 15-20 recent <=5-expected deals (short remaining
   term, high cap). Are they being assigned a term that's too LONG (so they fall
   into 6-8 / 8-12 instead of <=5)? Quantify how many high-cap (>8%) sales sit in
   the 6-8 / 8-12 buckets that, by their actual remaining term, belong in <=5.
3. SMOOTHING / POOLING. Confirm the TTM pool + smoothing isn't compressing the
   spread (the deck's lines clearly separate ~140 bps; ours ~50 bps). Test the
   cohort series with and without the centered smoothing.
4. REPRODUCE. Produce a query whose four cohort series match the deck targets
   within ~15-20 bps at the labelled dates. Document exactly which cap field,
   term definition, bucket edges, and pooling/smoothing reproduce the deck.

## Then fix
- Repoint cm_dialysis_cap_by_term_q/_m to the reproduced definition. Keep the
  4 dia cohorts (12+/8-12/6-8/<=5). Record a migration with the before/after
  cohort values at the deck's labelled dates as the acceptance evidence.

## Validate
- The four cohorts FAN OUT to ~140 bps with <=5 highest (8-9% at the 2019 peak
  and ~8.3% recent), 12+ lowest, matching deck p.22 within ~20 bps.

## Constraints
- Don't fabricate. If, after the above, a cohort genuinely cannot reach the deck
  value from any field/bucketing, say so with the evidence (which deals are
  missing and why) — but the strong prior is that the data is present and the
  current cap-field / bucketing choice is the issue.
```

---

## FINAL RESOLUTION — cohort definition of record (2026-06-04, Scott's call)

The exploration above ran to ground over the Round 66x / 66x.2 data-integrity
arc. The chart does **not** need to numerically reproduce the deck, because the
two answer different questions. Decision: **the broad universe ships.** Keep the
full-market cohorts (`cm_dialysis_sold_cap_by_term_dot` and the `_m`/`_q`
consumers that read it) exactly as they are.

### The two series are different populations — both correct
- **Our chart = the full market universe.** Every dia sale we can cap- and
  term-resolve, reconciled **deal-by-deal against the firm's curated comp
  workbook wherever the two overlap** (cap-fingerprint verified to ≤5bp — the
  same identity test that drove the Round 66x.2 cap/term adjudication and the
  master-address backfill). Where the master is authoritative we adopt its
  cap/term/address; where it is silent the market deal still counts.
- **The deck = the firm's curated comps only.** A deliberately narrower set,
  and it **includes >12% prints that our market view excludes by policy**
  (`dia_flag_suspect_cap_rate`, threshold 0.12 → `exclude_from_market_metrics`).

### Why the residual gap is expected, not a defect
The 2019 `≤5` cohort is the sharpest example. The deck's `≤5` is curated-only and
keeps high-cap credit-impaired prints we suppress. The **23.93% Midwest City
deal (sale_id 8117) alone is ≈ 50 bps of the 2019 `≤5` gap.** The rest is the
universe difference (our cohort blends curated deals with non-curated market
deals at lower caps). Neither side is wrong — they are the market vs. the curated
book. This is documented end-to-end in the Round 66x.2 migration headers
(`20260712_cm_round66x2_step3_r2_term_backfill_from_master.sql` carries the
honest 2019 finding).

### Reproducibility of the deck
The deck remains **fully reproducible from the master workbook** on demand
(`scripts/master_sales_comps_full.json` + the deck cohort definition). We do not
need to bend the live chart to it. When a curated-only cut is wanted, build it
from the master; the live cap-of-record ladder (`dia_derive_cap_of_record` →
`cap_rate_final`) continues to serve the market view.

**Net:** chart = market (reconciled against curated where they meet); deck =
curated (incl. policy-excluded >12% prints). One cap-of-record (`cap_rate_final`)
feeds every consumer view; no per-view cap logic. Arc closed.
