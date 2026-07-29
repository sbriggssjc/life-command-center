-- 20260729130000_lcc_w0_8_drop_duplicate_indexes.sql
-- W0.8 — Drop redundant duplicate indexes on LCC Opps (public schema).
--
-- Source: performance advisor duplicate_index (3 groups on LCC Opps) cross-checked against
--   a pg_index signature match (table + access method + indkey + opclass + indoption +
--   uniqueness + expression + predicate). 1 of the 3 groups has a droppable redundant
--   copy; the other 2 have BOTH members backing a constraint and are left untouched
--   (never drop a constraint-backed index):
--     * domains               {domains_workspace_id_slug_key, domains_workspace_slug_unique}
--     * workspace_memberships {workspace_memberships_workspace_id_user_id_key, workspace_memberships_workspace_user_unique}
--
-- Dropped index  ->  surviving twin (kept):
--   idx_wm_user  -> idx_memberships_user
--
-- Reversible: recreate idx_wm_user from idx_memberships_user's definition
--   (pg_get_indexdef). Idempotent via IF EXISTS.

DROP INDEX IF EXISTS public.idx_wm_user;
