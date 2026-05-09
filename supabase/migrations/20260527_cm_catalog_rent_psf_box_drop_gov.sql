-- =====================================================================
-- Migration: cm_chart_catalog — drop 'gov' from rent_psf_box_quarterly
--
-- User feedback (2026-05-09 gov export review): "Data_Rent_PSF_Box is
-- empty." Investigation shows the catalog row applies_to_verticals
-- includes 'gov', but the gov database has no `cm_gov_rent_box_q` view
-- backing it (only `cm_dialysis_rent_box_q` exists). Result: empty tab
-- in every gov export.
--
-- Cleaner end state: drop 'gov' from the applies_to_verticals array so
-- the export skips this template for gov until/unless we ship a gov
-- rent box-plot view. The dialysis + national_st rendering paths are
-- unaffected.
-- =====================================================================

update public.cm_chart_catalog
  set applies_to_verticals = array['national_st','dialysis']::text[]
  where chart_template_id = 'rent_psf_box_quarterly';
