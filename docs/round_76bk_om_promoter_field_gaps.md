# Round 76bk — OM promoter field-propagation gaps

## Discovery

Scott observed that "basic data like RBA, SF leased, land, built" wasn't fully
propagating from OMs into the dia property table.

**Audit findings:**

| Field | dia coverage | Recent OM extracts capturing it |
|---|---|---|
| building_size (RBA) | 5,291 / 10,993 (48%) | 387 / 1,124 (34%) |
| year_built | 341 / 10,993 (3%) | 351 / 1,124 (31%) |
| land_area | 3,020 / 10,993 (27%) | (via lot_sf 330) |
| lot_sf | 248 / 10,993 (2%) | 330 / 1,124 (29%) |
| listing_broker | — | 603 / 1,124 (54%) |
| annual_rent | — | 282 / 1,124 (25%) |

The extractor *was* pulling these fields into `staged_intake_extractions.extraction_snapshot`. The promoter just wasn't writing them all.

## Root cause

`api/_handlers/intake-promoter.js::promoteDiaPropertyFromOm()` patched 7 fields:
`tenant`, `year_built`, `parcel_number`, `lot_sf`, `lease_commencement`,
`anchor_rent`, `anchor_rent_date`/`anchor_rent_source`.

It did **not** patch `building_size` (dia's column for RBA) or `land_area`
(acres). So those values from OM extractions were dropped on the floor.

## Fix

1. **Forward path** — added `building_size` and `land_area` patch logic to
   `promoteDiaPropertyFromOm()` in `api/_handlers/intake-promoter.js`:

   ```js
   // building_size (RBA)
   if ((current.building_size == null || current.building_size === 0)
       && buildingSf > 100 && buildingSf < 5_000_000) {
     patch.building_size = Math.round(buildingSf);
   }

   // land_area: prefer explicit acres, else convert lot_sf
   if ((current.land_area == null || current.land_area === 0)) {
     if (Number.isFinite(lotAcres)) patch.land_area = lotAcres;
     else if (Number.isFinite(lotSf)) patch.land_area = lotSf / 43560;
   }
   ```

   Also widened the SELECT in the GET to include `building_size, land_area`
   so the existing-value check works.

2. **Backward path** — migration `20260428320000_dia_round_76bk_property_backfill_from_om.sql`
   backfills 68 dia properties from already-existing
   `staged_intake_extractions.extraction_snapshot` data (61 actually patched
   — the rest already had values).

## Other gaps still pending audit

The OM extractor pulls these but the dia promoter doesn't write them — each
needs the same conservative-fill treatment in a follow-up:

- `expense_structure` (NNN/Gross/etc) → `dia.leases.expense_structure` —
  partial coverage already on lease side, but property-level cached value
  might be missing
- `roof_responsibility`, `hvac_responsibility`, `parking_responsibility`,
  `structure_responsibility` → `dia.leases.{field}_responsibility`
- `noi`, `gross_rent` → no dia property column for these (cap-rate calculations
  derive from lease.annual_rent + property.building_size)
- `listing_broker` / `listing_firm` / `seller_name` → already wired into
  `dia.available_listings.listing_broker_id` via the broker linker, but the
  cached text on `available_listings.listing_broker` should be checked

JS edits applied via Edit tool. Bash-side may show stale; on-disk
`grep -c building_size` on intake-promoter.js confirms 4 occurrences (vs
3 before the edit).
