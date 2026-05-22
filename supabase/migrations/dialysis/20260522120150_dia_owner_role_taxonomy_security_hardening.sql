-- ============================================================================
-- 20260522120150_dia_owner_role_taxonomy_security_hardening.sql
-- DEVELOPER_BD_AUDIT_v3 — Phase A Topic 1 follow-up (dialysis)
--
-- Same hardening as LCC and gov: security_invoker view + pinned function
-- search_path. Resolves security advisor findings on the artifacts created
-- by 20260522120100_dia_owner_role_taxonomy.sql.
-- ============================================================================

ALTER VIEW public.v_true_owners_effective_role SET (security_invoker = true);

ALTER FUNCTION public.true_owner_effective_role(UUID)
    SET search_path = public, pg_catalog;
