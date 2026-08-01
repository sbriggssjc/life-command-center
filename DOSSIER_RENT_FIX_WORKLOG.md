# Dossier Rent Fix Worklog

## Objective
Fix the 5247 Airways / DaVita lease economics display and source data gap for Dialysis_DB property `23654`, lease `16307`.

## Grounding
- Property: 5247 Airways Blvd, Memphis, TN 38116.
- Lease: annual rent `181959`, building size `6308`, start `2018-06-06`, expiration `2033-06-06`.
- Escalation: `10% every 5 years`, `lease_bump_pct = 0.1`, `lease_bump_interval_mo = 60`.
- Expected year-1 rent/SF: `181959 / 6308 = 28.85`.
- Expected current rent as of 2026: one 2023 escalation, `181959 * 1.10 = 200154.90`, or about `$31.73/SF`.

## Plan
1. Trace the dossier and detail-panel lease renderers.
2. Add compute-on-read rent/SF when the stored lease value is null.
3. Add current-rent-as-of computation from `lease_rent_schedule`, else anchor rent and bump math.
4. Render Year-1 rent + $/SF, Current rent + $/SF, term remaining, and option-bump continuation without fabricating unknown option terms.
5. Add an idempotent Dialysis_DB migration to backfill `leases.rent_per_sf` only when blank and inputs exist.

## Findings
- The stored dossier packet assembler already derives Year-1 rent/SF from `annual_rent / building_size` when inputs are present.
- It did not fetch `lease_rent_schedule` or compute current escalated rent.
- The browser lease tab displayed stored `rent_psf`/metadata only, so a null stored `leases.rent_per_sf` rendered blank.

## Changes
- `api/_handlers/entities-handler.js`
  - Fetches `lease_rent_schedule` for the live lease.
  - Computes Year-1 rent/SF from `annual_rent / building_size` when the stored value is null.
  - Computes Current rent as of the generation date from `lease_rent_schedule` when populated, else `anchor/lease rent × bump math` using `projectRentAtDate`.
  - Adds Derived tags with inputs for current rent and current rent/SF.
  - Emits option bump continuation only when renewal terms explicitly support it; otherwise omitted so the renderer shows "Not on file."
- `api/_shared/dossier-generator.js`
  - Renders `Year-1 rent + $/SF` and `Current rent + $/SF` as paired rows.
  - Preserves two decimals for rent/SF.
  - Adds `Bumps continue through options?`.
- `detail.js`
  - Computes rent/SF in the live Lease tab when stored rent/SF is null.
  - Renders Year-1 and Current paired rent rows.
  - Uses `lease_rent_schedule` first for current rent, then anchor/bump projection.
  - Shows option bump continuation as "Not on file" unless stated in renewal terms.
- `migrations/dialysis_db/20260801_backfill_lease_rent_per_sf.sql`
  - Fill-blanks-only source backfill for `leases.rent_per_sf` from `leases.annual_rent / properties.building_size`.
- Live Dialysis_DB source row:
  - Patched lease `16307` to `rent_per_sf = 28.85` via Supabase REST after sandbox approval.
  - Returned row confirms `annual_rent = 181959`, `rent_per_sf = 28.85`, `renewal_options = "2, 5yr"`, `escalation_raw_text_current = "10% every 5 years"`.

## Verification
- `node --test test\dossier-generator.test.mjs` passes.
- `node --check api\_handlers\entities-handler.js` passes.
- `node --check api\_shared\dossier-generator.js` passes.
- `node --check detail.js` passes.
