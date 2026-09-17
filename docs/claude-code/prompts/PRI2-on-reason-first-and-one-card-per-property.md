# PRI2-on — turn `priority_tab_v2` on with the reason-first order and one card per property

**Filed:** 2026-09-17 (Cowork). **Owner:** LCC (`api/_shared/seller-prospect-queue.js`, the Priority tab
under `priority_tab_v2`, `test/…priority…`). **Read first:** `docs/audits/PRI2_SIDE_BY_SIDE_2026-09-16.md`
(the gate PRI2 asked for, measured live) and `prompts/done/PRI2-…md` + response (PR #2523: built, flag OFF).

## The read (R1)

Scott delegated the read to Cowork's recommendation. From the side-by-side: V1's top 20 is the oldest
overdue P1 rows — a two-year-old to-do, all gov, no value, no reason, no reach state — so **ON** is not
in question. V2's top 20 as ordered today is *value first*, which puts eight `reason_to_sell_unmeasured`
rows in the first twenty ahead of measured debt/developer reasons, and shows the same property twice
when two owner entities are linked (rows 1/17, 5/6). Two small changes make the list what the doctrine
says it is, and neither is a new score.

## What to build

1. **Order: reason before value.** `SELLER_QUEUE_ORDER` becomes *measured reason first* (`reason_debt`
   or `reason_value_creation_developer` true, or `reason_to_sell <> 'reason_to_sell_unmeasured'`), then
   `rank_value DESC`, then `years_into_term ASC`. Implement as an ordering expression on the existing
   view columns (or one computed boolean column added to `v_lcc_seller_prospect_queue` **only if**
   PostgREST cannot order on the expression — say which). ⛔ No change to the view's predicate, no new
   weights.
2. **One card per property.** Rows sharing `source_domain + source_property_id` render as one card
   listing every owner entity (and each owner's `reach_state`); the chip counts stay per row (they are
   honest as row counts — say so in the footer: "N owner·property rows"). The list's rank is the
   property's best row.
3. **Flag ON** — `priority_tab_v2 = on` in the registry with the reason ("R1 2026-09-17, Cowork's read
   on Scott's delegation; side-by-side in `docs/audits/`"). The OFF path stays byte-identical (the
   existing test).
4. **Measure and report:** the new top 20 (owner · property · why now · reach) next to the old V2 top
   20; how many of the 508 rows have a measured reason; how many properties collapse (rows → cards).
5. Tests: order puts a measured-reason row above a higher-value unmeasured one; a two-owner property
   renders once with both owners; flag OFF unchanged.

## Prohibitions

- ⛔ No new scoring engine; no predicate edits; P-band machinery stays behind the flag until HOME2.
- ⛔ Redeploy both Railway services and confirm `/version`.
