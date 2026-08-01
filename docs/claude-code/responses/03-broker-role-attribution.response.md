# Response — 03 Broker / role attribution

## What shipped

Added Northmarq sell-side broker-of-record reconciliation:

- `api/_handlers/party-extract.js`
  - Added `planNorthmarqListingBrokerReconciliation()`.
  - For `is_northmarq=true` sell-side rows, our SF/SJC roster source wins the canonical `listing_broker`.
  - The prior third-party value is retained as an as-reported listing view and produces a disagreement.

- `scripts/reconcile-northmarq-broker-role.mjs`
  - Dry-run by default; `--apply` is required for writes.
  - Reads Northmarq sales, consults `v_sjc_deal_book` where available, and applies a scoped field-priority-guarded patch.
  - Records `party_extract_disagreements` with `northmarq_authoritative_role_conflict`.
  - Records/refreshes `lcc_deal_conflict` so the dossier surfaces Team Briggs vs. the third-party feed.
  - Retains the third-party value as `as_reported_listing` in the conflict payload.

- `supabase/migrations/20260801193000_lcc_northmarq_broker_role_priority.sql`
  - Registers `northmarq_sf_roster` as a high-authority source for `listing_broker`.

## Live 35724 verification

Live data initially contradicted the prompt premise: `dia.sales_transactions.sale_id=14832` had
`is_northmarq=false` and `listing_broker="Chris Bodnar (CBRE Inc.)"`. I applied only the worked record with
`--property 35724 --force-northmarq --apply`.

Verified after apply:

- `listing_broker` now resolves to `Team Briggs / Northmarq`.
- `party_extract_disagreements` retains `Chris Bodnar (CBRE Inc.)` as the conflicting third-party value.
- `lcc_deal_conflict` is open with:
  - `Team Briggs / Northmarq` from `northmarq_sf_roster`
  - `Chris Bodnar (CBRE Inc.)` from `costar_sidebar`, role `as_reported_listing`

One domain-level retention note: `sale_brokers.role='as_reported_listing'` is blocked by the current
`sale_brokers_role_check`, so the as-reported CBRE view is retained in LCC conflict/disagreement tables rather
than the domain junction until that check is widened.

## Verify

- `node --test test/party-extract.test.mjs` → 22/22 passing.
- `node scripts/reconcile-northmarq-broker-role.mjs --property 35724 --force-northmarq --limit 5` now reports
  `action: "noop"` with `current_listing_broker: "Team Briggs / Northmarq"` and the retained CBRE/CoStar conflict.
