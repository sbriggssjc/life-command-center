# Prompt 108 — W9.6 comms_owner_bridge provenance: make the owner-attribution writes observable

**Status: DONE (2026-08-14).**

## Gap
Scott worked all 22 W9.6 proposals → 22 confirmed, 22 `comms_owner_attribution_apply_log` rows, the
`correspondence_entity_owner_llc` metric moved 2.5%→9.3% — the writes landed. But `field_provenance` had
**0** `comms_owner_bridge` rows, so these owner-attribution edges were invisible to the provenance ledger /
Decision Center provenance lanes, violating "every cross-table curated write is observed."

## Root cause
The confirm writer (`api/admin.js`, `comms_owner_attribution_review` verdict branch) DID call
`rpc/lcc_merge_field`, but (a) inside a swallowed `catch (_e) {}` that hid the failure, and (b) passed
`p_value: JSON.stringify(ownerEid)` — a double-encoded string against the RPC's `p_value jsonb` param.

## Fix
1. **Un-swallowed** the error → `console.warn` on non-ok / thrown (loud, mirrors the ticks).
2. **Fixed `p_value`** to the RAW owner id (the RPC casts to jsonb — working callers
   `availability-checker` / `sf-promotion-worker` pass the raw value, never `JSON.stringify`). Extracted a
   single builder `buildOwnerBridgeProvenanceArgs` in `api/_shared/comms-owner-attribution.js` consumed by
   both the writer and the regression test. `p_target_database='lcc_opps'` (the ops-local convention — the
   sole existing ops-local provenance row + `sf-promotion-worker` both use it; views don't filter on it).
3. **Backfilled the 22** already-confirmed bridges via migration
   `20260814140000_lcc_w9_6_comms_owner_bridge_provenance_backfill.sql` (applied live) — one provenance row
   per bridge keyed on each review's `sample_activity_id` (the writer's representative pk), through
   `lcc_merge_field`, idempotent (skip if a matching `comms_owner_bridge` write row exists), reversible by
   `source_run_id='w9_6_provenance_backfill:2026-08-14'`.

## Acceptance (verified live)
- `field_provenance` `comms_owner_bridge` = **22** write rows; all 22 in `v_field_provenance_current`.
- `v_field_provenance_unranked` adds **0** for `comms_owner_bridge` (fsp row already registered — no new drift).
- Provenance call no longer fails silently (loud log).
- Regression test (`test/comms-owner-attribution.test.mjs`, +3): asserts `p_value` is the bare id, never
  `JSON.stringify` (guards against the double-encoding).
- Docs: STATUS milestone follow-up + ROLLOUT_STATUS W9.6 row touched.
