-- ============================================================================
-- Prompt 115 — v_lcc_bd_worklist: kill the per-row correlated subplans
-- ============================================================================
-- SYMPTOM
--   GET /api/operations?action=bd_worklist&limit=5 cost ~8.2s on EVERY page load
--   (warm, not cold-start). It feeds the home BD rail, My Day and the worklist
--   surface. The stats/index pass (20260909120000) fixed planning (145ms -> 15ms)
--   and turned the entity_relationships seq scan into an Index Only Scan, but the
--   endpoint did not move.
--
-- DIAGNOSIS (re-verified 2026-08-16 with the handler's REAL query shape,
--   `ORDER BY rank_value DESC NULLS LAST LIMIT 150` — NOT `LIMIT 5`, which plans
--   completely differently and misled an earlier pass):
--
--     v_lcc_bd_worklist  ORDER BY rank_value DESC NULLS LAST LIMIT 150
--       Execution Time: 30,610 ms      Buffers: shared hit=10,726,588
--         -> Append rows=5054
--              -> Subquery Scan on cw   30,327 ms   <- v_lcc_contact_writeback_candidates
--              -> Subquery Scan on ch      269 ms   <- v_ownership_chain_worklist
--
--   The ORDER BY forces the whole view to materialise, so the LIMIT is irrelevant
--   and shrinking the handler's CAP would achieve nothing.
--
--   ALL of the cost is v_lcc_contact_writeback_candidates, and it is not one
--   correlated subplan but THREE, each re-executed once per candidate person
--   (loops=1648):
--
--     SubPlan 2  sf_account_id        1.179 ms x 1648 =  ~1.9 s
--                  CTE Scan on owner_link, Filter: person_id = e.id
--                  Rows Removed by Filter: 15,695   <- full CTE re-scan per row
--     SubPlan 3  rank_value          12.458 ms x 1648 = ~20.5 s   <- dominant
--                  GroupAggregate (actual rows=3681 loops=1648)
--                    -> Index Scan on entities e_4 (organization)
--                  i.e. v_entity_portfolio_all re-aggregated per output row,
--                  plus the same linear owner_link re-filter (8.99M buffer hits)
--     SubPlan 4  rank_property_count  4.581 ms x 1648 =  ~7.5 s
--                  HashAggregate over 42,245 orgs + the owner_link re-filter
--
--   A CTE scan cannot use an index, so each correlation is O(rows x CTE).
--
-- FIX
--   Hoist both rollups OUT of the correlation so each is computed once and
--   LEFT JOINed onto the candidate rows:
--     * portfolio   — v_entity_portfolio_all pulled into a CTE referenced twice
--                     (pself + owner_roll) so Postgres materialises it once
--                     instead of re-planning the aggregate on each reference.
--     * owner_roll  — the per-person MAX over that person's owner orgs, computed
--                     as ONE GROUP BY over owner_link (15,981 rows) instead of a
--                     correlated aggregate per candidate.
--     * owner_sf    — the person -> SF Account id lookup, likewise grouped once.
--
-- EQUIVALENCE
--   Output columns, types and row semantics are unchanged (this is a
--   CREATE OR REPLACE, so the column list is identical — append-only rule, 42P16).
--   Two points worth stating explicitly:
--     1. The correlated aggregates returned NULL for a person with no owner_link
--        rows (scalar aggregate over the empty set) and the caller COALESCEd that
--        to 0. A LEFT JOIN to the grouped rollup yields NULL for the same people,
--        COALESCEd to 0 identically.
--     2. sf_account_id was `(SELECT ... LIMIT 1)` with NO ORDER BY — i.e. an
--        ARBITRARY row when a person reached several SF Accounts. min() is
--        deterministic. Verified live before the change: of the 1,648 candidates,
--        54 reach an SF Account and **0** reach more than one distinct
--        external_id, so min() is byte-identical here and strictly more stable
--        going forward. (397 persons DB-wide have multiple, but none of them are
--        writeback candidates — they already carry a salesforce Contact identity,
--        which is exactly what the cand NOT EXISTS filter removes.)
--   Verified with a full-set diff in both directions against a snapshot of the
--   pre-change output (5,054 rows) — 0 rows each way. See the round notes.
--
-- MEASURED (same session, same warm cache, handler's real query shape)
--   before: Execution Time 30,610.640 ms   Buffers: shared hit=10,726,588
--   after:  Execution Time    589.881 ms   Buffers: shared hit=    232,071
--   The cw branch alone: 30,327 ms -> 371 ms, and no `loops=1648` node remains.
--
-- NOT TOUCHED (measured, deliberately left alone)
--   The `ch` branch (v_ownership_chain_worklist) is 269 ms of the 30.6 s — it
--   does carry a `Seq Scan on entities e_3` (60,678 rows) inside a HashAggregate,
--   but that scan is ~20 ms and the whole branch is <1% of the cost. Rewriting it
--   would add risk to a shared consumer for no measurable gain.
--
-- SCOPE / DISCIPLINE
--   Additive and reversible — this replaces ONE view body; no table, index, grant
--   or column changes. v_lcc_bd_worklist itself is untouched (it selects from
--   this view). Nothing else in the DB depends on either view (pg_depend check
--   returned 0 dependent views).
--
-- REVERSAL RUNBOOK
--   The previous definition is reproduced verbatim at the foot of this file.
--   To revert, run that CREATE OR REPLACE VIEW statement.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_lcc_contact_writeback_candidates AS
WITH cand AS (
  SELECT e.id AS entity_id,
         e.workspace_id,
         e.name,
         e.email,
         e.phone,
         e.domain,
         e.metadata ->> 'company'::text AS company
    FROM entities e
   WHERE e.entity_type = 'person'::entity_type
     AND e.merged_into_entity_id IS NULL
     AND e.email IS NOT NULL
     AND btrim(e.email) <> ''::text
     AND NOT (EXISTS (SELECT 1
                        FROM external_identities x
                       WHERE x.entity_id = e.id
                         AND x.source_system = 'salesforce'::text
                         AND x.source_type = 'Contact'::text))
), owner_link AS (
  SELECT er.to_entity_id AS person_id,
         er.from_entity_id AS owner_id
    FROM entity_relationships er
   WHERE er.relationship_type = 'associated_with'::text
), portfolio AS (
  -- Referenced twice (pself + owner_roll) so it is materialised ONCE. Previously
  -- the owner-side reference lived inside a correlated aggregate and was
  -- re-aggregated per output row (loops=1648).
  SELECT p.entity_id,
         p.current_annual_rent_total,
         p.current_property_count
    FROM v_entity_portfolio_all p
), owner_roll AS (
  -- The per-person rollup over the owner orgs that person is associated with.
  -- One GROUP BY over owner_link replaces two correlated aggregates.
  SELECT ol.person_id,
         max(GREATEST(COALESCE(cv.connected_property_value, 0::numeric),
                      COALESCE(p.current_annual_rent_total, 0::numeric)))    AS max_value,
         max(GREATEST(COALESCE(cv.connected_property_count, 0)::bigint,
                      COALESCE(p.current_property_count, 0::bigint)))        AS max_count
    FROM owner_link ol
    LEFT JOIN lcc_entity_connected_value cv ON cv.entity_id = ol.owner_id
    LEFT JOIN portfolio p                   ON p.entity_id  = ol.owner_id
   GROUP BY ol.person_id
), owner_sf AS (
  -- Replaces the correlated `(SELECT xa.external_id ... LIMIT 1)`. See the
  -- EQUIVALENCE note above on min() vs the old arbitrary LIMIT 1.
  SELECT ol.person_id,
         min(xa.external_id) AS sf_account_id
    FROM owner_link ol
    JOIN external_identities xa
      ON xa.entity_id = ol.owner_id
     AND xa.source_system = 'salesforce'::text
     AND xa.source_type = 'Account'::text
   GROUP BY ol.person_id
)
SELECT c.entity_id,
       c.workspace_id,
       c.name,
       c.email,
       c.phone,
       c.company,
       c.domain,
       osf.sf_account_id,
       GREATEST(COALESCE(NULLIF(cvself.connected_property_value, 0::numeric), 0::numeric),
                COALESCE(NULLIF(pself.current_annual_rent_total, 0::numeric), 0::numeric),
                COALESCE(orl.max_value, 0::numeric))                          AS rank_value,
       GREATEST(COALESCE(cvself.connected_property_count, 0)::bigint,
                COALESCE(pself.current_property_count, 0::bigint),
                COALESCE(orl.max_count, 0::bigint))                           AS rank_property_count
  FROM cand c
  LEFT JOIN lcc_entity_connected_value cvself ON cvself.entity_id = c.entity_id
  LEFT JOIN portfolio pself                   ON pself.entity_id  = c.entity_id
  LEFT JOIN owner_roll orl                    ON orl.person_id    = c.entity_id
  LEFT JOIN owner_sf   osf                    ON osf.person_id    = c.entity_id;

-- ============================================================================
-- REVERSAL — the pre-Prompt-115 definition, verbatim (pg_get_viewdef, 2026-08-16)
-- ============================================================================
-- CREATE OR REPLACE VIEW public.v_lcc_contact_writeback_candidates AS
--  WITH cand AS (
--          SELECT e.id AS entity_id, e.workspace_id, e.name, e.email, e.phone, e.domain,
--             e.metadata ->> 'company'::text AS company
--            FROM entities e
--           WHERE e.entity_type = 'person'::entity_type AND e.merged_into_entity_id IS NULL
--             AND e.email IS NOT NULL AND btrim(e.email) <> ''::text
--             AND NOT (EXISTS ( SELECT 1 FROM external_identities x
--                    WHERE x.entity_id = e.id AND x.source_system = 'salesforce'::text
--                      AND x.source_type = 'Contact'::text))
--         ), owner_link AS (
--          SELECT er.to_entity_id AS person_id, er.from_entity_id AS owner_id
--            FROM entity_relationships er
--           WHERE er.relationship_type = 'associated_with'::text
--         )
--  SELECT c.entity_id, c.workspace_id, c.name, c.email, c.phone, c.company, c.domain,
--     ( SELECT xa.external_id
--            FROM owner_link ol
--              JOIN external_identities xa ON xa.entity_id = ol.owner_id
--                AND xa.source_system = 'salesforce'::text AND xa.source_type = 'Account'::text
--           WHERE ol.person_id = c.entity_id
--          LIMIT 1) AS sf_account_id,
--     GREATEST(COALESCE(NULLIF(cvself.connected_property_value, 0::numeric), 0::numeric),
--              COALESCE(NULLIF(pself.current_annual_rent_total, 0::numeric), 0::numeric),
--              COALESCE(( SELECT max(GREATEST(COALESCE(cv.connected_property_value, 0::numeric),
--                                             COALESCE(p.current_annual_rent_total, 0::numeric))) AS max
--            FROM owner_link ol
--              LEFT JOIN lcc_entity_connected_value cv ON cv.entity_id = ol.owner_id
--              LEFT JOIN v_entity_portfolio_all p ON p.entity_id = ol.owner_id
--           WHERE ol.person_id = c.entity_id), 0::numeric)) AS rank_value,
--     GREATEST(COALESCE(cvself.connected_property_count, 0)::bigint,
--              COALESCE(pself.current_property_count, 0::bigint),
--              COALESCE(( SELECT max(GREATEST(COALESCE(cv.connected_property_count, 0)::bigint,
--                                             COALESCE(p.current_property_count, 0::bigint))) AS max
--            FROM owner_link ol
--              LEFT JOIN lcc_entity_connected_value cv ON cv.entity_id = ol.owner_id
--              LEFT JOIN v_entity_portfolio_all p ON p.entity_id = ol.owner_id
--           WHERE ol.person_id = c.entity_id), 0::bigint)) AS rank_property_count
--    FROM cand c
--      LEFT JOIN lcc_entity_connected_value cvself ON cvself.entity_id = c.entity_id
--      LEFT JOIN v_entity_portfolio_all pself ON pself.entity_id = c.entity_id;
-- ============================================================================
