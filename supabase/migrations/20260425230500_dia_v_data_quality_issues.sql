-- ============================================================================
-- Migration: data quality triage views
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL)
--
-- Surfaces patterns that auto-correction triggers can't safely fix on their
-- own (require human review or merge). Use these views from the LCC UI's
-- Operations / Triage tab to drive a "Data Quality Issues" panel.
--
-- Categories:
--   1. duplicate_property_address — multiple property_ids share the same
--      normalized address+state. Needs manual merge (FK fanout is risky).
--   2. multi_active_lease         — properties with >1 active lease; could be
--      legitimate multi-tenant or stale duplicates. Surface for review.
--   3. listing_after_sale         — active listings whose property has a
--      recorded sale, where listing_date <= sale_date (suggests the
--      close_listing_on_sale trigger missed it).
--   4. orphan_listing             — listings whose property_id no longer
--      exists in properties.
--   5. lease_no_dates             — active leases with neither lease_start
--      nor lease_expiration (placeholder rows).
-- ============================================================================

CREATE OR REPLACE VIEW public.v_data_quality_issues AS
WITH dup_props AS (
  SELECT
    'duplicate_property_address'::text AS issue_kind,
    p.property_id::text                AS record_id,
    p.address                          AS detail_1,
    p.state                            AS detail_2,
    p.tenant                           AS detail_3,
    g.dupe_count::int                  AS severity,
    'Same normalized address+state used by ' || g.dupe_count || ' property_ids: ' ||
      array_to_string(g.property_ids[1:5], ', ') ||
      CASE WHEN g.dupe_count > 5 THEN '…' ELSE '' END AS suggested_action
  FROM properties p
  JOIN (
    SELECT
      state,
      lower(trim(regexp_replace(address, '\s+', ' ', 'g'))) AS norm_addr,
      count(*) AS dupe_count,
      array_agg(property_id ORDER BY property_id) AS property_ids
    FROM properties
    WHERE address IS NOT NULL
    GROUP BY 1, 2
    HAVING count(*) > 1
  ) g ON g.state = p.state
     AND g.norm_addr = lower(trim(regexp_replace(p.address, '\s+', ' ', 'g')))
),
multi_lease AS (
  SELECT
    'multi_active_lease'::text AS issue_kind,
    property_id::text          AS record_id,
    NULL::text                 AS detail_1,
    NULL::text                 AS detail_2,
    NULL::text                 AS detail_3,
    count(*)::int              AS severity,
    'Property has ' || count(*) || ' active leases. Review for stale duplicates vs legitimate multi-tenant.' AS suggested_action
  FROM leases
  WHERE is_active = true
  GROUP BY property_id
  HAVING count(*) > 1
),
listing_after_sale AS (
  SELECT
    'listing_after_sale'::text AS issue_kind,
    al.listing_id::text        AS record_id,
    al.status                  AS detail_1,
    st.sale_date::text         AS detail_2,
    al.listing_date::text      AS detail_3,
    1::int                     AS severity,
    'Listing is active but a sale was recorded on ' || st.sale_date ||
      '. Check if listing pre-dates sale (should be Sold) or is a relisting.' AS suggested_action
  FROM available_listings al
  JOIN sales_transactions st ON st.property_id = al.property_id
  WHERE al.is_active = true
    AND al.status NOT IN ('Sold', 'sold')
    AND st.sale_date IS NOT NULL
    AND (al.listing_date IS NULL OR al.listing_date <= st.sale_date)
),
orphan_listings AS (
  SELECT
    'orphan_listing'::text     AS issue_kind,
    al.listing_id::text        AS record_id,
    al.property_id::text       AS detail_1,
    NULL::text                 AS detail_2,
    NULL::text                 AS detail_3,
    1::int                     AS severity,
    'Listing references property_id ' || al.property_id || ' which no longer exists in properties.' AS suggested_action
  FROM available_listings al
  WHERE NOT EXISTS (SELECT 1 FROM properties p WHERE p.property_id = al.property_id)
),
date_less_leases AS (
  SELECT
    'lease_no_dates'::text  AS issue_kind,
    lease_id::text          AS record_id,
    property_id::text       AS detail_1,
    tenant                  AS detail_2,
    NULL::text              AS detail_3,
    1::int                  AS severity,
    'Active lease has neither lease_start nor lease_expiration. Likely a placeholder.' AS suggested_action
  FROM leases
  WHERE is_active = true
    AND lease_start IS NULL
    AND lease_expiration IS NULL
)
SELECT * FROM dup_props
UNION ALL SELECT * FROM multi_lease
UNION ALL SELECT * FROM listing_after_sale
UNION ALL SELECT * FROM orphan_listings
UNION ALL SELECT * FROM date_less_leases;

COMMENT ON VIEW public.v_data_quality_issues IS
  'Triage view of data quality patterns that auto-correction triggers
   cannot safely resolve. Each row is one issue; severity column gives
   relative magnitude. Use issue_kind to filter:
     SELECT * FROM v_data_quality_issues WHERE issue_kind=X ORDER BY severity DESC';

CREATE OR REPLACE VIEW public.v_data_quality_summary AS
SELECT
  issue_kind,
  count(*)         AS issue_count,
  sum(severity)    AS total_severity,
  max(severity)    AS worst_severity
FROM public.v_data_quality_issues
GROUP BY issue_kind
ORDER BY total_severity DESC;
