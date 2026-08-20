-- ============================================================================
-- P118 (b) — lcc_resolve_owner_address_observation_entities: hoist the
-- normalization out of a correlated subplan.
--
-- Symptom (LCC Opps, cron `lcc-owner-address-feed`, 2026-08-20 05:07Z):
--   ERROR: canceling statement due to statement timeout
--   CONTEXT: PL/pgSQL function lcc_normalize_entity_name(text) line 16
--
-- Root cause: the resolver picked each observation's org entity with a
-- CORRELATED subquery that recomputed `lcc_normalize_entity_name(e.name)` for
-- EVERY organization entity, for EVERY owner-address row. Measured live:
--
--   Limit (actual time=1021.163..1021.163 rows=0 loops=5)
--     -> Index Scan on entities e
--          Filter: (lcc_normalize_entity_name(name) = lcc_normalize_entity_name(o.owner_name))
--          Rows Removed by Filter: 45325
--
-- i.e. ~45k function calls per observation row, ~1.02 s per row -- the textbook
-- correlated subplan CLAUDE.md warns about ("any node with loops= equal to the
-- output row count is a correlated subplan; no index fixes one -- hoist the
-- aggregate out and LEFT JOIN once"). With 44 rows in the backlog that is ~45 s,
-- past the statement timeout, so the tick never committed and the backlog never
-- drained.
--
-- Fix: normalize the org names ONCE into a `norm_org` CTE keyed by the
-- normalized value, and LEFT JOIN on it. `o.owner_name` is still normalized
-- per observation row (44 calls) -- that was never the blow-up.
--
-- Tiebreak is PRESERVED: the old form took `ORDER BY e.created_at ASC LIMIT 1`;
-- `DISTINCT ON (normalized name) ... ORDER BY normalized name, created_at ASC`
-- selects the same earliest-created winner. `e.id ASC` is appended only to make
-- the winner deterministic where two entities share a created_at (the old form
-- was arbitrary there); it cannot change any row the old form resolved stably.
--
-- MEASURED LIVE, ONE SESSION (raw DB timing is session-variable -- CLAUDE.md --
-- so both forms were timed inside a single DO block, with count(eid) rather
-- than count(*) so the planner could not prune the scalar subquery):
--     old correlated,  5 rows : 5,091.8 ms   (-> ~45 s at 44 rows)
--     new hoisted,     5 rows : 1,220.1 ms
--     new hoisted,    44 rows : 1,216.0 ms   <- FLAT: cost no longer scales
--                                               with the number of input rows
-- ~37x on the full backlog, and the correlated SubPlan is gone from the plan.
--
-- EQUIVALENCE PROVEN, 0-row diff BOTH directions, on a match-rich 104-row
-- sample (all 44 unresolved + 60 already-resolved observations so the match
-- path is genuinely exercised, not a vacuous all-NULL comparison):
--     sample_rows 104 | old_matched 58 | new_matched 58
--     diff_rows 0 | old_only 0 | new_only 0
--
-- NOTE / premise correction: `lcc_normalize_entity_name(text)` IS declared
-- IMMUTABLE, so a functional index on it is in fact possible (contrary to the
-- originating note). It is deliberately NOT added here: the hoist alone takes
-- the tick from timeout to ~1.2 s, and an index on a 43k-row, merge-heavy
-- `entities` table is a cost every writer pays for a saving nothing currently
-- needs. It stays available if `entities` grows enough to matter.
--
-- Discipline: idempotent (CREATE OR REPLACE) - behaviour-identical (proven) -
-- no data mutated by this migration itself - fill-blanks only (the UPDATE still
-- touches `owner_entity_id IS NULL` rows exclusively).
-- REVERSAL: re-apply the prior body from
--   20260723123000_lcc_ore_option_a_owner_address_observations.sql
-- ============================================================================
CREATE OR REPLACE FUNCTION public.lcc_resolve_owner_address_observation_entities(p_limit integer DEFAULT 2000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n int;
BEGIN
  WITH src AS (
    -- normalize each observation's owner_name once (44 calls, not the blow-up)
    SELECT o.id, public.lcc_normalize_entity_name(o.owner_name) AS nname
      FROM public.lcc_owner_address_observations o
     WHERE o.owner_entity_id IS NULL AND o.owner_name IS NOT NULL
     LIMIT greatest(1, least(coalesce(p_limit, 2000), 20000))
  ),
  norm_org AS (
    -- normalize each org entity ONCE; earliest created_at wins its name-group
    SELECT DISTINCT ON (public.lcc_normalize_entity_name(e.name))
           public.lcc_normalize_entity_name(e.name) AS nname,
           e.id AS eid
      FROM public.entities e
     WHERE e.entity_type = 'organization'
       AND e.merged_into_entity_id IS NULL
       AND e.name IS NOT NULL
       AND public.lcc_normalize_entity_name(e.name) IS NOT NULL
     ORDER BY public.lcc_normalize_entity_name(e.name), e.created_at ASC, e.id ASC
  ),
  cand AS (
    SELECT s.id, n.eid
      FROM src s
      JOIN norm_org n ON n.nname = s.nname
  )
  UPDATE public.lcc_owner_address_observations o
     SET owner_entity_id = cand.eid
    FROM cand
   WHERE cand.id = o.id AND cand.eid IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END;
$function$;
