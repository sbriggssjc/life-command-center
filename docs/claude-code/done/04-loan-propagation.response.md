# Response — 04 Loan propagation

Status: done.

## What shipped

- Hardened `scripts/asset-metadata-loan-feeder.mjs`.
  - Pages through all OPS asset entities with `metadata.loans`.
  - Resolves property linkage through `external_identities (dia|gov, asset, property_id)`.
  - Inserts structured domain `loans` idempotently, deduped by property + amount band + origination date.
  - Uses the shared lender cleaner to suppress bare brokerages and strip broker prefixes while preserving real lender/deal names.
  - Records a current-balance estimate with explicit upper-bound basis when no servicer balance/amortization schedule is on file.
  - Writes DIA legacy `mortgage_records` idempotently with property/entity linkage in `raw_payload` because that table has no `property_id` column.

- Wired property dossiers to the structured loan table.
  - `buildPropertyPacket()` now includes `debt_financing`.
  - `renderPropertySections()` now renders a deterministic `Debt / Financing` section.

## Live propagation

- Target entity: `bd4aab4a-117c-47cf-b1cd-fbf64ec7b3e0`.
- Target property: DIA `23654`.
- Target apply:
  - Existing loan `913` reused, not duplicated.
  - Patched `current_balance = 1800000`.
  - Inserted/verified mortgage record `c9abcefc-2bb2-49f6-afbc-fc8fad6958fd`.

- Fleet apply:
  - First pass scanned `2534` asset entities; inserted `101` loans and `204` mortgage records.
  - Gov schema mismatch found (`gov.loans` has no `current_balance`), patched.
  - Second pass scanned `2535` asset entities; inserted `23` additional gov loans.
  - Final dry-run: `inserted: 0`, `mortgage_inserted: 0`; remaining skips are already-recorded rows, no domain bridge/config, or no loan amount.

## Verification

- DIA `loans` for property `23654`:
  - `loan_id 913`
  - lender/deal `JPMCC 2019-COR4`
  - originator `LoanCore Cap Prtnrs`
  - loan amount/current-balance estimate `$1,800,000`
  - rate `4.7%`
  - originated `2018-06-08`
  - matures `2028-07-06`
  - LTV `57.4`
  - term `120` months
  - special servicer `Midland Loan Services`
  - source `ops_asset_metadata_loan`

- DIA `mortgage_records` verifies by `raw_payload->>property_id = 23654` with lender `JPMCC 2019-COR4`, original amount `$1,800,000`, rate `4.7`, maturity `2028-07-06`, recording/origination `2018-06-08`.
- Brokerage suppression verified:
  - DIA `loans` with `data_source=ops_asset_metadata_loan` and `lender_name ilike Marcus & Millichap`: `[]`.
  - GOV `loans` with `data_source=ops_asset_metadata_loan` and `originator ilike Marcus & Millichap`: `[]`.
- Dossier verification for 23654:
  - Live packet includes `debt_financing[0]` for `JPMCC 2019-COR4`.
  - Rendered HTML contains `Debt / Financing`, `$1,800,000`, `4.70%`, `2028-07-06`, and `Midland Loan Services`.

## Tests

- `node --test test/asset-metadata-loan-feeder.test.mjs test/dossier-generator.test.mjs` → 13/13 passing.
