-- ============================================================================
-- Migration: surface active gov listings missing verification_due_at
--
-- Target: government Supabase (GOV_SUPABASE_URL)
--
-- Mirror of the dia migration in this round. See that file for the full
-- explanation of why active listings can end up with NULL
-- verification_due_at despite the BEFORE INSERT/UPDATE trigger that's
-- supposed to populate it.
--
-- The lcc-auto-scrape-listings cron now picks up NULL verification_due_at
-- rows automatically (admin.js change in the same commit). This view adds
-- visibility so we can see if it's a real problem and trend it over time.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_data_quality_issues AS
WITH dup_props AS (
  SELECT
    'duplicate_property_address'::text AS issue_kind,
    p.property_id::text                AS record_id,
    p.address                          AS detail_1,
    p.state                            AS detail_2,
    p.agency                           AS detail_3,
    g.dupe_count::int                  AS severity,
    'Same normalized address+state used by ' || g.dupe_count || ' property_ids: ' ||
      array_to_string(g.property_ids[1:5], ', ') ||
      CASE WHEN g.dupe_count > 5 THEN '…' ELSE '' END AS suggested_action
  FROM public.properties p
  JOIN (
    SELECT
      state,
      lower(trim(regexp_replace(address, '\s+', ' ', 'g'))) AS norm_addr,
      count(*) AS dupe_count,
      array_agg(property_id ORDER BY property_id) AS property_ids
    FROM public.properties
    WHERE address IS NOT NULL
    GROUP BY 1, 2
    HAVING count(*) > 1
  ) g ON g.state = p.state
     AND g.norm_addr = lower(trim(regexp_replace(p.address, '\s+', ' ', 'g')))
),
listing_after_sale AS (
  SELECT
    'listing_after_sale'::text  AS issue_kind,
    al.listing_id::text         AS record_id,
    al.listing_status           AS detail_1,
    st.sale_date::text          AS detail_2,
    al.listing_date::text       AS detail_3,
    1::int                      AS severity,
    'Listing is Active but a sale was recorded on ' || st.sale_date ||
      '. Likely a missed listing-close — review and mark Sold.' AS suggested_action
  FROM public.available_listings al
  JOIN public.sales_transactions st ON st.property_id = al.property_id
  WHERE al.listing_status = 'Active'
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
  FROM public.available_listings al
  WHERE NOT EXISTS (SELECT 1 FROM public.properties p WHERE p.property_id = al.property_id)
),
date_less_leases AS (
  SELECT
    'lease_no_dates'::text  AS issue_kind,
    lease_id::text          AS record_id,
    property_id::text       AS detail_1,
    agency                  AS detail_2,
    NULL::text              AS detail_3,
    1::int                  AS severity,
    'Active lease has neither commencement_date nor expiration_date. Likely a placeholder.' AS suggested_action
  FROM public.leases
  WHERE superseded_at IS NULL
    AND commencement_date IS NULL
    AND expiration_date   IS NULL
),
listing_no_verif_due AS (
  -- Active listings whose verification_due_at trigger never fired (or was
  -- bypassed). The cron now picks these up; this view tracks the count
  -- so we can spot a sudden spike.
  SELECT
    'listing_active_no_verification_due'::text AS issue_kind,
    al.listing_id::text                        AS record_id,
    al.property_id::text                       AS detail_1,
    al.listing_date::text                      AS detail_2,
    al.last_verified_at::text                  AS detail_3,
    1::int                                     AS severity,
    'Active listing without verification_due_at. The cron will pick it up; '
      || 'if this count is non-trivial, investigate the trigger or do a one-shot '
      || 'UPDATE ... SET verification_due_at = lcc_compute_verification_due_at(...).'
      AS suggested_action
  FROM public.available_listings al
  WHERE COALESCE(al.listing_status, 'active') = 'active'
    AND al.verification_due_at IS NULL
)
SELECT * FROM dup_props
UNION ALL SELECT * FROM listing_after_sale
UNION ALL SELECT * FROM orphan_listings
UNION ALL SELECT * FROM date_less_leases
UNION ALL SELECT * FROM listing_no_verif_due;
