-- ============================================================================
-- Round 76ay — Dialysis dashboard duplicate suppression
--
-- Audit found visible dups in v_sales_comps despite Round 76ax sweep:
-- 46 portfolio-sale groups (same prop+date+buyer+seller, different prices —
-- CSV-imported portfolio allocations attached to a single property_id) +
-- 87 multi-buyer cross-attribution groups (different buyers/sellers on
-- same prop+date — separate transactions wrongly linked).
--
-- Plus: v_sales_comps was missing the exclude_from_market_metrics filter
-- (gov side already had it).
-- ============================================================================

-- ── 1. Portfolio-sale dedup (delete losers, keep MAX-priced) ───────────────
DO $$
DECLARE rewired_oh int := 0; rewired_al int := 0; rewired_sb int := 0; deleted int := 0;
BEGIN
  CREATE TEMP TABLE _portfolio_map ON COMMIT DROP AS
  WITH dup_groups AS (
    SELECT property_id, sale_date, buyer_name, seller_name FROM public.sales_transactions
    WHERE property_id IS NOT NULL AND sale_date IS NOT NULL
      AND buyer_name IS NOT NULL AND seller_name IS NOT NULL
    GROUP BY 1,2,3,4 HAVING COUNT(*) > 1
  ),
  ranked AS (
    SELECT s.sale_id, s.property_id, s.sale_date, s.buyer_name, s.seller_name,
      ROW_NUMBER() OVER (
        PARTITION BY s.property_id, s.sale_date, s.buyer_name, s.seller_name
        ORDER BY s.sold_price DESC NULLS LAST, s.sale_id
      ) AS rn,
      FIRST_VALUE(s.sale_id) OVER (
        PARTITION BY s.property_id, s.sale_date, s.buyer_name, s.seller_name
        ORDER BY s.sold_price DESC NULLS LAST, s.sale_id
      ) AS keeper_id
    FROM public.sales_transactions s
    JOIN dup_groups dg USING (property_id, sale_date, buyer_name, seller_name)
  )
  SELECT keeper_id, sale_id AS loser_id FROM ranked WHERE rn > 1;

  UPDATE public.ownership_history oh SET sale_id = pm.keeper_id
    FROM _portfolio_map pm WHERE oh.sale_id = pm.loser_id;
  GET DIAGNOSTICS rewired_oh = ROW_COUNT;

  UPDATE public.available_listings al SET sale_transaction_id = pm.keeper_id
    FROM _portfolio_map pm WHERE al.sale_transaction_id = pm.loser_id;
  GET DIAGNOSTICS rewired_al = ROW_COUNT;

  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='sale_brokers') THEN
    DELETE FROM public.sale_brokers sb
     WHERE sb.sale_id IN (SELECT loser_id FROM _portfolio_map)
       AND EXISTS (SELECT 1 FROM public.sale_brokers sb2
                    WHERE sb2.sale_id IN (SELECT keeper_id FROM _portfolio_map WHERE keeper_id <> sb.sale_id)
                      AND sb2.broker_id = sb.broker_id AND sb2.role = sb.role);
    UPDATE public.sale_brokers sb SET sale_id = pm.keeper_id
      FROM _portfolio_map pm WHERE sb.sale_id = pm.loser_id;
    GET DIAGNOSTICS rewired_sb = ROW_COUNT;
  END IF;

  DELETE FROM public.sales_transactions
   WHERE sale_id IN (SELECT loser_id FROM _portfolio_map);
  GET DIAGNOSTICS deleted = ROW_COUNT;

  RAISE NOTICE 'dia 76ay portfolio dedup: % oh, % al, % sb rewires; % deletes',
    rewired_oh, rewired_al, rewired_sb, deleted;
END $$;

-- ── 2. Dashboard-dup suppression for any (prop, date) groups still > 1 ─────
WITH dup_groups AS (
  SELECT property_id, sale_date FROM public.sales_transactions
  WHERE property_id IS NOT NULL AND sale_date IS NOT NULL
    AND COALESCE(exclude_from_market_metrics, FALSE) = FALSE
  GROUP BY 1,2 HAVING COUNT(*) > 1
),
ranked AS (
  SELECT s.sale_id,
    ROW_NUMBER() OVER (
      PARTITION BY s.property_id, s.sale_date
      ORDER BY ((s.buyer_name IS NOT NULL)::int + (s.seller_name IS NOT NULL)::int +
                (s.sold_price IS NOT NULL)::int) DESC,
               s.sold_price DESC NULLS LAST, s.sale_id
    ) AS rn
  FROM public.sales_transactions s JOIN dup_groups dg USING (property_id, sale_date)
)
UPDATE public.sales_transactions st SET exclude_from_market_metrics = TRUE
  FROM ranked r WHERE st.sale_id = r.sale_id AND r.rn > 1;

-- ── 3. Re-create v_sales_comps with exclude_from_market_metrics filter ─────
DROP MATERIALIZED VIEW IF EXISTS public.v_sales_comps CASCADE;
-- (full definition mirrors prior, with WHERE clause appended) — see
-- migration apply for the exact DDL; abbreviated here for documentation.

-- ── 4. Hygiene sweep extension — see Round 76ay-D ──────────────────────────
