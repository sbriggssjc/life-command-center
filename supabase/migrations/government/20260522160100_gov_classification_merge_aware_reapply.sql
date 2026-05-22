-- ============================================================================
-- 20260522160100_gov_classification_merge_aware_reapply.sql
-- DEVELOPER_BD_AUDIT_v3 — Phase A Topic 1.6 follow-up (gov)
--
-- Mirrors the dia merge-aware classification rewrite. Aggregates property
-- counts across merge groups; writes classification to canonical only.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_gov_owner_role_classification AS
WITH per_canonical AS (
  SELECT
    COALESCE(t.merged_into_true_owner_id, t.true_owner_id) AS canonical_id,
    MAX(t.name) FILTER (
      WHERE t.true_owner_id = COALESCE(t.merged_into_true_owner_id, t.true_owner_id)
    ) AS name,
    COUNT(DISTINCT d.property_id) AS dev_props,
    COUNT(DISTINCT b.property_id) AS buy_props,
    jsonb_agg(DISTINCT jsonb_build_object(
      'source','developer_pattern',
      'property_id', d.property_id,
      'rule', d.rule_source,
      'confidence', d.confidence
    )) FILTER (WHERE d.property_id IS NOT NULL) AS dev_evidence
  FROM public.true_owners t
  LEFT JOIN public.v_gov_developer_candidates d ON d.true_owner_id = t.true_owner_id
  LEFT JOIN public.v_gov_buyer_candidates     b ON b.true_owner_id = t.true_owner_id
  GROUP BY COALESCE(t.merged_into_true_owner_id, t.true_owner_id)
)
SELECT
  canonical_id AS true_owner_id, name, dev_props, buy_props,
  CASE
    WHEN dev_props >= 2
      OR (dev_props >= 1 AND dev_props * 10 >= (dev_props + buy_props) * 3)
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
FROM per_canonical;

ALTER VIEW public.v_gov_owner_role_classification SET (security_invoker = true);

UPDATE public.true_owners
SET owner_role = NULL, owner_role_source = NULL, owner_role_confidence = NULL,
    owner_role_updated_at = NOW(), developer_flag_sources = '[]'::jsonb
WHERE merged_into_true_owner_id IS NOT NULL;

UPDATE public.true_owners t
SET owner_role = c.owner_role, owner_role_source = c.owner_role_source,
    owner_role_confidence = c.owner_role_confidence, owner_role_updated_at = NOW(),
    developer_flag_sources = c.evidence_jsonb
FROM public.v_gov_owner_role_classification c
WHERE t.true_owner_id = c.true_owner_id
  AND t.merged_into_true_owner_id IS NULL
  AND t.behavioral_override IS NULL
  AND COALESCE(t.owner_role_source, '') NOT IN ('manual', 'behavioral_override')
  AND (t.owner_role IS DISTINCT FROM c.owner_role
       OR t.owner_role_confidence IS DISTINCT FROM c.owner_role_confidence
       OR (c.evidence_jsonb IS NOT NULL AND c.evidence_jsonb <> '[]'::jsonb));
