-- ============================================================================
-- 20260522140350_dia_expand_owner_role_source_check.sql
-- DEVELOPER_BD_AUDIT_v3 — Phase A Topic 1 / constraint expansion
--
-- The 20260522120100 taxonomy migration added a CHECK constraint on
-- true_owners.owner_role_source limiting values to 5 legacy/internal tokens.
-- The v5 fact-based algorithm needs new source tokens to record WHICH rule
-- produced the classification, so brokers and the audit trail can see
-- exactly why an entity was classified the way it was.
--
-- New tokens added:
--   - manual_operator_flag        (operator from is_operator_not_owner)
--   - tenant_relationship_value_creation  (developer pattern)
--   - acquired_after_lease        (buyer pattern)
--   - sale_leaseback_seller       (user_owner pattern)
-- ============================================================================

ALTER TABLE public.true_owners
  DROP CONSTRAINT IF EXISTS true_owners_owner_role_source_check;

ALTER TABLE public.true_owners
  ADD CONSTRAINT true_owners_owner_role_source_check
    CHECK (owner_role_source IS NULL OR owner_role_source IN (
      'computed',
      'manual',
      'behavioral_override',
      'legacy_heuristic',
      'bts_delivered',
      'manual_operator_flag',
      'tenant_relationship_value_creation',
      'acquired_after_lease',
      'sale_leaseback_seller'
    ));
