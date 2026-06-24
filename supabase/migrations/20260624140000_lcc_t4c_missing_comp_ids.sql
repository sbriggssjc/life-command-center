-- T4c RECOVERY — ID-based SF record lookup (2026-06-24)
-- ============================================================================
-- The broad PA Comp crawl is EXHAUSTED: the `Get Comps` tenant-keyword filter
-- tops out at 674 comps and two full crawls did NOT grow it — the still-held
-- SF-linked comps that don't match the keyword filter are unreachable that way.
-- The fix (Scott's design) is an ID-based lookup: LCC sends the exact comp IDs
-- it's missing, the PA "SF -> LCC: Record Lookup by ID" flow returns their
-- On_Market_Date__c, LCC lands them in the retained map and re-runs the backfill.
--
-- This migration adds the LCC-side artifacts the worker
-- (api/_handlers/sf-record-lookup.js) consumes:
--   (1) v_lcc_missing_comp_ids   — the comp IDs linked to a promoted dia/gov
--       listing that are NOT yet in lcc_sf_comp_on_market (the LCC-derivable
--       missing set; the worker narrows it to STILL-HELD listings domain-side).
--   (2) lcc_upsert_sf_comp_on_market(jsonb) — lands the SF lookup results in the
--       retained map with the SAME ON CONFLICT semantics as the hourly harvest
--       (lcc_harvest_sf_comp_on_market), so the existing
--       v_lcc_on_market_backfill_map picks them up automatically.
--
-- Additive + reversible: DROP the view + function to revert. Touches NOTHING
-- outside LCC Opps; no domain writes (the dia/gov backfill functions, applied
-- separately, consume v_lcc_on_market_backfill_map as before).

-- ── (1) the LCC-derivable missing-comp-ID set ───────────────────────────────
-- One row per (match_domain, listing_id, sf_comp_id) reachable from an SF-comp
-- intake (seed_data.sf_entity_id -> extraction_result.promotion_listing_id)
-- whose comp is NOT yet retained in lcc_sf_comp_on_market. The worker groups by
-- domain, intersects listing_id with the domain's STILL-HELD set
-- (available_listings.on_market_date_source='unestablished'), and de-dupes the
-- comp IDs into the lookup batches. "Held" is a domain-side fact LCC can't see,
-- so it is applied in the worker, not here.
CREATE OR REPLACE VIEW public.v_lcc_missing_comp_ids AS
SELECT DISTINCT
  lower(s.raw_payload->'extraction_result'->>'match_domain') AS match_domain,
  s.raw_payload->'extraction_result'->>'promotion_listing_id' AS listing_id,
  s.raw_payload->'seed_data'->>'sf_entity_id'                 AS sf_comp_id
FROM public.staged_intake_items s
LEFT JOIN public.lcc_sf_comp_on_market c
  ON c.sf_comp_id = s.raw_payload->'seed_data'->>'sf_entity_id'
WHERE s.raw_payload->'seed_data'->>'sf_entity_id' IS NOT NULL
  AND s.raw_payload->'extraction_result'->>'promotion_listing_id' IS NOT NULL
  AND lower(s.raw_payload->'extraction_result'->>'match_domain') IN ('dialysis','government')
  AND c.sf_comp_id IS NULL;   -- not yet in the retained map

COMMENT ON VIEW public.v_lcc_missing_comp_ids IS
  'T4c recovery: comp IDs linked to a promoted dia/gov listing that are NOT yet in lcc_sf_comp_on_market. Consumed by the sf-record-lookup worker, which narrows to still-held listings domain-side and fetches each comp''s On_Market_Date__c by Id from Salesforce.';

-- ── (2) land SF lookup results in the retained map ──────────────────────────
-- p_rows: jsonb array of {sf_comp_id, on_market_date, created_date}. Mirrors the
-- hourly harvest ON CONFLICT semantics: keep the latest non-null OMD, the
-- earliest CreatedDate, has_omd sticky. Returns counts.
CREATE OR REPLACE FUNCTION public.lcc_upsert_sf_comp_on_market(p_rows jsonb)
RETURNS TABLE(upserted integer, with_omd integer)
LANGUAGE plpgsql
AS $fn$
DECLARE v_u integer; v_o integer;
BEGIN
  WITH src AS (
    SELECT e->>'sf_comp_id'                              AS sf_comp_id,
           NULLIF(e->>'on_market_date','')::date         AS omd,
           NULLIF(e->>'created_date','')::date           AS created_dt
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) e
    WHERE e->>'sf_comp_id' IS NOT NULL
      AND length(e->>'sf_comp_id') > 0
  ),
  up AS (
    INSERT INTO public.lcc_sf_comp_on_market AS t
      (sf_comp_id, on_market_date, created_date, has_omd, last_seen)
    SELECT sf_comp_id, omd, created_dt, (omd IS NOT NULL), now()
    FROM src
    ON CONFLICT (sf_comp_id) DO UPDATE SET
      on_market_date = COALESCE(EXCLUDED.on_market_date, t.on_market_date),
      created_date   = COALESCE(t.created_date, EXCLUDED.created_date),
      has_omd        = t.has_omd OR EXCLUDED.has_omd,
      last_seen      = now()
    RETURNING (t.on_market_date IS NOT NULL) AS has_date
  )
  SELECT count(*)::int, count(*) FILTER (WHERE has_date)::int INTO v_u, v_o FROM up;
  RETURN QUERY SELECT v_u, v_o;
END
$fn$;

COMMENT ON FUNCTION public.lcc_upsert_sf_comp_on_market(jsonb) IS
  'T4c recovery: land ID-based SF record-lookup results ({sf_comp_id,on_market_date,created_date}) in lcc_sf_comp_on_market with the same ON CONFLICT semantics as lcc_harvest_sf_comp_on_market.';
