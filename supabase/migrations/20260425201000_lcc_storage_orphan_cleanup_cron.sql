-- ============================================================================
-- Migration: nightly cleanup of orphan storage objects in lcc-om-uploads
--
-- Target:    LCC Opps Supabase (OPS_SUPABASE_URL)
--
-- Why: Power Automate's flagged-email V3 trigger reliably fires the flow
--      2-6 times per flag event. The staging_started_at dedup patch
--      (api/intake.js, 2026-04-25) collapses those to one staged row,
--      but every duplicate POST still uploads its 3 attachments to
--      storage. Result: ~50 MB of redundant copies per OM that no
--      staged_intake_artifacts row references. Over time this bloats
--      the bucket without bound.
--
-- Strategy:
--   - Sweep daily at 03:30 UTC (after the matcher-accuracy rollup at 02:15)
--   - Delete storage.objects rows in lcc-om-uploads:
--       a) older than 14 days, AND
--       b) whose name is not referenced by any staged_intake_artifacts.storage_path
--   - Delete cascades through Supabase's storage backend trigger to
--     remove the underlying file from object storage.
--   - Bounded at 500 deletes per run for predictable runtimes.
--
-- Safety: 14-day grace window protects manually-recovered intakes that
-- might still be repointing artifact rows. The function returns the
-- deleted_count plus up to 10 sample names for the cron log.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_cleanup_orphan_om_uploads(
  grace_days int DEFAULT 14
) RETURNS TABLE (deleted_count int, sample_names text[])
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cutoff timestamptz := now() - (grace_days * interval '1 day');
  deleted int := 0;
  samples text[];
BEGIN
  WITH referenced AS (
    SELECT DISTINCT
      CASE
        WHEN storage_path LIKE 'lcc-om-uploads/%'
          THEN substring(storage_path FROM length('lcc-om-uploads/') + 1)
        ELSE storage_path
      END AS object_name
    FROM public.staged_intake_artifacts
    WHERE storage_path IS NOT NULL
  ),
  to_delete AS (
    SELECT o.id, o.name
    FROM storage.objects o
    LEFT JOIN referenced r ON r.object_name = o.name
    WHERE o.bucket_id = 'lcc-om-uploads'
      AND o.created_at < cutoff
      AND r.object_name IS NULL
    LIMIT 500
  ),
  deleted_rows AS (
    DELETE FROM storage.objects o
    USING to_delete d
    WHERE o.id = d.id
    RETURNING d.name
  )
  SELECT count(*)::int, COALESCE(array_agg(name) FILTER (WHERE name IS NOT NULL), ARRAY[]::text[])
  INTO deleted, samples
  FROM deleted_rows;

  IF samples IS NOT NULL AND array_length(samples, 1) > 10 THEN
    samples := samples[1:10];
  END IF;

  RETURN QUERY SELECT deleted, samples;
END;
$$;

COMMENT ON FUNCTION public.lcc_cleanup_orphan_om_uploads(int) IS
  'Deletes orphan objects in lcc-om-uploads older than N days that
   are not referenced by any staged_intake_artifacts.storage_path.
   Bounded at 500 rows per call to keep cron runtimes predictable.
   Returns deleted_count + up to 10 sample names for audit.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('lcc-cleanup-orphan-om-uploads')
      WHERE EXISTS (
        SELECT 1 FROM cron.job WHERE jobname = 'lcc-cleanup-orphan-om-uploads'
      );
    PERFORM cron.schedule(
      'lcc-cleanup-orphan-om-uploads',
      '30 3 * * *',
      $cron$SELECT public.lcc_cleanup_orphan_om_uploads(14);$cron$
    );
  END IF;
END$$;
