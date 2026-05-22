-- ============================================================================
-- 20260522140400_dia_apply_owner_role_classification_v5.sql
-- DEVELOPER_BD_AUDIT_v3 — Phase A Topic 1 / final apply
--
-- Creates v_dia_owner_role_classification — the authoritative classification
-- view encoding the v5 fact-based algorithm — and applies its results to
-- true_owners.owner_role + supporting columns.
--
-- The view recomputes on every read, so re-running this apply (or a
-- scheduled cron) will pick up new ingest data and reclassify entities.
--
-- ALGORITHM (per DEVELOPER_BD_AUDIT_v3 §2 + WS3 corrections):
--
--   PRIORITY (operator > user_owner > developer > buyer > unknown):
--
--   1. operator        — is_operator_not_owner = TRUE (manually curated)
--
--   2. user_owner      — Entity appears as seller in a sale-leaseback event:
--                         a. Sale exists with sale_date X
--                         b. Lease commences within ±30 days of X
--                         c. No prior lease at the property
--                         d. SELLER's true_owner has is_operator_not_owner=TRUE
--                            (the operator is selling out)
--
--   3. developer       — One of:
--                         RULE A (strict BTS): owner held property continuously
--                          from ≥90 days BEFORE first long-term lease through
--                          its commencement; lease started near year_built or
--                          year_renovated; ownership row is sale-supported
--                          (sale_id IS NOT NULL).
--                         RULE B (seller-exit BTS): entity is the seller in a
--                          sales_transactions_seller_exit OH row where the
--                          exit happened within ±2 years of year_built/
--                          year_renovated and a long-term lease commenced
--                          near construction/renovation.
--                         PROMOTION RULE: dev_props ≥ 2 OR dev_share ≥ 30%
--                          (entity-level priority preserves the developer
--                          tag even with mixed buyer signals).
--
--   4. buyer           — Entity's first sale-supported start_date is AFTER
--                         earliest lease commencement by >90 days, AND no new
--                         long-term lease commenced during their tenure.
--
--   5. unknown         — No signal-pattern match.
--
-- Excluded by data integrity:
--   - Owners whose start_date equals or precedes lease_start by <90 days
--     (the "took title at delivery" pattern that historically mis-classified
--     buyers like Carrollwood, Butler Trust as developers)
--   - Owners whose start_date is not sale-supported (no sale_id)
-- ============================================================================

-- --- Helper view: properties + first long-term lease + construction/renovation anchor
CREATE OR REPLACE VIEW public.v_dia_property_signals AS
WITH ltl AS (
  SELECT property_id, lease_start, lease_expiration,
         (lease_expiration - lease_start) / 365.25 AS term_years
  FROM public.leases
  WHERE lease_start IS NOT NULL
    AND lease_expiration IS NOT NULL
    AND (lease_expiration - lease_start) / 365.25 >= 9.0
),
first_ltl AS (
  SELECT DISTINCT ON (property_id)
    property_id, lease_start, lease_expiration, term_years
  FROM ltl
  ORDER BY property_id, lease_start
),
earliest_lease AS (
  SELECT property_id, MIN(lease_start) AS earliest_lease_start
  FROM public.leases
  WHERE lease_start IS NOT NULL
  GROUP BY property_id
)
SELECT
  p.property_id,
  p.year_built,
  p.year_renovated,
  f.lease_start                AS first_long_term_lease_start,
  f.lease_expiration           AS first_long_term_lease_end,
  f.term_years                 AS first_long_term_lease_term_years,
  el.earliest_lease_start,
  -- Anchor flag: first LT lease commenced near year_built (±6mo to +24mo)
  (f.lease_start IS NOT NULL
   AND p.year_built IS NOT NULL
   AND f.lease_start BETWEEN make_date(p.year_built, 1, 1) - INTERVAL '6 months'
                          AND make_date(p.year_built + 2, 12, 31)
  ) AS lease_anchored_to_year_built,
  -- Or to year_renovated (±6mo to +24mo)
  (f.lease_start IS NOT NULL
   AND p.year_renovated IS NOT NULL
   AND f.lease_start BETWEEN make_date(p.year_renovated, 1, 1) - INTERVAL '6 months'
                          AND make_date(p.year_renovated + 2, 12, 31)
  ) AS lease_anchored_to_year_renovated
FROM public.properties p
LEFT JOIN first_ltl f      ON f.property_id  = p.property_id
LEFT JOIN earliest_lease el ON el.property_id = p.property_id;

COMMENT ON VIEW public.v_dia_property_signals IS
  'DEVELOPER_BD_AUDIT_v3 helper. Per-property signal anchor: year_built, '
  'year_renovated, earliest long-term lease commencement, and whether that '
  'lease is anchored to construction or renovation. Drives the developer '
  'detection rules in v_dia_owner_role_classification.';

-- --- Helper view: sale-leaseback events where seller IS an operator
CREATE OR REPLACE VIEW public.v_dia_sale_leaseback_events AS
SELECT DISTINCT
  s.property_id, s.sale_id, s.sale_date,
  s.seller_id   AS seller_recorded_owner_id,
  ro.true_owner_id AS seller_true_owner_id
FROM public.sales_transactions s
JOIN public.recorded_owners ro ON ro.recorded_owner_id = s.seller_id
JOIN public.true_owners t      ON t.true_owner_id = ro.true_owner_id
WHERE s.sale_date IS NOT NULL
  AND s.seller_id IS NOT NULL
  -- Seller must be flagged as an operator (sale-leaseback = operator selling out)
  AND COALESCE(t.is_operator_not_owner, FALSE) = TRUE
  -- New lease commences within ±30 days of sale
  AND EXISTS (
    SELECT 1 FROM public.leases l
    WHERE l.property_id = s.property_id
      AND l.lease_start IS NOT NULL
      AND ABS(l.lease_start - s.sale_date) <= 30
  )
  -- No prior lease at the property
  AND NOT EXISTS (
    SELECT 1 FROM public.leases l2
    WHERE l2.property_id = s.property_id
      AND l2.lease_start IS NOT NULL
      AND l2.lease_start < s.sale_date - INTERVAL '30 days'
  );

COMMENT ON VIEW public.v_dia_sale_leaseback_events IS
  'DEVELOPER_BD_AUDIT_v3 §3.4. Sale-leaseback transactions where the SELLER '
  'is flagged as an operator. Identifies user_owner classification candidates '
  '(operator selling out their owned RE while continuing as tenant).';

-- --- Helper view: developer candidates per (true_owner, property)
CREATE OR REPLACE VIEW public.v_dia_developer_candidates AS
WITH ps AS (SELECT * FROM public.v_dia_property_signals WHERE year_built IS NOT NULL),
rule_a_strict_bts AS (
  -- Owner held property ≥90 days before first long-term lease commenced
  SELECT DISTINCT
    oh.true_owner_id,
    ps.property_id,
    'strict_bts_with_90d_gap'::text AS rule_source,
    0.85::numeric AS confidence
  FROM ps
  JOIN public.ownership_history oh ON oh.property_id = ps.property_id
  JOIN public.true_owners t        ON t.true_owner_id = oh.true_owner_id
  WHERE oh.true_owner_id IS NOT NULL
    AND COALESCE(t.is_operator_not_owner, FALSE) = FALSE
    AND oh.start_date IS NOT NULL
    AND oh.start_date <= ps.first_long_term_lease_start - INTERVAL '90 days'
    AND (oh.end_date IS NULL OR oh.end_date > ps.first_long_term_lease_start)
    AND oh.sale_id IS NOT NULL
    AND (ps.lease_anchored_to_year_built OR ps.lease_anchored_to_year_renovated)
),
rule_b_seller_exit AS (
  -- Entity sold property near construction/renovation; lease anchored
  SELECT DISTINCT
    oh.true_owner_id,
    ps.property_id,
    'seller_exit_near_construction'::text AS rule_source,
    0.80::numeric AS confidence
  FROM ps
  JOIN public.ownership_history oh ON oh.property_id = ps.property_id
  JOIN public.true_owners t        ON t.true_owner_id = oh.true_owner_id
  WHERE oh.true_owner_id IS NOT NULL
    AND COALESCE(t.is_operator_not_owner, FALSE) = FALSE
    AND oh.ownership_source = 'sales_transactions_seller_exit'
    AND oh.end_date IS NOT NULL
    AND (
      ABS(EXTRACT(YEAR FROM oh.end_date) - ps.year_built) <= 2
      OR (ps.year_renovated IS NOT NULL
          AND ABS(EXTRACT(YEAR FROM oh.end_date) - ps.year_renovated) <= 2)
      OR ABS(oh.end_date - ps.first_long_term_lease_start) <= 365
    )
    AND (ps.lease_anchored_to_year_built OR ps.lease_anchored_to_year_renovated)
)
-- Exclude entities classified as sale-leaseback sellers (user_owner) for that property
SELECT q.*
FROM (
  SELECT * FROM rule_a_strict_bts
  UNION ALL
  SELECT * FROM rule_b_seller_exit
) q
WHERE NOT EXISTS (
  SELECT 1 FROM public.v_dia_sale_leaseback_events sl
  WHERE sl.property_id = q.property_id
    AND sl.seller_true_owner_id = q.true_owner_id
);

COMMENT ON VIEW public.v_dia_developer_candidates IS
  'DEVELOPER_BD_AUDIT_v3 §2.2 developer pattern detection. Two rules: '
  '(A) strict BTS — owner held ≥90 days before first long-term lease, '
  'lease anchored to construction/renovation, sale-supported. '
  '(B) seller-exit BTS — sales_transactions_seller_exit OH row near '
  'year_built/year_renovated. Excludes sale-leaseback sellers (those are '
  'user_owner, not developer).';

-- --- Helper view: buyer candidates per (true_owner, property)
CREATE OR REPLACE VIEW public.v_dia_buyer_candidates AS
WITH ltl AS (
  SELECT property_id, lease_start, lease_expiration FROM public.leases
  WHERE lease_start IS NOT NULL AND lease_expiration IS NOT NULL
    AND (lease_expiration - lease_start) / 365.25 >= 9.0
),
earliest_lease AS (
  SELECT property_id, MIN(lease_start) AS earliest_lease_start
  FROM public.leases WHERE lease_start IS NOT NULL GROUP BY property_id
),
entity_first_acq AS (
  SELECT DISTINCT ON (true_owner_id, property_id)
    true_owner_id, property_id, start_date, end_date
  FROM public.ownership_history
  WHERE true_owner_id IS NOT NULL AND start_date IS NOT NULL AND sale_id IS NOT NULL
  ORDER BY true_owner_id, property_id, start_date
)
SELECT DISTINCT
  efa.true_owner_id, efa.property_id,
  'acquired_post_lease'::text AS rule_source,
  0.75::numeric AS confidence
FROM entity_first_acq efa
JOIN earliest_lease el ON el.property_id = efa.property_id
JOIN public.true_owners t ON t.true_owner_id = efa.true_owner_id
WHERE efa.start_date > el.earliest_lease_start + INTERVAL '90 days'
  AND COALESCE(t.is_operator_not_owner, FALSE) = FALSE
  AND NOT EXISTS (
    SELECT 1 FROM ltl
    WHERE ltl.property_id = efa.property_id
      AND ltl.lease_start > efa.start_date
      AND ltl.lease_start <= COALESCE(efa.end_date, CURRENT_DATE)
  );

COMMENT ON VIEW public.v_dia_buyer_candidates IS
  'DEVELOPER_BD_AUDIT_v3 §2.2 buyer pattern detection. Entity acquired '
  'AFTER earliest lease commenced by >90 days, AND no new long-term lease '
  'commenced during their tenure (passive cash-flow acquisition).';

-- --- Helper view: user_owner candidates from sale-leaseback events
CREATE OR REPLACE VIEW public.v_dia_user_owner_candidates AS
SELECT DISTINCT
  sl.seller_true_owner_id AS true_owner_id,
  sl.property_id,
  'sale_leaseback_seller'::text AS rule_source,
  0.85::numeric AS confidence
FROM public.v_dia_sale_leaseback_events sl
WHERE sl.seller_true_owner_id IS NOT NULL;

COMMENT ON VIEW public.v_dia_user_owner_candidates IS
  'DEVELOPER_BD_AUDIT_v3 §3.4 user_owner detection. Sellers in sale-leaseback '
  'events (where the seller IS an operator).';

-- --- Main classification view: applies priority rule across all candidates
CREATE OR REPLACE VIEW public.v_dia_owner_role_classification AS
WITH per_entity AS (
  SELECT
    t.true_owner_id,
    t.name,
    COALESCE(t.is_operator_not_owner, FALSE) AS is_operator,
    COUNT(DISTINCT d.property_id) AS dev_props,
    COUNT(DISTINCT b.property_id) AS buy_props,
    COUNT(DISTINCT u.property_id) AS uo_props,
    -- Capture evidence for developer_flag_sources JSONB
    jsonb_agg(DISTINCT jsonb_build_object(
      'source', 'developer_pattern',
      'property_id', d.property_id,
      'rule', d.rule_source,
      'confidence', d.confidence
    )) FILTER (WHERE d.property_id IS NOT NULL) AS dev_evidence,
    jsonb_agg(DISTINCT jsonb_build_object(
      'source', 'user_owner_pattern',
      'property_id', u.property_id,
      'rule', u.rule_source,
      'confidence', u.confidence
    )) FILTER (WHERE u.property_id IS NOT NULL) AS uo_evidence
  FROM public.true_owners t
  LEFT JOIN public.v_dia_developer_candidates d  ON d.true_owner_id = t.true_owner_id
  LEFT JOIN public.v_dia_buyer_candidates     b  ON b.true_owner_id = t.true_owner_id
  LEFT JOIN public.v_dia_user_owner_candidates u ON u.true_owner_id = t.true_owner_id
  GROUP BY t.true_owner_id, t.name, t.is_operator_not_owner
)
SELECT
  true_owner_id,
  name,
  is_operator,
  dev_props, buy_props, uo_props,
  CASE
    -- Priority 1: operator (manually curated)
    WHEN is_operator THEN 'operator'
    -- Priority 2: user_owner if any sale-leaseback evidence
    WHEN uo_props >= 1 THEN 'user_owner'
    -- Priority 3: developer if (≥2 dev props) OR (dev_share ≥ 30%)
    WHEN dev_props >= 2
      OR (dev_props >= 1 AND dev_props * 10 >= (dev_props + buy_props) * 3)
      THEN 'developer'
    -- Priority 4: buyer if any acquisition-post-lease evidence
    WHEN buy_props >= 1 THEN 'buyer'
    -- Priority 5: developer-by-single-signal (no buyer signal to outweigh)
    WHEN dev_props >= 1 THEN 'developer'
    ELSE 'unknown'
  END AS owner_role,
  CASE
    WHEN is_operator THEN 'manual_operator_flag'
    WHEN uo_props >= 1 THEN 'sale_leaseback_seller'
    WHEN dev_props >= 1 THEN 'tenant_relationship_value_creation'
    WHEN buy_props >= 1 THEN 'acquired_after_lease'
    ELSE NULL
  END AS owner_role_source,
  CASE
    WHEN is_operator THEN 0.80
    WHEN uo_props >= 1 THEN 0.85
    WHEN dev_props >= 2 THEN 0.85
    WHEN dev_props >= 1 THEN 0.75
    WHEN buy_props >= 1 THEN 0.75
    ELSE NULL
  END AS owner_role_confidence,
  -- Combine dev + uo evidence into the sources JSONB array
  COALESCE(dev_evidence, '[]'::jsonb) || COALESCE(uo_evidence, '[]'::jsonb) AS evidence_jsonb
FROM per_entity;

COMMENT ON VIEW public.v_dia_owner_role_classification IS
  'DEVELOPER_BD_AUDIT_v3 final classification view (v5). Encodes the '
  'fact-based algorithm with priority: operator > user_owner > developer > '
  'buyer > unknown. Reads from v_dia_developer_candidates, '
  'v_dia_buyer_candidates, v_dia_user_owner_candidates, plus the manually-'
  'curated is_operator_not_owner flag. Used by the apply UPDATE below and '
  'by future scheduled reclassification.';

-- --- Apply classification to true_owners
-- Honors behavioral_override (do not overwrite) and existing manual classifications.
UPDATE public.true_owners t
SET owner_role            = c.owner_role,
    owner_role_source     = c.owner_role_source,
    owner_role_confidence = c.owner_role_confidence,
    owner_role_updated_at = NOW(),
    developer_flag_sources = c.evidence_jsonb
FROM public.v_dia_owner_role_classification c
WHERE t.true_owner_id = c.true_owner_id
  -- Don't overwrite manual overrides
  AND t.behavioral_override IS NULL
  -- Don't overwrite manual classifications
  AND COALESCE(t.owner_role_source, '') NOT IN ('manual', 'behavioral_override')
  -- Only update when the classification differs OR confidence is higher
  AND (t.owner_role IS DISTINCT FROM c.owner_role
       OR t.owner_role_confidence IS DISTINCT FROM c.owner_role_confidence
       OR (c.evidence_jsonb IS NOT NULL AND c.evidence_jsonb <> '[]'::jsonb));

-- Set security_invoker on the new views (per security hardening pattern)
ALTER VIEW public.v_dia_property_signals          SET (security_invoker = true);
ALTER VIEW public.v_dia_sale_leaseback_events     SET (security_invoker = true);
ALTER VIEW public.v_dia_developer_candidates      SET (security_invoker = true);
ALTER VIEW public.v_dia_buyer_candidates          SET (security_invoker = true);
ALTER VIEW public.v_dia_user_owner_candidates     SET (security_invoker = true);
ALTER VIEW public.v_dia_owner_role_classification SET (security_invoker = true);
