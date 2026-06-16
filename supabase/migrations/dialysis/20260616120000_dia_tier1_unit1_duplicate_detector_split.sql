-- ============================================================================
-- TIER 1 · Unit 1 — split the duplicate-address detector (dialysis)
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL, ref zqzrriwuavgrquhisnoa)
--
-- The single `duplicate_property_address` lane conflated two different problems
-- (deep-dive audit Finding B):
--   (b1) placeholder/missing-address false positives — properties whose address
--        is a literal placeholder ("Dialysis Unit", "TBD") in different cities,
--        which are NOT duplicates, just rows that need a real address. They were
--        generating false "N properties share an address" clusters.
--   (b3) genuine duplicates — properties sharing a REAL full address.
--
-- This migration splits the one noisy detector into two precise lanes and
-- EXCLUDES placeholder addresses from the duplicate-grouping key so they stop
-- generating false clusters:
--   * `duplicate_property` — genuine duplicates (real, non-placeholder address).
--                            The clean input to the Tier-2 gated auto-merge.
--   * `missing_address`    — placeholder/empty-address properties that were
--                            mis-clustering. NOT a merge — an address-backfill /
--                            geocode task (Tier 4). Re-classification only here.
--
-- Measured live 2026-06-16: 42 dup rows → 26 duplicate_property + 16
-- missing_address (placeholder strings: "dialysis unit", "tbd"). 73 total
-- placeholder dia properties exist; only the 16 that currently mis-cluster are
-- re-classified here (the broader address backfill is Tier 4 — see guardrails).
--
-- Idempotent (CREATE OR REPLACE). Reproduces the live view body verbatim and
-- changes ONLY the dup_props CTE + adds the missing_address CTE; every other
-- branch (multi_active_lease / listing_after_sale / orphan_listing /
-- lease_no_dates / listing_active_no_verification_due / sales_price_xref_conflict)
-- is preserved unchanged. Same 7-column contract.
-- ============================================================================

-- Shared placeholder-address predicate (one definition, used by the detector
-- split). A normalized address is a placeholder when it is empty/too-short or a
-- known stand-in token. Anchored so a legitimate address containing one of these
-- words is never caught (only a bare/leading token matches).
CREATE OR REPLACE FUNCTION public.lcc_addr_is_placeholder(p_addr text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT
    p_addr IS NULL
    OR length(trim(regexp_replace(p_addr, '\s+', ' ', 'g'))) < 5
    OR lower(trim(regexp_replace(p_addr, '\s+', ' ', 'g'))) = ANY (ARRAY[
         'dialysis unit','suite','unit','n/a','tbd','unknown','none','na','-','.',
         'tba','various','address','no address','tbd address'
       ])
    OR lower(trim(regexp_replace(p_addr, '\s+', ' ', 'g'))) ~ '^(dialysis unit|suite|ste|unit)( |$)'
$$;

COMMENT ON FUNCTION public.lcc_addr_is_placeholder(text) IS
  'TIER 1 Unit 1: true when an address column is a placeholder/empty stand-in '
  '("Dialysis Unit", "TBD", "N/A", <5 chars). Used to keep placeholder rows out '
  'of the duplicate-property detector and route them to the missing_address lane.';

CREATE OR REPLACE VIEW public.v_data_quality_issues AS
WITH dup_props AS (
  -- (b3) GENUINE duplicates: same normalized REAL address+state, ≥2 property_ids.
  -- Placeholder addresses are excluded from the grouping key so they can never
  -- form a false cluster here.
  SELECT
    'duplicate_property'::text         AS issue_kind,
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
      AND NOT public.lcc_addr_is_placeholder(address)
    GROUP BY 1, 2
    HAVING count(*) > 1
  ) g ON g.state::text = p.state::text
     AND g.norm_addr = lower(trim(regexp_replace(p.address, '\s+', ' ', 'g')))
),
missing_address AS (
  -- (b1) Placeholder/missing-address rows that were mis-clustering in the merge
  -- lane. NOT a merge — an address-backfill task. One row per property.
  SELECT
    'missing_address'::text            AS issue_kind,
    p.property_id::text                AS record_id,
    p.address                          AS detail_1,
    p.state                            AS detail_2,
    p.tenant                           AS detail_3,
    g.dupe_count::int                  AS severity,
    'Placeholder/missing address ("' || COALESCE(p.address, '<null>') || '") shared by '
      || g.dupe_count || ' properties — NOT a duplicate. Backfill the real street '
      || 'address (geocode / CMS / county). ids: ' || array_to_string(g.property_ids[1:5], ', ')
      || CASE WHEN g.dupe_count > 5 THEN '…' ELSE '' END AS suggested_action
  FROM properties p
  JOIN (
    SELECT
      state,
      lower(trim(regexp_replace(address, '\s+', ' ', 'g'))) AS norm_addr,
      count(*) AS dupe_count,
      array_agg(property_id ORDER BY property_id) AS property_ids
    FROM properties
    WHERE address IS NOT NULL
      AND public.lcc_addr_is_placeholder(address)
    GROUP BY 1, 2
    HAVING count(*) > 1
  ) g ON g.state::text = p.state::text
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
),
sales_price_xref AS (
  SELECT
    'sales_price_xref_conflict'::text AS issue_kind,
    st.sale_id::text                  AS record_id,
    st.property_id::text              AS detail_1,
    st.sold_price::text               AS detail_2,
    oh.sold_price::text               AS detail_3,
    1::int                            AS severity,
    'sales_transactions.sold_price ($' || to_char(st.sold_price, 'FM999,999,999') ||
      ') disagrees >5% with ownership_history.sold_price ($' || to_char(oh.sold_price, 'FM999,999,999') ||
      ') for sale_id ' || st.sale_id || '. Reconcile the authoritative close price.' AS suggested_action
  FROM sales_transactions st
  JOIN ownership_history oh ON oh.sale_id = st.sale_id
  WHERE st.sold_price IS NOT NULL AND oh.sold_price IS NOT NULL
    AND st.sold_price > 0 AND oh.sold_price > 0
    AND abs(st.sold_price - oh.sold_price) / st.sold_price > 0.05
)
SELECT * FROM dup_props
UNION ALL SELECT * FROM missing_address
UNION ALL SELECT * FROM multi_lease
UNION ALL SELECT * FROM listing_after_sale
UNION ALL SELECT * FROM orphan_listings
UNION ALL SELECT * FROM date_less_leases
UNION ALL SELECT * FROM listing_no_verif_due
UNION ALL SELECT * FROM sales_price_xref;
