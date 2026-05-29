# On-Market Availability — Implementation Log (2026-05-29)

Implements the decisions confirmed after
`ON_MARKET_LIFECYCLE_CATEGORIZATION_REVIEW_2026-05-29.md`. Scope: the
**available / on-market** side only (the sales-comps dedup desync — R1/R2 of
`SALES_AND_AVAILABLE_COMPS_DEFINITION_AUDIT_2026-05-29.md` — is a separate
workstream, not touched here). **No rows deleted; every data change is
snapshotted and reversible.**

## ✅ Applied to production 2026-05-29

Applied live to dia (`zqzrriwuavgrquhisnoa`) and gov (`scknotsqkcheojiaewwh`),
verified: dia `v_available_listings` = **265**, gov = **191**, dia
available-backslide = 0. Note: gov `v_available_listings` was a **materialized
view** (refreshed by cron `refresh-mv-available-listings`); it was converted to a
**live regular view** and the refresh cron unscheduled, so the on-market set is
always current. The dia synthetic reclassification omits `off_market_reason`
(table CHECK constraint `al_off_market_reason_check`); `is_active=false` alone
excludes those rows.

## Decisions implemented (user, 2026-05-29)

| # | Decision | How |
|---|---|---|
| D1 | Dia "available" = `is_active=true AND no sale` (snapshot-in-time) | `v_available_listings` rewritten to gate on `is_active` (not the `status` string) |
| D2 | 144 synthetic/import-placeholder rows are not marketed | reclassified `is_active=false`, `status='Imported-Estimate'` (snapshotted) |
| D3 | `under_contract` counts as available | gov gate includes `under_contract`; shared `lccIsListingOnMarket()` helper |
| D4 | Align gov to the `is_active` model | gov gets a drift-proof generated `is_active` column; view gates on it |
| D5 | Keep the April-2026 broker-bearing import as real inventory | synthetic rule requires no-broker AND no-URL, so broker-bearing rows are kept |
| D6 | Pure `is_active`, no recency filter | no staleness clause added (Stale cron still handles 2yr aging) |

## Changes

### Dialysis DB — `supabase/migrations/dialysis/20260529160000_dia_available_listings_authoritative_gate.sql`
1. Snapshot table `available_listings_gate_backfill_20260529` (reversible).
2. Reclassify the 144 synthetic rows (null/`Draft-Commenced`, no URL, no broker, no seller) → `is_active=false`, `status='Imported-Estimate'`.
3. Heal the 33 stale-status rows (already `is_active=false`) so `status` text matches the lifecycle (`Sold`/`Off Market`).
4. Rewrite `v_available_listings` to gate on `is_active=true AND sold_date IS NULL AND sale_transaction_id IS NULL` (+ defensive synthetic guard). Output columns unchanged.
5. Patch `lcc_record_listing_check` to keep the `status` text in lockstep with `is_active` going forward (root-cause fix for the drift).

Validated: rewritten view returns **265** rows (was 289 status-keyed; the 289 wrongly included 33 off-market and excluded 11 re-listings + the synthetics).

### Government DB — `supabase/migrations/government/20260529160000_gov_available_listings_authoritative_gate.sql`
1. Snapshot + heal 2 withdrawn-but-`active` desync rows (`listing_status='withdrawn'`).
2. Add drift-proof `is_active` GENERATED column: `listing_status IN ('active','under_contract')` (the gov RPC already maintains `listing_status`, so no extra upkeep).
3. Rewrite `v_available_listings` to gate on `is_active`, suppressing only true closes (a **live** sale on/after `listing_date − 60d`) instead of "any sale ever" — so historical sales no longer hide genuine re-listings.

Validated: rewritten view returns **191** rows (was 161; correctly re-includes ~30 genuine re-listings / under-contract that were wrongly suppressed; drops the 2 withdrawn-unsold leaks).

### Frontend
- `app.js` — added canonical `lccIsListingActive()` + `lccIsListingOnMarket()` (single source of truth; documents the gate).
- `gov.js` — overview, hotlist, and listings-tab predicates now route through `lccIsListingActive()` (was three separate inline definitions — eliminates future drift; numbers unchanged today since gov `listing_status` is already lowercase).
- `dialysis.js` — On-Market tab drops its redundant client-side `status=in.(...)` filter and trusts the now-gated `v_available_listings`.

## Deploy + verify

Apply the two migrations to their respective projects (dia `zqzrriwuavgrquhisnoa`, gov `scknotsqkcheojiaewwh`), ship the JS. Then:

```sql
-- dia: expect ~265, and 0 off-market/sold leaking in
SELECT count(*) FROM v_available_listings;
SELECT count(*) FROM available_listings
 WHERE is_active=true AND status='Imported-Estimate';   -- expect 0 (reclassified)

-- gov: expect ~191, and is_active present
SELECT count(*) FROM v_available_listings;
SELECT count(*) FILTER (WHERE is_active) AS on_market FROM available_listings;
```

Backslide guards to add to the existing Track-B alarms (follow-up):
- dia: `count(*) FROM available_listings WHERE is_active=true AND (sold_date IS NOT NULL OR sale_transaction_id IS NOT NULL)` should be 0.
- gov: `count(*) FROM v_available_listings v JOIN sales_transactions s ON s.property_id=v.property_id AND s.transaction_state='live' AND s.sale_date >= v.listing_date` should be 0.

## Rollback
Each migration ends with its manual rollback (restore from the
`*_gate_backfill_20260529` snapshot table + re-create the prior view/function
definitions). The JS changes revert cleanly via git.

## Still pending (separate workstream, awaiting go-ahead)
Sales-comps dedup desync (R1/R2): `duplicate_superseded`/`needs_review` rows
leak into comps + the CM PDF because `transaction_state` and
`exclude_from_market_metrics` are not synced, and the dia dashboard reads raw
`sales_transactions`. See `SALES_AND_AVAILABLE_COMPS_DEFINITION_AUDIT_2026-05-29.md`.
