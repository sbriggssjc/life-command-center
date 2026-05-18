-- ============================================================================
-- QA-06 (2026-05-18): Materialize v_property_value_signal to fix the
-- Home NBA rail timeout (Postgres 57014 statement_timeout on
-- v_next_best_action over the dia domain).
--
-- Before this change: SELECT * FROM v_next_best_action ORDER BY rank LIMIT 50
-- took ~75 seconds (Execution Time: 75,141 ms). Statement timeout for the
-- authenticated role is below that, so /api/admin?_route=next-best-action
-- returned `by_domain.dialysis.ok=false, status=500,
-- error="canceling statement due to statement timeout"`. The user-facing
-- Home rail header showed "⚠ partial · 10 shown · 65 total open" (gov-only).
--
-- Dominant cost was v_property_value_signal: a regular VIEW with four
-- correlated subqueries per property × 15,219 properties, joined SIX times
-- in v_next_best_action's UNION ALL. EXPLAIN ANALYZE showed multiple
-- Seq Scans on properties each taking ~8-10s.
--
-- Fix: materialize the per-property value signal once nightly. Refresh
-- CONCURRENTLY so readers aren't blocked. The view v_property_value_signal
-- stays in place (redefined as `SELECT * FROM mv_property_value_signal`)
-- so v_next_best_action and any other consumers keep working unchanged.
--
-- After this change: same query runs in 632 ms (~120× speedup), live
-- Home rail shows "130 total open" with no partial warning.
--
-- Already applied to dia (zqzrriwuavgrquhisnoa) at 2026-05-18 via Supabase
-- MCP. This file commits the migration to the repo as the historical record.
-- ============================================================================

-- 1) Materialized view. Body is byte-for-byte identical to the previous
--    v_property_value_signal definition; only the storage shape changes.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_property_value_signal AS
WITH curr_cap AS (
  SELECT cm_dialysis_cap_ttm_q.ttm_weighted_cap_rate AS cap
    FROM cm_dialysis_cap_ttm_q
   WHERE cm_dialysis_cap_ttm_q.subspecialty = 'all'::text
     AND cm_dialysis_cap_ttm_q.ttm_weighted_cap_rate IS NOT NULL
     AND cm_dialysis_cap_ttm_q.ttm_weighted_cap_rate > 0::numeric
   ORDER BY cm_dialysis_cap_ttm_q.period_end DESC
   LIMIT 1
)
SELECT
  p.property_id,
  COALESCE(
    ( SELECT s.sold_price
        FROM sales_transactions s
       WHERE s.property_id = p.property_id
         AND s.sale_date > (CURRENT_DATE - '10 years'::interval)
         AND s.sold_price > 100000::numeric
       ORDER BY s.sale_date DESC
       LIMIT 1
    ),
    ( SELECT COALESCE(al.last_price, al.initial_price)
        FROM available_listings al
       WHERE al.property_id = p.property_id
         AND al.is_active = true
       ORDER BY COALESCE(al.last_seen, al.listing_date) DESC
       LIMIT 1
    ),
    ( SELECT l.annual_rent / GREATEST((SELECT cap FROM curr_cap), 0.04)
        FROM leases l
       WHERE l.property_id = p.property_id
         AND l.is_active = true
         AND l.annual_rent IS NOT NULL
         AND l.annual_rent > 1000::numeric
         AND l.annual_rent < 5000000::numeric
       ORDER BY l.lease_start DESC NULLS LAST
       LIMIT 1
    ),
    LEAST(p.building_size, 200000::numeric) * 400::numeric,
    p.current_value_estimate * 0.2,
    LEAST(p.last_known_rent, 5000000::numeric) * 2::numeric,
    1000000::numeric
  ) AS rev_value
FROM properties p;

-- 2) Required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS mv_property_value_signal_pkey
  ON public.mv_property_value_signal(property_id);

-- 3) Redefine v_property_value_signal as a thin SELECT from the matview.
--    CREATE OR REPLACE VIEW preserves the OID so v_next_best_action and
--    any other consumers keep working without recompilation.
CREATE OR REPLACE VIEW public.v_property_value_signal AS
SELECT property_id, rev_value FROM public.mv_property_value_signal;

-- 4) Initial populate (safe on re-run — REFRESH is idempotent).
REFRESH MATERIALIZED VIEW public.mv_property_value_signal;

-- 5) Permissions — match the rest of the dia mv pattern.
GRANT SELECT ON public.mv_property_value_signal TO anon, authenticated, service_role;

-- 6) Nightly refresh via pg_cron. 6:50 AM UTC — between
--    refresh-mv-sales-comps (06:10) and refresh-clinic-research-priority (06:40).
--    Uses CONCURRENTLY so readers aren't blocked.
SELECT cron.unschedule('refresh-mv-property-value-signal')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-mv-property-value-signal');
SELECT cron.schedule(
  'refresh-mv-property-value-signal',
  '50 6 * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_property_value_signal$$
);
