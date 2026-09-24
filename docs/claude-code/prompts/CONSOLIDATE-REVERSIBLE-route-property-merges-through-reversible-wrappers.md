# CONSOLIDATE-REVERSIBLE — the property Consolidate button (and the Decision Center merge) must use the reversible merges

Backlog: `CONSOLIDATE-REVERSIBLE`. Source: DOCMAP3's reading pass (CC, 2026-09-24). Re-verified live by Cowork in round 74. **This is a live bug and first in the queue.**

## Measured (Cowork, 2026-09-24)

- **Gov Consolidate fails.** The live gov `gov_merge_property(integer, integer)` is a 362-character stub that RAISEs ("retired from direct use… call `gov_merge_property_reversible`"). The reversible path exists:
  - `gov_merge_property_reversible(p_keep_id bigint, p_drop_id bigint, p_batch_tag text)`;
  - `gov_unmerge_property(p_backup_id bigint)`;
  - `gov_merge_property_apply(integer, integer)`.
- **Dia Consolidate hard-deletes with no snapshot.** It calls `dia_merge_property(integer, integer)`. The reversible pair exists: `dia_merge_property_reversible(p_keep_id, p_drop_id, p_batch_tag)` and `dia_unmerge_property(p_backup_id)`. The Dialysis `CLAUDE.md` twin-merge doctrine requires the reversible path.
- **Call sites still on the old functions** (`api/admin.js`):
  - ~12444: the Decision Center `property_merge` verdict `merge` calls `rpc/dia_merge_property` / `rpc/gov_merge_property`.
  - ~13969: `handleConsolidateProperty`, POST `?_route=consolidate-property`.
- **Already on the right path:** ~12523, the SIDEBAR5 twin lane, calls `dia_merge_property_reversible`. Copy its shape.

## Ask

1. **Grep before editing.** Search every caller of `dia_merge_property` / `gov_merge_property` in `api/`, `mcp/`, `scripts/`, the frontend JS and `supabase/functions/`. List them, then route each one through `*_reversible` with a batch tag. Use `consolidate_<route>_<yyyymmdd>`, or reuse the tag convention the twin lane already uses.
2. **Response shape.** Return the backup id (whatever `*_reversible` returns) in the response and in the Decision Center `record(...)` payload, so an unmerge is one call. Don't add an unmerge button in this prompt; file it if one doesn't exist.
3. **Merge-log reconcile.** Confirm it still sees the merge (Round 76ee Phase 2 reads `property_merge_log`). If the reversible wrappers log elsewhere, make the reconcile read that too, so LCC entity backreferences get repointed.
4. **Live proof on a disposable pair, then undo it.** Pick a pending pair from `gov_property_twin_review`; don't use Saginaw (id 2, Scott's call).
   - If no safe pair exists, prove the path inside a transaction that rolls itself back, on both DBs.
   - Report: the backup id, that the drop row is gone, that the unmerge restores it, and the `property_merge_log` row.

Tests: both call sites use `*_reversible`, and neither calls the bare function (guard with a grep test). Each needs a mutation that turns it red.

## Done means

- Backlog row updated with the evidence.
- Deploy = redeploy BOTH Railway services (`api/admin.js` runs on `tranquil-delight`; say whether the MCP imports it).
- Tell Scott one thing to click to confirm: Consolidate on a known twin, then unmerge.
