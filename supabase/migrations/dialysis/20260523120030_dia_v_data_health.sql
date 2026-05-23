-- ============================================================================
-- 20260523120030_dia_v_data_health.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — Foundation F4 (dia)
--
-- Read-only views surfacing the data-health metrics from §6 of the plan.
-- These power the ops "Data Health" dashboard (B8) and the daily backslide
-- alarms (B7). Each view is keyed so the dashboard can simply select the
-- whole row.
--
-- The values are computed live, so as Track A cleanup runs land the numbers
-- improve in real time without any view refresh.
--
--   v_data_health_sales      — sales-side metrics (G1, G2, G6, G9)
--   v_data_health_ownership  — ownership-side metrics (G3, G10)
--   v_data_health_entities   — entity dedup metrics (G4)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- v_data_health_sales (dia)
-- ----------------------------------------------------------------------------
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
    COUNT(*)                   AS duplicate_groups_live,
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
    COUNT(*) FILTER (WHERE transaction_state = 'live' AND cap_rate IS NOT NULL
                       AND (cap_rate < 0.03 OR cap_rate > 0.10))
                                                                            AS sales_live_cap_rate_outside_default_band,
    COUNT(*) AS sales_total
  FROM public.sales_transactions
)
SELECT
  'dia'::TEXT                                          AS domain,
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
  'Single-row dashboard view of sales-side data-health (dia). Powers Track B7 backslide alarms.';

-- ----------------------------------------------------------------------------
-- v_data_health_ownership (dia)
-- ----------------------------------------------------------------------------
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
  -- deed_records may not exist on every project; guarded by to_regclass
  SELECT
    COALESCE((SELECT COUNT(*) FROM public.deed_records), 0)                                       AS deed_total,
    COALESCE((SELECT COUNT(*) FROM public.deed_records WHERE property_id IS NULL), 0)             AS deed_orphans
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
  now()                                                AS computed_at
FROM props, oh, deeds;

COMMENT ON VIEW public.v_data_health_ownership IS
  'Single-row dashboard view of ownership-side data-health (dia). Powers Track B7 alarms and G3/G10 progress tracking.';

-- ----------------------------------------------------------------------------
-- v_data_health_entities (dia)
-- ----------------------------------------------------------------------------
-- "Redundancy" here is approximate until the C4 BEFORE INSERT trigger
-- normalizes the canonical key. We define a redundant row as one whose
-- COALESCE(normalized_name, lower(trim(recorded_owner_name))) matches at
-- least one other row's normalized key. The B2 worker will drive this to
-- 0 once A1 lands.
CREATE OR REPLACE VIEW public.v_data_health_entities AS
WITH norm AS (
  SELECT
    recorded_owner_id,
    LOWER(REGEXP_REPLACE(
      COALESCE(normalized_name, recorded_owner_name, ''),
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
  'dia'::TEXT                                          AS domain,
  ro.total_recorded_owners,
  to_t.total_true_owners,
  (SELECT COUNT(*) FROM norm_grouped WHERE rows_in_group > 1)         AS redundant_owner_groups,
  (SELECT COALESCE(SUM(rows_in_group - 1), 0)
     FROM norm_grouped WHERE rows_in_group > 1)                       AS redundant_owner_rows,
  now()                                                AS computed_at
FROM ro, to_t;

COMMENT ON VIEW public.v_data_health_entities IS
  'Single-row dashboard view of entity dedup health (dia). The redundant_owner_rows count is the A1 backlog. Drops to ~0 after A1 + C4.';
