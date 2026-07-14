# Claude Code (dia) — SJC Deal Book: tighten cross-source dedup + fix manual-row closed classification

## Context

The bootstrap seed is now LOADED live into `sjc_deal_ingest` (287 real `manual_export`
rows; the 3 spreadsheet footer rows — `Total`, `NaT`, `Applied filters:` — were
excluded). The Deal-object-primary book (PR #1389) is live and now reflects the full
history. But loading the bootstrap surfaced two consolidation bugs that make
`v_sjc_deal_book` **over-count** closed deals: it shows **313 closed** where the
ground truth (the SF export) is ~**251**.

Grounded live on dia (`zqzrriwuavgrquhisnoa`):
- `v_sjc_deal_ingest_current`: `sf_crawl` 148 (62 closed) + `manual_export` 244 (244
  "closed") = 392 (306 closed). The book adds the listing supplement → 313 closed.

## Bug 1 — cross-source dedup misses same-deal pairs (the big one: ~53 double-counts)

`dedup_key = norm(deal_name) | close_date | round(price/1000)` does NOT collapse the
same deal across sources, because `sf_crawl` (from `sf_deal_staging.deal_price`/
`expected_close_date`) and `manual_export` (export `sales_price`/`close_date`) record
**slightly different prices and sometimes dates** for the same deal, so the third key
segment (and occasionally the date) differs → the `DISTINCT ON (dedup_key)` never
sees them as duplicates. Measured live: **53 deals** exist in BOTH sources on
`(normalized deal_name + close MONTH)` yet weren't collapsed — that's essentially all
of `sf_crawl`'s 62 closed being duplicates of `manual_export` deals.

**Fix:** make the cross-source supersede-key looser/robust so `sf_crawl` collapses a
matching `manual_export` row. Options (pick the robust one):
- Match on `(normalized deal_name, close-month)` OR `(normalized deal_name, price
  within ±2%)` rather than exact `round(price/1000)`; OR
- Once deal→property propagation runs, dedup on `(linked_property_id, close-month)` —
  the strongest key. Keep `sf_crawl` as the winner (it carries `sf_deal_id`), drop the
  `manual_export` twin. Target: the ~53 dupes collapse, closed drops ~313 → ~260.

## Bug 2 — manual_export rows are all marked `is_closed=true` (~20 false closed)

Every `manual_export` row is classified `is_closed=true`, but the export includes
**20 rows with null price** (referrals / advisory / outside-fee — `deal_type` like
`IS - Referral`, or "(Referral)"/"Outside Fee"/"Advisory" in the name) that are NOT
closed sales. They inflate the closed count and would distort closed-volume/cap-rate.

**Fix:** classify `manual_export` `deal_stage`/`is_closed` the same way the crawl does
— map `deal_type`/name to a stage (a null-price referral/advisory/off-market fee row
is NOT `closed`; treat as `referral`/`other`). Only real sold rows (price present, a
Sale/IS-CM/buy-side/co-broke closed type) count as closed. Target: ~20 fewer false
closed.

## Expected after both fixes

`v_sjc_deal_book` closed ≈ **~251–265** (export-truth), no same-deal doubles across
`sf_crawl`/`manual_export`, `_by_year` + `_summary` reconcile, closed-volume no longer
inflated by referral/advisory rows. Verify: 0 `(norm name, close-month)` pairs appear
twice across sources in the current view; count matches the export's closed set.

## Boundaries

dia views only (the consolidation `v_sjc_deal_ingest_current` + the `manual_export`
stage/is_closed mapping); the loaded `sjc_deal_ingest` data is correct — do not
reload. Reversible (re-create the prior view bodies). The durable levers (widen the
`intake-salesforce` crawl SOQL; run deal→property propagation) still stand and would
also enable the property-key dedup above.
