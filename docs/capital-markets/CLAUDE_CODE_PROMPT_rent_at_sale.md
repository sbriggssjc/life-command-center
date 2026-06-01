# Claude Code prompt — investigate `rent_at_sale` not reconciling with cap rate

> Copy everything inside the fenced block into a new Claude Code session opened in the
> **DialysisProject** repo (the dialysis ingestion codebase).

```
Investigate and fix a data-integrity problem with `sales_transactions.rent_at_sale`
in the dialysis dataset: it does NOT reconcile with the cap rate, which corrupts the
Valuation Index and blocks NOI-weighting on the cap-rate charts.

## The symptom (measured 2026-06-01)
- Across Northmarq dialysis sales with a usable cap (4-12%): `SUM(rent_at_sale) /
  SUM(sold_price) = 3.6%`, but the average `cap_rate` for the same deals is `6.8%`.
- If `rent_at_sale` were the annual NOI behind the cap, then rent/price would equal
  the cap rate. It's ~half — so `rent_at_sale` is NOT the NOI that the cap rate
  implies (it looks like base/partial rent, monthly rent, per-SF, or an inconsistent
  mix).

## Why it matters
- `cm_dialysis_valuation_index_m` computes the index as `avg(rent_at_sale)/avg(cap)`
  — a wrong `rent_at_sale` makes the whole Valuation Index wrong.
- It also prevented proper NOI/deal-size weighting on the NM-vs-Market cap line (we
  had to fall back to price*cap weighting because ΣRENT/ΣPRICE = 3.6% was implausible).
- The master comp workbook's `RENT` column DOES reconcile (its `SOLD CAP = RENT /
  PRICE`), so the firm's intended definition is annual NOI. Ours should match.

## Environment
- Supabase "Dialysis_DB", ref `zqzrriwuavgrquhisnoa`, schema `public`. Use the
  Supabase MCP / CLI. Migrations + ingestion code live in this repo.
- Relevant columns on `sales_transactions`: `rent_at_sale`, `rent_source`,
  `calculated_cap_rate`, `stated_cap_rate`, `cap_rate`, `cap_rate_quality`,
  `sold_price`, plus any building-size / per-SF / chairs columns on `properties`.

## Tasks
1. QUANTIFY the discrepancy. For sold rows with `rent_at_sale>0`, `sold_price>0`, and
   a usable `calculated_cap_rate`, compute `r = (rent_at_sale/sold_price) /
   calculated_cap_rate`. Report the distribution of `r` (median, IQR, and the share
   near 1.0 vs near 0.5 vs near 0.083 [= monthly] vs other). This tells you whether
   it's a uniform factor (e.g. monthly vs annual = 1/12, base-vs-gross, per-SF) or a
   mixed/garbage field.
2. TRACE the source. Inspect `rent_source` value distribution and find every writer of
   `rent_at_sale` (OM-intake extractor, CoStar sidebar pipeline, manual/CSV import).
   Determine what each writer puts there — annual NOI? gross rent? base rent excl.
   reimbursements? monthly? per-SF? Look at the actual extraction/mapping code.
3. CHECK whether `calculated_cap_rate` is itself derived from `rent_at_sale` (if
   `calculated_cap_rate = rent_at_sale/sold_price` for some rows, those would show
   `r≈1` and be self-consistent but wrong-scaled). Separate the self-derived rows from
   the independently-sourced cap rows.
4. DIAGNOSE the dominant cause and propose the fix:
   - If monthly → annualize (×12) at ingestion + backfill.
   - If per-SF → multiply by building size.
   - If base-rent-excluding-reimbursements → reconcile to NOI or relabel the field.
   - If mixed across sources → standardize the writers to store ANNUAL NOI and backfill,
     recording provenance.
   Do NOT change `calculated_cap_rate` if it's independently correct.
5. FIX: implement the ingestion-side correction + a backfill migration, with a
   validation query showing the post-fix `SUM(rent_at_sale)/SUM(sold_price)` now ≈ the
   avg cap rate (~6.8%), and a per-`rent_source` reconciliation table.
6. Note the downstream effect: after the fix, the Valuation Index numerator
   (`cm_dialysis_valuation_index_m`) becomes correct, and the NM cap line can switch
   from price-weighting to true NOI-weighting (ΣRENT/ΣPRICE) to exactly match the
   master.

## Constraints
- Follow this repo's git rules (feature branch off origin/main, PR, copy/paste
  merge + test commands).
- Backfills must record provenance and not clobber manually-corrected rents.
- Report findings even if the fix is a multi-source standardization that needs staging.
```
