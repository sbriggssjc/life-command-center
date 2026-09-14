-- ============================================================================
-- Prompt 81 (item 1) — U4 flow-failure clusters must count only OPEN failures
--
-- The W8/U4 systemic-findings surface (v_lcc_w8_u4_flow_failure_clusters) counted
-- EVERY flow_run_failures row regardless of resolved_at, so a RETIRED flow's
-- historical (already auto-resolved) failures kept ranking as the top cluster.
--
-- Grounded 2026-08-08 (LCC Opps xengecqvemvfknjvbvrq):
--   • "Unflag Completed Email Tasks"      — 524 rows, 100% resolved_at NOT NULL,
--     last failure 2026-07-29, all auto-resolved ("flow quiet"), STATUS = Off/retired
--     (consolidated into LCCToDoCompletionPoll).
--   • "To Do - Life Command Center Sync"  — 131 rows, 100% resolved, same profile.
--
-- These are NOT live zombies — the dead-letter plane's
-- lcc_autoresolve_recovered_flow_failures cron (18h quiet) already closed every
-- row. The only defect was that the U4 cluster view ignored resolved_at, so the
-- retired flows' resolved history polluted the report. This filters the view to
-- unresolved (open) failures — a resolved failure is not an open problem.
--
-- Idempotent: CREATE OR REPLACE only appends a WHERE clause; output columns are
-- unchanged so api/admin.js's reader (select flow_name,error_kind,error_code,
-- cnt,cnt_30d,last_seen) is unaffected.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_lcc_w8_u4_flow_failure_clusters AS
SELECT coalesce(flow_name, '?')     AS flow_name,
       coalesce(error_kind, '')     AS error_kind,
       coalesce(error_code, '')     AS error_code,
       count(*)::int                AS cnt,
       count(*) FILTER (WHERE detected_at >= now() - interval '30 days')::int AS cnt_30d,
       max(detected_at)             AS last_seen
  FROM public.flow_run_failures
 WHERE resolved_at IS NULL          -- Prompt 81: open failures only
 GROUP BY 1, 2, 3
 ORDER BY count(*) DESC
 LIMIT 25;

GRANT SELECT ON public.v_lcc_w8_u4_flow_failure_clusters TO anon, authenticated, service_role;

COMMENT ON VIEW public.v_lcc_w8_u4_flow_failure_clusters IS
  'U4 flow-failure clusters — OPEN (resolved_at IS NULL) failures only, so a '
  'retired/recovered flow whose failures the dead-letter auto-resolver already '
  'closed drops off the surface (Prompt 81, 2026-08-08).';
