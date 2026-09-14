# Prompt 118 — Fix two overnight cron failures: provenance-prune FK guard + owner-address-feed timeout

**Status:** DRAFT 2026-08-20 (Cowork-diagnosed from live LCC Opps `v_lcc_health_alerts_open`)

Grounding: `field_provenance_prune(interval,boolean)` and
`lcc_resolve_owner_address_observation_entities()` (called by `lcc_owner_address_feed_tick()`), both on
**LCC Opps** (`xengecqvemvfknjvbvrq`). CLAUDE.md doctrines: the **correlated-subplan** perf antipattern
("any node with `loops=` equal to the output row count is a correlated subplan — no index fixes it; hoist
the aggregate out and LEFT JOIN once"), the **disk-full → sign-in-lockout** footgun (a prune that never
completes lets `field_provenance` grow), and provenance discipline (never lose an audit row).

Both are **additive/live-immediate migrations on LCC Opps — no Railway deploy.**

## Bug 1 — `field-provenance-prune` cron fails with an FK violation (easy, do first)

Live error (2026-08-20 04:30Z):
```
ERROR: update or delete on table "field_provenance" violates foreign key constraint
"field_provenance_resolutions_attempted_provenance_id_fkey" on table "field_provenance_resolutions"
DETAIL: Key (id)=(187741) is still referenced from table "field_provenance_resolutions".
CONTEXT: SQL "delete from public.field_provenance where id = any(v_ids)" … field_provenance_prune line 56
```

Root cause: `field_provenance_resolutions` references `field_provenance` via **two** FK columns —
`current_provenance_id` AND `attempted_provenance_id`. The prune's candidate filter only excludes rows
referenced by `current_provenance_id`:
```sql
and not exists (select 1 from public.field_provenance_resolutions r
                 where r.current_provenance_id = fp.id)
```
A provenance row referenced only via `attempted_provenance_id` (e.g. id 187741) passes the guard and the
delete violates the constraint.

**Ask:**
1. Add the missing guard so a candidate is excluded if referenced by EITHER column:
   `and not exists (select 1 from public.field_provenance_resolutions r where r.attempted_provenance_id = fp.id)`
   (add alongside the existing `current_provenance_id` guard, in BOTH the dry-run count block and the delete
   loop's candidate CTE). Keep the batch/time-budget structure intact.
2. Verify: id 187741 (and its cohort) is no longer selected; run the prune non-dry — it completes and returns
   a `deleted`/`refs_nulled` count with no FK error; `remaining_total` is sane.
3. Consider (only if it reflects real intent) whether `attempted_provenance_id` rows should ever be prunable
   via a nulling step like the existing `superseded_by_id` reset — but default to the conservative skip above;
   do not delete an audit row that a resolution still points at.

## Bug 2 — `lcc-owner-address-feed` cron: statement timeout (correlated subplan)

Live error (2026-08-20 05:07Z), inside `lcc_resolve_owner_address_observation_entities()`:
```
ERROR: canceling statement due to statement timeout
CONTEXT: PL/pgSQL function lcc_normalize_entity_name(text) line 16 …
SQL: WITH cand AS (
  SELECT o.id, (SELECT e.id FROM public.entities e
           WHERE e.entity_type='organization' AND e.merged_into_entity_id IS NULL
             AND public.lcc_normalize_entity_name(e.name) = public.lcc_normalize_entity_name(o.owner_name)
           ORDER BY e.created_at ASC LIMIT 1) AS eid
  FROM public.lcc_owner_addres… o …
```

Root cause: the correlated subquery recomputes `lcc_normalize_entity_name(e.name)` for **every organization
entity, for every owner-address row** — O(owner_rows × org_entities) function calls, non-sargable (no index
helps a per-row function call). Classic correlated subplan → timeout. `lcc_normalize_entity_name` is not
IMMUTABLE, so a functional index on it is not the fix.

**Ask:**
1. Hoist the normalization: precompute normalized org names **once** and join on the value. Preserve the
   existing tiebreak (earliest `created_at` wins). E.g.
   ```sql
   WITH norm_org AS (
     SELECT DISTINCT ON (lcc_normalize_entity_name(name))
            lcc_normalize_entity_name(name) AS nname, id AS eid
     FROM public.entities
     WHERE entity_type='organization' AND merged_into_entity_id IS NULL AND name IS NOT NULL
     ORDER BY lcc_normalize_entity_name(name), created_at ASC
   )
   … LEFT JOIN norm_org n ON n.nname = lcc_normalize_entity_name(o.owner_name)
   ```
   (normalizing `o.owner_name` once per owner row is fine; the blow-up was the inner per-entity recompute).
2. Prove equivalence + speed in ONE session (raw DB timing is session-variable — measure both before and
   after in the same session): the rewritten resolver returns the **same eid per owner row** as the old
   correlated form on a sample (0-row diff both directions), and the plan no longer shows a `loops=`-per-row
   correlated subplan. Report before/after timing + buffers.
3. Re-run `lcc_owner_address_feed_tick()` end-to-end within the statement timeout; confirm
   `entities_resolved` advances and no `cron_failure` alert re-opens.

## Close-out
- Register nothing new in `field_source_priority` (no new writer/source here).
- Update `docs/claude-code/STATUS.md` with the fix + the correlated-subplan lesson; note the 2026-08-20
  overnight-verification entry these came from.
- Both fixes are migrations on LCC Opps (`xengecqvemvfknjvbvrq`), live immediately; no deploy gate.
