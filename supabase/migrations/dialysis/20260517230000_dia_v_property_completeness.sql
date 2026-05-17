-- ============================================================================
-- Item #6 Phase A (dia, 2026-05-17): v_property_completeness
-- Per-property completeness score driving the detail-panel completeness rail.
--
-- Weights (sum = 100):
--   recorded_owner       14
--   anchor_rent          12
--   tenant_or_operator   10
--   cms_link              9
--   building_size         8
--   lease_commencement    7
--   latest_sale_price     6
--   total_chairs          6
--   lease_bump_pct        5
--   ttm_revenue           5
--   latest_patient_count  5
--   parcel_number         5
--   year_built            4
--   latest_deed_date      4
--
-- Score bands:
--   90-100  excellent
--   70-89   good
--   40-69   fair
--   <40     poor
-- ============================================================================
CREATE OR REPLACE VIEW public.v_property_completeness AS
WITH spec AS (
  SELECT
    p.property_id,
    -- Boolean field-presence flags
    (p.recorded_owner_id IS NOT NULL
       OR NULLIF(trim(coalesce(p.recorded_owner_name, '')), '') IS NOT NULL) AS has_recorded_owner,
    (NULLIF(trim(coalesce(p.operator, p.tenant::text, p.chain_canonical, '')), '') IS NOT NULL) AS has_tenant_or_operator,
    (p.anchor_rent IS NOT NULL AND p.anchor_rent > 0)               AS has_anchor_rent,
    (p.building_size IS NOT NULL AND p.building_size > 0)           AS has_building_size,
    (NULLIF(trim(coalesce(p.medicare_id, p.linked_medicare_facility_id, '')), '') IS NOT NULL) AS has_cms_link,
    (p.latest_sale_price IS NOT NULL AND p.latest_sale_price > 0)   AS has_latest_sale_price,
    (p.latest_deed_date IS NOT NULL)                                 AS has_latest_deed_date,
    (p.lease_commencement IS NOT NULL)                               AS has_lease_commencement,
    (p.lease_bump_pct IS NOT NULL)                                   AS has_lease_bump_pct,
    (p.total_chairs IS NOT NULL AND p.total_chairs > 0)              AS has_total_chairs,
    (p.year_built IS NOT NULL AND p.year_built > 1800)               AS has_year_built,
    (p.ttm_revenue IS NOT NULL AND p.ttm_revenue > 0)                AS has_ttm_revenue,
    (p.latest_patient_count IS NOT NULL AND p.latest_patient_count > 0) AS has_patient_count,
    (NULLIF(trim(coalesce(p.parcel_number, '')), '') IS NOT NULL)    AS has_parcel_number
  FROM public.properties p
),
scored AS (
  SELECT
    property_id,
    (CASE WHEN has_recorded_owner       THEN 14 ELSE 0 END
   + CASE WHEN has_anchor_rent           THEN 12 ELSE 0 END
   + CASE WHEN has_tenant_or_operator    THEN 10 ELSE 0 END
   + CASE WHEN has_cms_link              THEN  9 ELSE 0 END
   + CASE WHEN has_building_size         THEN  8 ELSE 0 END
   + CASE WHEN has_lease_commencement    THEN  7 ELSE 0 END
   + CASE WHEN has_latest_sale_price     THEN  6 ELSE 0 END
   + CASE WHEN has_total_chairs          THEN  6 ELSE 0 END
   + CASE WHEN has_lease_bump_pct        THEN  5 ELSE 0 END
   + CASE WHEN has_ttm_revenue           THEN  5 ELSE 0 END
   + CASE WHEN has_patient_count         THEN  5 ELSE 0 END
   + CASE WHEN has_parcel_number         THEN  5 ELSE 0 END
   + CASE WHEN has_year_built            THEN  4 ELSE 0 END
   + CASE WHEN has_latest_deed_date      THEN  4 ELSE 0 END) AS completeness_score,
    -- Missing-field list, sorted by weight DESC, as JSONB array.
    jsonb_strip_nulls(jsonb_build_array(
      CASE WHEN NOT has_recorded_owner    THEN jsonb_build_object('key','recorded_owner','label','Recorded owner','weight',14,'tab','Ownership & CRM') END,
      CASE WHEN NOT has_anchor_rent       THEN jsonb_build_object('key','anchor_rent','label','Anchor rent','weight',12,'tab','Rent Roll') END,
      CASE WHEN NOT has_tenant_or_operator THEN jsonb_build_object('key','tenant_or_operator','label','Tenant / operator','weight',10,'tab','Operations') END,
      CASE WHEN NOT has_cms_link          THEN jsonb_build_object('key','cms_link','label','CMS link (CCN)','weight',9,'tab','Operations') END,
      CASE WHEN NOT has_building_size     THEN jsonb_build_object('key','building_size','label','Building size (SF)','weight',8,'tab','Overview') END,
      CASE WHEN NOT has_lease_commencement THEN jsonb_build_object('key','lease_commencement','label','Lease commencement','weight',7,'tab','Rent Roll') END,
      CASE WHEN NOT has_latest_sale_price THEN jsonb_build_object('key','latest_sale_price','label','Latest sale price','weight',6,'tab','Deal History') END,
      CASE WHEN NOT has_total_chairs      THEN jsonb_build_object('key','total_chairs','label','Total chairs','weight',6,'tab','Operations') END,
      CASE WHEN NOT has_lease_bump_pct    THEN jsonb_build_object('key','lease_bump_pct','label','Rent escalation %','weight',5,'tab','Rent Roll') END,
      CASE WHEN NOT has_ttm_revenue       THEN jsonb_build_object('key','ttm_revenue','label','TTM revenue','weight',5,'tab','Operations') END,
      CASE WHEN NOT has_patient_count     THEN jsonb_build_object('key','patient_count','label','Latest patient count','weight',5,'tab','Operations') END,
      CASE WHEN NOT has_parcel_number     THEN jsonb_build_object('key','parcel_number','label','Parcel number','weight',5,'tab','Overview') END,
      CASE WHEN NOT has_year_built        THEN jsonb_build_object('key','year_built','label','Year built','weight',4,'tab','Overview') END,
      CASE WHEN NOT has_latest_deed_date  THEN jsonb_build_object('key','latest_deed_date','label','Latest deed date','weight',4,'tab','Deal History') END
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
