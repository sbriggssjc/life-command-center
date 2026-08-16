# Prompt 115 — `v_lcc_bd_worklist`: kill the per-row correlated subplan (8.2s → target <1s)

**Origin:** browser re-measure of the merged build, 2026-08-15
(`docs/architecture/panel-redesign-verification.md` §4.2d). This is the endpoint that did **not** improve
after the stats/index pass, and it is now precisely diagnosed.

**Why it matters:** `/api/operations?action=bd_worklist&limit=5` costs **8,171ms on every page load** (warm,
not cold-start). It feeds the home BD rail, My Day and the worklist surface. It is the single slowest thing
on the app after `decisions?summary=1`.

---

## Grounded diagnosis — do not re-derive, but DO re-verify

**Two things have already been ruled out. Do not spend time on them again:**

1. **It is not stale statistics or a missing index.** Both were fixed
   (`20260909120000_lcc_perf_stats_and_rel_type_index.sql`): `entity_relationships` now has
   `idx_entity_rel_type_from_to` and autoanalyze at a 2% scale factor. The CTE's seq scan became an Index
   Only Scan and planning dropped 145ms → 15ms. The endpoint **did not move** (8,192 → 8,171 ms).
2. **It is not the fetch size.** The handler uses `CAP = 150`, and shrinking it changes nothing:

   | Query shape | Execution |
   |---|---|
   | `LIMIT 5`, **no** ORDER BY | **321 ms** |
   | `ORDER BY rank_value LIMIT 25` | **18,561 ms** |
   | `ORDER BY rank_value LIMIT 150` (the handler) | **19,320 ms** |

   The `ORDER BY` forces the whole view to materialise, so the limit is irrelevant. A previous pass was
   about to ship a CAP reduction on the strength of the misleading `LIMIT 5` number — it would have
   achieved nothing.

**The actual cost — `SubPlan 2`, a correlated aggregate that runs once per output row:**

```
SubPlan 2
  ->  Aggregate  (actual rows=1 loops=1648)              <- 1,648 executions
        ->  Merge Right Join
              ->  GroupAggregate  (actual rows=3681 loops=1648)   <- re-aggregates orgs, per row
                    ->  Index Scan on entities e_4 (organization) rows=3682 loops=1648
              ->  CTE Scan on owner_link ol  (actual rows=0 loops=1648)
                    Filter: (person_id = e.id)
                    Rows Removed by Filter: 15981                 <- full CTE re-filter, per row
```

For each of 1,648 candidate people the view re-aggregates ~3,681 organizations **and** linearly re-filters
the entire 15,981-row `owner_link` CTE. A CTE scan cannot use an index, so the correlation is O(rows × CTE).

---

## The fix

Hoist the owner→portfolio rollup **out of the correlation** so it is computed once and joined:

1. Materialise `owner_link` (person → owner org, from `entity_relationships.relationship_type =
   'associated_with'`) **keyed for lookup**, not as a correlated CTE scan.
2. Compute the per-organization portfolio aggregate **once** (it is already computed once elsewhere in the
   same plan — see the non-correlated `GroupAggregate` at the top of the `cw` branch, which produces 42,245
   rows in ~a single pass). Reuse that instead of recomputing it per row.
3. `LEFT JOIN` the result onto the candidate rows.

Expected shape afterwards: one pass over people, one pass over orgs, one hash join — no `loops=1648`.

**Consider also:** the `ch` (ownership-chain) branch produces 3,406 rows through a nested-loop chain with
its own `Seq Scan on entities e_3 (60,678 rows)` inside a HashAggregate. It is cheaper than `cw` but not
free; measure it separately before deciding whether to touch it.

---

## Constraints

- **`v_lcc_bd_worklist` is a shared consumer** — the home BD rail, My Day and the worklist surface all read
  it, and `getBdWorklist` merges it with five cross-region domain sources. **Output columns and row
  semantics must not change.** Verify with a full-set diff, not a spot check:
  ```sql
  -- must return 0 rows both ways
  select * from old_view except select * from public.v_lcc_bd_worklist;
  select * from public.v_lcc_bd_worklist except select * from old_view;
  ```
  (snapshot the current output into a temp table first — it is only ~5,054 rows).
- `CREATE OR REPLACE VIEW` is **append-only for columns** (Postgres 42P16). If the column list must change,
  that is a DROP + CREATE and every dependent view/grant must be re-checked.
- Additive, reversible (keep the old definition in the migration header), dry-run the timings before and
  after in the same session so the comparison is apples-to-apples.

## Deliverable

1. **Re-verify the diagnosis first** with `EXPLAIN (ANALYZE)` on the handler's real query shape
   (`ORDER BY rank_value DESC NULLS LAST LIMIT 150`) — not `LIMIT 5`, which is what misled the last pass.
2. The rewritten view, with the equivalence diff above showing **0 rows** in both directions.
3. Before/after execution time at `LIMIT 150`, plus a **browser** re-measure of
   `action=bd_worklist&limit=5` (the DB number alone has already proved misleading once — the endpoint is
   the metric that counts).
4. While you are there: **`/api/priority-queue?limit=5` measures 5,776 ms** in the same browser capture and
   has not been diagnosed at all. Profile it; if it shares the same correlated-subplan shape, fix both.
5. Update `panel-redesign-verification.md` §4.2d with the new numbers.

## Out of scope
- Cross-region latency (three Supabase projects in three regions) — architectural.
- The `count=exact` badge counts in `fetchFederatedSource` — separate, already logged.
