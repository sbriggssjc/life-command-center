-- ============================================================================
-- QA-16 (2026-05-18, dia): Keyset-pagination index for
-- clinic_financial_estimates is_latest scan.
--
-- The dia financial-metrics widget paginates 36,538 is_latest rows in
-- 1000-row pages. The previous OFFSET pagination was O(n²) overall (page
-- 30 ≈ 1.4s by itself), and the last few pages routinely tripped Postgres
-- statement_timeout (57014). Keyset pagination on estimate_id is O(1)
-- per page — but only if there's a partial index covering BOTH the
-- is_latest predicate AND the estimate_id ordering. Without this index,
-- Postgres uses the regular PK index and has to filter out ~8K non-latest
-- rows per page (650ms per page with PK; 4.5ms with the partial index).
--
-- Companion to the frontend change in dialysis.js that switched the lazy
-- loader from OFFSET to keyset pagination.
--
-- Already applied to dia (zqzrriwuavgrquhisnoa) on 2026-05-18 via Supabase
-- MCP. Verified: EXPLAIN ANALYZE on a representative page now reports
-- 4.563 ms execution time vs. 1356 ms previously.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_cfe_latest_keyset
  ON public.clinic_financial_estimates(estimate_id)
  WHERE is_latest = true;
