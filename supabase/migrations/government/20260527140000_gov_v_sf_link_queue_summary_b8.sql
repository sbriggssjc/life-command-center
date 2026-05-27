-- B8 (2026-05-27): mirror of the dia migration. Per-status SF-link queue
-- count for the Domain Health Summary tile.
CREATE OR REPLACE VIEW public.v_sf_link_queue_summary AS
SELECT status, count(*)::int AS n
FROM public.sf_link_research_queue
GROUP BY status;
