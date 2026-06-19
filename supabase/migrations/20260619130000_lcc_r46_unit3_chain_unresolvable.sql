-- R46 Unit 3 (DB): the "ownership chain" Decision Center lane support.
--
-- mark_unresolvable needs a durable "stop asking" hook (the worklist is a live
-- view, so a row mutation can't park it — mirrors the R10/R13 view-gate doctrine).
-- lcc_chain_unresolvable is anti-joined into v_ownership_chain_worklist, so a
-- property marked unresolvable drops out of BOTH the lane AND the research-task
-- generator (which reads the worklist), and the generator's sweep then skips any
-- open chain task for it on the next run. Reversible: DELETE the row to re-surface.

BEGIN;

CREATE TABLE IF NOT EXISTS public.lcc_chain_unresolvable (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_domain       text NOT NULL,
  source_property_id  text NOT NULL,
  reason              text,
  decided_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_domain, source_property_id)
);

GRANT SELECT ON public.lcc_chain_unresolvable TO authenticated;

-- Re-point the worklist to exclude unresolvable-marked properties. Same column
-- list/order as 20260619120000 (CREATE OR REPLACE append-only safe) — only the
-- WHERE gains the anti-join.
CREATE OR REPLACE VIEW public.v_ownership_chain_worklist
WITH (security_invoker = true) AS
SELECT DISTINCT ON (c.source_domain, c.source_property_id)
  c.source_domain,
  c.source_property_id,
  c.current_owner_entity_id,
  c.current_owner_name,
  c.workspace_id,
  c.true_owner_name,
  c.developer_name,
  c.owner_links,
  c.earliest_known_owner,
  c.address, c.city, c.state,
  c.current_annual_rent,
  COALESCE(NULLIF(c.current_annual_rent, 0), pa.annual_rent, 0)::numeric AS rank_value,
  c.missing_segments AS gap,
  CASE c.missing_segments
    WHEN 'no_prior_owners_recorded' THEN 'establish_ownership_history'
    WHEN 'developer_unidentified'   THEN 'trace_ownership_to_developer'
    ELSE 'trace_ownership_to_developer'
  END AS suggested_research_type
FROM public.v_lcc_ownership_chain_completeness c
LEFT JOIN public.lcc_property_attributes pa
  ON pa.source_domain = c.source_domain
 AND pa.source_property_id = c.source_property_id
WHERE c.chain_complete = false
  AND NOT EXISTS (
    SELECT 1 FROM public.lcc_chain_unresolvable u
    WHERE u.source_domain = c.source_domain
      AND u.source_property_id = c.source_property_id
  )
ORDER BY c.source_domain, c.source_property_id,
         COALESCE(NULLIF(c.current_annual_rent, 0), pa.annual_rent, 0) DESC;

COMMIT;
