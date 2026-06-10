-- ============================================================================
-- Phase 2 — folder_feed_seen (LCC Opps) · SharePoint folder-feed tracking
-- 2026-06-09 (intelligence-hub architecture, Phase 2, Slice 1)
--
-- DB-only tracking of the Team Briggs Documents tree as an ingestion channel.
-- Locked convention (Scott, 2026-06-09): the feed records what it has SEEN in a
-- LCC table and NEVER writes anything into the team's SharePoint tree — no
-- sidecar files, no _Processed moves. This table is the entire footprint on the
-- team's files. Drop it and the feed leaves zero trace.
--
-- One row per (server_relative_path, content_hash). content_hash is:
--   * cloud worker (no bytes in hand) — a change-signature hash of
--     etag|size|modified from the PA "List folder" flow
--   * local backfill (bytes on disk)  — a true sha256 of the file contents
-- Either way, a changed file yields a new (path, hash) pair → a new row, and a
-- re-walk of an unchanged file is a no-op (idempotent on the unique key).
--
-- status lifecycle:
--   seen     — recorded, not yet routed (transient)
--   staged   — handed to stageOmIntake; intake_id set
--   promoted — the downstream promoter finalized it (reserved; set by a later
--              reconcile unit — the worker itself stops at 'staged')
--   skipped  — recognized non-OM type this slice doesn't parse yet
--              (detected_type records what it is, for later units)
--   error    — staging failed; safe to retry on the next walk
--   stale    — the path vanished from a later walk (renamed/deleted). Never
--              deletes derived data — just marks the pointer dead.
--
-- SAFE BY CONSTRUCTION: additive new table, no FK to the hot intake tables
-- (intake_id is a soft pointer), tiny, idempotent (IF NOT EXISTS). Empty table
-- => the worker behaves exactly as a first run. Apply on LCC Opps
-- (xengecqvemvfknjvbvrq).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.folder_feed_seen (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  server_relative_path text        NOT NULL,
  content_hash         text        NOT NULL,
  size_bytes           bigint,
  modified_at          timestamptz,
  intake_id            uuid,
  status               text        NOT NULL DEFAULT 'seen',
  vertical             text,
  detected_type        text,
  subject_hint         jsonb,
  first_seen_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_folder_feed_seen_path_hash UNIQUE (server_relative_path, content_hash),
  CONSTRAINT chk_folder_feed_seen_status CHECK (
    status IN ('seen','staged','promoted','skipped','error','stale')
  )
);

CREATE INDEX IF NOT EXISTS idx_folder_feed_seen_status
  ON public.folder_feed_seen (status);
-- Prefix scans for the stale-sweep ("rows under this folder not in the listing")
-- and per-path lookups during the diff.
CREATE INDEX IF NOT EXISTS idx_folder_feed_seen_path
  ON public.folder_feed_seen (server_relative_path text_pattern_ops);

COMMENT ON TABLE public.folder_feed_seen IS
  'Phase 2 folder-feed: DB-only record of files SEEN in the Team Briggs SharePoint tree. The entire LCC footprint on the team files — nothing is written back into SharePoint.';
COMMENT ON COLUMN public.folder_feed_seen.content_hash IS
  'Change-signature hash (etag|size|modified from the PA List flow) for the cloud worker, or a true sha256 for the local backfill. Keys idempotency with server_relative_path.';
COMMENT ON COLUMN public.folder_feed_seen.subject_hint IS
  'Path-derived match anchor {tenant_brand, city, state, vertical, bucket} fed to the matcher as a high-confidence pre-filter (path beats cover-page parse).';
COMMENT ON COLUMN public.folder_feed_seen.detected_type IS
  'Filename-first classification: om|flyer|lease|master|comp|bov|dd|unknown. Only om/flyer are staged this slice; the rest record the type for later units.';
