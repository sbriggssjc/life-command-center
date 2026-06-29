-- R2-D (2026-06-29, LCC Opps): reusable recovery-map view that feeds the dia
-- date_uncertain on_market_date recovery (`lcc_apply_r2d_date_uncertain_recovery`
-- on the dia DB) from the harvested Salesforce Comp__c.On_Market_Date__c map.
--
-- WHY a NEW view (vs reusing T4c's `v_lcc_on_market_backfill_map`):
--   The T4c map filters `match_domain IN ('dialysis','government')`, but the
--   date_uncertain SF-comp intakes carry `extraction_result.match_domain='lcc'`
--   (the domain lives in `seed_data.source_vertical='dia'/'gov'` instead). So the
--   T4c map SILENTLY EXCLUDED the entire date_uncertain set. This view resolves
--   the domain from `source_vertical`, so those rows are included.
--
-- It emits ONE row per (domain, listing_id, comp candidate) — a listing re-listed
-- over time carries multiple candidates; the dia recovery function picks the
-- latest candidate that does not postdate the listing's exit. Reusable: after a
-- future full Comp__c pull (the ~173 still-unmapped SF-linked comps land in
-- `lcc_sf_comp_on_market` via the `sf-record-lookup-tick` worker / harvest cron),
-- rebuild the payload from this view and re-run the (idempotent, fill-
-- date_uncertain-only) recovery — newly-recovered comps flow through automatically.

CREATE OR REPLACE VIEW public.v_lcc_date_uncertain_recovery_map AS
SELECT DISTINCT
  CASE
    WHEN lower(s.raw_payload->'seed_data'->>'source_vertical') IN ('dia','dialysis')   THEN 'dialysis'
    WHEN lower(s.raw_payload->'seed_data'->>'source_vertical') IN ('gov','government') THEN 'government'
  END                                                          AS match_domain,
  s.raw_payload->'extraction_result'->>'promotion_listing_id'  AS listing_id,
  s.raw_payload->'seed_data'->>'sf_entity_id'                  AS sf_comp_id,
  c.on_market_date
FROM public.staged_intake_items s
JOIN public.lcc_sf_comp_on_market c
  ON c.sf_comp_id = s.raw_payload->'seed_data'->>'sf_entity_id'
WHERE s.raw_payload->'seed_data'->>'sf_entity_id' IS NOT NULL
  AND s.raw_payload->'extraction_result'->>'promotion_listing_id' ~ '^[0-9]+$'
  AND lower(s.raw_payload->'seed_data'->>'source_vertical') IN ('dia','dialysis','gov','government')
  AND c.on_market_date IS NOT NULL;

COMMENT ON VIEW public.v_lcc_date_uncertain_recovery_map IS
  'R2-D: per (domain, listing_id, comp) Comp__c On_Market_Date__c candidates for the dia date_uncertain on_market_date recovery. Resolves domain from seed_data.source_vertical (the date_uncertain intakes carry match_domain=lcc, which the T4c map excluded). Build the payload: SELECT jsonb_agg(jsonb_build_object(''listing_id'',listing_id,''on_market_date'',on_market_date,''sf_comp_id'',sf_comp_id)) FROM v_lcc_date_uncertain_recovery_map WHERE match_domain=''dialysis''; then call dia lcc_apply_r2d_date_uncertain_recovery(payload, false).';
