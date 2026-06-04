-- ============================================================================
-- Round 68-E (G15 + G16) — remove two gov charts from the Capital Markets export
--
-- Target: LCC Opps (xengecqvemvfknjvbvrq) — public.cm_chart_catalog
--
-- Scott's 2026-06-04 chart review: the gov book should NOT replicate
--   G15  "NM Buyer Distribution — Top States (TTM)"   (nm_buyer_distribution)
--   G16  "NM Track Record by Buyer Type (TTM)"        (nm_track_record_buyer_type)
-- "unnecessary, do not replicate." Both applied only to ['gov']; removing 'gov'
-- leaves them applying to no vertical, so the export's realTemplates filter
-- drops them. Reversible: array_append the vertical back.
-- ============================================================================

UPDATE public.cm_chart_catalog
SET applies_to_verticals = array_remove(applies_to_verticals, 'gov')
WHERE chart_template_id IN ('nm_buyer_distribution', 'nm_track_record_buyer_type');
