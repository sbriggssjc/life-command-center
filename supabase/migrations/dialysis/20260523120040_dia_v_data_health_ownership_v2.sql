-- ============================================================================
-- 20260523120040_dia_v_data_health_ownership_v2.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — Foundation F4 follow-up (dia)
--
-- Real-data check after the F4 apply revealed dia uses `property_public_records`
-- as a join table for parcel/deed -> property linkage. The v1 view defined
-- orphans by `deed_records.property_id IS NULL`, which counted 596 orphans —
-- but most of those have a join-table link and just need the column
-- denormalized (a Track A backfill, not a real owner-data gap).
--
-- This view rebuild defines orphans as "deed/parcel has no link via
-- property_public_records AND no direct property_id column value", which is
-- the true linkage gap. Drops from 596 to 377 orphans on the live data.
--
-- The denorm-backfill (sync property_id from join table) is a one-shot
-- Track A run; the join-table writes already happen on new ingest.
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
    COUNT(*) AS prop_total,
    COUNT(*) FILTER (WHERE recorded_owner_id IS NOT NULL) AS prop_with_recorded_owner,
    COUNT(*) FILTER (WHERE true_owner_id     IS NOT NULL) AS prop_with_true_owner
  FROM public.properties
),
deeds AS (
  -- True orphan = no direct property_id AND no join-table link
  SELECT
    COUNT(*) AS deed_total,
    COUNT(*) FILTER (
      WHERE property_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.property_public_records ppr
          WHERE ppr.record_type = 'deed' AND ppr.record_id::text = deed_records.id::text
        )
    ) AS deed_orphans,
    -- Recoverable backlog: NULL column but join-table link exists
    -- (Track A "sync property_id from join table" will fix these)
    COUNT(*) FILTER (
      WHERE property_id IS NULL
        AND EXISTS (
          SELECT 1 FROM public.property_public_records ppr
          WHERE ppr.record_type = 'deed' AND ppr.record_id::text = deed_records.id::text
        )
    ) AS deed_column_backfill_pending
  FROM public.deed_records
)
SELECT
  'dia'::TEXT                                          AS domain,
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
  deeds.deed_column_backfill_pending,
  now()                                                AS computed_at
FROM props, oh, deeds;

COMMENT ON VIEW public.v_data_health_ownership IS
  'Single-row dashboard view of ownership-side data-health (dia). v2 — counts true orphans via property_public_records join AND direct column. The new deed_column_backfill_pending field surfaces the Track A backfill backlog separately.';
