-- ============================================================================
-- Round 76ao — unschedule the broken lcc-cleanup-orphan-om-uploads cron
--
-- The cron job has been failing on every nightly run since deploy with:
--
--   ERROR:  Direct deletion from storage tables is not allowed. Use the
--           Storage API instead.
--   HINT:   This prevents accidental data loss from orphaned objects.
--   CONTEXT: PL/pgSQL function storage.protect_delete() line 5 at RAISE
--
-- Root cause: lcc_cleanup_orphan_om_uploads(grace_days int) tried to
-- DELETE FROM storage.objects directly, but Supabase blocks that with a
-- BEFORE-DELETE protect_delete trigger. Storage cleanup needs to go
-- through the Storage REST API (which honors the trigger and other RLS).
--
-- Audit at the time of unscheduling:
--   2,216 objects in lcc-om-uploads bucket
--   1,835 of them orphan (no FK in staged_intake_artifacts.storage_path)
--   All <7 days old — would have been swept on first successful run
--
-- Most orphans come from the PA -> stage-om path: PA uploads PDF to
-- storage via signed URL, then calls intake/stage-om which receives
-- bytes_base64 inline and writes inline_data only — never wires up
-- storage_path on the artifact row. Result: storage object orphaned.
--
-- Action: unschedule the failing cron immediately. Replacement TBD —
-- needs a Vercel admin endpoint that uses SUPABASE_SERVICE_ROLE_KEY +
-- the Storage REST API DELETE method.
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('lcc-cleanup-orphan-om-uploads');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron.unschedule failed (likely already unscheduled): %', SQLERRM;
END $$;
