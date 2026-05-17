-- ============================================================================
-- Item #4 valuation v3 (dia, 2026-05-17): NOI / cap_rate methodology.
--
-- Replaces v_property_value_signal with a value chain that prefers real
-- transaction prices, then NOI / TTM cap rate (broker methodology), then
-- a capped SF proxy, then heavily-discounted polluted columns.
--
-- This commit captures the FINAL state already applied to dia
-- (zqzrriwuavgrquhisnoa) via Supabase MCP. Prior in-session iterations
-- (initial $400/SF formula, then 200K SF cap, then NOI/cap, then $5M
-- rent sanity cap) are superseded by this single migration.
--
-- Audit-discovery context:
--   • current_value_estimate and last_known_rent on dia.properties are
--     polluted with dialysis-operator BUSINESS valuations (revenue × ~5×
--     EBITDA), not real estate values. Top-ranked properties showed
--     implausible $/SF (e.g. $12,363/SF on a 5,880 SF Maryland building).
--   • leases.annual_rent has the same pollution class on the same rows
--     (operator revenue loaded into rent column).
--   • $5M sanity cap filters out the polluted rent entries; real
--     dialysis NNN leases are $100K-$2M annually.
--
-- Broker methodology (per Scott): NOI / TTM cap rate from CM reports.
-- NOI for NNN dialysis ≈ active lease annual_rent. Cap rate from
-- cm_dialysis_cap_ttm_q (currently 7.85% Q1 2026).
--
-- Phase B-3 (deferred): join on (subspecialty, lease_term_remaining tier)
-- once the dia CM views publish term-sliced rates (today only 'all' subsp).
-- ============================================================================

CREATE OR REPLACE VIEW public.v_property_value_signal AS
WITH curr_cap AS (
  -- Latest TTM weighted cap rate. Floor of 4% protects against any
  -- zero / negative edge case producing implausible valuations.
  SELECT ttm_weighted_cap_rate AS cap
  FROM public.cm_dialysis_cap_ttm_q
  WHERE subspecialty = 'all'
    AND ttm_weighted_cap_rate IS NOT NULL
    AND ttm_weighted_cap_rate > 0
  ORDER BY period_end DESC
  LIMIT 1
)
SELECT
  p.property_id,
  COALESCE(
    -- 1. Most recent real sale within 10 years
    (SELECT s.sold_price FROM public.sales_transactions s
      WHERE s.property_id = p.property_id
        AND s.sale_date  > CURRENT_DATE - interval '10 years'
        AND s.sold_price > 100000
      ORDER BY s.sale_date DESC LIMIT 1),
    -- 2. Active listing's most recent price
    (SELECT COALESCE(al.last_price, al.initial_price)
       FROM public.available_listings al
      WHERE al.property_id = p.property_id
        AND al.is_active   = true
      ORDER BY COALESCE(al.last_seen, al.listing_date) DESC LIMIT 1),
    -- 3. NOI / cap_rate — broker methodology.
    --    annual_rent capped at $5M to filter operator-revenue pollution.
    (SELECT l.annual_rent / GREATEST((SELECT cap FROM curr_cap), 0.04)
       FROM public.leases l
      WHERE l.property_id = p.property_id
        AND l.is_active   = true
        AND l.annual_rent IS NOT NULL
        AND l.annual_rent > 1000
        AND l.annual_rent < 5000000
      ORDER BY l.lease_start DESC NULLS LAST LIMIT 1),
    -- 4. SF × $400/SF, capped at 200K SF
    (LEAST(p.building_size, 200000) * 400),
    -- 5. current_value_estimate × 0.2 (polluted column)
    (p.current_value_estimate * 0.2),
    -- 6. last_known_rent × 2 (also polluted; capped at $5M)
    (LEAST(p.last_known_rent, 5000000) * 2),
    -- 7. baseline
    1000000
  )::numeric AS rev_value
FROM public.properties p;

COMMENT ON VIEW public.v_property_value_signal IS
  'Best-available real-estate value signal per dia property. Priority: recent sale > active listing > NOI/cap (broker methodology) > SF×$400 capped > polluted columns × heavy discount > $1M baseline. NOI uses active lease annual_rent (NNN) capped at $5M to filter operator-revenue pollution. Cap rate from cm_dialysis_cap_ttm_q TTM weighted (subspecialty=all, latest period).';
