-- User feedback (2026-05-07): "Y Axis issues on Data_DOM_Ask_M and
-- Data_Sentiment_M Data_Vol_Cap_Combo charts."
--
-- After PR L2/M2 rewired the regular dom_and_pct_of_ask, bid_ask_spread,
-- and seller_sentiment chart_template_ids to use monthly TTM data from
-- master_m, the explicit _monthly variants render the same chart twice.
-- The user reported Y-axis issues on those duplicate tabs — fixing them
-- once on the regular tab is enough.
--
-- Drop dialysis from the _monthly variants' applies_to_verticals so they
-- no longer render in the dialysis export. The catalog rows stay
-- (data_shape carries useful context for any future cadence-toggle UI),
-- but they don't appear as tabs.

UPDATE public.cm_chart_catalog
SET applies_to_verticals = ARRAY(
  SELECT v FROM unnest(applies_to_verticals) v WHERE v <> 'dialysis'
)
WHERE chart_template_id IN (
  'dom_and_pct_of_ask_monthly',
  'bid_ask_spread_monthly',
  'seller_sentiment_monthly'
)
  AND 'dialysis' = ANY(applies_to_verticals);
