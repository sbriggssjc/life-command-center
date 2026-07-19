# Claude Code (LCC) — `v_priority_queue_live` degraded to >60s and saturated LCC Opps (forced a DB reset)

## What happened (grounded live 2026-07-19, LCC Opps `xengecqvemvfknjvbvrq`)

LCC Opps became unreachable for new connections — every SQL read timed out on connect
while the project reported `ACTIVE_HEALTHY` and pg_cron kept running. **Scott had to reset
and recover the database.** LCC Opps is the auth DB, so this is a sign-in-lockout class of
incident, not a degraded-feature one.

### Root cause

`lcc_refresh_priority_queue_resolved()` runs `INSERT INTO lcc_priority_queue_resolved
SELECT ... FROM public.v_priority_queue_live`. **That INSERT now exceeds a 60-second
statement timeout.** Reproduced live — calling the refresh through the MCP SQL path fails:

```
ERROR: 57014: canceling statement due to statement timeout
CONTEXT: SQL statement "INSERT INTO public.lcc_priority_queue_resolved ...
          FROM public.v_priority_queue_live"
PL/pgSQL function lcc_refresh_priority_queue_resolved() line 6
```

Postgres logs confirm it in steady state, every 5 minutes:

```
duration: 61575 ms  SELECT public.lcc_refresh_priority_queue_resolved();
duration: 61983 ms  SELECT public.lcc_refresh_priority_queue_resolved();
duration: 63872 ms  SELECT public.lcc_refresh_priority_queue_resolved();
```

`pg_stat_statements` cumulative: **12,664 calls / 116,889 s total (32.5 hours of DB time) /
9,230 ms mean.** The mean is lower than 62s because it degraded over time — it is now the
worst it has ever been. Cron job 97 was `*/5`, so a 62s query held a connection **~20% of
every wall-clock minute** on a DB with `max_connections = 90`. That is what exhausted the
pool.

### Why it degraded (the trigger)

`v_priority_queue_live` was ~1.1 s when R7 Slice 1 materialized it. Since then R5/R6/R10
Unit 3b/R16 Unit 2/R20/R25 each added CTEs that scan the entity graph — `person_connected_entities`,
`self_contactable_person_entities`, `reachable_cadence`, the buyer-SPE `NOT IN` gates, the
junk-name exclusion. Those scale with `entities` × `entity_relationships` × `external_identities`.

The SF campaign-list seed just added **6,545 new person entities in 2 days** (entities
39k → 45,797; entity_relationships 101,506; external_identities 49,867). The live view's
graph CTEs went superlinear against that volume and crossed the cliff.

**So this is not "the SF import was bad" — the import was correct. It exposed that the
5-minute queue refresh has no cost ceiling and scales with the whole entity graph.**

### Ruled out (do not re-investigate)

- **Not cache bloat.** `lcc_priority_queue_resolved` = 1,122 live rows / **0 dead tuples** /
  576 kB, autovacuumed 14,155 times. All the cache tables are tiny and clean.
- **Not the cache-or-live UNION failing to short-circuit.** I suspected the
  `WHERE EXISTS (...) UNION ALL ... WHERE NOT EXISTS (...)` pattern was making every read pay
  live cost. It is not: `select count(*) from v_priority_queue` returns 1,122 rows in
  **0.4 ms**, and `v_priority_queue_band_counts` returns in **76 ms** (matching the 68 ms R7
  documented). Reads are fine. **Only the refresh — which must compute the live view by
  definition — is slow.**
- **Not missing basic FK indexes.** `entity_relationships` has `from_entity_id` and
  `to_entity_id` indexes; `external_identities` has entity/source indexes.

## Mitigation already applied live (do NOT redo; do re-tighten at the end)

Cron cadence backed off, within the documented R7 staleness contract (the queue is a
worklist; band-moving verdicts already call `lcc_refresh_priority_queue_resolved()`
on demand, so background cadence only affects passive freshness):

| job | was | now |
|---|---|---|
| 97 `lcc-priority-queue-refresh` | `*/5` | `*/20` |
| 91 `lcc-review-lane-counts-refresh` | `*/5` | `*/10` |

Duty cycle ~20% → ~5%. This stops the saturation risk; it does **not** fix the 62s query.

## What to build

### Unit 1 — profile `v_priority_queue_live` and fix the hot CTEs (the real fix)

Target: **< 5 s**, ideally < 2 s (it was ~1.1 s).

1. Get a real plan. The statement timeout blocks it through pooled clients, so raise it for
   the session: `SET LOCAL statement_timeout = '180s';` then
   `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF) SELECT * FROM v_priority_queue_live;`
   (`TIMING OFF` keeps the overhead down; the plan is ~100 kB — summarize, don't paste it all).
2. Identify which CTEs dominate. Prime suspects, in order:
   - `person_connected_entities` / `self_contactable_person_entities` (R16/R20) — these join
     `entities` (45.8k) to `entity_relationships` (101.5k) filtered on
     `relationship_type IN ('associated_with','contact_at','works_at')` and on
     `entity_type='person'` + email/phone. **There is no index on
     `entity_relationships.relationship_type`** — check whether that's driving a seq scan or a
     bad nested loop.
   - `reachable_cadence` (R10 Unit 3b) — note the historical `NOT IN` vs `NOT EXISTS` NULL bug
     documented in CLAUDE.md; confirm the current body still uses `NOT EXISTS`.
   - the three `NOT IN (SELECT ... FROM v_lcc_buyer_spe_entities)` gates (R5) — that view is
     itself cached (`lcc_buyer_spe_resolved`, 758 rows), so these should be cheap; verify they
     actually hit the cache and not `v_lcc_buyer_spe_entities_live`.
3. Fix with the least invasive change that holds:
   - **Prefer indexes** — e.g. `entity_relationships (relationship_type, from_entity_id)` and
     `(relationship_type, to_entity_id)`; a partial index on `entities` for the
     self-contactable predicate. Additive, reversible, no view rewrite.
   - **Then consider materializing a shared CTE.** If the connection/reachability predicate is
     the cost and it is recomputed per band, extract it into its own small cron-refreshed cache
     table and have the live view read that — exactly the R7 Slice 1 and R17
     `lcc_entity_connected_value` pattern (the doctrine is already established; follow it).
     R7 explicitly deferred caching this predicate as "not worth it at 95 ms" — that
     assessment is now stale; the data has grown past it.
   - Rewriting band logic is a last resort. **Band membership must not change.**
4. **Prove no regression.** Before/after, compare every band on both count AND an md5 of the
   ordered entity-id set — the exact check R7 Slice 1 used:
   ```sql
   select priority_band, count(*),
          md5(string_agg(entity_id::text, ',' order by entity_id)) sig
   from v_priority_queue_live group by 1 order by 1;
   ```
   All bands must match byte-for-byte. Current baseline: 1,122 rows across 10 bands.

### Unit 2 — a cost ceiling so this can never saturate again (the durable guard)

The refresh had no upper bound on cost or duration and no alarm when it degraded 60×.

- Add `SET LOCAL statement_timeout` inside `lcc_refresh_priority_queue_resolved()` (e.g. 45 s)
  so a pathological refresh **fails fast and leaves the previous cache intact** rather than
  holding a connection. The cache-or-live pattern already makes a stale cache safe — a skipped
  refresh costs freshness, never correctness.
- Record each refresh's duration and row count (a small `lcc_refresh_log` table, or reuse
  `lcc_health_alerts`), and open a `slow_refresh` alert when duration crosses a threshold
  (e.g. 15 s). The hourly `lcc-cron-health-check` already surfaces `lcc_health_alerts` in the
  daily briefing — reuse it, don't build a new watcher (that's the R18 Unit 2 lesson: a new
  watcher can itself be silently disabled).
- Consider applying the same `statement_timeout` guard to the other refresh functions
  (`lcc_refresh_review_lane_counts` 1.5 s mean, `lcc_refresh_buyer_spe_resolved` 4.0 s mean,
  `lcc_harvest_sf_comp_on_market` 9.4 s mean) — same class of unbounded cron work.

### Unit 3 — restore cadence once Unit 1 lands

With the live view back under ~5 s, return job 97 to `*/5` and job 91 to `*/5`
(`SELECT cron.alter_job(97, schedule => '*/5 * * * *');`). **Do this only after the
before/after band signatures match and the measured duration is confirmed** — and commit the
final schedule as a repo migration so a replay doesn't resurrect `*/5` against a slow view.

## Boundaries

LCC Opps only · no dia/gov writes · auth schema untouched · additive/reversible (indexes,
optional cache table, function guard) · **band membership byte-identical** · ≤12 `api/*.js`
(this is a pure-DB round; no JS expected) · commit every live change as a repo migration.

## Verify

1. `EXPLAIN (ANALYZE, TIMING OFF)` on `v_priority_queue_live` — report before/after wall time.
2. Band count + md5 signature identical before/after (all 10 bands, 1,122 rows).
3. Time the actual refresh: `SELECT public.lcc_refresh_priority_queue_resolved();` completes
   well inside the new statement_timeout.
4. `select count(*) from v_priority_queue` still ~0.4 ms and `v_priority_queue_band_counts`
   still <100 ms (no read regression).
5. Confirm cron 97/91 schedules match whatever the final decision is, and that a deliberately
   slow refresh opens a `slow_refresh` alert instead of hanging.
