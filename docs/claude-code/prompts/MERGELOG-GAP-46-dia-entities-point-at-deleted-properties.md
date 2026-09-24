# MERGELOG-GAP — 46 LCC dialysis entities point at dia properties that no longer exist

Backlog: `MERGELOG-GAP` (plus `CONSOLIDATE-REVERSIBLE-reconcile-unmerge`). Source: CONSOLIDATE-REVERSIBLE (CC, 2026-09-24).

## Measured (CC, 2026-09-24; re-measure first)

- LCC asset entities carry 1,359 distinct dia property ids. **50** are missing from dia `properties`:
  - 3 are in `dia_property_merge_backup`: the reconcile fixes them now that it reads backups (Cowork saw it mark Saginaw's gov backup 7 at 10:10 UTC);
  - 1 is in `property_merge_log`;
  - **46 are in neither.**
- Dia merges between 2026-05-17 and 2026-08-14 are recorded in neither ledger.
- An unmerge doesn't move LCC entities back to the restored property (`CONSOLIDATE-REVERSIBLE-reconcile-unmerge`).

## Ask

1. **For each of the 46, find the drop→keep mapping from evidence.** Sources: any redirects table, `dia_auto_merge_property_duplicates` / `p31_property_consolidation_apply` history, the entity's own capture (address, CCN/Medicare id, CoStar id) matched through the existing address matcher (SIDEBAR3-c folding + GOV-AVAIL1 civic guard), and ownership or sales rows that moved. Report per id: mapped (with evidence), candidate (review), or unknowable.
2. **Repoint only the mapped ones** through `lcc_repoint_entity_property_id`, logged and reversible. Route candidates to an existing review lane (reuse one; don't create a new queue if a property-review lane fits). Leave unknowables as "Not on file" on the entity, with a flag the panel already renders. Don't fabricate a link.
3. **Unmerge follow-through:** when `<dom>_unmerge_property` restores a row, the reconcile moves entities that were repointed by that backup back to the restored id. Mark the backup `unmerged_at`-reconciled. Test with a rolled-back round trip.
4. **Guard:** a daily check (existing health-alert pattern) that counts LCC asset entities whose dia/gov property id doesn't exist, and alerts when the count rises.

Tests: mapping only on evidence, unmerge moves entities back, and the guard fires. Each needs a mutation that turns it red.

## Done means

- Backlog rows updated with the evidence.
- Deploy = redeploy BOTH Railway services if LCC code changes.
- Report the before/after count of dangling entity → property links (dia and gov).
