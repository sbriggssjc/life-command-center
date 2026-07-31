-- W4.3 follow-up (2026-07-31): append last_error to v_sf_link_review_queue so the
-- SF-link candidate review lane can flag the 18 dia conflict rows — their
-- last_error carries the pre-existing sf_company_id as
-- 'w4_3_conflict_existing_sf_company_id_<ID>', which the lane parses into the
-- three-way (keep existing / switch / research) card.
--
-- CREATE OR REPLACE VIEW is APPEND-ONLY for columns (Postgres 42P16 otherwise):
-- last_error is added at the END of the SELECT, all prior columns/order unchanged.
-- Additive + reversible (re-create without last_error) + live-immediately.

CREATE OR REPLACE VIEW public.v_sf_link_review_queue AS
  SELECT queue_id,
         source_table,
         source_id,
         owner_name,
         canonical_name,
         state,
         property_count,
         priority_score,
         sf_account_id_resolved,
         sf_account_name_resolved,
         score_resolved,
         resolved_at,
         last_attempted_at,
         last_error
    FROM public.sf_link_research_queue
   WHERE status = 'needs_review'::text
   ORDER BY priority_score DESC, resolved_at DESC;

GRANT SELECT ON public.v_sf_link_review_queue TO anon, authenticated, service_role;
