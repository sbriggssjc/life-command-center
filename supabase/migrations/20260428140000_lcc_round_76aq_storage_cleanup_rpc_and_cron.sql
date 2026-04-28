-- ============================================================================
-- Round 76aq — orphan storage cleanup via Vercel + Storage REST API
--
-- Replaces the broken pg_cron job that was trying to DELETE FROM
-- storage.objects directly (blocked by Supabase's protect_delete trigger,
-- failing every nightly run since deploy — see Round 76ao).
--
-- New architecture:
--   1. PG-side helper (this migration): lcc_list_orphan_storage_objects()
--      RPC enumerates orphans for a given bucket/cutoff/limit. SECURITY
--      DEFINER so it can read storage.objects without RLS.
--
--   2. Vercel-side endpoint: /api/storage-cleanup (handleStorageCleanup
--      in api/admin.js). GET = dry-run, POST = actually delete via the
--      Supabase Storage REST API DELETE method (which routes through the
--      storage backend and is permitted by the protect_delete trigger).
--
--   3. Cron job (this migration): /api/storage-cleanup is invoked
--      nightly at 03:30 via lcc_cron_post + pg_net. Returns batch
--      deletion summary; failures are non-fatal.
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

-- ── 1. RPC for the Vercel endpoint to enumerate orphans ────────────────────
CREATE OR REPLACE FUNCTION public.lcc_list_orphan_storage_objects(
  _bucket text DEFAULT 'lcc-om-uploads',
  _cutoff timestamptz DEFAULT (now() - interval '14 days'),
  _limit int DEFAULT 200
) RETURNS TABLE(name text, created_at timestamptz, size_bytes bigint)
LANGUAGE sql SECURITY DEFINER AS $$
  WITH referenced AS (
    SELECT DISTINCT
      CASE
        WHEN storage_path LIKE _bucket || '/%'
          THEN substring(storage_path FROM length(_bucket) + 2)
        ELSE storage_path
      END AS object_name
    FROM public.staged_intake_artifacts
    WHERE storage_path IS NOT NULL
  )
  SELECT o.name, o.created_at, COALESCE((o.metadata->>'size')::bigint, 0)
  FROM storage.objects o
  LEFT JOIN referenced r ON r.object_name = o.name
  WHERE o.bucket_id = _bucket
    AND o.created_at < _cutoff
    AND r.object_name IS NULL
  ORDER BY o.created_at
  LIMIT _limit;
$$;

GRANT EXECUTE ON FUNCTION public.lcc_list_orphan_storage_objects(text, timestamptz, int)
  TO authenticated, service_role;

-- ── 2. Re-schedule the nightly cron via Vercel ─────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- unschedule the old broken one (idempotent — silently no-ops if absent)
    BEGIN
      PERFORM cron.unschedule('lcc-cleanup-orphan-om-uploads');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    -- schedule the working one
    PERFORM cron.schedule(
      'lcc-cleanup-orphan-om-uploads',
      '30 3 * * *',
      $cmd$SELECT public.lcc_cron_post('/api/storage-cleanup?grace_days=14&batch_size=200', '{}'::jsonb, 'vercel')$cmd$
    );
  END IF;
END $$;
