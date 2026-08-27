# Dossier Debt / Graph Fix Worklog

## Objective
Fix the 5247 Airways / property 23654 debt and graph-data issues without fabricating dossier facts:
- Feed grounded RCA/deed/OPS metadata loan facts into structured domain `loans`.
- Suppress brokerage names from `finances` lender edges.
- Quarantine bogus 2026-06-23 `costar_sidebar` graph edges for Radar Woodbridge LLC and Clue Drive LLC, and add a same-batch cross-asset guard.

## Grounding
- OPS project: `xengecqvemvfknjvbvrq`.
- DIA project: `zqzrriwuavgrquhisnoa`.
- Asset entity: `bd4aab4a-117c-47cf-b1cd-fbf64ec7b3e0`.
- Property: `23654`, 5247 Airways Blvd, Memphis, TN 38116.
- Rule: absent fields render `Not on file`; derived fields must be labeled with inputs; owner is never operator.

## Current Findings
- Existing code already has `upsertDomainLoans()` for RCA `metadata.loans[]`, `writeLoanFromDeed()` for mortgage/deed-of-trust security instruments, and `cleanLenderName()` for lender normalization.
- The finance graph writer in `unpackSalesHistory()` creates `finances` edges from `sale.lender` before applying the lender cleaner, which allows brokerages such as Marcus & Millichap to land as lenders.
- The domain loan path uses structured facts from `metadata.loans[]`, but asset entity metadata can hold `loans[]` even when the domain `loans` table is empty; this needs a backfill feeder keyed through `external_identities`.

## Changes Planned
- Add shared brokerage/lender guard usage to the finance-edge writer.
- Add a same-batch asset-address guard around sidebar sales-history graph edges so a capture cannot attach purchase/sell/finance edges for another property to the current asset.
- Add a dry-run/apply feeder script that reads OPS asset metadata loans, resolves the `(dia|gov, asset, property_id)` bridge, and fill-blanks inserts domain `loans`.
- Add a reversible quarantine script or SQL migration for the known bad 23654 edges once live IDs are confirmed.

## Changes Made
- `api/_handlers/sidebar-pipeline.js`
  - Added `saleHistoryBelongsToAsset()` same-batch graph guard.
  - Added `lenderNameForGraphFinance()` so brokerages are suppressed before `finances` edges are written.
  - Corrected `writeLoanFromDeed()` to run `cleanLenderName()` before `lenderNamePasses()`.
- `scripts/asset-metadata-loan-feeder.mjs`
  - New dry-run/apply feeder from OPS `entities.metadata.loans[]` to domain `loans`.
  - Upserts `field_source_priority` for `ops_asset_metadata_loan` and records `field_provenance` via `lcc_merge_field`.
- `scripts/quarantine-cross-asset-edges.mjs`
  - New reversible quarantine utility for Radar Woodbridge / Clue Drive cross-asset relationships.
- `supabase/migrations/20260801120000_lcc_ops_asset_metadata_loan_source.sql`
  - SQL registration for the new source in `field_source_priority`.
- `supabase/migrations/20260801121000_lcc_filter_quarantined_relationships.sql`
  - Filters `metadata.quarantined=true` relationships out of `lcc_party_relationships`, `lcc_party_history`, and `lcc_deal_parties`.
- `test/owner-deed-propagation.test.mjs`
  - Added finance-edge brokerage suppression and same-batch cross-asset guard tests.

## Live Actions
- Inserted DIA `loans` row `loan_id=913` for property `23654` from OPS asset metadata:
  - lender/trust: `JPMCC 2019-COR4`
  - originator: `LoanCore Cap Prtnrs`
  - initial balance: `1800000`
  - rate: `4.7`
  - term: `120` months
  - origination: `2018-06-08`
  - maturity: `2028-07-06`
  - LTV: `57.4`
  - data_source: `ops_asset_metadata_loan`
  - current balance: not computed; notes state the amortization/current servicer balance is not on file.
- Quarantined 8 existing Marcus & Millichap `finances` edges on asset `bd4aab4a-117c-47cf-b1cd-fbf64ec7b3e0` with metadata reason `brokerage_recorded_as_lender`.
- Checked Radar Woodbridge / Clue Drive live edge state: zero current candidates attached to this asset; no quarantine patch needed.

## Verification
- `node scripts/asset-metadata-loan-feeder.mjs --entity=bd4aab4a-117c-47cf-b1cd-fbf64ec7b3e0 --dry-run` showed one grounded insert payload.
- `node scripts/asset-metadata-loan-feeder.mjs --entity=bd4aab4a-117c-47cf-b1cd-fbf64ec7b3e0 --apply` inserted loan `913`; second apply skipped as `already_recorded`.
- Live read confirmed loan `913`, 12 provenance writes, 24 source-priority rows, and no `v_field_provenance_unranked` rows for `ops_asset_metadata_loan`.
- `node scripts/quarantine-cross-asset-edges.mjs --asset=bd4aab4a-117c-47cf-b1cd-fbf64ec7b3e0 --dry-run` returned zero candidates.
- `node --test test\owner-deed-propagation.test.mjs` passed.
- `node --test test\lender-name.test.mjs` passed.
- `node --check scripts\asset-metadata-loan-feeder.mjs` passed.
- `node --check scripts\quarantine-cross-asset-edges.mjs` passed.
