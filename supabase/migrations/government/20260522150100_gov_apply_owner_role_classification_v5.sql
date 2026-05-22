-- ============================================================================
-- 20260522150100_gov_apply_owner_role_classification_v5.sql
-- DEVELOPER_BD_AUDIT_v3 — Phase A Topic 1.7 / Government Mirror
--
-- Mirrors the dia v5 classification (migration 20260522140400) for the
-- government DB. Key schema/algorithm adaptations:
--
--   • Gov leases have an EXPLICIT `is_first_generation` flag (9,167 rows
--     populated as of 2026-05-22). No "earliest lease" proxy needed — use
--     the flag directly.
--   • Gov properties have an EXPLICIT `is_build_to_suit` flag (155 props).
--     Use it as a high-confidence rule (0.90) when paired with a first-gen
--     lease anchored to year_built.
--   • Gov OH uses single-event semantics: each row is a transfer
--     (`transfer_date` + `new_owner` + `prior_owner` text fields), not an
--     interval. Owner at time T = the new_owner of the most recent transfer
--     with transfer_date <= T. This requires a window-function-based
--     "owner-at-date" view rather than the dia interval join.
--   • Gov does NOT have an `is_operator_not_owner` flag on true_owners.
--     The TENANT in every gov lease is a federal agency (which is the
--     operator-equivalent for gov), and the OWNER is a separate entity.
--     So gov has no "operator" classification — only developer + buyer.
--     We DO filter federal-government anti-pattern names from developer
--     and buyer classification so true federal-owned buildings don't get
--     classified as prospects.
--   • Gov does NOT have user_owner classification either (no sale-leaseback
--     equivalent — federal tenants don't sell-leaseback the way dialysis
--     operators do).
--
-- VIEW CHAIN:
--   v_gov_normalize_for_match    — helper function (same as dia)
--   v_gov_property_signals        — year_built + year_renovated + first-gen
--                                    lease info + anchor flags
--   v_gov_owner_at_first_gen      — owner at the first-gen lease commencement
--                                    via window function over OH transfers
--   v_gov_developer_candidates    — BTS-explicit OR first-gen-landlord rules
--   v_gov_buyer_candidates        — first transfer with transfer_date > 90d
--                                    after first-gen lease commencement
--   v_gov_owner_role_classification — final priority rollup (top-level view)
-- ============================================================================

-- Helper: light-touch normalizer (mirrors dia.dia_normalize_for_match)
CREATE OR REPLACE FUNCTION public.gov_normalize_for_match(s TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT LOWER(TRIM(REGEXP_REPLACE(
    REGEXP_REPLACE(COALESCE(s, ''), '[[:punct:]]+', ' ', 'g'),
    '\s+', ' ', 'g'
  )))
$$;

COMMENT ON FUNCTION public.gov_normalize_for_match IS
  'DEVELOPER_BD_AUDIT_v3 helper. Lowercase + strip punctuation + collapse '
  'whitespace. Used for entity-name matching in the classification chain.';

-- View 1: per-property signals
CREATE OR REPLACE VIEW public.v_gov_property_signals AS
WITH first_gen_lease AS (
  SELECT DISTINCT ON (property_id)
    property_id, commencement_date, expiration_date,
    -- Term years: prefer firm_term_years, then total_term_years, else compute
    COALESCE(
      firm_term_years,
      total_term_years,
      ((expiration_date - commencement_date) / 365.25)::numeric
    ) AS term_years
  FROM public.leases
  WHERE is_first_generation = TRUE
    AND commencement_date IS NOT NULL
  ORDER BY property_id, commencement_date
)
SELECT
  p.property_id,
  p.year_built,
  p.year_renovated,
  p.is_build_to_suit,
  fg.commencement_date AS first_gen_commencement,
  fg.expiration_date   AS first_gen_expiration,
  fg.term_years        AS first_gen_term_years,
  (fg.commencement_date IS NOT NULL
   AND p.year_built IS NOT NULL AND p.year_built > 0
   AND fg.commencement_date BETWEEN make_date(p.year_built, 1, 1) - INTERVAL '6 months'
                                AND make_date(p.year_built + 2, 12, 31)
  ) AS lease_anchored_to_year_built,
  (fg.commencement_date IS NOT NULL
   AND p.year_renovated IS NOT NULL AND p.year_renovated > 0
   AND fg.commencement_date BETWEEN make_date(p.year_renovated, 1, 1) - INTERVAL '6 months'
                                AND make_date(p.year_renovated + 2, 12, 31)
  ) AS lease_anchored_to_year_renovated
FROM public.properties p
LEFT JOIN first_gen_lease fg ON fg.property_id = p.property_id;

COMMENT ON VIEW public.v_gov_property_signals IS
  'DEVELOPER_BD_AUDIT_v3 §11.5 (gov adaptation). Per-property year_built + '
  'year_renovated + first-generation lease commencement + anchor flags. '
  'Uses explicit leases.is_first_generation flag (no earliest-lease proxy).';

-- View 2: owner at first-gen lease commencement
-- For each property with a first-gen lease, find the owner active at that
-- commencement date via the most recent transfer at or before that date.
CREATE OR REPLACE VIEW public.v_gov_owner_at_first_gen AS
WITH ranked AS (
  SELECT
    ps.property_id, ps.first_gen_commencement,
    oh.ownership_id,
    oh.true_owner_id, oh.recorded_owner_id,
    oh.transfer_date, oh.new_owner, oh.prior_owner, oh.change_type,
    ROW_NUMBER() OVER (
      PARTITION BY ps.property_id
      -- Prefer rows with transfer_date (real events) over rows without
      ORDER BY
        CASE WHEN oh.transfer_date IS NOT NULL THEN 0 ELSE 1 END,
        oh.transfer_date DESC NULLS LAST,
        oh.created_at DESC NULLS LAST
    ) AS rn
  FROM public.v_gov_property_signals ps
  JOIN public.ownership_history oh ON oh.property_id = ps.property_id
  WHERE ps.first_gen_commencement IS NOT NULL
    AND (oh.transfer_date IS NULL OR oh.transfer_date <= ps.first_gen_commencement)
    AND (oh.true_owner_id IS NOT NULL OR oh.new_owner IS NOT NULL)
)
SELECT property_id, first_gen_commencement,
       ownership_id, true_owner_id, recorded_owner_id,
       transfer_date, new_owner, prior_owner, change_type
FROM ranked
WHERE rn = 1;

COMMENT ON VIEW public.v_gov_owner_at_first_gen IS
  'DEVELOPER_BD_AUDIT_v3 §11 (gov adaptation). Owner at the first-generation '
  'lease commencement, derived via window function over ownership_history '
  'transfers. Owner at time T = new_owner of the most recent transfer with '
  'transfer_date <= T. Falls back to NULL-transfer-date rows when no dated '
  'transfer exists. Drives developer detection in v_gov_developer_candidates.';

-- View 3: developer candidates
CREATE OR REPLACE VIEW public.v_gov_developer_candidates AS
WITH ps AS (
  SELECT * FROM public.v_gov_property_signals
  WHERE first_gen_commencement IS NOT NULL
    AND (lease_anchored_to_year_built OR lease_anchored_to_year_renovated)
),
candidates AS (
  -- Rule A: explicit BTS + first-gen lease landlord (high confidence)
  SELECT DISTINCT
    oaf.true_owner_id, ps.property_id,
    'bts_explicit_with_first_gen'::text AS rule_source,
    0.90::numeric AS confidence
  FROM ps
  JOIN public.v_gov_owner_at_first_gen oaf USING (property_id, first_gen_commencement)
  WHERE ps.is_build_to_suit = TRUE
    AND oaf.true_owner_id IS NOT NULL
  UNION
  -- Rule B: first-gen lease landlord (no BTS flag — still strong signal)
  SELECT DISTINCT
    oaf.true_owner_id, ps.property_id,
    'first_gen_lease_landlord'::text AS rule_source,
    0.80::numeric AS confidence
  FROM ps
  JOIN public.v_gov_owner_at_first_gen oaf USING (property_id, first_gen_commencement)
  WHERE (ps.is_build_to_suit IS NULL OR ps.is_build_to_suit = FALSE)
    AND oaf.true_owner_id IS NOT NULL
)
SELECT q.*
FROM candidates q
-- Filter: exclude federal-government anti-pattern names
WHERE EXISTS (
  SELECT 1 FROM public.true_owners t
  WHERE t.true_owner_id = q.true_owner_id
    AND t.name !~* '^(u\.?\s*s\.?\s*a\.?|united states|us government|us treasury|federal government|department of|government of)\s*$'
    AND t.name !~* '^(general services administration|gsa)\s*$'
);

COMMENT ON VIEW public.v_gov_developer_candidates IS
  'DEVELOPER_BD_AUDIT_v3 (gov v5). Two rules: (A) explicit BTS flag '
  'paired with first-gen lease anchored to construction/renovation (0.90 '
  'confidence — gov has the explicit is_build_to_suit signal); (B) first-gen '
  'lease landlord without explicit BTS flag (0.80 confidence — still strong '
  'signal: owner held property at first-gen lease commencement near '
  'year_built/year_renovated). Federal-government anti-pattern names excluded.';

-- View 4: buyer candidates
CREATE OR REPLACE VIEW public.v_gov_buyer_candidates AS
WITH entity_first_transfer AS (
  SELECT DISTINCT ON (true_owner_id, property_id)
    property_id, true_owner_id, transfer_date
  FROM public.ownership_history
  WHERE transfer_date IS NOT NULL
    AND true_owner_id IS NOT NULL
  ORDER BY true_owner_id, property_id, transfer_date
)
SELECT DISTINCT
  eft.true_owner_id, eft.property_id,
  'acquired_post_lease'::text AS rule_source,
  0.75::numeric AS confidence
FROM entity_first_transfer eft
JOIN public.v_gov_property_signals ps USING (property_id)
WHERE ps.first_gen_commencement IS NOT NULL
  AND eft.transfer_date > ps.first_gen_commencement + INTERVAL '90 days'
  AND EXISTS (
    SELECT 1 FROM public.true_owners t
    WHERE t.true_owner_id = eft.true_owner_id
      AND t.name !~* '^(u\.?\s*s\.?\s*a\.?|united states|us government|us treasury|federal government|department of|government of)\s*$'
      AND t.name !~* '^(general services administration|gsa)\s*$'
  );

COMMENT ON VIEW public.v_gov_buyer_candidates IS
  'DEVELOPER_BD_AUDIT_v3 (gov v5). Buyer pattern: entity acquired property '
  'AFTER first-gen lease commenced by >90 days. Excludes federal-government '
  'anti-pattern names.';

-- View 5: classification view (final priority rollup)
CREATE OR REPLACE VIEW public.v_gov_owner_role_classification AS
WITH per_entity AS (
  SELECT
    t.true_owner_id, t.name,
    COUNT(DISTINCT d.property_id) AS dev_props,
    COUNT(DISTINCT b.property_id) AS buy_props,
    jsonb_agg(DISTINCT jsonb_build_object(
      'source','developer_pattern',
      'property_id',d.property_id,
      'rule',d.rule_source,
      'confidence',d.confidence
    )) FILTER (WHERE d.property_id IS NOT NULL) AS dev_evidence
  FROM public.true_owners t
  LEFT JOIN public.v_gov_developer_candidates d ON d.true_owner_id = t.true_owner_id
  LEFT JOIN public.v_gov_buyer_candidates     b ON b.true_owner_id = t.true_owner_id
  GROUP BY t.true_owner_id, t.name
)
SELECT
  true_owner_id, name, dev_props, buy_props,
  CASE
    WHEN dev_props >= 2 OR (dev_props >= 1 AND dev_props * 10 >= (dev_props + buy_props) * 3)
      THEN 'developer'
    WHEN buy_props >= 1 THEN 'buyer'
    WHEN dev_props >= 1 THEN 'developer'
    ELSE 'unknown'
  END AS owner_role,
  CASE
    WHEN dev_props >= 1 THEN 'tenant_relationship_value_creation'
    WHEN buy_props >= 1 THEN 'acquired_after_lease'
    ELSE NULL
  END AS owner_role_source,
  CASE
    WHEN dev_props >= 2 THEN 0.85
    WHEN dev_props >= 1 THEN 0.75
    WHEN buy_props >= 1 THEN 0.75
    ELSE NULL
  END AS owner_role_confidence,
  COALESCE(dev_evidence, '[]'::jsonb) AS evidence_jsonb
FROM per_entity;

COMMENT ON VIEW public.v_gov_owner_role_classification IS
  'DEVELOPER_BD_AUDIT_v3 (gov v5). Final classification view. Priority: '
  'developer (via dev_props>=2 or share>=30%) > buyer > unknown. Gov has no '
  'operator or user_owner classification (federal tenant always; no operator-'
  'as-owner or sale-leaseback patterns).';

-- Apply classification to true_owners
UPDATE public.true_owners t
SET owner_role            = c.owner_role,
    owner_role_source     = c.owner_role_source,
    owner_role_confidence = c.owner_role_confidence,
    owner_role_updated_at = NOW(),
    developer_flag_sources = c.evidence_jsonb
FROM public.v_gov_owner_role_classification c
WHERE t.true_owner_id = c.true_owner_id
  AND t.behavioral_override IS NULL
  AND COALESCE(t.owner_role_source, '') NOT IN ('manual', 'behavioral_override')
  AND (t.owner_role IS DISTINCT FROM c.owner_role
       OR t.owner_role_confidence IS DISTINCT FROM c.owner_role_confidence
       OR (c.evidence_jsonb IS NOT NULL AND c.evidence_jsonb <> '[]'::jsonb));

-- Set security_invoker on new views (per security hardening pattern)
ALTER VIEW public.v_gov_property_signals          SET (security_invoker = true);
ALTER VIEW public.v_gov_owner_at_first_gen        SET (security_invoker = true);
ALTER VIEW public.v_gov_developer_candidates      SET (security_invoker = true);
ALTER VIEW public.v_gov_buyer_candidates          SET (security_invoker = true);
ALTER VIEW public.v_gov_owner_role_classification SET (security_invoker = true);
