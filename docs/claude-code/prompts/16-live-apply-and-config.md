# Prompt 16 — Live-apply & config checklist (credential/env-gated)
- Priority: **P0/P1** (several fixes are code-complete but not yet live)
- Status: open (drafted 2026-08-01)
- Related: prompts 09, 07-followup7, 07-followup8; responses in `done/`
- Response file: `../responses/16-live-apply-and-config.response.md`

## Prompt (copy/paste to Claude Code — run where Supabase migration creds + env keys are available)
```
Several fixes are code-complete but were not applied live from the prior sessions' shells (missing
SUPABASE_ACCESS_TOKEN / env keys). Apply and verify:
1. Field-source-priority #710 (LCC Opps): apply supabase/migrations/20260801210000_lcc_field_source_priority_
   schema_drift_710_listing_fix.sql, then rerun Daily DB Checks / query v_field_source_priority_invalid_columns
   — expect 0 rows. Confirm folder_feed_bov/master now write ask price+cap to real available_listings columns.
2. Relocation + market competition (Dialysis_DB): apply supabase/migrations/dialysis/20260801190000_dia_dossier_
   relocation_competition.sql to activate v_clinic_relocation_lineage + dia_nearby_dialysis_competition, and run
   the 442740 lineage backfill. Verify the 23654 dossier shows Relocation Lineage + Market Competition.
3. Census radius demographics: set CENSUS_API_KEY, run scripts/backfill-dia-location-trade-area-23654.mjs to
   backfill property_demographics 1/3/5-mi for 23654, then work the broader gaps in
   DIA_DEMOGRAPHICS_COVERAGE_GAPS_2026-08-01.md.
Report each apply result + the audit/verify output.
```

## Verify
#710 audit = 0 rows; relocation/competition view+RPC live and rendering; property_demographics backfilled for
23654 + the coverage-gap list worked down.

## STATUS 2026-08-01 (applied live by Cowork via Supabase MCP)
- **Item 1 (#710, LCC Opps):** APPLIED + verified — dead folder_feed listing rules removed; live ask columns
  (initial_price/last_price/initial_cap_rate/current_cap_rate/cap_rate/price_change_date [dia]; asking_price/
  asking_cap_rate [gov]) registered at priority 45; column-drift guard trigger installed.
- **Item 2 (relocation/competition, Dialysis_DB):** APPLIED + verified — `v_clinic_relocation_lineage` returns
  442740 cert 2017-10-27 / prior 2003-02-01 / 13 stations / prior_site_not_on_file; `dia_nearby_dialysis_
  competition(35.005382,-89.989957,5)` returns 8 nearby clinics incl. DaVita State Line $19.63/SF + DaVita
  Memphis South $15.00/SF. (Note: its dependency `dia_haversine_miles` already existed — no change needed.)
- **Item 3 (CENSUS_API_KEY):** PENDING Scott — free key from api.census.gov/data/key_signup.html, set in
  Railway Variables (+ .env.local), then run scripts/backfill-dia-location-trade-area-23654.mjs.
