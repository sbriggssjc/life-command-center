# Prompt 19 — Run the census demographics backfill (CENSUS_API_KEY now set)
- Priority: P1
- Status: open (drafted 2026-08-02)
- Related: prompt 16 item 3; `scripts/backfill-dia-location-trade-area-23654.mjs`; `DIA_DEMOGRAPHICS_COVERAGE_GAPS_2026-08-01.md`
- Response file: `../responses/19-run-census-backfill.response.md`

## Context
Scott has set CENSUS_API_KEY. Verified live: property_demographics still covers only 85 dialysis properties and
has 0 rows for 23654 — the key enables the backfill but the script has not been run yet.

## Prompt (copy/paste to Claude Code)
```
CENSUS_API_KEY is now set. Run the radius-demographics backfill: node scripts/backfill-dia-location-trade-area-
23654.mjs for property 23654 first (verify property_demographics gets 1/3/5-mi rows and the dossier Location &
Trade Area section fills), then work the broader coverage list in DIA_DEMOGRAPHICS_COVERAGE_GAPS_2026-08-01.md
(currently ~994 dialysis properties lack radius demographics). Respect Census API rate limits / batch politely;
report how many properties were backfilled and any that failed (bad geocode, ACS gap). Do not fabricate — leave
"Not on file" where Census returns nothing.
```

## Verify
property_demographics has 1/3/5-mi rows for 23654 (and the coverage count climbs from 85); the dossier renders
real radius demographics instead of the ZIP proxy.
