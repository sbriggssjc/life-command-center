# Prompt 03 Broker Role Attribution Worklog

## Objective
For Northmarq sell-side deals, make our SF/SJC roster authoritative for the canonical listing broker. Preserve third-party feed attribution separately and surface a disagreement rather than silently overwriting.

Worked record: dia property 35724 / sale 14832. Current failure mode: CoStar captured Chris Bodnar / CBRE as `listing_broker` even though `is_northmarq=true` indicates our sell-side role.

## Plan
- Add pure reconciliation planning to `api/_handlers/party-extract.js`.
- Add a dry-run-first runner, `scripts/reconcile-northmarq-broker-role.mjs`, to apply the plan against live domain/Ops data.
- Register `northmarq_sf_roster` in field priority so authoritative writes are provenance-aware.
- Add unit coverage for the 35724-shaped case.
- Verify tests and, if credentials/network allow, run a 35724 dry-run/apply.

## Changes
- `planNorthmarqListingBrokerReconciliation()` returns:
  - authoritative `listing_broker` patch from SF/SJC roster or Team Briggs fallback,
  - `sale_brokers` links for our listing role plus third-party `as_reported_listing`,
  - `northmarq_authoritative_role_conflict` disagreement metadata.
- `scripts/reconcile-northmarq-broker-role.mjs`:
  - reads `is_northmarq=true` sales,
  - consults `v_sjc_deal_book` where available,
  - applies only with `--apply`,
  - records `party_extract_disagreements`,
  - records `lcc_deal_conflict`,
  - uses `shouldWriteField()` before patching `sales_transactions.listing_broker`.
- Added `20260801193000_lcc_northmarq_broker_role_priority.sql` for `northmarq_sf_roster`.

## Verification
- `node --test test/party-extract.test.mjs` passes: 22 tests / 9 suites.
- Live dry-run before apply found property 35724 / sale 14832 had `is_northmarq=false` and `listing_broker="Chris Bodnar (CBRE Inc.)"`, contrary to the prompt premise.
- Scoped live apply used `--property 35724 --force-northmarq --apply` to reconcile only the worked record:
  - `sales_transactions.listing_broker` now reads `Team Briggs / Northmarq`.
  - `party_extract_disagreements` records `northmarq_authoritative_role_conflict` with Team Briggs vs Chris Bodnar / CBRE.
  - `lcc_deal_conflict` is open with Team Briggs from `northmarq_sf_roster` and CBRE from `costar_sidebar` as `as_reported_listing`.
- Domain `sale_brokers.role='as_reported_listing'` insert was rejected by the current `sale_brokers_role_check`; retention is currently in LCC conflict/disagreement lanes. A future domain migration can widen the role check if we want the domain junction to carry the same as-reported role.
