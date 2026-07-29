-- ============================================================================
-- 20260729120000_rls_enable_two_stragglers_ops.sql   (OPS project xengecqvemvfknjvbvrq)
-- Applied live 2026-07-29. Closes two ERROR-level `rls_disabled_in_public` security
-- advisors that re-appeared after the 2026-07-28 hardening sweep because these two
-- tables post-dated that migration:
--   - public.feature_flags_registry
--   - public.staged_intake_feedback_backfill_w1_1_log
-- Enable-RLS-no-policy = anon/authenticated are denied; service_role (the LCC engine)
-- bypasses RLS and is unaffected. The frontend never reads OPS tables with the anon
-- key (Supabase Auth only), so this is non-breaking. Verified: OPS security ERRORs 2 -> 0.
-- ============================================================================
alter table public.feature_flags_registry enable row level security;
alter table public.staged_intake_feedback_backfill_w1_1_log enable row level security;
