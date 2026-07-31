-- W4.3 follow-up (2026-07-31): the SF-link candidate review lane needs
-- last_error on v_sf_link_review_queue to flag the conflict rows (dia carries
-- the pre-existing sf id in last_error as 'w4_3_conflict_existing_sf_company_id_<ID>').
-- gov currently has 0 such rows, but the column is added for parity so the lane's
-- conflict parser works identically across both domains.
--
-- CREATE OR REPLACE VIEW is APPEND-ONLY for columns (Postgres 42P16 otherwise):
-- last_error is added at the END of the SELECT, all prior columns/order unchanged.
-- Additive + reversible (re-create without last_error) + live-immediately (the
-- lane reads the view per request, no deploy dependency).

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
