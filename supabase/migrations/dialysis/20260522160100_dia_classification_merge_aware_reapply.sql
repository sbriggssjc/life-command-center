-- ============================================================================
-- 20260522160100_dia_classification_merge_aware_reapply.sql
-- DEVELOPER_BD_AUDIT_v3 — Phase A Topic 1.6 follow-up
--
-- Rewrites v_dia_owner_role_classification to be merge-aware: aggregates
-- dev_props / buy_props / uo_props across all variants in a merge group,
-- then writes the classification to the CANONICAL row only. Duplicate rows
-- get their owner_role reset to NULL (so the canonical's classification is
-- the only one visible).
-- ============================================================================

CREATE OR REPLACE VIEW public.v_dia_owner_role_classification AS
WITH per_canonical AS (
  SELECT
    COALESCE(t.merged_into_true_owner_id, t.true_owner_id) AS canonical_id,
    -- Pick the canonical entity's name (its own name, not a duplicate's)
    MAX(t.name) FILTER (
      WHERE t.true_owner_id = COALESCE(t.merged_into_true_owner_id, t.true_owner_id)
    ) AS name,
    -- Operator priority: TRUE if ANY variant in the merge group is operator-flagged
    BOOL_OR(COALESCE(t.is_operator_not_owner, FALSE)) AS is_operator,
    -- Aggregate property counts across all variants in the merge group
    COUNT(DISTINCT d.property_id) AS dev_props,
    COUNT(DISTINCT b.property_id) AS buy_props,
    COUNT(DISTINCT u.property_id) AS uo_props,
    jsonb_agg(DISTINCT jsonb_build_object(
      'source','developer_pattern',
      'property_id', d.property_id,
      'rule', d.rule_source,
      'confidence', d.confidence
    )) FILTER (WHERE d.property_id IS NOT NULL) AS dev_evidence,
    jsonb_agg(DISTINCT jsonb_build_object(
      'source','user_owner_pattern',
      'property_id', u.property_id,
      'rule', u.rule_source,
      'confidence', u.confidence
    )) FILTER (WHERE u.property_id IS NOT NULL) AS uo_evidence
  FROM public.true_owners t
  LEFT JOIN public.v_dia_developer_candidates d  ON d.true_owner_id = t.true_owner_id
  LEFT JOIN public.v_dia_buyer_candidates     b  ON b.true_owner_id = t.true_owner_id
  LEFT JOIN public.v_dia_user_owner_candidates u ON u.true_owner_id = t.true_owner_id
  GROUP BY COALESCE(t.merged_into_true_owner_id, t.true_owner_id)
)
SELECT
  canonical_id AS true_owner_id, name, is_operator,
  dev_props, buy_props, uo_props,
  CASE
    WHEN is_operator THEN 'operator'
    WHEN uo_props >= 1 THEN 'user_owner'
    WHEN dev_props >= 2
      OR (dev_props >= 1 AND dev_props * 10 >= (dev_props + buy_props) * 3)
      THEN 'developer'
    WHEN buy_props >= 1 THEN 'buyer'
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
  COALESCE(dev_evidence, '[]'::jsonb) || COALESCE(uo_evidence, '[]'::jsonb) AS evidence_jsonb
FROM per_canonical;

ALTER VIEW public.v_dia_owner_role_classification SET (security_invoker = true);

COMMENT ON VIEW public.v_dia_owner_role_classification IS
  'DEVELOPER_BD_AUDIT_v3 (v5 + Topic 1.6 merge-aware). Aggregates dev/buy/uo '
  'property counts across all merge-group variants and writes the '
  'classification to the canonical row only. Duplicate rows get '
  'owner_role=NULL.';

-- Reset duplicate rows' classification (canonical will get the aggregated one)
UPDATE public.true_owners
SET owner_role = NULL,
    owner_role_source = NULL,
    owner_role_confidence = NULL,
    owner_role_updated_at = NOW(),
    developer_flag_sources = '[]'::jsonb
WHERE merged_into_true_owner_id IS NOT NULL;

-- Re-apply classification to canonical rows
UPDATE public.true_owners t
SET owner_role            = c.owner_role,
    owner_role_source     = c.owner_role_source,
    owner_role_confidence = c.owner_role_confidence,
    owner_role_updated_at = NOW(),
    developer_flag_sources = c.evidence_jsonb
FROM public.v_dia_owner_role_classification c
WHERE t.true_owner_id = c.true_owner_id
  AND t.merged_into_true_owner_id IS NULL  -- only update canonicals
  AND t.behavioral_override IS NULL
  AND COALESCE(t.owner_role_source, '') NOT IN ('manual', 'behavioral_override')
  AND (t.owner_role IS DISTINCT FROM c.owner_role
       OR t.owner_role_confidence IS DISTINCT FROM c.owner_role_confidence
       OR (c.evidence_jsonb IS NOT NULL AND c.evidence_jsonb <> '[]'::jsonb));
