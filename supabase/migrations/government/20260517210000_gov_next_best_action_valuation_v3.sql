-- ============================================================================
-- Item #4 valuation v3 (gov, 2026-05-17): NOI / cap_rate by lease term.
--
-- Gov side mirrors the dia valuation v3 with federal-property adaptations:
--   • NOI = gross_rent - current_annual_opex (when both present),
--     else gross_rent (gross-lease approximation).
--   • Cap rate from cm_gov_cap_by_term_q matched to properties.term_remaining:
--       term_remaining >= 10 → cap_10plus
--       term_remaining 6-10  → cap_6to10
--       term_remaining < 5   → cap_less5
--       else                  → cap_outside_firm
--     Most term tiers are NULL today (only cap_outside_firm populated
--     ≈ 9.76% Q1 2026); falls back to cm_gov_cap_ttm_q TTM weighted.
--
-- This commit captures the FINAL state already applied to gov
-- (scknotsqkcheojiaewwh) via Supabase MCP.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_property_value_signal AS
WITH curr_cap_all AS (
  SELECT cap_less5, cap_6to10, cap_10plus, cap_outside_firm
  FROM public.cm_gov_cap_by_term_q
  WHERE subspecialty = 'all'
  ORDER BY period_end DESC LIMIT 1
),
curr_cap_ttm AS (
  SELECT ttm_weighted_cap_rate AS cap
  FROM public.cm_gov_cap_ttm_q
  WHERE subspecialty = 'all'
    AND ttm_weighted_cap_rate IS NOT NULL
    AND ttm_weighted_cap_rate > 0
  ORDER BY period_end DESC LIMIT 1
)
SELECT
  p.property_id,
  COALESCE(
    -- 1. Recent sale within 10 years
    (SELECT s.sold_price FROM public.sales_transactions s
      WHERE s.property_id = p.property_id
        AND s.sale_date  > CURRENT_DATE - interval '10 years'
        AND s.sold_price > 100000
      ORDER BY s.sale_date DESC LIMIT 1),
    -- 2. Active listing's most recent price
    (SELECT COALESCE(al.last_price, al.asking_price)
       FROM public.available_listings al
      WHERE al.property_id    = p.property_id
        AND al.listing_status = 'Active'
      ORDER BY COALESCE(al.last_seen_at, al.listing_date) DESC LIMIT 1),
    -- 3. NOI / cap_rate by term tier (broker methodology)
    (
      CASE
        WHEN p.gross_rent IS NULL OR p.gross_rent <= 0 THEN NULL
        ELSE
          GREATEST(p.gross_rent - COALESCE(p.current_annual_opex, 0), p.gross_rent * 0.5)
          /
          GREATEST(
            COALESCE(
              CASE
                WHEN p.term_remaining IS NULL THEN NULL
                WHEN p.term_remaining >= 10   THEN (SELECT cap_10plus FROM curr_cap_all)
                WHEN p.term_remaining >=  6   THEN (SELECT cap_6to10  FROM curr_cap_all)
                WHEN p.term_remaining <   5   THEN (SELECT cap_less5  FROM curr_cap_all)
                ELSE NULL
              END,
              (SELECT cap_outside_firm FROM curr_cap_all),
              (SELECT cap              FROM curr_cap_ttm)
            ),
            0.04
          )
      END
    ),
    -- 4. estimated_value (federal valuations are real)
    p.estimated_value,
    -- 5. gross_rent × 10 (legacy cap-rate-implied)
    (p.gross_rent * 10),
    -- 6. SF × $400/SF, capped at 500K SF
    (LEAST(p.rba, 500000) * 400),
    -- 7. baseline
    1000000
  )::numeric AS rev_value
FROM public.properties p;

COMMENT ON VIEW public.v_property_value_signal IS
  'Best-available real-estate value signal per gov property. Priority: recent sale > active listing > NOI/cap by lease-term tier (broker methodology) > estimated_value > gross_rent×10 > SF×$400 capped at 500K > $1M baseline. Tier-sliced cap rates from cm_gov_cap_by_term_q; falls back to cap_outside_firm → cm_gov_cap_ttm_q.';
