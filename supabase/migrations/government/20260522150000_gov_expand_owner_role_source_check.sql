-- ============================================================================
-- 20260522150000_gov_expand_owner_role_source_check.sql
-- DEVELOPER_BD_AUDIT_v3 — Phase A Topic 1.7 / gov constraint expansion
--
-- Mirrors dia migration 20260522140350. Expands the owner_role_source
-- CHECK constraint to allow the new fact-based source tags used by the
-- v5 classification algorithm.
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
      'sale_leaseback_seller',
      'bts_explicit_with_first_gen'
    ));
