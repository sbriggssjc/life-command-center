-- ============================================================================
-- Round 76qa.13 (2026-06-03): Review-Console lane-count cache
--
-- Target: LCC Opps (OPS_SUPABASE_URL, ref xengecqvemvfknjvbvrq)
--
-- /api/review-counts (api/admin.js handleReviewCounts) headline latency was
-- dominated by a single ops lane: count=exact over v_field_provenance_actionable.
-- Measured 2026-06-03 with EXPLAIN ANALYZE:
--
--   lane (source)                          rows     count(*) exec
--   v_field_provenance_actionable (ops)    13,285   3,640 ms   <-- dominant
--   ownership_research_queue (gov)         49,648     738 ms
--   v_data_quality_issues dup_addr (gov)    6,914     212 ms
--   v_next_best_research (dia)             27,992     192 ms
--   v_recorded_owner_link_review (gov)         44     146 ms
--   pending_updates pending (gov)           2,018      54 ms
--   v_stale_identities (ops)               19,112      32 ms
--   v_unlinked_entities (ops)                 461      22 ms
--   llc_research_queue queued (gov/dia)    656/1210   <3 ms
--
-- count=estimated does NOT help v_field_provenance_actionable: the planner
-- estimates 765 rows vs 13,285 actual (17x low) because the hash-join +
-- LATERAL cardinality is badly misestimated. The real cost is a parallel seq
-- scan of the 585k-row field_provenance table (decision IN ('skip','conflict')
-- selects ~half the table) joined to the 70 warn/strict field_source_priority
-- rules. So this lane needs a cache, not an estimate.
--
-- Lane counts are headline approximations ("~13k to review"), not exact band
-- chips, so a 5-minute-stale cached value is correct here. We cache the three
-- ops-LOCAL lanes (this DB) in a tiny table refreshed by pg_cron — mirroring
-- the mv_user_work_counts / refresh_work_counts pattern. handleReviewCounts
-- reads the cache (sub-ms) for ops lanes and surfaces generated_at + a stale
-- marker; the gov/dia lanes stay live with count=estimated for the big
-- sources and a per-lane timeout.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lcc_review_lane_counts (
  lane_key    text PRIMARY KEY,
  lane_count  bigint NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lcc_review_lane_counts IS
  'Cached headline counts for the Review Console expensive ops-local views. '
  'Refreshed every 5 min by the lcc-review-lane-counts-refresh pg_cron via '
  'lcc_refresh_review_lane_counts(). Read by api/admin.js handleReviewCounts.';

CREATE OR REPLACE FUNCTION public.lcc_refresh_review_lane_counts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_actionable bigint;
  v_stale      bigint;
  v_unlinked   bigint;
BEGIN
  SELECT count(*) INTO v_actionable FROM public.v_field_provenance_actionable;
  SELECT count(*) INTO v_stale      FROM public.v_stale_identities;
  SELECT count(*) INTO v_unlinked   FROM public.v_unlinked_entities;

  INSERT INTO public.lcc_review_lane_counts (lane_key, lane_count, computed_at) VALUES
    ('data_conflicts',    v_actionable, now()),
    ('stale_identities',  v_stale,      now()),
    ('unlinked_entities', v_unlinked,   now())
  ON CONFLICT (lane_key) DO UPDATE
    SET lane_count  = EXCLUDED.lane_count,
        computed_at = EXCLUDED.computed_at;

  RETURN jsonb_build_object(
    'data_conflicts',    v_actionable,
    'stale_identities',  v_stale,
    'unlinked_entities', v_unlinked,
    'ran_at',            now()
  );
END;
$$;

-- The REST layer reads this through OPS_SUPABASE_KEY (service_role JWT, which
-- bypasses RLS); GRANT the lower roles too so the cache stays readable if the
-- key is ever narrowed. RLS intentionally left off — these are non-PII counts.
GRANT SELECT ON public.lcc_review_lane_counts TO anon, authenticated, service_role;

-- Seed immediately so the cache is warm the moment the endpoint ships.
SELECT public.lcc_refresh_review_lane_counts();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('lcc-review-lane-counts-refresh')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-review-lane-counts-refresh');
    PERFORM cron.schedule(
      'lcc-review-lane-counts-refresh',
      '*/5 * * * *',
      $cron$SELECT public.lcc_refresh_review_lane_counts();$cron$
    );
  END IF;
END$$;
