# OWNERGAP2-ledger-order — an owner was written without a ledger row because the ledger insert collided on a reused batch tag

**Filed:** 2026-09-16 (Cowork), from the H7 apply. **Owner:** LCC (`api/_shared/ownergap2-owner-writeback.js`,
`api/_handlers/ownergap2-owner-resolve-tick.js`). **Small, one round.**

## What happened

`POST …/ownergap2-owner-resolve-tick?jurisdiction=harris_tx` with `batch_tag=ownergap2_harris_tx_20260916`
(the same tag as the 19-owner apply earlier that day) resolved `2626 South Loop West` and reported
`wrote: 1`. `properties.recorded_owner_id` and `recorded_owners` were written (source
`ownergap2_public_assessor:harris_tx:1145390000003`). **`dia_ownergap2_resolution_log` was not**: the
property already had an `unresolved / no_staged_rows` row under that batch tag from the earlier run,
and `uq_dia_ownergap2_open_attempt (batch_tag, property_id) WHERE reverted_at IS NULL` refused the new
`resolved` row. The owner write went ahead anyway. Cowork inserted the missing ledger row by hand
(id 125, batch `ownergap2_harris_tx_20260916b`, citation notes the repair).

Two defects, one operator error:

1. **Ledger after write, and a ledger failure does not abort the write.** The provenance contract
   (every written owner cites its source row, CHECK-enforced *on the ledger*) is only as strong as
   the order of operations. Write the ledger row first, inside the same transaction as the owner
   write, or roll the owner write back when the ledger insert fails — either way `wrote` must never
   exceed the count of ledger rows created.
2. **A re-run under the same batch tag is silently half-blind.** The dry run had already logged
   `unresolved` rows for this property under that tag; a later `resolved` under the same tag cannot
   be recorded. Either the tick derives its own tag (`<jurisdiction>_<YYYYMMDDTHHMM>`) and reports
   it, or it refuses a `batch_tag` that already has open attempts for the population, with a message
   that names the collision.
3. Operator side (Cowork's): the earlier row for the same property should have been superseded, not
   collided with. Say in the response which behaviour you chose for "a property refused in batch A,
   resolved in batch B": a second row (history) or an update of the open attempt.

## What to build

The ordering fix (1), the tag rule (2), a test where the ledger insert fails and the owner write is
rolled back (positive control: `wrote` = 0 and the property's `recorded_owner_id` unchanged), and a
test for the tag collision message. Also: the ledger `id` sequence sits at 125 with 77 rows — say
where the 48 consumed ids went (failed inserts under the unique index are the likely answer; confirm).

## Prohibitions

- ⛔ Do not touch the fabrication guard, the matcher, or the stage.
- ⛔ Do not delete or rewrite Cowork's hand-written ledger row 125; it is the record of the incident.
- ⛔ Redeploy both Railway services and confirm `/version`.
