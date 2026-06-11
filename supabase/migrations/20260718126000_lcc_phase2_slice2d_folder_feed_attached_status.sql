-- ============================================================================
-- Phase 2 Slice 2d — folder_feed_seen.status += 'attached' (LCC Opps)
-- 2026-06-11 (PROPERTIES cloud crawl engine — all-doc-type attach)
--
-- Slice 2a only STAGED OM/flyer PDFs through the extract pipeline; every other
-- recognized doc type (lease / BOV / DD / master / comp) was recorded
-- status='skipped' and never connected to the property. Slice 2d Unit 2 adds the
-- LIGHT attach path: resolve the property by the PATH ANCHOR alone (no AI
-- extraction) and attach the working doc as a property_documents row. Those rows
-- get a distinct status so the audit shows what landed:
--   attached — a recognized non-OM doc was resolved by path anchor and linked to
--              an existing property (property_documents row written; no extraction,
--              no create). Distinct from 'staged' (handed to stageOmIntake).
--
-- SAFE BY CONSTRUCTION: widens the CHECK only (no row rewrite), idempotent
-- (drop-then-add inside a guard). Existing rows are untouched. Apply on LCC Opps
-- (xengecqvemvfknjvbvrq) AFTER the Railway redeploy of the worker — the deployed
-- worker only writes 'attached' once api/_handlers/folder-feed.js ships, so apply
-- order is irrelevant in practice (same posture as lcc-folder-feed).
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_folder_feed_seen_status') THEN
    ALTER TABLE public.folder_feed_seen DROP CONSTRAINT chk_folder_feed_seen_status;
  END IF;
  ALTER TABLE public.folder_feed_seen
    ADD CONSTRAINT chk_folder_feed_seen_status CHECK (
      status IN ('seen','staged','attached','promoted','skipped','error','stale')
    );
END$$;

COMMENT ON COLUMN public.folder_feed_seen.status IS
  'Lifecycle: seen (recorded, not routed) | staged (handed to stageOmIntake) | attached (Slice 2d: recognized non-OM doc resolved by path anchor + linked to an existing property, no extraction) | promoted (downstream finalize) | skipped (unrecognized/lcc_generated) | error | stale (path vanished).';
