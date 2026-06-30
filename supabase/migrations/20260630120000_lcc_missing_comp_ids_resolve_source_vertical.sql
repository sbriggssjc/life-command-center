-- R2-D drain enablement (LCC Opps, 2026-06-30): let the sf-record-lookup worker
-- ENUMERATE the date_uncertain SF-comp set, not just the T4c `match_domain`-tagged
-- intakes.
--
-- WHY: `v_lcc_missing_comp_ids` filtered `extraction_result.match_domain IN
-- ('dialysis','government')`, but ~316 of the 375 still-pending SF-comp intakes
-- carry `match_domain='lcc'` (the domain lives in `seed_data.source_vertical`
-- instead — the SAME gap `v_lcc_date_uncertain_recovery_map` was created to
-- resolve). So the worker's source view never surfaced them and they could not be
-- fetched. This resolves the domain from `source_vertical` when
-- `extraction_result.match_domain` is not already a domain value, mirroring the
-- recovery-map view.
--
-- Together with the JS change (loadHeldListingIds now includes 'date_uncertain'),
-- the worker can source AND fetch the 375 date_uncertain source comps. Additive +
-- reversible (re-create the prior body — the T4c `match_domain`-only WHERE).

CREATE OR REPLACE VIEW public.v_lcc_missing_comp_ids AS
SELECT DISTINCT
  CASE
    WHEN lower(s.raw_payload->'extraction_result'->>'match_domain') IN ('dialysis','government')
      THEN lower(s.raw_payload->'extraction_result'->>'match_domain')
    WHEN lower(s.raw_payload->'seed_data'->>'source_vertical') IN ('dia','dialysis')   THEN 'dialysis'
    WHEN lower(s.raw_payload->'seed_data'->>'source_vertical') IN ('gov','government') THEN 'government'
  END                                                          AS match_domain,
  s.raw_payload->'extraction_result'->>'promotion_listing_id'  AS listing_id,
  s.raw_payload->'seed_data'->>'sf_entity_id'                  AS sf_comp_id
FROM public.staged_intake_items s
LEFT JOIN public.lcc_sf_comp_on_market c
  ON c.sf_comp_id = s.raw_payload->'seed_data'->>'sf_entity_id'
WHERE s.raw_payload->'seed_data'->>'sf_entity_id' IS NOT NULL
  AND s.raw_payload->'extraction_result'->>'promotion_listing_id' IS NOT NULL
  AND (
    lower(s.raw_payload->'extraction_result'->>'match_domain') IN ('dialysis','government')
    OR lower(s.raw_payload->'seed_data'->>'source_vertical') IN ('dia','dialysis','gov','government')
  )
  AND c.sf_comp_id IS NULL;   -- not yet in the retained map

COMMENT ON VIEW public.v_lcc_missing_comp_ids IS
  'T4c/R2-D recovery: comp IDs linked to a promoted dia/gov listing that are NOT yet in lcc_sf_comp_on_market. match_domain resolves from extraction_result.match_domain, falling back to seed_data.source_vertical (the date_uncertain SF-comp intakes carry match_domain=lcc). Consumed by the sf-record-lookup worker, which narrows to still-held listings (on_market_date_source in unestablished/date_uncertain) and fetches each comp''s On_Market_Date__c by Id from Salesforce.';
