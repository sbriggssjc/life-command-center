-- Tier 2 of parity audit, item 3 of 8: enable market_share_pie_ttm for dialysis.
-- Companion to DialysisProject migration 20260506220000_cm_dialysis_market_share_pie
-- which adds the underlying view to the Dialysis_DB project.
--
-- Note: this catalog row already had applies_to_verticals = {gov} but no
-- corresponding cm_gov_market_share_pie view existed (broker_firms is a
-- separate manual master table, not a live-computed view). The gov chart card
-- has therefore been silently 404ing. Adding 'dialysis' here doesn't break
-- gov further — gov needs its own view migration as a follow-up.

UPDATE public.cm_chart_catalog
SET applies_to_verticals = ARRAY(
  SELECT DISTINCT v
  FROM unnest(applies_to_verticals || ARRAY['dialysis']) v
  ORDER BY v
)
WHERE chart_template_id = 'market_share_pie_ttm';
