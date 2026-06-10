-- ============================================================================
-- Phase 2 Slice 1d — folder_feed_seen.miss_streak (LCC Opps)
-- 2026-06-10 (stale-sweep correctness hardening)
--
-- The stale sweep used to mark a previously-seen file 'stale' on the FIRST walk
-- that didn't list it. A capped/partial drain (or a transient partial-but-ok
-- List-folder response) could therefore mass-stale still-existing files, and
-- 'stale' is terminal for ingestion — a wrongly-staled OM is lost forever.
--
-- Unit 1 (handler) fixed the partial-PROCESSING case by building livePaths from
-- the FULL listing. This column adds defense-in-depth for the partial-LISTING
-- case: mirror the availability-checker's consecutive_check_failures pattern —
-- a file must be absent from TWO consecutive full listings before it goes stale.
-- The sweep increments miss_streak on a miss and only stales at >= 2; any
-- re-seen file resets it to 0 (in the diff PATCH and upsertSeen).
--
-- SAFE BY CONSTRUCTION: additive nullable-with-default column, no data rewrite,
-- idempotent (IF NOT EXISTS). Existing rows default to 0 — exactly "no misses
-- recorded yet", so the first miss after deploy bumps to 1 (status untouched)
-- and a genuine deletion stales on the following walk. Apply on LCC Opps
-- (xengecqvemvfknjvbvrq).
-- ============================================================================

ALTER TABLE public.folder_feed_seen
  ADD COLUMN IF NOT EXISTS miss_streak int NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.folder_feed_seen.miss_streak IS
  'Consecutive full-listing walks that did NOT list this path. The stale sweep bumps it on a miss and only marks status=stale at >= 2; any re-seen file resets it to 0. Guards against a single transient/partial List response staling a live file.';
