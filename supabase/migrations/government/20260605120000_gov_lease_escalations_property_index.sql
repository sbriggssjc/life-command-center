-- ============================================================================
-- Migration: index lease_escalations(property_id, effective_date DESC)
--            to fix the gov v_sales_comps statement timeout (R4-D #2, 2026-06-05)
--
-- Target: government Supabase (GOV_SUPABASE_URL)
--
-- Symptom: govQuery('v_sales_comps', …, {limit:1000}) returned HTTP 500 /
-- SQLSTATE 57014 (statement timeout) on every gov overview load. Downstream,
-- the lazy comps load never populated, so the TTM cap-rate section showed
-- "— (0 loaded comps)" and NM Performance showed "0 of 0 TTM deals".
--
-- Root cause: v_sales_comps carries a per-row LATERAL that pulls the 3 most
-- recent lease_escalations for each sale's property_id:
--
--   LEFT JOIN LATERAL (
--     SELECT string_agg(...)
--     FROM (SELECT ... FROM lease_escalations
--           WHERE property_id = s.property_id
--           ORDER BY effective_date DESC LIMIT 3) le
--   ) esc ON true
--
-- lease_escalations had ONLY its escalation_id PK index — no index on
-- property_id. So the LATERAL seq-scanned all 93,669 escalation rows for each
-- of the 2,707 live sales (~253M comparisons) → timeout.
--
-- Fix: a composite index on (property_id, effective_date DESC) turns the
-- LATERAL into an index scan (Memoized across duplicate property_ids).
-- After: EXPLAIN ANALYZE of the exact frontend query runs in ~261 ms
-- (was >5 s / timeout).
--
-- DB-only change, safe to apply anytime. Idempotent (IF NOT EXISTS).
-- Applied live to the gov project 2026-06-05.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_lease_escalations_property_effdate
  ON public.lease_escalations (property_id, effective_date DESC);

ANALYZE public.lease_escalations;
