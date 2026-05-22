-- ============================================================================
-- 20260522140000_dia_cleanup_sf_placeholder_oh.sql
-- DEVELOPER_BD_AUDIT_v3 — Phase A Topic 1 / WS3 data integrity
--
-- Drops the 7,544 ownership_history rows that originate from a Salesforce
-- sync placeholder: start_date='2023-07-01', end_date='2024-06-30', both
-- true_owner_id and recorded_owner_id NULL, sale_id NULL.
--
-- These rows carry no identifiers and pollute every ownership-chain query
-- (they shadow real ownership intervals and cause false "first known owner"
-- results in developer detection). Pre-state on 2026-05-22: 7,544 of 12,403
-- total OH rows match this pattern (61%).
--
-- Recoverable: no identifiers means no information is lost; re-running the
-- Salesforce sync can rebuild any that were genuinely needed (none were).
-- ============================================================================

WITH deleted AS (
  DELETE FROM public.ownership_history
  WHERE start_date = '2023-07-01'
    AND end_date = '2024-06-30'
    AND true_owner_id IS NULL
    AND recorded_owner_id IS NULL
    AND sale_id IS NULL
  RETURNING 1
)
SELECT COUNT(*) AS rows_deleted FROM deleted;
