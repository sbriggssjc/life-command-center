# Claude Code — R41: drop entity_relationship self-loops + guard at the writer (graph hygiene)

## Why (surfaced by R40, verified live 2026-06-16)
After R40 reconciled all merge-orphans (0 dangling edges on tombstones), the only remaining
`entity_relationships` hygiene wart is **99 self-loops** — rows where
`from_entity_id = to_entity_id` (an entity related to itself), all on LIVE entities (0 on
tombstones, so not an R40 artifact). They come from old capture/merge logic (e.g. a sale
where buyer == seller, or a self-reference). Low impact — a graph traversal shows an entity as
its own neighbor — but it's noise in the "accurate connected picture" and trivially fixable.

## Unit 1 — prevent at write
Wherever `entity_relationships` rows are created (the `ensureEntityLink` /
`entity-relationships` writer in `api/_shared/`, and any SQL that inserts edges), **skip when
`from_entity_id = to_entity_id`** — a self-relationship is never meaningful. One guard at the
choke point. (The R40 helper already drops self-loops on repoint; this covers the original
INSERT path so they can't be created in the first place.)

## Unit 2 — clean the 99 existing (reversible)
Snapshot-backed (mirror R40's backup pattern), delete the 99 `from_entity_id = to_entity_id`
rows. Tiny, reversible, idempotent. Optionally add a lightweight CHECK
(`from_entity_id <> to_entity_id`) so it's enforced at the DB — but verify no legitimate
self-edge type exists first (none expected); if a CHECK is too aggressive for any edge type,
the writer guard (Unit 1) is sufficient.

## Guards / house rules
- Reversible (snapshot before delete); idempotent; characterize by `relationship_type` first
  (dry-run count per type) and report before deleting. LCC-Opps only; auth untouched.
  ≤12 `api/*.js`; `node --check`; suite green. Apply live after the dry-run (same gate).
- Verify: 0 self-loops after; a synthetic INSERT with from==to is rejected/skipped; load-
  bearing caches unaffected (self-loops don't feed value, so no rank change expected).

## Bottom line
The last small graph-hygiene item after the R37–R40 dedup sweep: stop self-relationships at
the writer and remove the 99 existing ones, reversibly. Closes the relationship layer.
