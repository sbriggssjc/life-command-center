-- Field-source-priority registry rows for the gov Sale-Notes ingestion (2026-06-20)
-- =====================================================================================
-- The gov CoStar sidebar capture now routes two Sale-Notes-derived values through the
-- field-provenance guard (api/_handlers/sidebar-pipeline.js):
--   • gov.properties.noi                          (confirmed_sale NOI anchor)
--   • gov.sales_transactions.firm_term_years_at_sale (at-sale term seed)
-- Every (target_table, field_name, source) the sidebar pushes through
-- recordCoStarFieldsProvenance MUST have a registry row, else
-- v_field_provenance_unranked flags schema drift (LCC CLAUDE.md, Phase 4).
--
-- Priorities mirror the existing gov ladder (manual_edit=1 floor, om_extraction~30,
-- costar_sidebar=65 aggregator-quality). record_only mode — these record provenance
-- and surface conflicts without blocking writes, matching the rest of the gov sidebar
-- registry. The raw sale_notes_raw / sale_notes_extracted columns are single-source
-- capture artifacts (not contested across writers) and are intentionally NOT
-- provenance-tracked, so they need no registry rows.
--
-- Additive + idempotent (INSERT ... WHERE NOT EXISTS). Apply anytime — cache-or-live
-- safe; the JS writer ships on the Railway redeploy.

BEGIN;

INSERT INTO public.field_source_priority (target_table, field_name, source, priority, min_confidence, enforce_mode, notes)
SELECT v.target_table, v.field_name, v.source, v.priority, 0, 'record_only', v.notes
FROM (VALUES
  -- properties.noi — the confirmed_sale NOI anchor that drives gov_compute_cap_rate (tier 1, HIGH).
  ('gov.properties', 'noi', 'manual_edit',    1,  'Curated NOI edit — top trust.'),
  ('gov.properties', 'noi', 'om_extraction',  30, 'OM-extracted NOI.'),
  ('gov.properties', 'noi', 'costar_sidebar', 65, 'CoStar Sale-Notes / Income&Expenses NOI (confirmed_sale anchor).'),
  -- sales_transactions.firm_term_years_at_sale — at-sale term seed from the narrative.
  ('gov.sales_transactions', 'firm_term_years_at_sale', 'manual_edit',    1,  'Curated at-sale term — top trust.'),
  ('gov.sales_transactions', 'firm_term_years_at_sale', 'costar_sidebar', 65, 'CoStar Sale-Notes "N years remaining" at-sale term seed (fill-blank only).')
) AS v(target_table, field_name, source, priority, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM public.field_source_priority f
  WHERE f.target_table = v.target_table
    AND f.field_name   = v.field_name
    AND f.source       = v.source
);

COMMIT;
