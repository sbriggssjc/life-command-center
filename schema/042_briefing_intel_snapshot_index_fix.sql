-- ============================================================================
-- 042: Fix briefing_intel_snapshot unique index
-- Life Command Center — executive briefing v2 follow-up
--
-- The original index used COALESCE(workspace_id, sentinel-uuid) which made it
-- an EXPRESSION index. PostgREST's on_conflict=as_of_date,workspace_id
-- parameter requires a UNIQUE index on the bare columns, so the edge
-- function's upsert returned 42P10 ("no unique or exclusion constraint
-- matching the ON CONFLICT specification").
--
-- Fix: replace with a NULLS NOT DISTINCT unique index (PG15+) on the plain
-- columns. Treats (date, NULL) as duplicates of (date, NULL), which is the
-- behavior we wanted from COALESCE in the first place. OPS DB is on PG17
-- so the feature is available.
--
-- Live-applied via Supabase MCP after the first cron run surfaced the
-- error. This file documents the change for future fresh installs.
-- ============================================================================

drop index if exists ux_briefing_intel_snapshot_date_workspace;
create unique index ux_briefing_intel_snapshot_date_workspace
  on briefing_intel_snapshot (as_of_date, workspace_id) nulls not distinct;
