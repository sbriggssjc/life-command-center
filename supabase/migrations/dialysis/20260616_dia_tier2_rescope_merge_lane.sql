-- ============================================================================
-- TIER 2 (dia) — re-scope the duplicate detector (same-address ≠ duplicate)
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL, ref zqzrriwuavgrquhisnoa)
--
-- Deep-dive audit, Tier 2. GROUNDED LIVE 2026-06-16 — decision (Scott): Tier 2
-- is PURE DETECTOR RE-SCOPING, no auto-merge. The irreversible merge judgment
-- stays with the human on the Consolidate surface. VIEWS only — no data mutated,
-- fully reversible.
--
-- The Decision-Center property-merge lane reads `v_property_merge_lane`
-- (api/admin.js fetchFederatedSource 'property_merge'), which on dia is a thin
-- SELECT over `v_property_merge_candidates`. That candidates view groups purely
-- by normalized real address (it already requires `address ~ '\d'`) with NO
-- operator check → 56 groups, of which (grounded live):
--   * 47 are same address + DIFFERENT operator family → co-located DISTINCT
--        clinics / hospital campuses (e.g. multiple Fresenius+DaVita at one
--        medical-office address). NOT duplicates.
--   * 22 are same operator but DIFFERENT medicare_id → distinct CMS-certified
--        clinics (two units in one building). NOT a single duplicate.
--   *  2 have an unconfirmable (null) operator on a side.
--   *  5 are GENUINE duplicate candidates: same real street address + same
--        operator family + compatible (≤1 distinct) CMS identity, small group.
-- The lane is tightened to exactly that genuine predicate (56 → 5). The dia
-- detector's prior weakness — city-only addresses ("Lehi, UT", "Los Angeles,
-- CA") passing the placeholder filter and false-clustering multiple distinct
-- clinics of the same operator — is closed by the real-street requirement
-- (`address ~ '\d'`, already in the candidates view) + the operator/CMS gate.
--
-- v_property_merge_candidates is LEFT UNCHANGED (it may have other consumers and
-- serves as the "all same-address groups" analytics base). Only the LANE (the
-- operative Decision-Center source) and v_data_quality_issues are re-scoped.
--
-- Idempotent (CREATE OR REPLACE).
-- ============================================================================

-- ── The operative merge lane: reuse the candidates view, filter to GENUINE ──
CREATE OR REPLACE VIEW public.v_property_merge_lane AS
WITH genuine AS (
  -- group identity matches v_property_merge_candidates (dia_normalize_*, digit-required)
  SELECT dia_normalize_state(p.state::text) AS ns,
         dia_normalize_address(p.address)    AS na
  FROM public.properties p
  WHERE p.address IS NOT NULL
    AND p.address ~ '\d'
  GROUP BY 1, 2
  HAVING count(*) > 1
     AND count(*) <= 4                                                                          -- small group only
     AND count(*) FILTER (WHERE coalesce(p.chain_canonical, p.operator, p.tenant) IS NULL) = 0  -- operator known on every row
     AND count(DISTINCT lower(NULLIF(btrim(coalesce(p.chain_canonical, p.operator, p.tenant, '')), '')))
           FILTER (WHERE coalesce(p.chain_canonical, p.operator, p.tenant) IS NOT NULL) <= 1    -- one operator family
     AND count(DISTINCT p.medicare_id) FILTER (WHERE p.medicare_id IS NOT NULL) <= 1            -- compatible CMS identity
)
SELECT
  'duplicate_property_address'::text AS issue_kind,
  c.keep_id::text                    AS record_id,
  c.address                          AS detail_1,
  c.state::text                      AS detail_2,
  c.tenant                           AS detail_3,
  c.dupe_count::integer              AS severity,
  ('Genuine duplicate candidate: ' || c.dupe_count || ' properties at the same street address, same '
   || 'operator, compatible CMS identity. Keep ' || c.keep_id || ', drop '
   || array_to_string(COALESCE(c.drop_ids::bigint[], ARRAY[]::bigint[]), ', ')
   || '. Human confirms the surviving record on the Consolidate surface.')::text AS suggested_action
FROM public.v_property_merge_candidates c
JOIN genuine g
  ON g.ns::text = c.state::text                         -- c.state is already dia_normalize_state(...) in candidates
 AND g.na       = dia_normalize_address(c.address);

COMMENT ON VIEW public.v_property_merge_lane IS
  'TIER 2 (dia): GENUINE property-merge candidates only — same real street address '
  '+ same operator family + ≤1 distinct medicare_id + group ≤4. Co-located distinct '
  'clinics (different operator) and distinct CMS units (different medicare_id) are '
  'EXCLUDED and relabeled in v_data_quality_issues. Drives the Decision-Center '
  'property_merge lane (human merge on Consolidate; no auto-merge). '
  'v_property_merge_candidates (the all-same-address base) is unchanged.';

-- ── The analytics detector: genuine + relabel the co-located ───────────────
-- Reproduces the live (TIER 1) view body and changes ONLY the duplicate family:
-- dup_props is tightened to the genuine predicate and gains two informational
-- co-located kinds. Every other branch (missing_address / multi_active_lease /
-- listing_after_sale / orphan_listing / lease_no_dates /
-- listing_active_no_verification_due / sales_price_xref_conflict) is preserved.
CREATE OR REPLACE VIEW public.v_data_quality_issues AS
WITH addr_groups AS (
  -- group identity matches v_property_merge_candidates / v_property_merge_lane
  -- (dia_normalize_address strips punctuation, e.g. "1001 W. Arbrook" == "1001 W Arbrook").
  SELECT
    dia_normalize_state(state::text)                                                       AS ns,
    dia_normalize_address(address)                                                         AS na,
    count(*)                                                                               AS n,
    count(*) FILTER (WHERE coalesce(chain_canonical, operator, tenant) IS NULL)            AS null_oper,
    count(DISTINCT lower(NULLIF(btrim(coalesce(chain_canonical, operator, tenant, '')), '')))
      FILTER (WHERE coalesce(chain_canonical, operator, tenant) IS NOT NULL)               AS distinct_oper,
    count(DISTINCT medicare_id) FILTER (WHERE medicare_id IS NOT NULL)                      AS distinct_mid,
    array_agg(property_id ORDER BY property_id)                                            AS property_ids
  FROM properties
  WHERE address IS NOT NULL
    AND NOT public.lcc_addr_is_placeholder(address)
    AND address ~ '\d'                          -- real street address (reject city-only keys, e.g. "Los Angeles, CA")
  GROUP BY 1, 2
  HAVING count(*) > 1
),
dup_props AS (
  -- GENUINE duplicates: same real street address + same operator + compatible CMS identity, small group.
  SELECT
    'duplicate_property'::text         AS issue_kind,
    p.property_id::text                AS record_id,
    p.address                          AS detail_1,
    p.state                            AS detail_2,
    p.tenant                           AS detail_3,
    g.n::int                           AS severity,
    'Genuine duplicate candidate: ' || g.n || ' properties at the same street address, same operator, '
      || 'compatible CMS identity. Merge candidate (human Consolidate). ids: '
      || array_to_string(g.property_ids[1:5], ', ')
      || CASE WHEN g.n > 5 THEN '…' ELSE '' END AS suggested_action
  FROM properties p
  JOIN addr_groups g ON p.property_id = ANY(g.property_ids)   -- exact group members; no fan-out / norm mismatch
  WHERE g.distinct_oper <= 1 AND g.null_oper = 0 AND g.distinct_mid <= 1 AND g.n <= 4
),
colocated_distinct_operator AS (
  -- Same address, DIFFERENT operator family → co-located distinct clinics / campus. NOT a duplicate.
  SELECT
    'colocated_distinct_operator'::text AS issue_kind,
    p.property_id::text                 AS record_id,
    p.address                           AS detail_1,
    p.state                             AS detail_2,
    p.tenant                            AS detail_3,
    1::int                              AS severity,
    'Same address shared by ' || g.distinct_oper || ' distinct operators (co-located clinics / medical '
      || 'campus). NOT a duplicate — do not merge.' AS suggested_action
  FROM properties p
  JOIN addr_groups g ON p.property_id = ANY(g.property_ids)   -- exact group members; no fan-out / norm mismatch
  WHERE g.distinct_oper > 1
),
colocated_distinct_clinic AS (
  -- Same operator + same address but DIFFERENT medicare_id → distinct CMS units. Review, not auto-merge.
  SELECT
    'colocated_distinct_clinic'::text   AS issue_kind,
    p.property_id::text                 AS record_id,
    p.address                           AS detail_1,
    p.state                             AS detail_2,
    p.tenant                            AS detail_3,
    1::int                              AS severity,
    'Same operator + address but ' || g.distinct_mid || ' distinct medicare_ids → distinct CMS-certified '
      || 'units in one building. Review before merging (likely NOT a single duplicate).' AS suggested_action
  FROM properties p
  JOIN addr_groups g ON p.property_id = ANY(g.property_ids)   -- exact group members; no fan-out / norm mismatch
  WHERE g.distinct_oper <= 1 AND g.distinct_mid > 1
),
missing_address AS (
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
UNION ALL SELECT * FROM colocated_distinct_operator
UNION ALL SELECT * FROM colocated_distinct_clinic
UNION ALL SELECT * FROM missing_address
UNION ALL SELECT * FROM multi_lease
UNION ALL SELECT * FROM listing_after_sale
UNION ALL SELECT * FROM orphan_listings
UNION ALL SELECT * FROM date_less_leases
UNION ALL SELECT * FROM listing_no_verif_due
UNION ALL SELECT * FROM sales_price_xref;

COMMENT ON VIEW public.v_data_quality_issues IS
  'Per-row data-quality issues (dia, analytics). TIER 2 re-scope: duplicate_property is '
  'the GENUINE merge set only (same real street address + same operator + ≤1 medicare_id); '
  'colocated_distinct_operator + colocated_distinct_clinic are co-located distinct '
  'properties (NOT merges); missing_address + the other branches unchanged. All '
  'observation-only.';
