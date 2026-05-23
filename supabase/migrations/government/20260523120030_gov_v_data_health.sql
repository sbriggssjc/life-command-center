-- ============================================================================
-- 20260523120030_gov_v_data_health.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — Foundation F4 (gov)
--
-- Mirror of the dia data-health views. Gov has higher absolute counts on
-- almost every metric (458 implausible cap rates, 5,423 ownership stubs,
-- 9,402 orphaned parcels, 1,349 redundant owner rows) so this view is the
-- single most important dashboard input. See dia migration for design notes.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_data_health_sales AS
WITH dup AS (
  SELECT dedup_natural_key, COUNT(*) AS rows_in_group
  FROM public.sales_transactions
  WHERE transaction_state = 'live'
    AND dedup_natural_key IS NOT NULL
  GROUP BY dedup_natural_key
  HAVING COUNT(*) > 1
),
dup_summary AS (
  SELECT
    COUNT(*)                            AS duplicate_groups_live,
    COALESCE(SUM(rows_in_group - 1), 0) AS duplicate_rows_pending_quarantine
  FROM dup
),
state_counts AS (
  SELECT
    COUNT(*) FILTER (WHERE transaction_state = 'live')                     AS sales_live,
    COUNT(*) FILTER (WHERE transaction_state = 'duplicate_superseded')     AS sales_duplicate_superseded,
    COUNT(*) FILTER (WHERE transaction_state = 'ownership_stub')           AS sales_ownership_stub,
    COUNT(*) FILTER (WHERE transaction_state = 'quarantined_implausible')  AS sales_quarantined_implausible,
    COUNT(*) FILTER (WHERE transaction_state = 'needs_review')             AS sales_needs_review,
    COUNT(*) FILTER (WHERE transaction_state = 'live' AND property_id IS NULL)
                                                                            AS sales_live_missing_property,
    COUNT(*) FILTER (WHERE transaction_state = 'live' AND sold_price IS NULL)
                                                                            AS sales_live_missing_price,
    COUNT(*) FILTER (WHERE transaction_state = 'live' AND sale_date IS NULL)
                                                                            AS sales_live_missing_date,
    COUNT(*) FILTER (WHERE transaction_state = 'live'
                       AND (sold_price IS NULL OR sold_price < 50000)
                       AND COALESCE(transaction_type, '') ILIKE '%ownership%stub%')
                                                                            AS sales_live_ownership_stub_in_live_lane,
    COUNT(*) FILTER (WHERE transaction_state = 'live'
                       AND COALESCE(sold_cap_rate, cap_rate) IS NOT NULL
                       AND (COALESCE(sold_cap_rate, cap_rate) < 0.03
                            OR COALESCE(sold_cap_rate, cap_rate) > 0.10))
                                                                            AS sales_live_cap_rate_outside_default_band,
    COUNT(*) AS sales_total
  FROM public.sales_transactions
)
SELECT
  'gov'::TEXT                                          AS domain,
  state_counts.sales_total,
  state_counts.sales_live,
  state_counts.sales_duplicate_superseded,
  state_counts.sales_ownership_stub,
  state_counts.sales_quarantined_implausible,
  state_counts.sales_needs_review,
  state_counts.sales_live_missing_property,
  state_counts.sales_live_missing_price,
  state_counts.sales_live_missing_date,
  state_counts.sales_live_ownership_stub_in_live_lane,
  state_counts.sales_live_cap_rate_outside_default_band,
  dup_summary.duplicate_groups_live,
  dup_summary.duplicate_rows_pending_quarantine,
  now()                                                AS computed_at
FROM state_counts, dup_summary;

COMMENT ON VIEW public.v_data_health_sales IS
  'Single-row dashboard view of sales-side data-health (gov). Powers Track B7 backslide alarms.';

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
  SELECT
    COALESCE((SELECT COUNT(*) FROM public.deed_records),   0)                              AS deed_total,
    COALESCE((SELECT COUNT(*) FROM public.deed_records WHERE property_id IS NULL), 0)      AS deed_orphans,
    COALESCE((SELECT COUNT(*) FROM public.parcel_records), 0)                              AS parcel_total,
    COALESCE((SELECT COUNT(*) FROM public.parcel_records WHERE property_id IS NULL), 0)    AS parcel_orphans
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
  deeds.parcel_total,
  deeds.parcel_orphans,
  now()                                                AS computed_at
FROM props, oh, deeds;

COMMENT ON VIEW public.v_data_health_ownership IS
  'Single-row dashboard view of ownership-side data-health (gov). Tracks G3 (deed/parcel orphans) and G10 (ownership_history hygiene).';

CREATE OR REPLACE VIEW public.v_data_health_entities AS
WITH norm AS (
  SELECT
    recorded_owner_id,
    LOWER(REGEXP_REPLACE(
      COALESCE(canonical_name, normalized_name, recorded_owner_name, ''),
      '[\.,]|\m(llc|inc|corp|corporation|company|co|lp|llp|trust|holdings|properties|propco)\M',
      '', 'gi'
    ))                                                   AS canonical_key
  FROM public.recorded_owners
),
norm_grouped AS (
  SELECT canonical_key, COUNT(*) AS rows_in_group
  FROM norm
  WHERE canonical_key IS NOT NULL AND canonical_key <> ''
  GROUP BY canonical_key
),
ro AS (
  SELECT COUNT(*) AS total_recorded_owners FROM public.recorded_owners
),
to_t AS (
  SELECT COUNT(*) AS total_true_owners FROM public.true_owners
)
SELECT
  'gov'::TEXT                                          AS domain,
  ro.total_recorded_owners,
  to_t.total_true_owners,
  (SELECT COUNT(*) FROM norm_grouped WHERE rows_in_group > 1)         AS redundant_owner_groups,
  (SELECT COALESCE(SUM(rows_in_group - 1), 0)
     FROM norm_grouped WHERE rows_in_group > 1)                       AS redundant_owner_rows,
  now()                                                AS computed_at
FROM ro, to_t;

COMMENT ON VIEW public.v_data_health_entities IS
  'Single-row dashboard view of entity dedup health (gov). redundant_owner_rows ~ 1,349 baseline; drops to ~0 after A1 + C4.';
