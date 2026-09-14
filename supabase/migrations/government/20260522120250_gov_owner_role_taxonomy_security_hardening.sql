-- ⚠️ HISTORICAL — DO NOT RE-APPLY. This directory does not own the government database;
-- `government-lease` does (see supabase/migrations/government/README.md, 2026-09-12).
-- This file is kept as a record of what this repo applied in the past. The live, correct
-- copy of any object it defines may have since diverged -- read the deployed database or
-- government-lease's committed source, never this file, before trusting its content.

-- ============================================================================
-- 20260522120250_gov_owner_role_taxonomy_security_hardening.sql
-- DEVELOPER_BD_AUDIT_v3 — Phase A Topic 1 follow-up (government)
--
-- Same hardening as LCC and dia: security_invoker view + pinned function
-- search_path. Resolves security advisor findings on the artifacts created
-- by 20260522120200_gov_owner_role_taxonomy.sql.
-- ============================================================================

ALTER VIEW public.v_true_owners_effective_role SET (security_invoker = true);

ALTER FUNCTION public.true_owner_effective_role(UUID)
    SET search_path = public, pg_catalog;
