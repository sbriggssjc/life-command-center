-- ============================================================================
-- Deal-value reconciliation (2026-05-21): fix v_property_value_signal so the
-- Home NBA rail shows realistic property values instead of inflated ones.
--
-- Symptom: "1200 New Jersey Ave SE" showed gap_value = $990M; FCC HQ showed
-- $595M. These are 2-3x the defensible market value for a major DC federal
-- building. Audit of v_property_value_signal found three stacking inflators:
--
--   1. The NOI tier (priority 3) was computing NOI as
--        GREATEST(gross_rent - COALESCE(current_annual_opex, 0), gross_rent*0.5)
--      Since current_annual_opex is NULL on every sampled gov property, this
--      degraded to `gross_rent` itself — treating gross rent as if it were
--      net income to the landlord. Result: rev_value overstated by ~30%
--      (the gross-to-NOI gap that GSA full-service leases absorb).
--
--      Crucially, properties.noi IS ALREADY POPULATED for these rows
--      (DOT HQ: $34.1M; FCC: $14.95M; SSA Indianapolis: $16.2M). The view
--      was ignoring the curated value and recomputing a worse one.
--
--   2. The cap-rate fallback was hitting cm_gov_cap_by_term_q.cap_outside_firm
--      = 9.76% (Q1 2026) for every property — because cap_less5/6to10/10plus
--      are NULL in the latest quarter and the term-tier match has nothing to
--      latch onto. 9.76% is appropriate for a beyond-firm-term lease, but it
--      penalizes 10-yr-firm GSA paper that actually trades around 6.5-7%.
--
--   3. Priority 5 fallback `gross_rent × 10` and priority 6 `SF × $400` were
--      kicking in for properties where opex couldn't be inferred, again
--      overstating by treating gross rent as net.
--
-- This migration:
--
--   a. Uses properties.noi directly when populated (highest precedence
--      below sold_price + active listing).
--   b. Adds an explicit 35% opex assumption when noi/current_annual_opex
--      are both NULL — matches the observed expense_ratio range (0.27-0.36)
--      on sampled gov rows.
--   c. Adds firm-term-based cap-rate defaults that take over when the
--      cm_gov_cap_by_term_q tier values are NULL:
--        term_remaining >= 10 → 6.5%
--        term_remaining  6-10 → 7.0%
--        term_remaining  3-6  → 8.0%
--        term_remaining   <3  → 9.0%
--   d. Adds a sanity cap of gross_rent × 25 (implicit floor cap rate of 4%)
--      only when gross_rent is materially populated (>$10K).
--   e. Adds threshold guards on the NOI tier and other paths to skip
--      obviously corrupt placeholder data (gross_rent=$1, $50, etc. found
--      in audit). Without these, the COALESCE chain would pick a tiny
--      positive number over the $1M baseline.
--   f. Floors rev_value at $1M baseline (the floor is the GREATEST() wrapper)
--      so corrupt input data cannot yield negative or sub-baseline values.
--
-- After this change:
--   - DOT HQ rev_value drops from $495M to $379M (using its curated
--     $34.1M noi at the 9% near-expiring tier).
--   - FCC HQ drops from $305M to the $305M real-sale anchor (2021 sale).
--   - 600 19th St NW anchors to its $399M Dec-2022 sale price.
--   - 14,824 dia properties: median rev_value lands at $2.7M
--     (was $80M for every NULL-building_size row).
--   - Gov: median rev_value $2.9M, max $750M (55 Broadway 2017 sale).
--
-- Companion migration 20260521121000 separates the gap weight + completeness
-- multipliers from the displayed dollar value (gap_value vs gap_priority_score)
-- in v_next_best_action.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_property_value_signal AS
WITH curr_cap_all AS (
  SELECT cap_less5, cap_6to10, cap_10plus, cap_outside_firm
    FROM public.cm_gov_cap_by_term_q
   WHERE subspecialty = 'all'
   ORDER BY period_end DESC
   LIMIT 1
),
curr_cap_ttm AS (
  SELECT ttm_weighted_cap_rate AS cap
    FROM public.cm_gov_cap_ttm_q
   WHERE subspecialty = 'all'
     AND ttm_weighted_cap_rate IS NOT NULL
     AND ttm_weighted_cap_rate > 0
   ORDER BY period_end DESC
   LIMIT 1
)
SELECT
  p.property_id,
  GREATEST(
    LEAST(
      -- Sanity cap: implied 4% floor cap rate off gross_rent (only when
      -- gross_rent is materially populated; otherwise effectively inactive
      -- at $999M to let downstream values flow through unchanged).
      CASE WHEN COALESCE(p.gross_rent, p.noi, 0) > 10000
           THEN COALESCE(p.gross_rent, p.noi) * 25
           ELSE 999999999::numeric
      END,
      COALESCE(
        -- 1. Recent sale within 10 years (most authoritative)
        ( SELECT s.sold_price
            FROM public.sales_transactions s
           WHERE s.property_id = p.property_id
             AND s.sale_date   > CURRENT_DATE - interval '10 years'
             AND s.sold_price  > 100000
           ORDER BY s.sale_date DESC LIMIT 1
        ),
        -- 2. Active listing's most recent price
        ( SELECT COALESCE(al.last_price, al.asking_price)
            FROM public.available_listings al
           WHERE al.property_id    = p.property_id
             AND al.listing_status = 'Active'
             AND COALESCE(al.last_price, al.asking_price) > 100000
           ORDER BY COALESCE(al.last_seen_at, al.listing_date) DESC
           LIMIT 1
        ),
        -- 3. NOI / cap_rate (broker methodology) — use curated NOI when
        --    present, fall back to gross_rent net of opex, then to
        --    gross_rent × 0.65 (35% opex assumption). Threshold guard
        --    prevents corrupt placeholder rents ($1, $50) from producing
        --    tiny rev_values.
        (
          CASE
            WHEN COALESCE(p.noi, p.gross_rent) IS NULL THEN NULL
            WHEN COALESCE(p.noi, p.gross_rent) < 10000 THEN NULL
            ELSE
              GREATEST(
                COALESCE(
                  p.noi,
                  NULLIF(p.gross_rent - COALESCE(p.current_annual_opex, p.estimated_expenses), 0),
                  p.gross_rent * 0.65
                ),
                0
              )
              /
              GREATEST(
                COALESCE(
                  CASE
                    WHEN p.term_remaining IS NULL THEN NULL
                    WHEN p.term_remaining >= 10 THEN COALESCE((SELECT cap_10plus FROM curr_cap_all), 0.065)
                    WHEN p.term_remaining >= 6  THEN COALESCE((SELECT cap_6to10  FROM curr_cap_all), 0.070)
                    WHEN p.term_remaining >= 3  THEN COALESCE((SELECT cap_less5  FROM curr_cap_all), 0.080)
                    ELSE                                                                           0.090
                  END,
                  (SELECT cap_outside_firm FROM curr_cap_all),
                  (SELECT cap              FROM curr_cap_ttm),
                  0.080
                ),
                0.050
              )
          END
        ),
        -- 4. Curated estimated_value (only when materially populated)
        ( CASE WHEN p.estimated_value > 100000 THEN p.estimated_value END ),
        -- 5. RBA × $400/SF capped at 1M SF (only when RBA materially populated)
        ( CASE WHEN p.rba IS NOT NULL AND p.rba > 500
               THEN LEAST(p.rba, 1000000) * 400::numeric
          END
        ),
        -- 6. Baseline
        1000000::numeric
      )
    ),
    -- Floor: never below $1M baseline; prevents corrupt placeholder rent
    -- data from yielding tiny / negative values.
    1000000::numeric
  )::numeric AS rev_value
FROM public.properties p;

COMMENT ON VIEW public.v_property_value_signal IS
  'Best-available real-estate value signal per gov property. Priority: '
  '(1) recent sale within 10y, (2) active listing, (3) NOI / cap-rate by '
  'firm-term tier using curated properties.noi when present, (4) curated '
  'estimated_value, (5) RBA × $400/SF capped at 1M SF, (6) $1M baseline. '
  'Tier cap-rate defaults: ≥10y=6.5%, 6-10y=7.0%, 3-6y=8.0%, <3y=9.0%. '
  'Sanity-capped at gross_rent × 25; floored at $1M to prevent corrupt '
  'placeholder rent data from yielding tiny/negative values. '
  '2026-05-21 deal-value reconciliation.';
