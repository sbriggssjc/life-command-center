-- ============================================================================
-- 20260524110000_gov_B2_owner_merge_tick.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — B2 owner-merge-tick (gov)
--
-- Gov uses canonical_name groupings instead of dia's curated cluster view.
-- Otherwise mirrors dia B2.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.owner_merge_tick()
RETURNS TABLE (
  losers_merged BIGINT,
  clusters_seen BIGINT,
  run_at        TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_losers   BIGINT := 0;
  v_clusters BIGINT := 0;
BEGIN
  WITH props_per_owner AS (
    SELECT recorded_owner_id, COUNT(*) AS props
    FROM public.properties WHERE recorded_owner_id IS NOT NULL
    GROUP BY recorded_owner_id
  ),
  ranked AS (
    SELECT ro.canonical_name, ro.recorded_owner_id, COALESCE(pp.props,0) AS props,
           ROW_NUMBER() OVER (PARTITION BY ro.canonical_name
                              ORDER BY COALESCE(pp.props,0) DESC, ro.recorded_owner_id::text) AS rn,
           FIRST_VALUE(ro.recorded_owner_id) OVER (PARTITION BY ro.canonical_name
                              ORDER BY COALESCE(pp.props,0) DESC, ro.recorded_owner_id::text) AS survivor_id
    FROM public.recorded_owners ro
    LEFT JOIN props_per_owner pp ON pp.recorded_owner_id = ro.recorded_owner_id
    WHERE ro.canonical_name IS NOT NULL
      AND ro.merged_into_recorded_owner_id IS NULL
      AND ro.canonical_name IN (
        SELECT canonical_name FROM public.recorded_owners
        WHERE canonical_name IS NOT NULL AND merged_into_recorded_owner_id IS NULL
        GROUP BY 1 HAVING COUNT(*) > 1
      )
  ),
  losers AS (
    SELECT canonical_name, recorded_owner_id AS loser_id, survivor_id
    FROM ranked WHERE rn > 1
  ),
  merged AS (
    SELECT loser_id, canonical_name,
           public.apply_owner_merge(
             survivor_id, loser_id, canonical_name, 'owner_merge_tick'
           ) AS counts
    FROM losers
  )
  SELECT COUNT(*), COUNT(DISTINCT canonical_name)
    INTO v_losers, v_clusters
    FROM merged;

  RETURN QUERY SELECT v_losers, v_clusters, now();
END;
$$;

COMMENT ON FUNCTION public.owner_merge_tick IS
  'B2: continuous-propagation worker. Re-runs A1 over canonical_name groupings. Idempotent.';

DO $$
DECLARE
  v_existing_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_existing_jobid FROM cron.job WHERE jobname='lcc-gov-owner-merge-tick';
  IF v_existing_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_existing_jobid); END IF;
  PERFORM cron.schedule(
    'lcc-gov-owner-merge-tick', '0 * * * *',
    $cron$SELECT public.owner_merge_tick();$cron$
  );
END $$;
