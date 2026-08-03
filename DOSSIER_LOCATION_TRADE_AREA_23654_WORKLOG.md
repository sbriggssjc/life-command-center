# Dossier Location & Trade Area — property 23654

## Objective
Implement the dossier v2 "Location & Trade Area" section end to end for 5247 Airways Blvd / property 23654 in the dialysis DB (`zqzrriwuavgrquhisnoa`) without fabricating facts.

## Grounding Rules
- Absent fields render `Not on file`.
- Computed values are labeled `Derived` with inputs.
- ZIP demographics stay labeled as an interim proxy when radius-ring demographics are missing.
- Nearby national tenants come only from stored Places API results; never hand-enter tenant names.
- Google Maps and Places keys stay server-side.

## Plan
1. Read dossier specs, repo instructions, and current packet/renderer code.
2. Add server-side map/Places helpers with cache/storage hooks.
3. Add Location & Trade Area packet fields and deterministic HTML rendering.
4. Add idempotent DB migration/scripts for cached map assets, Places tenants, radius-demographic backfill, and coverage audit.
5. Verify with focused dossier tests and syntax checks.

## Progress
- 2026-08-01: Read `CLAUDE.md`, `.github/AI_INSTRUCTIONS.md`, the dossier standard, v2 gold-standard HTML, and v2 audit/triage.
- 2026-08-01: Found `buildPropertyPacket()` already queries `property_demographics`, `census_zcta_demographics`, and `v_payer_mix_geo_averages`, but `renderPropertySections()` does not render the Location & Trade Area section.
- 2026-08-01: Added `api/_shared/location-trade-area.js` for server-side Google Static Maps fetching/cache and Places tenant storage. Google keys stay server-side.
- 2026-08-01: Wired `buildPropertyPacket()` to include structured Location & Trade Area packet fields: map cache, geocode/frontage, stored nearby national tenants, radius demographics, ZIP proxy, and payer-mix context.
- 2026-08-01: Added deterministic Location & Trade Area rendering to `api/_shared/dossier-generator.js`, immediately after Snapshot.
- 2026-08-01: Added additive dia migration `supabase/migrations/dialysis/20260801203000_dia_location_trade_area_assets.sql` for map cache and stored Places tenant callouts.
- 2026-08-01: Added `scripts/backfill-dia-location-trade-area-23654.mjs` for explicit radius-demographic backfill and coverage-gap listing. It requires `CENSUS_API_KEY`; without that key it fails closed instead of using ZIP proxy as radius data.
- 2026-08-01: Applied the additive migration live to Dialysis_DB via `supabase db query --linked --file supabase\migrations\dialysis\20260801203000_dia_location_trade_area_assets.sql`.
- 2026-08-01: Ran the live map/Places pass. Verified `property_static_map_cache` has a Google Static Maps row for property 23654. Verified stored Places callouts within 5 miles: Walmart Supercenter (2.13 mi), Walgreens (2.33 mi), Walgreens (2.83 mi), Dollar Tree (3.03 mi), Walmart Supercenter (3.14 mi), Walgreens (3.18 mi).
- 2026-08-01: Radius demographics were not written because no `CENSUS_API_KEY` is configured. The script reported 994 dialysis properties still lacking any `property_demographics` rows, so the gap is systemic rather than isolated to 23654.
- 2026-08-03: Resumed Prompt 16 live-apply checklist. Items 1 (#710 field-source priority) and 2 (relocation + market competition) were already applied and re-verified live in `docs/claude-code/done/16-live-apply-and-config.response.md`; item 3 is the remaining Census-radius demographics write. Confirmed `.env.local` contains a `CENSUS_API_KEY` entry and `scripts/backfill-dia-location-trade-area-23654.mjs` still passes syntax check before commit run.
- 2026-08-03: Reran `node scripts\backfill-dia-location-trade-area-23654.mjs --commit --gaps-file=DIA_DEMOGRAPHICS_COVERAGE_GAPS_2026-08-03.md`. The script reached DIA Supabase, found cached map + 6 nearby tenants, but did not write demographics because the loaded Census key is blank (`CENSUS_API_KEY=""`). Live `property_demographics` for 23654 still has no rows. Refreshed gap file still reports 994 dialysis properties lacking demographics.
- 2026-08-03: Live read-only verifier reconfirmed Prompt 16 items 1 and 2: field-source invalid-column audit is 0; folder-feed ask/cap priority rows are live; 442740 relocation lineage is live; market competition RPC returns 9 nearby clinics with rent examples.

## Verification
- `node --test test\dossier-generator.test.mjs` passes.
- `node --check api\_shared\dossier-generator.js` passes.
- `node --check api\_shared\location-trade-area.js` passes.
- `node --check api\_handlers\entities-handler.js` passes.
- `node --check scripts\backfill-dia-location-trade-area-23654.mjs` passes.
- `node .tmp_prompt16_live_verify.mjs` passed on 2026-08-03 before the temporary verifier was removed.
