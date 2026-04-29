-- ============================================================================
-- Migration: gov data-quality view + listing-close backfill
--
-- Target: government Supabase (GOV_SUPABASE_URL)
--
-- Two parts:
--
--  (A) Mirror the dia v_data_quality_issues / v_data_quality_summary views
--      for the government schema. Uses gov-specific column names
--      (listing_status text vs is_active bool, superseded_at NULL semantics
--      vs is_active=true, agency vs tenant, commencement_date /
--      expiration_date vs lease_start / lease_expiration). Drops the
--      dia-specific multi_active_lease check — government buildings
--      legitimately host multiple agency leases per property, so >1 active
--      lease is not a smell.
--
--  (B) One-shot backfill of historical listings that should have been
--      marked Sold when their corresponding sales_transactions row was
--      ingested but stayed Active because pickClosestListing was undefined
--      (every government-domain CoStar sale ingest hit that ReferenceError
--      from somewhere around mid-2026 until the fix landed in
--      claude/fix-api-performance-target-Tjq5t).
--
--      The backfill mirrors the now-correct JS logic:
--        - Only consider available_listings with listing_status='Active'.
--        - Match against sales_transactions on property_id.
--        - Window: |sale_date - listing_date| <= 3 years (1096 days for
--          leap-year cushion). Skip rows where either date is null.
--        - Tiebreak: prefer sale_date on-or-after listing_date (the sale
--          that "closed" the listing rather than a phantom earlier sale).
--        - Each listing closes against at most one sale (DISTINCT ON
--          listing_id). The same sale may close multiple listings — that's
--          fine; a relisting after price reduction is the typical case.
--
--      Re-running this migration is safe: the WHERE listing_status='Active'
--      filter excludes already-closed rows.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (A) v_data_quality_issues
-- ----------------------------------------------------------------------------

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
  -- Active listings whose property has at least one sale.
  -- Only flag when sale_date >= listing_date or listing_date is null
  -- (otherwise the listing is a legitimate re-listing after sale).
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
)
SELECT * FROM dup_props
UNION ALL SELECT * FROM listing_after_sale
UNION ALL SELECT * FROM orphan_listings
UNION ALL SELECT * FROM date_less_leases;

COMMENT ON VIEW public.v_data_quality_issues IS
  'Triage view of data quality patterns that auto-correction triggers
   cannot safely resolve. Each row is one issue; severity gives relative
   magnitude. Government variant — drops dia-specific multi_active_lease
   (gov buildings legitimately have >1 active lease) and uses gov-flavored
   columns (agency, listing_status, superseded_at).';

-- ----------------------------------------------------------------------------
-- (B) v_data_quality_summary
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_data_quality_summary AS
SELECT
  issue_kind,
  count(*)         AS issue_count,
  sum(severity)    AS total_severity,
  max(severity)    AS worst_severity
FROM public.v_data_quality_issues
GROUP BY issue_kind
ORDER BY total_severity DESC;

-- ----------------------------------------------------------------------------
-- (C) Historical listing-close backfill — applies the now-correct
--     pickClosestListing logic to listings that should have been Sold
--     but stayed Active because of the JS bug.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  affected integer;
BEGIN
  WITH ranked_pairs AS (
    SELECT DISTINCT ON (al.listing_id)
      al.listing_id,
      st.sale_date,
      st.sale_id
    FROM public.available_listings al
    JOIN public.sales_transactions st ON st.property_id = al.property_id
    WHERE al.listing_status = 'Active'
      AND al.listing_date IS NOT NULL
      AND st.sale_date    IS NOT NULL
      AND ABS(st.sale_date - al.listing_date) <= 1096   -- ~3 years + leap cushion
    ORDER BY al.listing_id,
      -- Closest absolute distance wins.
      ABS(st.sale_date - al.listing_date) ASC,
      -- Tiebreak: prefer sale on-or-after listing_date (the closing sale),
      -- not a phantom earlier sale that happens to be the same distance.
      CASE WHEN st.sale_date >= al.listing_date THEN 0 ELSE 1 END,
      st.sale_date ASC
  )
  UPDATE public.available_listings al
     SET listing_status  = 'Sold',
         off_market_date = rp.sale_date,
         updated_at      = NOW()
    FROM ranked_pairs rp
   WHERE al.listing_id = rp.listing_id;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE '[gov-listing-close-backfill] closed % listings via 3-year sale_date match', affected;
END;
$$;
