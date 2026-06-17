# Claude Code — R40: reconcile historical merge-orphans + consolidate cadence on merge

## Why (verified live 2026-06-16, R39 follow-up)
R39 made `lcc_merge_entity` person-complete, so NEW merges repoint backrefs correctly
(verified: 0 orphaned edges on today's tombstones). But the engine was incomplete
historically (it moved only `portfolio_facts` + `external_identities`), so **old merges left
backrefs dangling on tombstones.** Live backlog across **862 tombstones**:
- **6,123 `entity_relationships` edges** point at a tombstone (from_ or to_) instead of the
  survivor — the big one. Relationships to dead nodes = the entity graph misses the
  survivor's connections / shows dead endpoints.
- **19 cadences** reference a tombstone via `entity_id` (the "both persons had a cadence"
  merge case — 14/19 the survivor also has one).
- **5 `external_identities`** on tombstones; **2 tombstone→tombstone chains** (A merged into
  B, but B is itself merged → must resolve to the FINAL survivor).
These don't currently leak into the priority queue / cadence dashboard (those filter
`merged_into_entity_id IS NULL`), so it's not a visible bug — but it IS an inaccurate graph,
and anything traversing relationships directly (context packets, MCP, owner→asset rollups)
hits dead nodes. This is the historical cleanup the now-correct engine enables.

## Unit 1 — retroactive backref reconciliation (the 6,123 + 19 + 5)
A one-time, reversible (snapshot-backed, mirror R22/R35/R37) reconciliation that, for every
tombstone, repoints its remaining backrefs to its **final** survivor:
- **Resolve chains first:** follow `merged_into_entity_id` transitively to the final
  non-tombstone survivor (handle the 2 chained tombstones; guard against cycles).
- **Repoint, reusing the now-correct merge logic** (don't reinvent — call the same
  dedup-safe repoint helpers R39 added to `lcc_merge_entity`, or factor them into a
  `lcc_reconcile_tombstone_backrefs(tombstone, survivor)` the merge path also uses):
  - `entity_relationships` (both directions) → survivor, **content-dedup** (drop if the
    survivor already has the same (other_entity, type) edge) and **drop self-loops**
    (from==to after repoint).
  - `external_identities` → survivor (dedup on the canonical identity key).
  - `watchers` / `activity_events` / `action_items` / `inbox_items` / `research_tasks` /
    `entity_aliases` → survivor (the R39 repoint set), deduped where a unique constraint
    exists.
  - cadences → handled in Unit 2 (the both-have-one case needs consolidation, not a blind
    repoint).
- Snapshot every change to a reversible backup (`r40_merge_reconcile_backup`, full-row jsonb
  + the old/new target). Idempotent; re-run finds 0. Bounded + guard-railed (don't run if the
  survivor resolution fails).
- **Verify after:** `entity_relationships` / `external_identities` pointing at any tombstone
  = 0; load-bearing caches (`lcc_refresh_priority_queue_resolved`,
  `_entity_connected_value`, `_buyer_spe_resolved`) rebuild cleanly (the repointed edges feed
  connected-value, so this may even improve rank coverage).

## Unit 2 — consolidate cadence on merge (forward + the existing 19)
The gap R39 left: when merging two persons who BOTH have an active cadence,
`lcc_merge_entity` can't blind-repoint the loser's cadence (collides with the survivor's
one-active-cadence). Fix the engine to **consolidate**:
- Keep the survivor's cadence; **fold the loser's engagement counters** into it
  (emails_sent/opened/replied, calls, touch counts — sum; keep the most-recent
  last_touch_at; keep the further-along phase); then set the **loser's cadence to a terminal
  `merged` state** (or delete it) so nothing stays active on a tombstone. When only the loser
  has a cadence, the existing blind-repoint is correct (keep it).
- One-time pass to apply this to the existing **19** tombstone cadences (consolidate into the
  survivor's where it has one; repoint where it doesn't). Reversible/snapshot.

## Guards / house rules
- Reversible (snapshot before every change); idempotent; chain- and cycle-safe; content-dedup
  so repointing never creates duplicate edges. Reuse the R39 merge helpers — single source of
  truth for "move backrefs to survivor." ≤12 `api/*.js` (this is SQL + the entity-link/merge
  layer). `node --check`; suite green. Apply live after a dry-run (same gate as R37/R38):
  report the per-table repoint counts for Scott before the write.
- This is LCC-Opps only (entity graph); no dia/gov domain writes; auth schema untouched.

## Bottom line
R39 fixed merges going forward; R40 cleans the 862 historical tombstones that the old
incomplete engine left with 6,123 dangling relationships (+19 cadences, +5 ids, +2 chains),
reconciling every backref to its final survivor reversibly — so the entity graph is the
accurate, fully-connected picture, not a web of edges to dead nodes. Completes the
consolidate/merge/dedup-at-source mandate on the relationship layer.
