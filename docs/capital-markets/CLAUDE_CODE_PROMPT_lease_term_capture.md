# Claude Code prompt — capture & repair firm lease term remaining at sale (dialysis)

> Run in the **DialysisProject** repo. This is the audit's #1 data gap and is the single
> highest-leverage data fix remaining: it un-sticks the lease-term cohort charts AND the
> thin-"10+ year" cohorts on four other Capital Markets charts. Related to but separate from
> the rent/cap/initial_price/listing_date master prompt (those fix value fields; this fixes
> the LEASE TERM dimension that the cohort splits depend on).

```
Improve the coverage and accuracy of "firm lease term remaining at sale" for dialysis sales,
so the lease-term cohort charts separate cleanly and the 10+ year cohorts on other charts
stop being starved.

## Environment
- Supabase "Dialysis_DB", ref zqzrriwuavgrquhisnoa, schema public. Use the Supabase MCP/CLI.
- Migrations + ingestion code live in this repo. Follow repo git rules (feature branch off
  origin/main, PR, copy/paste merge + test commands). Record provenance; never clobber a
  manual override.

## How term is currently resolved (read before changing)
Charts derive the lease-term-at-sale on the fly with a correlated subquery against `leases`:
  for each sale s, pick the lease on s.property_id whose [lease_start, lease_expiration]
  brackets s.sale_date (lease_expiration >= sale_date AND (lease_start IS NULL OR
  lease_start <= sale_date)), ordered by lease_expiration DESC, and compute
  firm_term_years = (lease_expiration - sale_date) / 365.25.
A sale with NO bracketing lease row resolves to NULL term and is DROPPED from every term
cohort. Wrong/short expiration dates push deals into the wrong bucket.

## The symptom (measured 2026-06-01)
- Coverage: only ~26% of dia market sales (≈691 of 2,703) have BOTH a usable cap (4-12%)
  AND a resolvable firm term. The rest are dropped from the term charts.
- The Cap-Rate-by-Lease-Term chart (deck p.22) is compressed/tangled vs the deck. Our LONG-
  term cohort matches the deck (12+ yr: ours 6.82% vs deck 6.89% at Dec-2025) but the SHORTER
  cohorts sit progressively below the deck and the gap widens as term shortens:
    8-12 yr: ours 6.58% vs deck 6.84% (-26 bps)
    6-8  yr: ours 6.77% vs deck 7.28% (-51 bps)
    <=5  yr: ours 7.28% vs deck 8.29% (-101 bps)
  The <=5 cohort should be the HIGHEST line (least term premium) but only reaches ~7.3% vs the
  deck's 8.3-9.5%. Pattern = short/mid-term deals are mis-bucketed LONGER than they really are
  (a longer resolved term drags a high-cap short deal into a lower-cap longer bucket), and/or
  the genuine short-term deals lack lease rows and are dropped.
- Downstream thin-cohort starvation (same root): the "10+ year" cohort is 0-4 deals/yr after
  2020 on Seller Sentiment, Asking Cap Quartiles, Available Market Size, and DOM & Price-
  Change — forcing aggressive n-gates and blank stretches on all of them.

## Tasks
1. QUANTIFY coverage and accuracy.
   - For dia sales (sale_date NOT NULL, sold_price>0, not exclude_from_market_metrics,
     usable cap): what share resolve a firm_term_years? Break the NULLs down by cause:
     (a) property has zero lease rows, (b) has leases but none bracket sale_date (gap /
     wrong dates), (c) lease_expiration is NULL.
   - Sanity-check resolved terms: distribution of firm_term_years; flag implausible values
     (e.g. > 25 yrs, < 0, or a term that disagrees with the OM-stated term on the same sale).
2. TRACE the lease writers. Find every path that writes `leases` (OM-intake extractor, CoStar
   sidebar pipeline, CMS/CSV import, manual). Determine which capture lease_start /
   lease_expiration / remaining term, and where the OM or CoStar clearly stated a primary
   term remaining that never landed in `leases`.
3. BACKFILL lease term at sale from the sale's own documents where the leases table is
   missing/incomplete:
   - OM intake very often states "X years remaining" or a lease expiration — capture it onto
     a lease row (or a sale-level firm_term_remaining field) so the cohort split can use it.
   - CoStar capture similarly carries lease term / expiration.
   - Prefer a real expiration date; else store the stated remaining-term years at sale.
   Record provenance; never clobber a manually-corrected lease.
4. FIX mis-bucketing. Where multiple leases exist, confirm the resolver picks the lease that
   was actually in effect at sale (not a stale/expired or a future renewal). Correct obvious
   data errors (expiration before start, expiration = sale_date, etc.).
5. CONSIDER a materialized `sales_transactions.firm_term_years_at_sale` column (written at
   ingest with provenance) so every term chart reads one authoritative value instead of
   recomputing the subquery — and so a sale with an OM-stated term but no lease row still gets
   bucketed. Keep it overridable.

## Validate (the charts that should improve)
- Coverage: share of usable-cap sales with a resolvable term rises materially above 26%.
- Cap-Rate-by-Lease-Term (deck p.22): the four cohorts FAN OUT with <=5 highest (~8-9% at the
  2019 peak and recent), 12+ lowest, ~140 bps spread — not the current compressed/tangled band.
- The "10+ year" cohorts on Seller Sentiment, Asking Cap Quartiles, Available Market Size, and
  DOM & Price-Change become dense enough that their n-gates pass continuously (>=5/period)
  instead of blanking after 2020-2022.

## Constraints / non-goals
- Don't invent terms. If neither a lease row nor an OM/CoStar-stated term exists, leave NULL
  (the sale stays out of the term cohorts) rather than guessing.
- Never clobber a manual override; backfills record provenance.
- This is the lease-TERM dimension only; the value fields (rent, cap-of-record, initial_price,
  listing_date) are the separate dia data-integrity master prompt.
```
