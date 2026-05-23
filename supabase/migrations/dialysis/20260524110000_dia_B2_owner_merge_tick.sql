-- ============================================================================
-- 20260524110000_dia_B2_owner_merge_tick.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — B2 owner-merge-tick (dia)
--
-- Continuous propagation worker. Re-runs A1 survivor-selection over the
-- conservative v_recorded_owner_canonical_clusters view, catching any new
-- duplicates that landed since the prior tick (sidebar capture, CSV import,
-- or other writer paths that don't yet have C4 entity-dedup triggers).
--
-- Idempotent: only operates on rows with merged_into_recorded_owner_id IS
-- NULL. The view itself filters known operators and short tokens so
-- "Independent" / "Unknown" / "Other" don't get collapsed.
--
-- Schedule: hourly (entity creation rate is low enough that 15-min ticks
-- would be wasted).
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
  -- Identify losers using the curated cluster view, filter merged
  -- losers out so re-runs don't try to re-merge.
  WITH ranked AS (
    SELECT canonical, recorded_owner_id,
           ROW_NUMBER() OVER (PARTITION BY canonical
                              ORDER BY properties DESC, recorded_owner_id::text) AS rn,
           FIRST_VALUE(recorded_owner_id) OVER (PARTITION BY canonical
                              ORDER BY properties DESC, recorded_owner_id::text) AS survivor_id
    FROM public.v_recorded_owner_canonical_clusters
    WHERE recorded_owner_id NOT IN (
      SELECT recorded_owner_id FROM public.recorded_owners
      WHERE merged_into_recorded_owner_id IS NOT NULL
    )
  ),
  losers AS (
    SELECT canonical, recorded_owner_id AS loser_id, survivor_id
    FROM ranked WHERE rn > 1
  ),
  merged AS (
    SELECT loser_id, canonical,
           public.apply_owner_merge(
             survivor_id, loser_id, canonical, 'owner_merge_tick'
           ) AS counts
    FROM losers
  )
  SELECT COUNT(*), COUNT(DISTINCT canonical)
    INTO v_losers, v_clusters
    FROM merged;

  RETURN QUERY SELECT v_losers, v_clusters, now();
END;
$$;

COMMENT ON FUNCTION public.owner_merge_tick IS
  'B2: continuous-propagation worker. Re-runs A1 over v_recorded_owner_canonical_clusters. Idempotent. Catches duplicates that slip past writer-side dedup.';

DO $$
DECLARE
  v_existing_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_existing_jobid FROM cron.job WHERE jobname='lcc-dia-owner-merge-tick';
  IF v_existing_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_existing_jobid); END IF;
  PERFORM cron.schedule(
    'lcc-dia-owner-merge-tick', '0 * * * *',
    $cron$SELECT public.owner_merge_tick();$cron$
  );
END $$;
