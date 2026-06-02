# Claude Code prompt — find & backfill dia listing_date for 2025 (exploration-first)

> Run in **DialysisProject** (+ check the CoStar sidebar capture in
> life-command-center if the dates live there). EXPLORATION-FIRST: do not assume
> the dates are gone. The listings ROWS exist; the `listing_date` field is null
> for 2025. Step one is to find where the real on-market date lives in the raw /
> source data before deciding anything is uncapturable.

```
GOAL: restore listing_date for 2025 dia listings so Market Turnover, Inventory
Backlog, and Available Market Size stop collapsing at the recent edge (added_month
= 0 in 2025-12/2026-01/2026-03; count_total falls 146 -> 8). 2025 currently has
~14 listings with a usable listing_date vs ~120 expected.

## Environment
- Supabase "Dialysis_DB", ref zqzrriwuavgrquhisnoa. available_listings is the
  table (listing_id, listing_date, sold_date, off_market_date, property_id,
  cap_rate/last_cap_rate, ...). The CoStar sidebar capture pipeline lives in
  life-command-center (api/_handlers/sidebar-pipeline.js) and is a likely writer.

## Exploration tasks (PROVE where the date is before backfilling)
1. INVENTORY THE GAP. Count available_listings rows whose implied on-market period
   covers 2025 but listing_date IS NULL (or is a batch-import sentinel date, e.g.
   any date carrying >=15 listings). Break down by data_source / ingest batch.
2. HUNT THE RAW DATE. For those rows, check every place the true on-market /
   list date could already exist but wasn't propagated to listing_date:
   - other columns on available_listings (first_seen, created_at, captured_at,
     raw payload/json, on_market_date, sold_date - days_on_market);
   - the raw CoStar capture / staging tables the sidebar pipeline writes;
   - the linked sale (sales_transactions.on_market_date / days_on_market);
   - any audit/history table.
   Report which source has a real date for how many of the 2025 rows.
3. ASSESS BATCH STAMPS. The known artifact: ~56 listings stamped on 2026-05-07 /
   2026-06-02 (import dates, not list dates). Confirm whether their TRUE list date
   is recoverable from (2) or is genuinely unknown.

## Then backfill
- Where (2) yields a real on-market date, populate listing_date from it (record
  provenance; never clobber a manually-set date). For batch-stamped rows whose
  true date is recoverable, replace the sentinel date.
- Only where NO source carries a real date, leave it null and report the count —
  that is the genuine residual gap.

## Validate
- Market Turnover / Inventory Backlog added_month is non-zero across 2025 (the
  charts already exclude >=15/day sentinel dates, so backfilled real dates flow
  straight through).
- Available Market Size count_total no longer collapses to single digits in 2025.

## Constraints
- This is the listing DATE only. Don't invent dates; prefer a captured raw date
  over any synthetic backdating. Record provenance on every backfill.
```
