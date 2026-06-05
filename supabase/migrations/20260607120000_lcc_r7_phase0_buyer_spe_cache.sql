-- ============================================================================
-- R7 Phase 0 (Slice 1) — materialize the buyer-SPE classification hot path
-- ============================================================================
-- Why: the priority queue read floor was ~5-7s unfiltered. The single root
-- cause is v_lcc_buyer_spe_entities: a 4-branch UNION whose
-- lcc_match_buyer_parent_by_name LATERAL + the 9,934-org × 55-pattern LIKE
-- nested loop costs ~1.2s AND the planner mis-estimates it at ~1.05M rows
-- (real: ~600). That cardinality lie poisons every downstream plan — the view
-- is consumed THREE times inside v_priority_queue (two NOT IN gates + the
-- P-BUYER rollup) and again in v_priority_queue_enriched, so the cost
-- compounds into the 1B-cost / 5.7s plan PR #1062 measured.
--
-- Fix: materialize v_lcc_buyer_spe_entities into a small real table
-- (lcc_buyer_spe_resolved, ~600 rows, accurate stats) and repoint the
-- consumed view at the cache. EVERY downstream consumer (candidates, rollup,
-- resolver tier, the queue's NOT IN gates, the R5 gate trigger) inherits the
-- speed-up with NO change to their own definitions.
--
-- Backward-compatible BY CONSTRUCTION (the R6 owner-facts-mirror rule):
--   * The cache-or-live view returns the cache when populated, else falls back
--     to the EXACT live computation. An empty cache == today's behavior, so
--     DB-vs-Railway deploy ordering is irrelevant.
--   * The cache is loaded from `SELECT DISTINCT <4 cols> FROM the live view`,
--     i.e. the identical row set the UNION produced. Band membership (counts
--     AND entity sets) is byte-identical pre/post — only the latency changes.
--   * v_lcc_buyer_spe_entities keeps its exact column list (entity_id,
--     parent_entity_id, parent_name, match_tier) so CREATE OR REPLACE VIEW is
--     legal against its dependents (candidates / rollup).
--
-- DB-safety (LCC Opps is the auth-critical box): additive only, idempotent,
-- short transaction, entity-scale table (~600 rows), no table rewrites, no
-- VACUUM, no constraint on a hot table, no trigger on a hot write path. ANALYZE
-- is baked into the refresh function (the PR #1062 lesson). Auth blast radius:
-- nothing here touches the auth schema, GoTrue tables, public.users /
-- workspace_memberships, holds no long locks, and cannot fill disk in bounded
-- operation.
--
-- Idempotent: re-applying re-sets both views to the same definitions and
-- re-runs the refresh. Safe to re-run after the cache is already cache-backed
-- (the _live view body is written explicitly, never copied from the
-- already-repointed main view — so no recursion on re-apply).
-- ============================================================================

-- 1. The cache table (entity-scale). No PK (the live UNION can legitimately
--    emit the same (entity_id,parent_entity_id) under two match_tiers, and a
--    PK collision risk on a derived parent_name buys nothing); two btree
--    indexes cover the only access paths: NOT IN by entity_id, rollup by
--    parent_entity_id.
CREATE TABLE IF NOT EXISTS public.lcc_buyer_spe_resolved (
  entity_id        uuid        NOT NULL,
  parent_entity_id uuid        NOT NULL,
  parent_name      text,
  match_tier       text        NOT NULL,
  refreshed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lcc_buyer_spe_resolved_entity
  ON public.lcc_buyer_spe_resolved (entity_id);
CREATE INDEX IF NOT EXISTS idx_lcc_buyer_spe_resolved_parent
  ON public.lcc_buyer_spe_resolved (parent_entity_id);

-- The 15-min cron fully replaces this table each tick (DELETE+INSERT), so
-- harden autovacuum to fire on absolute dead-tuple count rather than a scale
-- factor of a tiny table (the sf_sync_log churn lesson).
ALTER TABLE public.lcc_buyer_spe_resolved SET (
  autovacuum_vacuum_scale_factor  = 0.0, autovacuum_vacuum_threshold  = 500,
  autovacuum_analyze_scale_factor = 0.0, autovacuum_analyze_threshold = 500);

-- 2. Preserve the live computation under a stable name. This is the verbatim
--    current body of v_lcc_buyer_spe_entities (R5 seed + R6 tier-0). Both the
--    cache-or-live view and the refresh function read THIS, never the
--    repointed main view, so there is no recursion.
CREATE OR REPLACE VIEW public.v_lcc_buyer_spe_entities_live AS
 SELECT pf.entity_id,
    m.parent_entity_id,
    m.parent_name,
    'domain_true_owner'::text AS match_tier
   FROM lcc_entity_portfolio_facts pf
     JOIN entities e ON e.id = pf.entity_id AND e.entity_type = 'organization'::entity_type AND e.merged_into_entity_id IS NULL
     JOIN lcc_property_owner_facts pof ON pof.source_domain = pf.source_domain AND pof.source_property_id = pf.source_property_id
     JOIN LATERAL lcc_match_buyer_parent_by_name(pof.true_owner_name) m(parent_entity_id, parent_name) ON true
  WHERE pf.is_current = true AND pof.true_owner_name IS NOT NULL AND m.parent_entity_id <> pf.entity_id
UNION
 SELECT bp.parent_entity_id AS entity_id,
    bp.parent_entity_id,
    pe.name AS parent_name,
    'parent_self'::text AS match_tier
   FROM lcc_buyer_parents bp
     JOIN entities pe ON pe.id = bp.parent_entity_id
UNION
 SELECT e.id AS entity_id,
    p.parent_entity_id,
    parent.name AS parent_name,
    'prefix'::text AS match_tier
   FROM entities e
     JOIN lcc_operator_affiliate_patterns p ON p.relationship = 'buyer_parent'::text AND
        CASE p.pattern_type
            WHEN 'exact'::text THEN lower(e.name) = lower(p.pattern_name)
            WHEN 'prefix'::text THEN lower(e.name) ~~ lower(p.pattern_name)
            WHEN 'contains'::text THEN lower(e.name) ~~ (('%'::text || lower(p.pattern_name)) || '%'::text)
            ELSE NULL::boolean
        END
     JOIN entities parent ON parent.id = p.parent_entity_id
  WHERE e.entity_type = 'organization'::entity_type AND e.merged_into_entity_id IS NULL AND e.id <> p.parent_entity_id
UNION
 SELECT e.id AS entity_id,
    par_p.parent_entity_id,
    parent.name AS parent_name,
    'empirical_portfolio'::text AS match_tier
   FROM entities e
     JOIN lcc_entity_portfolio_facts f ON f.entity_id = e.id AND f.is_current = true
     JOIN LATERAL ( SELECT le.buyer_name
           FROM lcc_listing_events le
          WHERE le.source_domain = f.source_domain AND le.source_property_id = f.source_property_id AND le.buyer_name IS NOT NULL
          ORDER BY le.event_date DESC NULLS LAST
         LIMIT 1) lev ON true
     JOIN lcc_operator_affiliate_patterns par_p ON par_p.relationship = 'buyer_parent'::text AND
        CASE par_p.pattern_type
            WHEN 'exact'::text THEN lower(lev.buyer_name) = lower(par_p.pattern_name)
            WHEN 'prefix'::text THEN lower(lev.buyer_name) ~~ lower(par_p.pattern_name)
            WHEN 'contains'::text THEN lower(lev.buyer_name) ~~ (('%'::text || lower(par_p.pattern_name)) || '%'::text)
            ELSE NULL::boolean
        END
     JOIN entities parent ON parent.id = par_p.parent_entity_id
  WHERE e.entity_type = 'organization'::entity_type AND e.merged_into_entity_id IS NULL AND e.id <> par_p.parent_entity_id;

-- 3. Repoint the consumed view at the cache, with live fallback when empty.
--    When the cache is populated the planner evaluates `EXISTS(cache)` once as
--    a constant: the live branch's `NOT EXISTS(cache)` becomes a One-Time
--    Filter: false that gates the whole expensive subtree out of execution.
--    When the cache is empty the live branch runs (== current behavior).
CREATE OR REPLACE VIEW public.v_lcc_buyer_spe_entities AS
  SELECT entity_id, parent_entity_id, parent_name, match_tier
    FROM public.lcc_buyer_spe_resolved
   WHERE EXISTS (SELECT 1 FROM public.lcc_buyer_spe_resolved)
  UNION ALL
  SELECT entity_id, parent_entity_id, parent_name, match_tier
    FROM public.v_lcc_buyer_spe_entities_live
   WHERE NOT EXISTS (SELECT 1 FROM public.lcc_buyer_spe_resolved);

-- 4. Idempotent refresh: recompute from the live view, swap contents in one
--    short transaction, ANALYZE. DELETE+INSERT (not TRUNCATE) keeps it
--    lock-light. The DISTINCT mirrors the UNION dedup so the cached set is
--    identical to the live set.
CREATE OR REPLACE FUNCTION public.lcc_refresh_buyer_spe_resolved()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM public.lcc_buyer_spe_resolved;
  INSERT INTO public.lcc_buyer_spe_resolved
    (entity_id, parent_entity_id, parent_name, match_tier, refreshed_at)
  SELECT DISTINCT entity_id, parent_entity_id, parent_name, match_tier, now()
  FROM public.v_lcc_buyer_spe_entities_live;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- Refresh planner stats so the ~600-row reality replaces the stale estimate
  -- (PR #1062 lesson; ANALYZE is transaction-safe, VACUUM is not).
  ANALYZE public.lcc_buyer_spe_resolved;

  RETURN v_n;
END;
$fn$;

-- 5. Populate now so the view is cache-fast immediately on apply (and the R5
--    gate / R6 resolver keep their current classification with no lag).
SELECT public.lcc_refresh_buyer_spe_resolved();

-- 6. Short-cycle cron keeps the cache current. The SPE set only changes when
--    buyer patterns / parents / the owner-facts mirror / portfolio facts move,
--    so a 15-minute refresh is ample; the live fallback covers a cold cache.
--    (Distinct dollar-quote tags — the R6 nested-$$ cron lesson.)
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-buyer-spe-refresh') THEN
    PERFORM cron.unschedule('lcc-buyer-spe-refresh');
  END IF;
  PERFORM cron.schedule(
    'lcc-buyer-spe-refresh',
    '*/15 * * * *',
    $job$SELECT public.lcc_refresh_buyer_spe_resolved();$job$
  );
END
$cron$;
