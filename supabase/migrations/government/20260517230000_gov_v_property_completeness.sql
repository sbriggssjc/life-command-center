-- ============================================================================
-- Item #6 Phase A (gov, 2026-05-17): v_property_completeness
-- Government mirror of the dia completeness view.
--
-- Weights (sum = 100):
--   recorded_owner          14
--   gross_rent              11
--   noi                     11
--   agency                  10
--   lease_number            10
--   lease_expiration         9
--   rba                      8
--   lease_commencement       7
--   term_remaining           5
--   latest_sale_price        5
--   year_built               4
--   federal_employee_count   3
--   is_build_to_suit         3
--
-- (lease_structure dropped — 0% populated in current data.)
-- ============================================================================
CREATE OR REPLACE VIEW public.v_property_completeness AS
WITH spec AS (
  SELECT
    p.property_id,
    (p.recorded_owner_id IS NOT NULL)                                AS has_recorded_owner,
    (p.gross_rent IS NOT NULL AND p.gross_rent > 0)                  AS has_gross_rent,
    (p.noi IS NOT NULL)                                              AS has_noi,
    (NULLIF(trim(coalesce(p.agency_canonical, p.agency_full_name, p.agency, '')), '') IS NOT NULL) AS has_agency,
    (NULLIF(trim(coalesce(p.lease_number, '')), '') IS NOT NULL)     AS has_lease_number,
    (p.lease_expiration IS NOT NULL)                                 AS has_lease_expiration,
    (p.rba IS NOT NULL AND p.rba > 0)                                AS has_rba,
    (p.lease_commencement IS NOT NULL)                               AS has_lease_commencement,
    (p.term_remaining IS NOT NULL)                                   AS has_term_remaining,
    (p.latest_sale_price IS NOT NULL AND p.latest_sale_price > 0)    AS has_latest_sale_price,
    (p.year_built IS NOT NULL AND p.year_built > 1800)               AS has_year_built,
    (p.federal_employee_count IS NOT NULL AND p.federal_employee_count > 0) AS has_federal_employee_count,
    (p.is_build_to_suit IS NOT NULL)                                 AS has_is_build_to_suit
  FROM public.properties p
),
scored AS (
  SELECT
    property_id,
    (CASE WHEN has_recorded_owner         THEN 14 ELSE 0 END
   + CASE WHEN has_gross_rent              THEN 11 ELSE 0 END
   + CASE WHEN has_noi                     THEN 11 ELSE 0 END
   + CASE WHEN has_agency                  THEN 10 ELSE 0 END
   + CASE WHEN has_lease_number            THEN 10 ELSE 0 END
   + CASE WHEN has_lease_expiration        THEN  9 ELSE 0 END
   + CASE WHEN has_rba                     THEN  8 ELSE 0 END
   + CASE WHEN has_lease_commencement      THEN  7 ELSE 0 END
   + CASE WHEN has_term_remaining          THEN  5 ELSE 0 END
   + CASE WHEN has_latest_sale_price       THEN  5 ELSE 0 END
   + CASE WHEN has_year_built              THEN  4 ELSE 0 END
   + CASE WHEN has_federal_employee_count  THEN  3 ELSE 0 END
   + CASE WHEN has_is_build_to_suit        THEN  3 ELSE 0 END) AS completeness_score,
    jsonb_strip_nulls(jsonb_build_array(
      CASE WHEN NOT has_recorded_owner        THEN jsonb_build_object('key','recorded_owner','label','Recorded owner','weight',14,'tab','Ownership & CRM') END,
      CASE WHEN NOT has_gross_rent            THEN jsonb_build_object('key','gross_rent','label','Gross rent','weight',11,'tab','Rent Roll') END,
      CASE WHEN NOT has_noi                   THEN jsonb_build_object('key','noi','label','NOI','weight',11,'tab','Rent Roll') END,
      CASE WHEN NOT has_agency                THEN jsonb_build_object('key','agency','label','Tenant agency','weight',10,'tab','Overview') END,
      CASE WHEN NOT has_lease_number          THEN jsonb_build_object('key','lease_number','label','GSA / DACA lease #','weight',10,'tab','Overview') END,
      CASE WHEN NOT has_lease_expiration      THEN jsonb_build_object('key','lease_expiration','label','Lease expiration','weight',9,'tab','Rent Roll') END,
      CASE WHEN NOT has_rba                   THEN jsonb_build_object('key','rba','label','Rentable Building Area','weight',8,'tab','Overview') END,
      CASE WHEN NOT has_lease_commencement    THEN jsonb_build_object('key','lease_commencement','label','Lease commencement','weight',7,'tab','Rent Roll') END,
      CASE WHEN NOT has_term_remaining        THEN jsonb_build_object('key','term_remaining','label','Term remaining','weight',5,'tab','Rent Roll') END,
      CASE WHEN NOT has_latest_sale_price     THEN jsonb_build_object('key','latest_sale_price','label','Latest sale price','weight',5,'tab','Deal History') END,
      CASE WHEN NOT has_year_built            THEN jsonb_build_object('key','year_built','label','Year built','weight',4,'tab','Overview') END,
      CASE WHEN NOT has_federal_employee_count THEN jsonb_build_object('key','federal_employee_count','label','Federal headcount','weight',3,'tab','Operations') END,
      CASE WHEN NOT has_is_build_to_suit      THEN jsonb_build_object('key','is_build_to_suit','label','Build-to-suit flag','weight',3,'tab','Overview') END
    )) AS missing_fields_raw
  FROM spec
)
SELECT
  property_id,
  completeness_score,
  CASE
    WHEN completeness_score >= 90 THEN 'excellent'
    WHEN completeness_score >= 70 THEN 'good'
    WHEN completeness_score >= 40 THEN 'fair'
    ELSE 'poor'
  END AS completeness_band,
  COALESCE(
    (SELECT jsonb_agg(elem ORDER BY (elem->>'weight')::int DESC)
       FROM jsonb_array_elements(missing_fields_raw) elem),
    '[]'::jsonb
  ) AS missing_fields
FROM scored;

COMMENT ON VIEW public.v_property_completeness IS
  'Item #6 Phase A: per-property completeness score (0-100) + missing high-value fields. '
  'Powers the completeness rail on detail.js. Server-side calibration of the same weights.';
