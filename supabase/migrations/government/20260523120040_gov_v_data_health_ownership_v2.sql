-- ============================================================================
-- 20260523120040_gov_v_data_health_ownership_v2.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — Foundation F4 follow-up (gov)
--
-- Real-data check after the F4 apply revealed gov uses `property_public_records`
-- as the linkage mechanism (gov's deed/parcel tables have no property_id
-- column at all). 10,213 parcel links and 5,508 deed links already exist.
-- True orphans: 0 parcels and 88 deeds.
--
-- The v1 view reported 10,197 parcel "orphans" and 5,572 deed "orphans"
-- because it didn't know about the join table. This rebuild uses the
-- join correctly.
-- ============================================================================

DROP VIEW IF EXISTS public.v_data_health_ownership;

CREATE OR REPLACE VIEW public.v_data_health_ownership AS
WITH oh AS (
  SELECT
    COUNT(*) FILTER (WHERE ownership_state = 'active')              AS oh_active,
    COUNT(*) FILTER (WHERE ownership_state = 'superseded')          AS oh_superseded,
    COUNT(*) FILTER (WHERE ownership_state = 'orphan_no_property')  AS oh_orphan,
    COUNT(*) FILTER (WHERE ownership_state = 'needs_review')        AS oh_needs_review,
    COUNT(*)                                                        AS oh_total
  FROM public.ownership_history
),
props AS (
  SELECT
    COUNT(*)                                              AS prop_total,
    COUNT(*) FILTER (WHERE recorded_owner_id IS NOT NULL) AS prop_with_recorded_owner,
    COUNT(*) FILTER (WHERE true_owner_id     IS NOT NULL) AS prop_with_true_owner
  FROM public.properties
),
deeds AS (
  -- Gov deed_records has no property_id column; orphan = no join-table link.
  SELECT
    COUNT(*) AS deed_total,
    COUNT(*) FILTER (
      WHERE NOT EXISTS (
        SELECT 1 FROM public.property_public_records ppr
        WHERE ppr.record_type = 'deed' AND ppr.record_id::text = deed_records.deed_id::text
      )
    ) AS deed_orphans
  FROM public.deed_records
),
parcels AS (
  -- Gov parcel_records also has no property_id column; orphan = no join-table link.
  SELECT
    COUNT(*) AS parcel_total,
    COUNT(*) FILTER (
      WHERE NOT EXISTS (
        SELECT 1 FROM public.property_public_records ppr
        WHERE ppr.record_type = 'parcel' AND ppr.record_id::text = parcel_records.parcel_id::text
      )
    ) AS parcel_orphans
  FROM public.parcel_records
)
SELECT
  'gov'::TEXT                                          AS domain,
  props.prop_total,
  props.prop_with_recorded_owner,
  props.prop_with_true_owner,
  CASE WHEN props.prop_total > 0
       THEN ROUND(100.0 * props.prop_with_recorded_owner::NUMERIC / props.prop_total, 2)
       ELSE NULL END                                   AS pct_property_to_recorded_owner,
  CASE WHEN props.prop_total > 0
       THEN ROUND(100.0 * props.prop_with_true_owner::NUMERIC / props.prop_total, 2)
       ELSE NULL END                                   AS pct_property_to_true_owner,
  oh.oh_total,
  oh.oh_active,
  oh.oh_superseded,
  oh.oh_orphan,
  oh.oh_needs_review,
  deeds.deed_total,
  deeds.deed_orphans,
  parcels.parcel_total,
  parcels.parcel_orphans,
  now()                                                AS computed_at
FROM props, oh, deeds, parcels;

COMMENT ON VIEW public.v_data_health_ownership IS
  'Single-row dashboard view of ownership-side data-health (gov). v2 — counts true orphans via property_public_records join. v1 reported every row as orphaned because it didn''t know about the join table.';
