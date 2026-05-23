-- Topic 17 (audit §11.34): operator concentration + sale-leaseback
-- detection + operator-controlled SPE behavioral override.
--
-- §11.33 shipped the operator-affiliate registry. This round wires
-- the three downstream uses the registry enables:
--
--   1. `v_lcc_operator_effective_portfolio` — parent operator plus
--      every affiliate, with a unified property count.
--   2. `v_lcc_listing_event_queue` extended with operator-parent
--      columns + an `is_sale_leaseback` flag so the operator console
--      can see "Fresenius affiliate sold its building" in one row.
--   3. One-shot `behavioral_override='operator'` for affiliates
--      currently classified developer/buyer with small portfolios
--      (<=3 props) — these are operator-controlled SPEs that the
--      v5 BTS algorithm correctly flagged as developer (the
--      affiliate did execute the build-to-suit) but the BD
--      operator's effective outreach is to the parent operator,
--      not the SPE.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. v_lcc_operator_effective_portfolio
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_operator_effective_portfolio
WITH (security_invoker = true) AS
WITH operator_parents AS (
  SELECT DISTINCT parent_entity_id FROM public.lcc_operator_affiliate_patterns
),
distinct_affiliates AS (
  -- DISTINCT because patterns can overlap (e.g., 'davita%' prefix AND
  -- 'davita' contains both match "Davita Healthcare Prtnrs").
  SELECT DISTINCT affiliate_entity_id, parent_entity_id
  FROM public.v_lcc_operator_affiliates
),
membership AS (
  -- The parent itself
  SELECT op.parent_entity_id, op.parent_entity_id AS member_entity_id
  FROM operator_parents op
  UNION
  -- Each affiliate
  SELECT da.parent_entity_id, da.affiliate_entity_id AS member_entity_id
  FROM distinct_affiliates da
),
per_member_stats AS (
  SELECT
    m.parent_entity_id,
    m.member_entity_id,
    (SELECT COUNT(*) FROM public.lcc_entity_portfolio_facts f
     WHERE f.entity_id = m.member_entity_id) AS member_total,
    (SELECT COUNT(*) FROM public.lcc_entity_portfolio_facts f
     WHERE f.entity_id = m.member_entity_id AND f.is_current = true) AS member_current
  FROM membership m
)
SELECT
  parent.id           AS parent_entity_id,
  parent.name         AS parent_name,
  parent.owner_role   AS parent_owner_role,
  parent.domain       AS parent_domain,
  COUNT(DISTINCT pms.member_entity_id)                    AS member_count,
  SUM(pms.member_total)::int                              AS effective_total_property_count,
  SUM(pms.member_current)::int                            AS effective_current_property_count,
  array_agg(DISTINCT en.name ORDER BY en.name)            AS member_names,
  array_agg(DISTINCT pms.member_entity_id ORDER BY pms.member_entity_id) AS member_entity_ids
FROM per_member_stats pms
JOIN public.entities parent ON parent.id = pms.parent_entity_id
JOIN public.entities en     ON en.id = pms.member_entity_id
WHERE parent.merged_into_entity_id IS NULL
GROUP BY parent.id, parent.name, parent.owner_role, parent.domain;

GRANT SELECT ON public.v_lcc_operator_effective_portfolio TO authenticated;

COMMENT ON VIEW public.v_lcc_operator_effective_portfolio IS
  'True operator footprint = parent + all subsidiary-pattern matches '
  'from lcc_operator_affiliate_patterns. Used for concentration risk '
  'and operator-level BD targeting.';

-- ---------------------------------------------------------------------------
-- 2. Extend v_lcc_listing_event_queue with operator-parent columns
--
-- CREATE OR REPLACE VIEW can only ADD columns at the end (Postgres treats
-- mid-list inserts as renames — see §11.30 for the same gotcha).
-- New columns are appended at the end.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_listing_event_queue
WITH (security_invoker = true) AS
SELECT
  e.event_id, e.source_domain, e.source_property_id, e.source_event_id,
  e.event_date, e.sale_price, e.buyer_name, e.seller_name, e.cap_rate,
  e.data_source, e.detected_at, e.processed_at,
  EXTRACT(day FROM now() - e.detected_at)::int AS days_since_detected,
  pa.address    AS property_address,
  pa.city       AS property_city,
  pa.state      AS property_state,
  pa.building_size_sqft,
  pa.year_built,
  pa.latitude, pa.longitude,
  seller.id     AS seller_entity_id,
  seller.name   AS seller_entity_name,
  seller.owner_role AS seller_owner_role,
  buyer.id      AS buyer_entity_id,
  buyer.name    AS buyer_entity_name,
  buyer.owner_role AS buyer_owner_role,
  -- NEW columns appended below
  seller_op.parent_entity_id AS seller_operator_parent_id,
  seller_op.parent_name      AS seller_operator_parent_name,
  buyer_op.parent_entity_id  AS buyer_operator_parent_id,
  buyer_op.parent_name       AS buyer_operator_parent_name,
  -- sale-leaseback signal: seller is an operator (parent or affiliate),
  -- buyer is NOT the same operator parent. Means the operator is
  -- transitioning ownership to a third party while continuing to
  -- operate the facility.
  (
    seller_op.parent_entity_id IS NOT NULL
    AND (buyer_op.parent_entity_id IS NULL
         OR buyer_op.parent_entity_id <> seller_op.parent_entity_id)
  ) AS is_sale_leaseback
FROM public.lcc_listing_events e
LEFT JOIN public.lcc_property_attributes pa
  ON pa.source_domain = e.source_domain AND pa.source_property_id = e.source_property_id
LEFT JOIN LATERAL (
  SELECT en.id, en.name, en.owner_role
  FROM public.lcc_entity_portfolio_facts f
  JOIN public.entities en ON en.id = f.entity_id AND en.merged_into_entity_id IS NULL
  WHERE f.source_domain = e.source_domain
    AND f.source_property_id = e.source_property_id
    AND f.ownership_end_date IS NOT NULL
  ORDER BY f.ownership_end_date DESC LIMIT 1
) seller ON true
LEFT JOIN LATERAL (
  SELECT en.id, en.name, en.owner_role
  FROM public.lcc_entity_portfolio_facts f
  JOIN public.entities en ON en.id = f.entity_id AND en.merged_into_entity_id IS NULL
  WHERE f.source_domain = e.source_domain
    AND f.source_property_id = e.source_property_id
    AND f.is_current = true
  ORDER BY f.ownership_start_date DESC NULLS LAST LIMIT 1
) buyer ON true
-- Seller's operator parent (if seller IS the parent OR an affiliate)
LEFT JOIN LATERAL (
  SELECT DISTINCT ON (1)
    a.parent_entity_id, a.parent_name
  FROM public.v_lcc_operator_affiliates a
  WHERE a.affiliate_entity_id = seller.id
  ORDER BY 1, a.pattern_type   -- pick one deterministically when multiple patterns match
  LIMIT 1
) seller_op_affiliate ON true
LEFT JOIN LATERAL (
  -- If the seller IS itself an operator parent (not via affiliate)
  SELECT seller.id AS parent_entity_id, seller.name AS parent_name
  WHERE seller.id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.lcc_operator_affiliate_patterns p
                WHERE p.parent_entity_id = seller.id)
) seller_op_self ON true
LEFT JOIN LATERAL (
  SELECT
    COALESCE(seller_op_self.parent_entity_id, seller_op_affiliate.parent_entity_id) AS parent_entity_id,
    COALESCE(seller_op_self.parent_name,      seller_op_affiliate.parent_name)      AS parent_name
) seller_op ON true
LEFT JOIN LATERAL (
  SELECT DISTINCT ON (1)
    a.parent_entity_id, a.parent_name
  FROM public.v_lcc_operator_affiliates a
  WHERE a.affiliate_entity_id = buyer.id
  ORDER BY 1, a.pattern_type
  LIMIT 1
) buyer_op_affiliate ON true
LEFT JOIN LATERAL (
  SELECT buyer.id AS parent_entity_id, buyer.name AS parent_name
  WHERE buyer.id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.lcc_operator_affiliate_patterns p
                WHERE p.parent_entity_id = buyer.id)
) buyer_op_self ON true
LEFT JOIN LATERAL (
  SELECT
    COALESCE(buyer_op_self.parent_entity_id, buyer_op_affiliate.parent_entity_id) AS parent_entity_id,
    COALESCE(buyer_op_self.parent_name,      buyer_op_affiliate.parent_name)      AS parent_name
) buyer_op ON true;

GRANT SELECT ON public.v_lcc_listing_event_queue TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. One-shot behavioral_override for operator-controlled SPEs
--
-- An affiliate currently classified as 'developer' or 'buyer' with a small
-- portfolio (<= 3 properties) and matched via a PREFIX or EXACT pattern
-- (not a fuzzy 'contains') is almost certainly an operator-controlled SPE.
-- The v5 BTS algorithm correctly identified the affiliate as the entity
-- that did the build-to-suit; the override expresses that for outreach
-- purposes the operator parent is the real target.
-- ---------------------------------------------------------------------------
WITH spe_candidates AS (
  SELECT DISTINCT ON (a.affiliate_entity_id)
    a.affiliate_entity_id,
    a.affiliate_name,
    a.affiliate_owner_role,
    a.affiliate_portfolio_size,
    a.parent_name,
    a.pattern_type
  FROM public.v_lcc_operator_affiliates a
  JOIN public.entities e ON e.id = a.affiliate_entity_id
  WHERE a.affiliate_owner_role IN ('developer','buyer')
    AND a.affiliate_portfolio_size BETWEEN 1 AND 3
    AND a.pattern_type IN ('prefix','exact')
    AND e.behavioral_override IS NULL
  ORDER BY a.affiliate_entity_id, a.pattern_type
)
UPDATE public.entities en
SET behavioral_override = 'operator',
    behavioral_override_at = now(),
    behavioral_override_reason =
      'Operator-controlled SPE: matched operator-affiliate pattern (' ||
      spe.pattern_type || ' "' ||
      (SELECT pattern_name FROM public.v_lcc_operator_affiliates
       WHERE affiliate_entity_id = en.id LIMIT 1) ||
      '") for parent "' || spe.parent_name || '". Underlying ' ||
      spe.affiliate_owner_role || ' classification preserved in owner_role.',
    updated_at = now()
FROM spe_candidates spe
WHERE en.id = spe.affiliate_entity_id;

COMMIT;
