-- ============================================================================
-- Page-load performance — stale planner statistics + a missing index
-- ============================================================================
-- Origin: Scott's live console capture, 2026-08-15. Three slow paths on every
-- page load, worse than any of the panel defects we had been chasing:
--     api:/api/review-counts                     1,507ms
--     api:action=cadence_dashboard&limit=200     1,526ms
--     api:action=bd_worklist&limit=5             8,192ms   <- five rows
--     api:summary=1                             16,199ms
--     [Marketing] Opportunities pages 1..12     11,831 rows client-side
--
-- ── ROOT CAUSE 1: statistics 26 days stale on the hottest table ─────────────
-- `entity_relationships` (114,145 rows) had NOT been analyzed since
-- 2026-07-21 — 8,882 modifications accumulated without a refresh.
--
-- Why: autoanalyze fires at 10% of the table (default scale factor 0.1), i.e.
-- ~11,464 modifications for a table this size. It sat below that threshold and
-- drifted for nearly a month. The consequence is visible in the plan for
-- v_lcc_bd_worklist: the planner estimated **2,261 rows where 5 were returned**
-- and 2,413 organizations where 33 matched, so it chose merge/nested-loop plans
-- whose correlated subplans re-scanned ~42,000 organizations PER OUTPUT ROW.
--
-- The fix is not a cron — a cron papers over the threshold. Lower the scale
-- factor on the big, hot tables so autoanalyze keeps up. Note the repo already
-- does exactly this for ~20 smaller tables (`lcc_entity_connected_value`,
-- `owner_contact_pivot`, `field_provenance` …); the two biggest and hottest
-- tables had simply been missed.
--
-- ── ROOT CAUSE 2: no index on entity_relationships.relationship_type ────────
-- The bd_worklist CTE seq-scanned all 114,145 rows to find the 15,981
-- 'associated_with' edges (98,164 removed by filter, 5,776 buffer reads), and
-- the resulting CTE was then re-filtered once per output row. The table had
-- indexes on from_entity_id and to_entity_id only.
--
-- ── MEASURED, warm cache, EXPLAIN ANALYZE on `v_lcc_bd_worklist LIMIT 5` ────
--                       before      after
--   Planning Time      145.3 ms    15.3 ms    (9.5x)
--   Execution Time   1,334.1 ms   321.3 ms    (4.2x)
--   CTE owner_link    Seq Scan     Index Only Scan
--                     71 ms        21 ms
-- Scott's 8,192ms was a COLD cache; both changes cut buffer reads as well as
-- CPU, so the cold path benefits too — but the honest claim is the warm 4.2x.
-- Re-measure from the browser after the next load to get the real-world number.
--
-- Additive and reversible:
--   drop index concurrently if exists public.idx_entity_rel_type_from_to;
--   alter table public.entity_relationships reset (autovacuum_analyze_scale_factor,
--                                                  autovacuum_vacuum_scale_factor);
--   (same for entities / external_identities / the two lcc_ tables)
-- ============================================================================

-- NOTE: applied live with CREATE INDEX CONCURRENTLY (non-blocking). CONCURRENTLY
-- cannot run inside a transaction block, so if this file is replayed through a
-- migration runner that wraps statements in a transaction, drop the keyword.
create index concurrently if not exists idx_entity_rel_type_from_to
  on public.entity_relationships (relationship_type, from_entity_id, to_entity_id);

alter table public.entity_relationships
  set (autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_scale_factor = 0.05);
alter table public.entities
  set (autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_scale_factor = 0.05);
alter table public.external_identities
  set (autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_scale_factor = 0.05);
alter table public.lcc_property_owner_evidence
  set (autovacuum_analyze_scale_factor = 0.05);
alter table public.lcc_entity_portfolio_facts
  set (autovacuum_analyze_scale_factor = 0.05);

analyze public.entity_relationships;
analyze public.entities;
analyze public.lcc_property_owner_evidence;
analyze public.touchpoint_cadence;
analyze public.lcc_property_owner;

-- ============================================================================
-- STILL OPEN — the other two slow paths, with the hypothesis I could DISPROVE
-- removed so the next person does not re-test it
-- ============================================================================
-- (a) `/api/decisions?summary=1` = 16,199ms. NOT the SQL: the underlying
--     `v_lcc_decision_open_counts` runs in **85 ms**. And NOT sequential
--     federation either — I assumed it was and checked: `api/admin.js:8453`
--     already wraps the federated lanes in `Promise.all`.
--     Remaining leads, in order of suspicion:
--       * CROSS-REGION latency. LCC Opps is us-east-1, Dialysis_DB us-west-1,
--         government us-west-2. Every federated lane is a cross-country round
--         trip; parallel or not, the slowest lane sets the floor.
--       * `Prefer: count=exact` (e.g. admin.js:566 does
--         `select=*&limit=1` with count=exact purely to obtain a number).
--         An exact count forces a FULL SCAN. `count=planned` or
--         `count=estimated` would return in constant time, and a lane badge
--         does not need an exact count — it needs an honest order of magnitude.
--     Measure per-lane timings before changing anything.
--
-- (b) Marketing pulls **11,831 rows in 12 sequential round-trips** on load
--     (`app.js` ~3399: `diaQuery('v_opportunity_domain_classified', '*', …)`
--     paging at the PostgREST 1000-row cap). Three compounding problems:
--     `select=*` rather than the columns the render needs; the pages are
--     awaited one after another; and the whole table is pulled to compute what
--     is mostly counts and a filtered page. Push the aggregation server-side,
--     or at minimum fetch the pages with Promise.all and select only the
--     needed columns.
