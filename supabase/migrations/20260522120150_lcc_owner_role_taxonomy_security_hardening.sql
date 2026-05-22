-- ============================================================================
-- 20260522120150_lcc_owner_role_taxonomy_security_hardening.sql
-- DEVELOPER_BD_AUDIT_v3 — Phase A Topic 1 follow-up
--
-- Addresses the two Supabase advisor findings on the new objects introduced
-- by 20260522120000_lcc_owner_role_taxonomy.sql:
--   1. v_entities_effective_role was created with default SECURITY DEFINER
--      (ERROR-level security advisor). Recreate WITH (security_invoker=true)
--      so the view honors RLS on public.entities for the calling role.
--   2. entity_effective_owner_role had mutable search_path (WARN-level).
--      Pin to public, pg_catalog.
-- ============================================================================

ALTER VIEW public.v_entities_effective_role SET (security_invoker = true);

ALTER FUNCTION public.entity_effective_owner_role(UUID)
    SET search_path = public, pg_catalog;
