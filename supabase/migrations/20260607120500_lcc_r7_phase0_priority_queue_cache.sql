-- ============================================================================
-- R7 Phase 0 (Slice 1, part 2) — materialize v_priority_queue
-- ============================================================================
-- After the buyer-SPE cache (20260607120000) the unfiltered enriched view fell
-- 5,785ms -> ~1,140ms, but the two queries the API actually issues still missed
-- the gate:
--   * items page (enriched + ORDER BY + LIMIT 150, unfiltered): ~2,130ms
--   * band counts (v_priority_queue_band_counts):                 ~627ms
-- Both costs now live in v_priority_queue's OWN structure: an 11-branch
-- UNION ALL of CTEs over 16,672 entities that the planner can't estimate
-- (it guesses ~137K rows; reality is ~1,035). That cardinality lie makes
-- v_priority_queue_enriched nested-loop-rescan v_entity_portfolio_all (9,934
-- rows) once per output row (= ~633ms), and forces band_counts to recompute
-- the whole CTE stack on every read. Band counts < 300ms is simply
-- unreachable while the queue is recomputed live.
--
-- Fix: materialize v_priority_queue into a real ~1,035-row table
-- (lcc_priority_queue_resolved) refreshed on a short cron, and repoint
-- v_priority_queue at it with a live fallback. Because band_counts and
-- enriched both read v_priority_queue by name, they inherit the speed-up with
-- NO change to their own definitions, and the planner — now seeing a real,
-- analyzed 1,035-row table — switches the portfolio/property joins from
-- nested-loop-rescan to hash joins.
--
-- Backward-compatible BY CONSTRUCTION (same rule as the SPE cache / R6 mirror):
-- an empty cache falls through to the exact live computation, so DB-vs-Railway
-- ordering is irrelevant and a stalled cron only ever costs latency, never
-- correctness. The cache is a verbatim snapshot of v_priority_queue_live, so
-- band membership (counts AND entity sets) is identical at refresh time and
-- tracks live within one refresh interval thereafter.
--
-- Staleness note: the queue is a worklist, not a real-time surface. Bands keyed
-- on next_touch_due <= now() (P0/P6/P7) or connection/SPE/opp state
-- (P0.4/P0.5/P-BUYER) update within the 5-minute refresh interval — the same
-- order of latency as the existing refresh_work_counts cron. days_overdue is
-- frozen at refresh time (it is measured in days; minutes of lag are noise).
--
-- DB-safety: additive, idempotent, short transaction, entity-scale table
-- (~1,035 rows), no rewrites, no VACUUM, no hot-path trigger. ANALYZE baked
-- into the refresh. The DELETE+INSERT runs in one transaction so concurrent
-- readers never observe an empty cache mid-refresh (they never fall through to
-- the slow live path during a refresh). Auth blast radius: untouched.
-- ============================================================================

-- 1. The cache table — exact column shape of v_priority_queue (17 cols) so
--    CREATE OR REPLACE VIEW v_priority_queue (cache UNION ALL live) typechecks.
CREATE TABLE IF NOT EXISTS public.lcc_priority_queue_resolved (
  entity_id             uuid,
  name                  text,
  workspace_id          uuid,
  vertical              text,
  owner_user_id         uuid,
  contact_id            uuid,
  bd_opportunity_id     uuid,
  priority_band         text,
  reason                text,
  next_touch_due        timestamptz,
  days_overdue          integer,
  last_touch_at         timestamptz,
  last_touch_type       text,
  effective_owner_role  text,
  owner_role_confidence  numeric(3,2),
  source_domain         text,
  source_property_id    text,
  refreshed_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lcc_priority_queue_resolved_band
  ON public.lcc_priority_queue_resolved (priority_band);
CREATE INDEX IF NOT EXISTS idx_lcc_priority_queue_resolved_entity
  ON public.lcc_priority_queue_resolved (entity_id);

-- The 5-min cron fully replaces this table each tick (DELETE+INSERT); fire
-- autovacuum on absolute dead-tuple count, not a scale factor of a tiny table.
ALTER TABLE public.lcc_priority_queue_resolved SET (
  autovacuum_vacuum_scale_factor  = 0.0, autovacuum_vacuum_threshold  = 500,
  autovacuum_analyze_scale_factor = 0.0, autovacuum_analyze_threshold = 500);

-- 2. Preserve the live computation under a stable name. Captured dynamically
--    from the CURRENT v_priority_queue body the first time only — guarded on
--    non-existence so a re-apply (when v_priority_queue is already the
--    cache-or-live form) cannot copy the cache form back into _live and create
--    a recursive view. On a fresh migrate-from-scratch, v_priority_queue still
--    carries its full body here, so the capture is the genuine live query.
DO $do$
BEGIN
  IF to_regclass('public.v_priority_queue_live') IS NULL THEN
    EXECUTE 'CREATE VIEW public.v_priority_queue_live AS '
         || pg_get_viewdef('public.v_priority_queue'::regclass, true);
  END IF;
END
$do$;

-- 3. Repoint the consumed view at the cache, with live fallback when empty.
--    (When the cache is populated, the live branch's NOT EXISTS gate becomes a
--    One-Time Filter: false and the expensive CTE stack never executes.)
CREATE OR REPLACE VIEW public.v_priority_queue AS
  SELECT entity_id, name, workspace_id, vertical, owner_user_id, contact_id,
         bd_opportunity_id, priority_band, reason, next_touch_due, days_overdue,
         last_touch_at, last_touch_type, effective_owner_role,
         owner_role_confidence, source_domain, source_property_id
    FROM public.lcc_priority_queue_resolved
   WHERE EXISTS (SELECT 1 FROM public.lcc_priority_queue_resolved)
  UNION ALL
  SELECT entity_id, name, workspace_id, vertical, owner_user_id, contact_id,
         bd_opportunity_id, priority_band, reason, next_touch_due, days_overdue,
         last_touch_at, last_touch_type, effective_owner_role,
         owner_role_confidence, source_domain, source_property_id
    FROM public.v_priority_queue_live
   WHERE NOT EXISTS (SELECT 1 FROM public.lcc_priority_queue_resolved);

-- 4. Idempotent refresh: snapshot v_priority_queue_live, swap, ANALYZE.
CREATE OR REPLACE FUNCTION public.lcc_refresh_priority_queue_resolved()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM public.lcc_priority_queue_resolved;
  INSERT INTO public.lcc_priority_queue_resolved
    (entity_id, name, workspace_id, vertical, owner_user_id, contact_id,
     bd_opportunity_id, priority_band, reason, next_touch_due, days_overdue,
     last_touch_at, last_touch_type, effective_owner_role,
     owner_role_confidence, source_domain, source_property_id, refreshed_at)
  SELECT entity_id, name, workspace_id, vertical, owner_user_id, contact_id,
         bd_opportunity_id, priority_band, reason, next_touch_due, days_overdue,
         last_touch_at, last_touch_type, effective_owner_role,
         owner_role_confidence, source_domain, source_property_id, now()
  FROM public.v_priority_queue_live;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  ANALYZE public.lcc_priority_queue_resolved;
  RETURN v_n;
END;
$fn$;

-- 5. Populate now so the queue is cache-fast immediately on apply.
SELECT public.lcc_refresh_priority_queue_resolved();

-- 6. Short-cycle cron (5 min — parity with refresh_work_counts). Keeps band
--    transitions (cadence due, connections, new entities) fresh; the live
--    fallback covers a cold cache. Distinct dollar-quote tags (R6 lesson).
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-priority-queue-refresh') THEN
    PERFORM cron.unschedule('lcc-priority-queue-refresh');
  END IF;
  PERFORM cron.schedule(
    'lcc-priority-queue-refresh',
    '*/5 * * * *',
    $job$SELECT public.lcc_refresh_priority_queue_resolved();$job$
  );
END
$cron$;
