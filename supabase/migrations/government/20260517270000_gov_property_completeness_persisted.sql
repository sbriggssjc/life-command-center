-- ============================================================================
-- Item #6 Phase B-1 (gov, 2026-05-17): persist v_property_completeness
-- scores as denormalized columns on the properties table + nightly refresh.
--
-- Mirror of the dia migration. Cron staggered 5 minutes later than dia
-- so the two domains don't pile up on the same minute.
-- ============================================================================

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS completeness_score INTEGER,
  ADD COLUMN IF NOT EXISTS completeness_band  TEXT;

COMMENT ON COLUMN public.properties.completeness_score IS
  'Item #6 Phase B-1: denormalized cache of v_property_completeness.completeness_score (0-100). '
  'Refreshed nightly via pg_cron + on-demand via refresh_property_completeness().';

COMMENT ON COLUMN public.properties.completeness_band IS
  'Item #6 Phase B-1: denormalized cache of v_property_completeness.completeness_band '
  '(excellent/good/fair/poor). Refreshed nightly via pg_cron.';

CREATE INDEX IF NOT EXISTS idx_properties_completeness_score
  ON public.properties (completeness_score DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_properties_completeness_band
  ON public.properties (completeness_band);

CREATE OR REPLACE FUNCTION public.refresh_property_completeness()
RETURNS TABLE(updated_count BIGINT, total_scored BIGINT, ran_at TIMESTAMPTZ)
LANGUAGE plpgsql
AS $$
DECLARE
  upd_count BIGINT;
  tot_count BIGINT;
BEGIN
  WITH upd AS (
    UPDATE public.properties p
       SET completeness_score = v.completeness_score,
           completeness_band  = v.completeness_band
      FROM public.v_property_completeness v
     WHERE v.property_id = p.property_id
       AND (p.completeness_score IS DISTINCT FROM v.completeness_score
         OR p.completeness_band  IS DISTINCT FROM v.completeness_band)
    RETURNING 1
  )
  SELECT count(*) INTO upd_count FROM upd;

  SELECT count(*) INTO tot_count
    FROM public.properties
   WHERE completeness_score IS NOT NULL;

  updated_count := upd_count;
  total_scored  := tot_count;
  ran_at        := now();
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.refresh_property_completeness() IS
  'Item #6 Phase B-1: refresh denormalized completeness columns from v_property_completeness. '
  'Only updates rows whose score or band changed. Scheduled nightly via pg_cron.';

-- Seed: run once now
SELECT * FROM public.refresh_property_completeness();

-- Schedule nightly at 07:05 UTC (5 minutes after dia, to spread cron load)
SELECT cron.unschedule(jobname)
  FROM cron.job
 WHERE jobname = 'refresh_property_completeness_nightly';

SELECT cron.schedule(
  'refresh_property_completeness_nightly',
  '5 7 * * *',
  $sql$SELECT public.refresh_property_completeness();$sql$
);
