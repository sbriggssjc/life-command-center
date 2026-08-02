# Prompt 16 Response — Live Apply & Config Checklist

## Status
- Item 1: applied live before this Codex pass; re-verified live from this shell on 2026-08-02.
- Item 2: applied live before this Codex pass; re-verified live from this shell on 2026-08-02.
- Item 3: still credential-gated by missing `CENSUS_API_KEY`; DIA read path works, but radius demographics were not written.

## Item 1 — Field Source Priority #710
Target: LCC Opps (`xengecqvemvfknjvbvrq`)

Apply result:
- The prompt already recorded this as applied live by Cowork via Supabase MCP on 2026-08-01.
- This Codex shell does not have `SUPABASE_ACCESS_TOKEN`, so I did not re-apply the migration.

Live verification rerun:
- `v_field_source_priority_invalid_columns` returned `0` rows.
- Folder-feed listing source-priority rows are present on real `available_listings` ask columns:
  - `dia.available_listings`: `initial_price`, `last_price`, `initial_cap_rate`, `current_cap_rate`, `cap_rate`, `price_change_date` for both `folder_feed_bov` and `folder_feed_master`, priority `45`, `warn`.
  - `gov.available_listings`: `asking_price`, `asking_cap_rate` for both `folder_feed_bov` and `folder_feed_master`, priority `45`, `warn`.
- Sentinel quarantine rows still visible and intentional in the live query:
  - `dia.available_listings.sold_price`
  - `gov.available_listings.last_price`, `last_price_change`, `original_price`

Result: #710 audit passes.

## Item 2 — Relocation + Market Competition
Target: Dialysis_DB (`zqzrriwuavgrquhisnoa`)

Apply result:
- The prompt already recorded this as applied live by Cowork via Supabase MCP on 2026-08-01.
- This Codex shell did not re-apply the migration.

Live verification rerun:
- `v_clinic_relocation_lineage` for CCN `442740` returned:
  - `property_id`: `23654`
  - `facility_certification_date`: `2017-10-27`
  - `original_certification_date`: `2003-02-01`
  - `current_stations`: `13`
  - `lineage_status`: `prior_site_not_on_file`
  - `prior_address`: `null`
  - `current_address`: `5247 Airways Blvd`
- `dia_nearby_dialysis_competition(35.005382,-89.989957,5,25,'442740')` returned `9` nearby clinics in this rerun.
- Rent-bearing examples in the result:
  - DaVita State Line Dialysis: `1.116` mi, `$19.63/SF`, source `leases.rent_per_sf`.
  - DaVita Memphis South Dialysis: `2.73` mi, `$15.00/SF`, source `leases.rent_per_sf`.

Rendering verification:
- `node --test test\dossier-generator.test.mjs` passed `9/9`.
- The test suite includes the dossier render assertion for `Market Competition`.

Result: relocation lineage view, competition RPC, and dossier renderer are live/verified.

## Item 3 — Census Radius Demographics
Target: Dialysis_DB property `23654`

Apply result:
- Not applied. `.env.local` has DIA/OPS Supabase variables, but no `CENSUS_API_KEY`.
- The current shell also has no `CENSUS_API_KEY` environment variable.

Live script output:
- Command: `node scripts\backfill-dia-location-trade-area-23654.mjs`
- Property resolved: `23654`, `5247 Airways Blvd, Memphis, TN 38116`, `35.005382015896, -89.989957186779`.
- Map cache: `cached`.
- Nearby national tenants stored/found: `6`.
- Demographics write result: `Demographics backfill not written: CENSUS_API_KEY is required for ACS block-group demographics.`
- Coverage audit: `Dialysis properties still lacking demographic rows: 994`.

Static verification:
- `node --check scripts\backfill-dia-location-trade-area-23654.mjs` passed.

Remaining work:
- Set `CENSUS_API_KEY` in Railway Variables and `.env.local`.
- Rerun `node scripts\backfill-dia-location-trade-area-23654.mjs --commit` for property `23654`.
- Then run the broader coverage pass against `DIA_DEMOGRAPHICS_COVERAGE_GAPS_2026-08-01.md`.

## Command Notes
- Initial script/network attempts from the sandbox failed with `connect EACCES`; reruns used approved network access.
- No secrets were printed.
