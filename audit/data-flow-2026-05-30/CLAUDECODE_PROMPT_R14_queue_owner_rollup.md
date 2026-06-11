# Claude Code — R14: roll the property-trigger bands up to the owner (hybrid card)

## Why (doctrine, decided 2026-06-11)
The priority queue mixes two grains. *Relationship* bands are one row per owner
(P0.4/P0.5/P-CONTACT/P-BUYER/P6/P7). *Trigger* bands fan out **one row per
property**, so a multi-property owner floods the queue — grounded live: Wise
Developments LLC appears 8× in P1, 7× in P3, 3× in P8 (18 rows for one
relationship); Truist Bank 8× in P5. **P-BUYER already solved this** by rolling
each parent's SPE portfolio into ONE card with a count + rollup rent. This round
applies the SAME pattern to the four property-trigger bands so the queue is one
row per relationship, with the property detail carried on the card.

Doctrine: the queue unit is the *next action*, and the next action on a trigger is
ONE owner-level outreach ("several of your buildings have leases rolling in ≤24mo"),
not N separate touches. The per-property opportunities still matter — they live on
the card and in drill-down — but they don't each get their own queue row.

## The four trigger bands (one row per property today → one row per owner)
| band | reason | per-property fact today |
|------|--------|--------------------------|
| P1 | `lease_expiry_24mo` | a lease expiring ≤24mo |
| P3 | `ten_year_window` | acquired ~10yr ago (disposition timing) |
| P5 | `aged_building_value_add:built_YYYY` | aged building |
| P8 | `agency_active_solicitations:N` | gov agency active SAM solicitations |

Roll up ALL FOUR for consistency. (If site-specificity ever argues for keeping P8
per-property, that's a later toggle — default is roll up all four; the card's
property list preserves the per-site detail either way.)

## Build — mirror the P-BUYER rollup exactly
P-BUYER's mechanics are the template. In `v_priority_queue_live`, the P-BUYER
branch emits one row per parent with `buyer_rollup_property_count` /
`buyer_rollup_annual_rent` / `buyer_spe_count` / `buyer_last_acquisition_date`, and
`v_priority_queue_enriched` surfaces the `buyer_*` columns the P-BUYER card renders.
Do the same for the trigger bands:

1. **`v_priority_queue_live` — collapse each trigger band to `GROUP BY (entity_id,
   band)`** instead of one row per `source_property_id`. Per rolled-up row compute:
   - `trigger_property_count` — # of the owner's properties hitting this trigger
   - `trigger_rollup_annual_rent` — SUM of those properties' `rank_annual_rent`
     (this becomes the row's rank value, so biggest-portfolio owners rank highest —
     the rank stays honest)
   - a **representative/top property**: the most *urgent* one for the band
     (P1 = nearest lease expiry; P3 = nearest 10yr mark; P5 = oldest building;
     P8 = most solicitations) — keep its `source_property_id` + the scalar that
     drives the reason (nearest expiry date / built year / solicitation count).
   - `reason` summarizes: e.g. `lease_expiry_24mo` stays the band reason; the
     COUNT + the top fact ride the new columns (don't jam them into `reason`).
   - `days_overdue`: carry the band's existing overloaded metric for the TOP
     property (P5 building-age years, P8 solicitation count, P1/P3 days) so the
     existing sort semantics hold; `trigger_property_count` is separate.
   - Keep `source_domain` (a multi-property owner is usually single-domain here;
     if an owner spans dia+gov on the same trigger, emit one row per (entity,
     band, domain) — don't merge across domains, mirroring how the rest of the
     queue stays domain-scoped).

2. **Per-property detail must stay reachable** (the "hybrid"): add a small
   fan-out function `lcc_trigger_band_properties(entity_id, band)` returning the
   owner's properties in that band (property_id, address, the trigger fact, rent),
   ordered by urgency — the P-BUYER cohort functions (`lcc_listing_*`) are the
   pattern. The card drills into this; the queue row stays one-per-owner.

3. **`v_priority_queue_enriched`** — append the new `trigger_*` columns at the END
   (the append-only-view rule; `CREATE OR REPLACE VIEW` 42P16 otherwise).

4. **`lcc_priority_queue_resolved`** (the materialized cache) + its refresh
   function — the grain changes for these bands (entity+band, not entity+property),
   so re-materialize from the updated view. Band counts will DROP for P1/P3/P5/P8
   (that's the point — Wise Developments goes 8→1 in P1). Verify the refresh +
   ANALYZE still runs and the */5 cron is unaffected.

5. **`ops.js`** — render the rolled-up trigger card the way the P-BUYER card
   renders its rollup: headline = owner + band, sub-line = `"{count} {trigger}
   (top: {address}, {fact}) · ${rollup_rent} total"`, with a drill-down that calls
   the fan-out function to list the properties. The single-property case (count=1)
   should read naturally (no "1 properties"). `admin.js` BAND_ORDER unchanged
   (same bands, fewer rows); select the new `trigger_*` columns in the queue +
   band-detail handlers.

## Don't break
- Relationship bands (P0.4/P0.5/P-CONTACT/P-BUYER/P6/P7) are UNCHANGED — they're
  already owner-grained.
- P-BUYER's own rollup is untouched (this round mirrors it, doesn't modify it).
- `rank_annual_rent` ordering stays the operator's sort; the rolled-up rows rank on
  the portfolio SUM so big owners surface correctly.
- Single-property owners are one row either way — verify they're identical pre/post
  except the new columns.

## Tests / house rules
≤12 `api/*.js`; `node --check`; full suite green. Verify live (read-only) that band
membership is byte-identical in the RELATIONSHIP bands pre/post, and that the
trigger bands collapse to one-row-per-owner with correct counts (Wise Developments
P1: 8→1 with `trigger_property_count=8`; Truist P5: 8→1). Confirm the fan-out
function returns the original 8 properties for Wise Developments P1.

## After deploy (Cowork verifies live)
Band counts for P1/P3/P5/P8 drop to distinct-owner counts; the cards show the
rollup + top property; drill-down lists the per-property detail; rank order is by
portfolio rent. Migrations applied live to LCC Opps (view + function + cache
refresh), JS on the Railway redeploy — DB-first is safe (the view changes are
read-only and the cache re-materializes).
