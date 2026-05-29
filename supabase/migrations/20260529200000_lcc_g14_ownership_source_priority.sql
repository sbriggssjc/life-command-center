-- G14 completion (2026-05-29): ownership-field priority rules.
--
-- The field_source_priority matrix already covered the ownership identity
-- surface (recorded_owner_name/id, true_owner_id, ownership_start/end,
-- new_owner/prior_owner, property_ownership_type, and the recorded_owners
-- enrichment fields: state_of_incorporation / filing_state, manager_*,
-- registered_agent_*, filing_*) with the audit's county > SOS > sidebar > OM
-- ladder. The Phase-4 drift detector (v_field_provenance_unranked) flagged
-- exactly one written-but-unranked INGESTION field:
-- dia.ownership_history.ownership_source (written by costar_sidebar).
--
-- This adds its source ladder, mirroring the sibling ownership_start /
-- ownership_end rules. record_only — no enforcement change. Applied to
-- LCC Opps (xengecqvemvfknjvbvrq). Idempotent.
INSERT INTO public.field_source_priority (target_table, field_name, source, priority, enforce_mode)
SELECT 'dia.ownership_history', 'ownership_source', v.source, v.priority, 'record_only'
FROM (VALUES
  ('manual_edit', 1),
  ('manual_resolution', 1),
  ('recorded_deed', 3),
  ('county_records', 5),
  ('rca_sidebar', 50),
  ('costar_sidebar', 60),
  ('crexi_sidebar', 65),
  ('crexi_sidebar_description', 70)
) AS v(source, priority)
WHERE NOT EXISTS (
  SELECT 1 FROM public.field_source_priority f
  WHERE f.target_table = 'dia.ownership_history'
    AND f.field_name = 'ownership_source'
    AND f.source = v.source
);
