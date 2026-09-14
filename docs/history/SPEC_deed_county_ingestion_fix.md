# Deed / County Ingestion Fix — both domains

**Date:** 2026-05-21
**Severity:** high (orphaned owner data). **Type:** scraper (app) fix + DB propagation. Cannot be backfilled in SQL — the linkage was never persisted.

## Diagnosis (measured)
The county scrapers **run and capture real data** but **drop the property linkage**:
- **gov** `parcel_records`: 10,025 rows, **owner_name on 9,402 (94%)**, assessed value on 9,008 — but `situs_address` on only 621, `mailing_address` on 7, `apn` null, and **no `property_id`**. `deed_records`: 5,485 with grantee, linked to parcels via `parcel_id` — but parcels don't link to properties.
- **dia** `deed_records`: 635, only 135 have `property_id`; the other 500 have no address/parcel in `raw_payload` to match.
- Result: 9,402 gov parcel owner names + thousands of deeds are **orphaned**; only ~813 gov / 509 dia properties show a deed grantee, and those came from the **CoStar sidebar**, not these tables. `raw_payload` does not contain a recoverable address/APN, so **retroactive SQL linking is impossible**.

## Root cause
The scraper knows the `property_id` it is fetching for (it looks up a property's county record), but writes `parcel_records`/`deed_records` **without** `property_id` and without the situs address / APN that would allow later matching. So every scrape is disconnected from its property.

## Fix (scraper — `src/county_scraper.py` / `src/public_record_ingest.py`)
1. **Persist the link at fetch time.** When scraping county data for property P, write `parcel_records.property_id = P` (add the column on gov; dia `deed_records` already has it — set it) and always populate `situs_address` + `apn` from the source page. This single change stops the orphaning going forward.
2. **Add `property_id` to gov `parcel_records` and `deed_records`** (migration) so the link is first-class, not address-matched.
3. **Re-scrape / backfill** the existing orphaned rows now that the scraper persists the link (the data already there can't be salvaged without re-fetch, but is cheap to re-pull since the API/source is known).
4. **Schedule it.** Neither domain has a county-ingest cron today — add one driven off a property research queue (overdue/no-deed properties first), capped per tick, like the geocode-tick pattern. This is why coverage is 4.5%: it's not being driven across the property set.

## DB propagation (build once linkage exists — ready to wire)
A `propagate_deed_to_property()` that, for deeds with a resolved property:
- sets `properties.latest_deed_grantee/grantor/date` + `latest_sale_price` (consideration),
- inserts an `ownership_history` row (`grantor → grantee`, recording_date, deed_type) — which on gov fires the existing `propagate_ownership_to_property` trigger → updates current owner + **extends chain of title**,
- routes the grantee through `resolve_company` → recorded_owner + `unified_contacts`,
- pulls `parcel_records.owner_name` + `mailing_address` → recorded_owner address (the assessor owner is often the true owner / where notices go — directly fills the address gap O-5/O-8 and gives the address matcher its fuel).
Make it an AFTER trigger on deed/parcel insert+update (when property linked), plus a one-shot backfill.

## Order
1. Migration: `property_id` on gov parcel/deed records.
2. Scraper persists `property_id` + situs/apn (stops orphaning).
3. `propagate_deed_to_property()` + trigger + backfill.
4. Cron to drive the scraper across the property set (no-deed first).
5. Coverage alert already live (`v_ownership_coverage` tracks `pct_property_has_county_deed`).

*The owner data is largely already scraped — this fix is mostly about persisting + propagating the linkage, then driving coverage. It directly unblocks the address matcher and the SOS-independent owner-address fill.*
