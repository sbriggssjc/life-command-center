-- B6 (2026-05-27): nightly propagate-recompute backstop on dia.
--
-- The propagate_sale_to_property and propagate_ownership_to_property
-- functions in place today are trigger-only (they reference NEW); when
-- those triggers miss (concurrent write race, deferred trigger, hand-
-- edited row), properties.latest_* drifts vs the actual sales history.
-- Pre-flight check found 1,426 dia properties with drift.
--
-- This function backstops the triggers: finds drift, recomputes latest_*
-- from the canonical max-sale-date sales_transactions row, updates the
-- property. Safe to run repeatedly (idempotent — only writes when a
-- newer authoritative value exists, or when properties.recorded_owner_id
-- differs from the unique open ownership_history row).
--
-- Scheduled via cron.schedule('dia-propagate-recompute-tick', '30 3 * * *', ...)
-- — nightly at 03:30 UTC (off-peak).

CREATE OR REPLACE FUNCTION public.propagate_sales_recompute(p_lookback_hours int DEFAULT 24)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_sale_updated int := 0;
  v_owner_updated int := 0;
BEGIN
  -- 1. Recompute latest_* from the canonical most-recent live sale per property
  WITH live_max AS (
    SELECT DISTINCT ON (s.property_id)
      s.property_id, s.sale_date, s.sold_price, s.buyer_name, s.seller_name
    FROM public.sales_transactions s
    WHERE s.transaction_state = 'live'
      AND s.sale_date IS NOT NULL
      AND s.property_id IS NOT NULL
    ORDER BY s.property_id, s.sale_date DESC, s.sale_id DESC
  ),
  touched_recent AS (
    SELECT DISTINCT property_id
    FROM public.sales_transactions
    WHERE updated_at > now() - (p_lookback_hours || ' hours')::interval
      AND property_id IS NOT NULL
  ),
  candidates AS (
    SELECT p.property_id, lm.sale_date, lm.sold_price, lm.buyer_name, lm.seller_name
    FROM public.properties p
    JOIN live_max lm ON lm.property_id = p.property_id
    WHERE COALESCE(p.latest_deed_date, '1900-01-01'::date) < lm.sale_date
       OR p.property_id IN (SELECT property_id FROM touched_recent)
  ),
  upd_sales AS (
    UPDATE public.properties p SET
      latest_deed_date    = c.sale_date,
      latest_sale_price   = COALESCE(c.sold_price, p.latest_sale_price),
      latest_sale_grantor = COALESCE(c.seller_name, p.latest_sale_grantor),
      latest_deed_grantee = COALESCE(c.buyer_name,  p.latest_deed_grantee),
      recorded_owner_name = COALESCE(c.buyer_name,  p.recorded_owner_name),
      updated_at = now()
    FROM candidates c
    WHERE p.property_id = c.property_id
      AND (p.latest_deed_date IS DISTINCT FROM c.sale_date
        OR p.latest_sale_price IS DISTINCT FROM c.sold_price
        OR p.latest_sale_grantor IS DISTINCT FROM c.seller_name
        OR p.latest_deed_grantee IS DISTINCT FROM c.buyer_name)
    RETURNING 1
  )
  SELECT count(*) INTO v_sale_updated FROM upd_sales;

  -- 2. Recompute properties.recorded_owner_id from the unique open
  -- ownership_history row (after C5 Phase 1, multi-open=0 so this is
  -- unambiguous).
  WITH open_owner AS (
    SELECT DISTINCT ON (oh.property_id)
      oh.property_id, oh.recorded_owner_id
    FROM public.ownership_history oh
    WHERE oh.ownership_state = 'active'
      AND oh.property_id IS NOT NULL
      AND oh.recorded_owner_id IS NOT NULL
      AND COALESCE(oh.end_date, oh.ownership_end) IS NULL
    ORDER BY oh.property_id, oh.ownership_id DESC
  ),
  upd_owner AS (
    UPDATE public.properties p SET
      recorded_owner_id = oo.recorded_owner_id,
      updated_at = now()
    FROM open_owner oo
    WHERE p.property_id = oo.property_id
      AND p.recorded_owner_id IS DISTINCT FROM oo.recorded_owner_id
    RETURNING 1
  )
  SELECT count(*) INTO v_owner_updated FROM upd_owner;

  RETURN jsonb_build_object(
    'sales_propagation_fixed', v_sale_updated,
    'ownership_owner_id_fixed', v_owner_updated,
    'lookback_hours', p_lookback_hours,
    'ran_at', now()
  );
END $$;

COMMENT ON FUNCTION public.propagate_sales_recompute IS
  'B6 (2026-05-27): nightly backstop for propagate_sale_to_property + propagate_ownership_to_property triggers. Finds properties whose latest_deed_date is stale vs actual max sale_date (or were touched in past p_lookback_hours), recomputes from the canonical max-sale row. Also fixes properties.recorded_owner_id drift from the unique open ownership_history row. Idempotent.';

SELECT cron.schedule(
  'dia-propagate-recompute-tick',
  '30 3 * * *',
  $$ SELECT public.propagate_sales_recompute(48) $$
);
