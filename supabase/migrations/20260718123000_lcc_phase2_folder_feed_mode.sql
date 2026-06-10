-- ============================================================================
-- Phase 2 Slice 2a — folder_feed_seen.mode (LCC Opps)
-- 2026-06-10 (PROPERTIES enrich-read channel)
--
-- Slice 1 walked only the "On Market" ingest roots. Slice 2a adds the PROPERTIES
-- tree as a SECOND folder-feed channel with ENRICH-only semantics: extract →
-- match an EXISTING property via the path anchor → fill blanks + attach the doc +
-- write provenance. It must NEVER create a new property; an unresolved file goes
-- to the match_disambiguation decision lane.
--
-- One worker tick can walk BOTH channels, so every folder_feed_seen row records
-- which channel produced it:
--   ingest — On Market roots (Slice 1 behaviour; full create/update promoter)
--   enrich — PROPERTIES roots (fill-blanks-only; never creates a property)
--
-- SAFE BY CONSTRUCTION: additive nullable-with-default column, no data rewrite,
-- idempotent (IF NOT EXISTS). Existing rows default to 'ingest' — exactly the
-- channel that produced them (Slice 1 only walked ingest roots). Apply on LCC
-- Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

ALTER TABLE public.folder_feed_seen
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'ingest';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_folder_feed_seen_mode'
  ) THEN
    ALTER TABLE public.folder_feed_seen
      ADD CONSTRAINT chk_folder_feed_seen_mode CHECK (mode IN ('ingest','enrich'));
  END IF;
END$$;

COMMENT ON COLUMN public.folder_feed_seen.mode IS
  'Folder-feed channel that produced this row: ingest (On Market roots — full create/update promoter, Slice 1) | enrich (PROPERTIES roots — fill-blanks-only, never creates a property, Slice 2a). Defaults to ingest (Slice 1 only walked ingest roots).';
