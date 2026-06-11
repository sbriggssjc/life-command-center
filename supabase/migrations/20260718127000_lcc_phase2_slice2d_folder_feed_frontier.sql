-- ============================================================================
-- Phase 2 Slice 2d — folder_feed_frontier (LCC Opps) · persisted crawl frontier
-- 2026-06-11 (PROPERTIES cloud crawl engine — descend the tree across ticks)
--
-- The Slice-1/2a worker restarts its BFS from the configured roots every tick
-- (queue = rootList.slice()), so a cron pointed at the PROPERTIES root re-lists
-- the top letter-buckets forever and never descends to the tenant/city folders
-- where the files live. This table is the durable crawl cursor: one row per
-- folder the crawl has discovered, so successive ticks pop PENDING folders,
-- enqueue their subfolders, process their files, then mark them VISITED with a
-- revisit timer. Progress persists; the whole tree is reached over many ticks.
--
-- status lifecycle:
--   pending  — discovered, not yet listed this sweep (BFS frontier)
--   visited  — listed; visited_at set; revisit_after schedules the next sweep
--              (when no pending rows remain, visited rows past revisit_after are
--              promoted back to pending to pick up NEW files).
--
-- DB-only tracking (the locked Phase-2 convention): nothing is written into the
-- SharePoint tree. Drop this table → the crawl simply restarts from the roots.
--
-- SAFE BY CONSTRUCTION: additive table, no FK to hot tables, idempotent
-- (IF NOT EXISTS). Empty table ⇒ the crawl seeds the roots on its first tick.
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.folder_feed_frontier (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  server_relative_path text        NOT NULL,
  mode                 text        NOT NULL DEFAULT 'enrich',
  status               text        NOT NULL DEFAULT 'pending',
  depth                int         NOT NULL DEFAULT 0,
  parent_path          text,
  discovered_at        timestamptz NOT NULL DEFAULT now(),
  visited_at           timestamptz,
  revisit_after        timestamptz,
  CONSTRAINT uq_folder_feed_frontier_path UNIQUE (server_relative_path),
  CONSTRAINT chk_folder_feed_frontier_status CHECK (status IN ('pending','visited')),
  CONSTRAINT chk_folder_feed_frontier_mode   CHECK (mode   IN ('ingest','enrich'))
);

-- Pop the BFS frontier (oldest pending first) + re-promote sweep predicate.
CREATE INDEX IF NOT EXISTS idx_folder_feed_frontier_status
  ON public.folder_feed_frontier (status, discovered_at);
CREATE INDEX IF NOT EXISTS idx_folder_feed_frontier_revisit
  ON public.folder_feed_frontier (revisit_after)
  WHERE status = 'visited';

COMMENT ON TABLE public.folder_feed_frontier IS
  'Phase 2 Slice 2d crawl cursor: durable BFS frontier over the PROPERTIES tree so successive folder-feed ticks descend the whole tree instead of re-listing the roots. DB-only — nothing written into SharePoint.';
COMMENT ON COLUMN public.folder_feed_frontier.revisit_after IS
  'When status=visited, the time after which the folder is re-promoted to pending to sweep for NEW files. Set to now()+revisit interval at visit time.';
