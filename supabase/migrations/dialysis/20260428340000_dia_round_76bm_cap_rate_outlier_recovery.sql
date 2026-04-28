-- ============================================================================
-- Round 76bm — Cap-rate outlier recovery
--
-- After Round 76bl rounded float-precision noise, audit found 8 listings +
-- 1 sale with cap_rate > 20% and 54 listings + 21 sales with cap_rate <
-- 2%. Most have a sibling column (initial_cap_rate, current_cap_rate,
-- last_cap_rate, stated_cap_rate) that holds the correct value while the
-- main cap_rate field is corrupted from a bad calculation.
--
-- E.g. listing 8662: cap_rate=22.57% but initial_cap_rate=7.00%; listing
-- 8397: cap_rate=1.98% but initial_cap_rate=5.09%. The siblings are right.
--
-- Strategy: when main cap_rate is out of [3%, 15%] AND a sibling is in
-- range, copy the sibling. When no sibling is reasonable, NULL the cap_rate.
-- ============================================================================

UPDATE public.available_listings al
   SET cap_rate = COALESCE(initial_cap_rate, current_cap_rate, last_cap_rate)
 WHERE cap_rate > 0.20
   AND (initial_cap_rate BETWEEN 0.03 AND 0.15
        OR current_cap_rate BETWEEN 0.03 AND 0.15
        OR last_cap_rate BETWEEN 0.03 AND 0.15);

UPDATE public.available_listings al
   SET cap_rate = NULL
 WHERE cap_rate > 0.20
   AND COALESCE(initial_cap_rate, current_cap_rate, last_cap_rate) IS NULL;

UPDATE public.sales_transactions
   SET cap_rate = stated_cap_rate
 WHERE cap_rate > 0.20 AND stated_cap_rate BETWEEN 0.03 AND 0.15;

UPDATE public.sales_transactions
   SET cap_rate = NULL
 WHERE cap_rate > 0.20 AND (stated_cap_rate IS NULL OR stated_cap_rate > 0.20);
