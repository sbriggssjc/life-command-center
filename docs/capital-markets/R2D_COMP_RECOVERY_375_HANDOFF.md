# R2-D Comp__c recovery — 375 pending comps + price-history floor (2026-06-30)

Session outcome for "Comp__c pull → re-run R2-D recovery + add the price-history floor."
LCC Opps `xengecqvemvfknjvbvrq` · dia `zqzrriwuavgrquhisnoa`. All findings grounded live.

## TL;DR

| Step | Status | Result |
|---|---|---|
| 1. Drain 375 pending comps through sf-record-lookup worker | **BLOCKED (handoff)** | Needs the live Railway worker + `SF_RECORD_LOOKUP_URL` (the SF fetch) — not reachable from the Cowork sandbox. AND the worker can't auto-source these 375 today (two gaps, below). |
| 2. `lcc_harvest_sf_comp_on_market()` | **DONE (no-op)** | Ran it: 686 comps re-upserted / 568 with OMD, but map total unchanged (1316 / 1197 with OMD). The 375 are **not in `sf_sync_log`** (the broad crawl can't reach them), so harvest can't land them. |
| 3. Re-run `lcc_apply_r2d_date_uncertain_recovery()` (dia) | **DONE (0 recoverable now)** | Dry-run vs the current map: `matched=27, would_update=0, rejected_after_exit=27`. The current map is fully drained; the 27 still-`date_uncertain` listings that carry a harvested comp are all re-listing cases whose OMD postdates the exit (correctly rejected). **date_uncertain stays 467 → 467** until the 375's OMDs land. No apply run (it would write 0 rows). |
| 4. Price-history floor on `cm_dialysis_dom_price_change_active_m` | **SHIPPED ✅** | Applied live + committed. Exactly **2025-12, 2026-01, 2026-02, 2026-03 flip 0.0000 → NULL**; every genuine-rate period byte-identical; `pct_total` untouched. |

The recovery chain is genuinely gated on the **SF fetch** for the 375 comps. Everything
downstream (harvest, R2-D recovery, the recent active-membership refill) is a no-op until
those OMDs are pulled from Salesforce. The 4 deliverable is independent and is done.

## The 375 pending comps (grounded)

SF-comp intakes with `seed_data.sf_entity_id` + numeric `promotion_listing_id`,
`source_vertical` dia/gov, NOT in `lcc_sf_comp_on_market` (or there with NULL OMD):
**375 distinct comp Ids — dia 370 + gov 5.** These are the `date_uncertain` listings'
source comps.

### Why the sf-record-lookup worker can't auto-source them (the two gaps)

1. **`v_lcc_missing_comp_ids` only sees `extraction_result.match_domain IN ('dialysis','government')`.**
   ~**316 of the 375** carry `match_domain='lcc'` on their intake (the domain lives in
   `seed_data.source_vertical` instead — the same gap `v_lcc_date_uncertain_recovery_map`
   was created to resolve). The worker's source view never enumerates them.
2. **The worker's "held" set is `on_market_date_source='unestablished'` only**
   (`loadHeldListingIds` in `api/_handlers/sf-record-lookup.js`). After T9d FIX these
   listings are `date_uncertain`, so even the ~71 dia comps that ARE visible to the view
   are classified `missing_comps_not_held` and never fetched.

### The two worker changes — LANDED on this branch (2026-06-30)

Both were needed together (either alone is insufficient); both are now applied:

- **DB (applied live to LCC Opps + committed):** migration
  `20260630120000_lcc_missing_comp_ids_resolve_source_vertical.sql` broadens
  `public.v_lcc_missing_comp_ids` to resolve `match_domain` from `seed_data.source_vertical`
  when `extraction_result.match_domain` is `'lcc'`/absent (mirrors
  `v_lcc_date_uncertain_recovery_map`'s CASE). The worker's source view now enumerates the
  full pending set — **401 dia + 108 gov** distinct not-in-map comps (was 103 total).
- **Worker JS (`api/_handlers/sf-record-lookup.js`, ships on the Railway redeploy):**
  `loadHeldListingIds` widened to `on_market_date_source IN ('unestablished','date_uncertain')`
  so the recovered set is treated as "held" and fetched. `node --check` clean; 12 api files;
  `test/sf-record-lookup.test.mjs` 13/13 pass.

The SF fetch itself still can't be exercised from the sandbox (needs the live Railway
worker + `SF_RECORD_LOOKUP_URL`). Once the JS deploys, run the drain below — the worker now
both **sources** and **fetches** the 375 date_uncertain source comps.

NOTE: comps already in `lcc_sf_comp_on_market` with a NULL OMD (SF returned no
On_Market_Date__c) are intentionally still excluded from `v_lcc_missing_comp_ids`
(`c.sf_comp_id IS NULL` filter) — re-fetching them won't recover a date SF doesn't have.
They surface as the worker's `residual.no_omd_in_sf`. The not-in-map bulk of the 375 is now
sourceable.

### Runbook (once `SF_RECORD_LOOKUP_URL` is live + the two changes ship)

```
GET  /api/sf-record-lookup-tick?domain=both&batch_size=20         # dry-run: confirm missing set now includes the 375
POST /api/sf-record-lookup-tick?domain=both&batch_size=20&limit=400  # drain (≤20/batch, sequential — sync PA flow)
```
Repeat POST until `residual.still_missing_after_tick` stops shrinking. Then:

```sql
-- LCC Opps: land any newly-crawled comps + confirm growth
SELECT public.lcc_harvest_sf_comp_on_market();
SELECT count(*), count(*) FILTER (WHERE on_market_date IS NOT NULL) FROM public.lcc_sf_comp_on_market;
```
```sql
-- dia: re-run R2-D recovery (build the payload on LCC Opps from
-- v_lcc_date_uncertain_recovery_map WHERE match_domain='dialysis', then pass it in)
SELECT * FROM public.lcc_apply_r2d_date_uncertain_recovery('<payload>'::jsonb, false, 'r2d_recovery_2026-06-30');
SELECT count(*) FROM public.available_listings WHERE on_market_date_source='date_uncertain';  -- 467 → lower
```

### The explicit current Id snapshot (regenerate authoritative list anytime)

Authoritative regen (LCC Opps):
```sql
SELECT DISTINCT s.raw_payload->'seed_data'->>'sf_entity_id' AS sf_comp_id
FROM public.staged_intake_items s
LEFT JOIN public.lcc_sf_comp_on_market c ON c.sf_comp_id = s.raw_payload->'seed_data'->>'sf_entity_id'
WHERE s.raw_payload->'seed_data'->>'sf_entity_id' IS NOT NULL
  AND s.raw_payload->'extraction_result'->>'promotion_listing_id' ~ '^[0-9]+$'
  AND lower(s.raw_payload->'seed_data'->>'source_vertical') IN ('dia','dialysis','gov','government')
  AND (c.sf_comp_id IS NULL OR c.on_market_date IS NULL);
```

gov (5): `a1Y8W000004K1XbUAK, a1Y8W000004K3dbUAC, a1Y8W000004K4caUAC, a1Y8W000004K7tgUAC, a1YVs000002xOYDMA2`

(dia = 370; full Id list is the regen query above. ~316 of the 375 carry intake
`match_domain='lcc'`.)

## Price-history floor (Unit 4, shipped)

Migration `supabase/migrations/dialysis/20260630_dia_r2d_price_history_floor_core_price_change.sql`
(applied live to dia + committed).

**Grounding refuted the literal "denominator = listings with ≥2 price observations":**
dia's `listing_price_history` is **empty (0 rows globally)**, and `price_change_history` /
`price_change_date` are NULL across the entire recent core set. The only evidence of ≥2
distinct observed prices is `had_price_change OR initial<>last`. Replacing the denominator
with that count **collapses the genuine era to a degenerate 1.0** (every history-bearing
dia listing is one that changed price; dia stores no held-price multi-observation
histories) and gaps 2025-12..2026-03. That is itself misleading.

**So the floor GATES rather than replaces:** emit `pct_price_change_core` only when the
core pool carries ≥1 listing with real price-history evidence
(`denom_core_history_raw >= 1`), on top of the existing R2-C density floor
(`denom_core_raw >= 16`). The emitted rate keeps the raw denominator, so genuine-era
values are unchanged.

Verified live — the ONLY periods that change (4):

| period | before | after |
|---|---|---|
| 2025-12-31 | 0.0000 | **NULL** |
| 2026-01-31 | 0.0000 | **NULL** |
| 2026-02-28 | 0.0000 | **NULL** |
| 2026-03-31 | 0.0000 | **NULL** |

Genuine-rate periods byte-identical (e.g. 2024-12 0.0625, 2025-01/02 0.0588);
2025-03..2025-11 stay NULL (R2-C density floor); `pct_price_change_total` and the `all`
cohort untouched. Reversible: re-create the R2-C body.
