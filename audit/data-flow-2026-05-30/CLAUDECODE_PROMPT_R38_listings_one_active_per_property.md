# Claude Code — R38: one active listing per property (gov listings dedup at source)

## Why (listings audit, live 2026-06-16 — companion to R37)
Same re-capture/duplication pattern as the sales writer, but **gov-only** for listings:
- **gov `available_listings`: 868 active rows across only 639 distinct properties — 117
  properties have 2–3 concurrent `is_active=true` listings (346 rows where there should be
  117).** 595 created in the last 30 days.
- **dia `available_listings`: 810 active rows = 810 distinct properties, 0 dups — CLEAN.**
So dia's listing write path is already idempotent (one active per property); **gov's is
not.** gov has multiple listing writers (`listing_sync.py`, `costar_ingest.py`, and the
sidebar gov path) that insert active rows for the same property without a shared natural key,
so re-captures / multi-source captures stack up concurrent active listings.

Metric impact is currently small — the canonical M1 filters
(`exclude_from_listing_metrics` + 60-day sale-overlap) happen to dedup it down to **629 rows
≈ 628 distinct properties** — but the **raw table is polluted** (anything reading
`available_listings` directly double-sees), and the canonical counts ROWS not DISTINCT
PROPERTIES, so it's one filter-degradation away from double-counting on-market.

## The invariant
**A property has at most ONE active listing at a time.** (A genuine relisting supersedes the
prior active row; it doesn't add a second concurrent active row.) dia already holds this; gov
must too.

## Unit 1 — enforce one-active-per-property on the gov listing writers
Reconcile the gov listing write paths (`GovernmentProject/src/listing_sync.py`,
`costar_ingest.py`, and the LCC `sidebar-pipeline.js` gov listing writer) to a shared
idempotent upsert:
- On a new/updated listing for a property, **match the existing active listing by
  `property_id`** (the natural key) and UPDATE it in place; if a genuinely new listing
  supersedes a prior one, mark the prior `is_active=false` (withdrawn/superseded) in the same
  transaction — never leave two `is_active=true` rows for one property.
- If gov legitimately needs multiple concurrent listings (e.g. distinct spaces in a
  multi-tenant building), key on `(property_id, space/suite identifier)` instead of
  `property_id` — but confirm that's real before allowing it; for single-asset gov net-lease,
  property_id is the key. (dia's writer is the reference implementation — mirror its dedup.)
- Look at WHY gov has 3 writers and dia 1: if `listing_sync`/`costar_ingest`/sidebar are
  redundant paths, consolidate or make them share the upsert helper so they can't each insert
  a separate active row.

## Unit 2 — reversible cleanup of the 117 gov dup-property backlog
Snapshot-backed (mirror R22/R37 reversibility): for each of the 117 gov properties with >1
active listing, keep ONE survivor (newest / most-complete / non-`exclude_from_listing_metrics`)
and mark the others `is_active=false` with a tag (`r38_dedup_superseded`). Reversible with one
UPDATE from the snapshot. Don't delete; just collapse to one active per property. dia needs no
cleanup (already clean).

## Unit 3 — canonical M1 counts DISTINCT properties (belt-and-suspenders)
In `v_market_metrics_*` / the M1 on-market definition, count **distinct property_id** (not
listing rows) so on-market can never double-count a property even if a residual duplicate
active listing slips through. Today this changes gov on-market 629→628 (negligible) but makes
the metric robust by construction. (No NM/definition change — just rows→distinct-properties.)

## Guards / house rules
- Reversible/snapshot cleanup; no deletes (mark inactive). Respect the cap-rate triggers on
  listings + field-provenance. dia untouched (already correct). ≤12 LCC `api/*.js`;
  `node --check`; gov `py_compile`; suite green. Cleanup migration applied live by Scott after
  a dry-run (same gate as R37).
- Verify live: gov active listings == distinct properties (≈639→one-per-property); a
  re-capture of a listed property creates no second active row; canonical on-market = distinct
  properties; dia unchanged (810).

## Bottom line
gov's multi-writer listing path stacks concurrent active listings on 117 properties; dia's
single idempotent writer proves the right shape. R38 makes gov hold "one active listing per
property," cleans the backlog reversibly, and hardens the canonical on-market to count
distinct properties — completing the consolidate/dedup-at-source work alongside R37 (sales).
