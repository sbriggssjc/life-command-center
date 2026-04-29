-- ============================================================================
-- Migration: surface active listings missing verification_due_at
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL)
--
-- The Round 76cx listing_verification schema added a BEFORE INSERT/UPDATE
-- trigger that populates verification_due_at on every active listing, plus
-- a one-shot backfill at install time. In normal operation, every active
-- listing has a value.
--
-- But:
--   - The trigger only fires on INSERT or UPDATE OF (listing_date,
--     last_verified_at, listing_status). A row loaded via psql / pg_dump
--     restore / replication / SUPERUSER bypass would skip it.
--   - The one-shot backfill ran in 20260428540000 — listings inserted
--     between then and a separate trigger creation could have slipped
--     through.
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
),
listing_no_verif_due AS (
  -- Active listings whose verification_due_at trigger never fired (or was
  -- bypassed). lcc-auto-scrape-listings cron now picks these up since the
  -- claude/fix-api-performance-target-Tjq5t branch landed; this view tracks
  -- the count so we can spot a sudden spike.
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
  FROM available_listings al
  WHERE al.is_active = true
    AND al.verification_due_at IS NULL
)
SELECT * FROM dup_props
UNION ALL SELECT * FROM multi_lease
UNION ALL SELECT * FROM listing_after_sale
UNION ALL SELECT * FROM orphan_listings
UNION ALL SELECT * FROM date_less_leases
UNION ALL SELECT * FROM listing_no_verif_due;
