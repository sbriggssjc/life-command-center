-- ============================================================================
-- TIER 1 · Unit 1 — split the duplicate-address detector (government)
--
-- Target: government Supabase (GOV_SUPABASE_URL, ref scknotsqkcheojiaewwh)
--
-- Mirrors the dia split (see the dia migration in this round). Splits the one
-- `duplicate_property_address` lane into:
--   * `duplicate_property` — genuine duplicates (real, non-placeholder address;
--                            active only — the Tier-0 archived exclusion is
--                            preserved). The clean input to Tier-2 auto-merge.
--   * `missing_address`    — placeholder/empty-address rows that were
--                            mis-clustering (address-backfill task, not a merge).
--
-- Measured live 2026-06-16: the active dup lane is 230 (post Tier-0). 0 of those
-- are placeholders, so `duplicate_property` = 230 and `missing_address` = 0 today
-- — the placeholder exclusion + missing_address branch are defensive (they catch
-- a future placeholder cluster before it pollutes the merge lane).
--
-- Idempotent (CREATE OR REPLACE). Reproduces the LIVE gov view body verbatim
-- (incl. the Tier-0 `status <> 'archived'` guard and every other branch:
-- unmatched_orphan_listing / lease_no_dates / expired_lease_not_superseded /
-- listing_after_sale / pending_update_orphan) and changes ONLY dup_props +
-- adds missing_address. Same 7-column contract.
-- ============================================================================

-- Shared placeholder-address predicate (identical definition to the dia DB).
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
  '("TBD", "N/A", <5 chars). Keeps placeholder rows out of the duplicate-property '
  'detector and routes them to the missing_address lane.';

CREATE OR REPLACE VIEW public.v_data_quality_issues AS
WITH dup_props AS (
  -- GENUINE duplicates: same normalized REAL address+state, ≥2 ACTIVE property_ids.
  -- Tier-0 archived exclusion preserved; placeholder addresses excluded from the
  -- grouping key so they can never form a false cluster.
  SELECT
    'duplicate_property'::text         AS issue_kind,
    p.property_id::text                AS record_id,
    p.address                          AS detail_1,
    p.state                            AS detail_2,
    p.agency                           AS detail_3,
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
      AND COALESCE(status, 'active') <> 'archived'
      AND NOT public.lcc_addr_is_placeholder(address)
    GROUP BY 1, 2
    HAVING count(*) > 1
  ) g ON g.state = p.state
     AND g.norm_addr = lower(trim(regexp_replace(p.address, '\s+', ' ', 'g')))
  WHERE COALESCE(p.status, 'active') <> 'archived'
),
missing_address AS (
  -- Placeholder/missing-address active rows that were mis-clustering. NOT a merge.
  SELECT
    'missing_address'::text            AS issue_kind,
    p.property_id::text                AS record_id,
    p.address                          AS detail_1,
    p.state                            AS detail_2,
    p.agency                           AS detail_3,
    g.dupe_count::int                  AS severity,
    'Placeholder/missing address ("' || COALESCE(p.address, '<null>') || '") shared by '
      || g.dupe_count || ' properties — NOT a duplicate. Backfill the real street '
      || 'address (geocode / county). ids: ' || array_to_string(g.property_ids[1:5], ', ')
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
      AND COALESCE(status, 'active') <> 'archived'
      AND public.lcc_addr_is_placeholder(address)
    GROUP BY 1, 2
    HAVING count(*) > 1
  ) g ON g.state = p.state
     AND g.norm_addr = lower(trim(regexp_replace(p.address, '\s+', ' ', 'g')))
  WHERE COALESCE(p.status, 'active') <> 'archived'
),
unmatched_orphan_listings AS (
  SELECT
    'unmatched_orphan_listing'::text AS issue_kind,
    al.listing_id::text              AS record_id,
    al.address                       AS detail_1,
    al.city                          AS detail_2,
    al.state                         AS detail_3,
    1                                AS severity,
    'Listing captured with no property match. Source: ' || COALESCE(al.listing_source, 'unknown')
      || '. Likely needs manual address verification or property creation.' AS suggested_action
  FROM available_listings al
  WHERE al.listing_status = 'orphan'
),
leases_no_dates AS (
  SELECT
    'lease_no_dates'::text AS issue_kind,
    l.lease_id::text       AS record_id,
    l.property_id::text    AS detail_1,
    l.tenant_agency        AS detail_2,
    NULL::text             AS detail_3,
    1                      AS severity,
    'Active gov lease has neither commencement_date nor expiration_date. Likely a placeholder from CSV import.' AS suggested_action
  FROM leases l
  WHERE l.superseded_at IS NULL
    AND l.commencement_date IS NULL
    AND l.expiration_date IS NULL
),
expired_unresolved AS (
  SELECT
    'expired_lease_not_superseded'::text AS issue_kind,
    l.lease_id::text                     AS record_id,
    l.property_id::text                  AS detail_1,
    l.tenant_agency                      AS detail_2,
    l.expiration_date::text              AS detail_3,
    CASE
      WHEN l.expiration_date < (CURRENT_DATE - '5 years'::interval) THEN 5
      WHEN l.expiration_date < (CURRENT_DATE - '2 years'::interval) THEN 3
      ELSE 1
    END                                  AS severity,
    'Lease expired ' || ((CURRENT_DATE - l.expiration_date)::text) || ' days ago and was never superseded.' AS suggested_action
  FROM leases l
  WHERE l.superseded_at IS NULL
    AND l.expiration_date IS NOT NULL
    AND l.expiration_date < (CURRENT_DATE - '90 days'::interval)
),
listing_after_sale AS (
  SELECT
    'listing_after_sale'::text AS issue_kind,
    al.listing_id::text        AS record_id,
    COALESCE(al.listing_status, '') AS detail_1,
    st.sale_date::text         AS detail_2,
    COALESCE(al.listing_date::text, '<null>') AS detail_3,
    1                          AS severity,
    'Listing is still active but a sale was recorded on ' || st.sale_date::text || '. close_listing_on_sale missed it.' AS suggested_action
  FROM available_listings al
  JOIN sales_transactions st ON st.property_id = al.property_id
  WHERE (COALESCE(al.listing_status, '') <> ALL (ARRAY['Sold','sold','Off Market','Withdrawn','orphan']))
    AND st.sale_date IS NOT NULL
    AND (al.listing_date IS NULL OR al.listing_date <= st.sale_date)
),
pending_orphans AS (
  SELECT
    'pending_update_orphan'::text AS issue_kind,
    pu.id::text                   AS record_id,
    pu.property_id::text          AS detail_1,
    pu.field_name                 AS detail_2,
    pu.status                     AS detail_3,
    1                             AS severity,
    'pending_updates row references property_id ' || pu.property_id || ' which no longer exists in properties.' AS suggested_action
  FROM pending_updates pu
  WHERE pu.property_id IS NOT NULL
    AND (pu.status <> ALL (ARRAY['expired','rejected','auto_resolved','applied']))
    AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.property_id = pu.property_id)
)
SELECT * FROM dup_props
UNION ALL SELECT * FROM missing_address
UNION ALL SELECT * FROM unmatched_orphan_listings
UNION ALL SELECT * FROM leases_no_dates
UNION ALL SELECT * FROM expired_unresolved
UNION ALL SELECT * FROM listing_after_sale
UNION ALL SELECT * FROM pending_orphans;

-- ----------------------------------------------------------------------------
-- Merge-candidate lane: keep placeholder groups out of the property_merge lane
-- so the Tier-2 auto-merge never sees a placeholder cluster. Reproduces the live
-- v_property_merge_lane body (active + non-distinct-lease guard) and adds the
-- placeholder exclusion + renames the cosmetic issue_kind literal to match the
-- detector. No count change today (0 placeholder groups in the gov active set).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_property_merge_lane AS
WITH grp AS (
  SELECT
    p.state,
    lower(trim(regexp_replace(p.address, '\s+', ' ', 'g'))) AS norm_addr,
    count(*) AS n,
    count(DISTINCT p.lease_number) AS distinct_leases,
    count(*) FILTER (WHERE p.lease_number IS NOT NULL) AS with_lease,
    min(p.property_id) AS rep_property_id,
    (array_agg(p.property_id ORDER BY p.property_id))[1:5] AS property_ids,
    min(p.address) AS address,
    min(p.agency)  AS agency
  FROM properties p
  WHERE p.address IS NOT NULL
    AND COALESCE(p.status, 'active') <> 'archived'
    AND NOT public.lcc_addr_is_placeholder(p.address)
  GROUP BY p.state, lower(trim(regexp_replace(p.address, '\s+', ' ', 'g')))
  HAVING count(*) > 1
)
SELECT
  'duplicate_property'::text AS issue_kind,
  rep_property_id::text      AS record_id,
  address                    AS detail_1,
  state                      AS detail_2,
  agency                     AS detail_3,
  n::int                     AS severity,
  'Address group of ' || n || ' active properties (' || distinct_leases
    || ' distinct lease numbers). Representative property ' || rep_property_id
    || '; first ids: ' || array_to_string(property_ids, ', ') AS suggested_action
FROM grp
WHERE NOT (distinct_leases = n AND with_lease = n);
