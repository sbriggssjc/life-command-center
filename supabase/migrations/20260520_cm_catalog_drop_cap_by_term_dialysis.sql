-- User feedback (2026-05-07): "Data_Cap_by_Term has the average for Outside
-- Firm Cap at a lower cap rate than the other three data points when usually
-- that number is a higher cap rate. Ensure this data is for federal government
-- leases with less than 6 months of firm lease term remaining at closing.
-- Speaking of, this is a government chart and not a dialysis chart. Double
-- check which one we should have in the dialysis export."
--
-- The cap_rate_by_lease_term chart with its "Outside Firm" cohort is a
-- gov-leased concept (federal-leased properties have well-defined firm-term
-- structures + an "outside firm term" tail that's shorter and therefore
-- riskier — higher cap). Dialysis lease terms don't segment cleanly the
-- same way; the dialysis "outside firm" cohort here was lifting nulls and
-- mid-range values, producing the inverted ordering the user spotted.
--
-- Drop dialysis from this template's applies_to_verticals so the chart no
-- longer renders on the dialysis tab / export. Gov keeps it (where the
-- semantic actually fits).

UPDATE public.cm_chart_catalog
SET applies_to_verticals = ARRAY(
  SELECT v FROM unnest(applies_to_verticals) v WHERE v <> 'dialysis'
)
WHERE chart_template_id = 'cap_rate_by_lease_term'
  AND 'dialysis' = ANY(applies_to_verticals);
