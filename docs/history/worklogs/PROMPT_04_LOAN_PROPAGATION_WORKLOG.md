# Prompt 04 Loan Propagation Worklog

## Objective
Propagate OPS asset `entities.metadata.loans[]` into structured domain `loans`, suppress brokerage names as lenders, preserve current-balance estimate provenance, and make property dossiers render the resulting debt facts.

## Current Findings
- Target entity resolves through `external_identities (dia, asset, 23654)` to `bd4aab4a-117c-47cf-b1cd-fbf64ec7b3e0`.
- DIA `loans` already contains loan `913` for property `23654`: `$1,800,000`, `JPMCC 2019-COR4`, `4.7%`, originated `2018-06-08`, matures `2028-07-06`, LTV `57.4`, special servicer `Midland Loan Services`.
- DIA `mortgage_records` is a legacy document-style table with no `property_id`; property linkage must live in `raw_payload`.

## Changes
- Hardened `scripts/asset-metadata-loan-feeder.mjs`:
  - Uses shared lender cleaning to suppress bare brokerages.
  - Preserves CMBS deal names such as `JPMCC 2019-COR4`.
  - Fills `current_balance` as a documented upper-bound estimate only when no servicer balance is on file.
  - Writes idempotent legacy `mortgage_records` rows for DIA with entity/property linkage in `raw_payload`.
  - Exports pure helpers for tests.
- Added `debt_financing` to the property dossier packet in `api/_handlers/entities-handler.js`.
- Added deterministic `Debt / Financing` rendering in `api/_shared/dossier-generator.js`.
- Added focused unit tests for loan mapping, broker suppression, mortgage payload shape, and dossier rendering.

## Verification Plan
- `node --test test/asset-metadata-loan-feeder.test.mjs test/dossier-generator.test.mjs` passed 13/13.
- Target apply for `bd4aab4a-117c-47cf-b1cd-fbf64ec7b3e0` reused loan `913`, patched `current_balance`, and inserted/verified mortgage record `c9abcefc-2bb2-49f6-afbc-fc8fad6958fd`.
- Fleet apply scanned `2535` asset entities after paging fix; final dry-run reports `inserted: 0`, `mortgage_inserted: 0`.
- Live checks show no `Marcus & Millichap` lender/originator rows for `ops_asset_metadata_loan` in DIA/GOV.
- Live 23654 dossier packet and rendered HTML include `Debt / Financing`, `JPMCC 2019-COR4`, `$1,800,000`, `4.70%`, `2028-07-06`, and `Midland Loan Services`.

## Follow-up Notes
- DIA `mortgage_records` is not property-keyed; property linkage is stored in `raw_payload.property_id`.
- GOV `loans` has no `current_balance` column; current-balance estimate remains in `notes.current_balance_estimate` for gov rows.
