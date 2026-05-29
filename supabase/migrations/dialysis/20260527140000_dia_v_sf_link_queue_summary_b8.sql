-- B8 (2026-05-27): aggregate the per-status row counts for the SF-link
-- backfill queue so the ops.js Domain Health Summary tile pulls a single
-- 7-row resultset instead of all 3K+ queue rows.
--
-- Returns one row per status: queued / in_progress / linked / needs_review
-- / no_match / failed / unsupported.
CREATE OR REPLACE VIEW public.v_sf_link_queue_summary AS
SELECT status, count(*)::int AS n
FROM public.sf_link_research_queue
GROUP BY status;

COMMENT ON VIEW public.v_sf_link_queue_summary IS
  'B8 (2026-05-27): per-status row count for sf_link_research_queue. Drives the SF-link row on the Data Quality > Domain Health Summary tile.';
