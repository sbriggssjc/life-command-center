# Dossier Reconciliation 23654 Worklog

## Objective
Read-only reconciliation of the v2 gold-standard dossier design for 5247 Airways Blvd, Memphis, TN 38116 against the production property-panel/contact360/dossier code path and the current live values for dialysis property_id 23654 / CCN 442740 / OPS asset entity bd4aab4a-117c-47cf-b1cd-fbf64ec7b3e0.

## Instructions
- Do not fix production code or data in this pass.
- Use `docs/architecture/dossier-standard-and-llm-contract.md` section 3 plus sections 7 and 8, and `docs/architecture/dossier-example-5247-airways-v2.html` as the design target.
- Grounding rule: never fabricate; absent fields are "Not on file"; computed fields are labeled "Derived" with inputs; conflicts are surfaced; owner is never the operator.

## Trace Plan
- Inspect `detail.js` property-panel loaders and client dossier builder.
- Inspect `api/_handlers/entities-handler.js` for `portfolio`, `contact360`, and `documents`.
- Query live read paths for property 23654 and asset entity bd4aab4a-117c-47cf-b1cd-fbf64ec7b3e0.
- Write the field-by-field reconciliation to `docs/architecture/dossier-design-vs-production-23654.md`.

## Findings So Far
- The production property-panel dossier button is the client-side v1 builder in `detail.js`; it does not call the newer server-side dossier packet/generator.
- The property panel loads core rows from `v_property_detail`, `v_lease_detail`, `v_ownership_current`, `v_ownership_chain`, `v_property_rankings`, supplemental `properties`, and lazy Operations/Deal/Documents calls.

## Final Read-Only Findings
- Wrote the reconciliation artifact to `docs/architecture/dossier-design-vs-production-23654.md`.
- Production has many v2 ingredients in tab loaders, but the Dossier button omits them because it renders a v1 client HTML from `_udCache`.
- Highest BD-impact deltas: document endpoint pollution, Deal History source priority, incomplete active-listing economics, operations value conflicts, and the v2 packet/generator not being wired to the property panel.

## 2026-08-01 P0 CMS Denorm Fix
- Objective: stop 23654-style operations/revenue drift by reading CMS tables as source of truth and retiring bad `properties` revenue denorms.
- LCC changes: dossier packet now reads current patients from `medicare_clinics.latest_estimated_patients`, keeps `facility_patient_counts` as trend context, and the Operations panel/export no longer falls back to `properties`/rankings revenue.
- DialysisProject changes: `propagate_property_financials.py` no longer writes `properties.estimated_annual_revenue`; `property_cms_reconciliation.py` flags/backfills denorm drift and clears retired property revenue.
- Verification target: property 23654 / CCN 442740 should display 13 stations, 33 patients, 4,283 TTM treatments, and revenue `Not on file` unless corrected clinic economics exist.

## 2026-08-01 P3 Relocation + Market Competition
- Objective: close the two remaining 5247 Airways dossier gaps without fabricating prior-site facts.
- Dialysis migration added `v_clinic_relocation_lineage`, `dia_nearby_dialysis_competition(lat,lng,radius,limit,exclude_ccn)`, and an idempotent 442740 `clinic_history_unified` lineage marker. The marker records the known 2003-02-01 operator prior certification and 2017-10-27 facility certification while keeping prior address/chairs/distance null (`Not on file`).
- LCC dossier packet now reads relocation lineage plus nearby dialysis competition within 5 miles of the property geocode, including operator, stations, patients, and rent/SF where a lease row supports it.
- Dossier renderer now includes an Operations relocation row and a Market Competition table. Missing prior site or competitor rent renders `Not on file`; rent/SF derived from annual rent/building size is labeled by the SQL `rent_source`.

## 2026-08-01 Prompt 07 Backlog Index Reconciliation
- Objective: reconcile the P0-P3 follow-up index and tell Cowork which backlog items can close.
- Close prompts 0-6. Prompt 5 is closed through prompt 04 loan propagation plus `DOSSIER_DEBT_GRAPH_FIX_WORKLOG.md`; prompt 6 wiring is closed because the documents endpoint now aggregates intake, CRE property documents, and Salesforce files with reconciled status.
- Keep prompt 7 open only for live Dialysis_DB migration apply credentials.
- Keep prompt 8 open only for Census radius-demographics backfill after `CENSUS_API_KEY` is configured; map cache, Places callouts, ZIP fallback, payer mix, and rendering are implemented.
