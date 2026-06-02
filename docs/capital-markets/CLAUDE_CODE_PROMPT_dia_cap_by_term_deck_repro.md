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
