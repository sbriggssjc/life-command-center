-- B6 (2026-05-27): mirror of dia.propagate_sales_recompute for gov.
--
-- Column-name differences: gov.sales_transactions uses buyer/seller
-- (not buyer_name/seller_name) and gov.properties has no recorded_owner_name
-- column. gov.ownership_history is point-in-time (transfer_date only,
-- no start/end pair), so the owner-id recompute path skips on gov.
--
-- Scheduled via cron.schedule('gov-propagate-recompute-tick', '30 3 * * *', ...)

CREATE OR REPLACE FUNCTION public.propagate_sales_recompute(p_lookback_hours int DEFAULT 24)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_sale_updated int := 0;
BEGIN
  WITH live_max AS (
    SELECT DISTINCT ON (s.property_id)
      s.property_id, s.sale_date, s.sold_price, s.buyer, s.seller
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
    SELECT p.property_id, lm.sale_date, lm.sold_price, lm.buyer, lm.seller
    FROM public.properties p
    JOIN live_max lm ON lm.property_id = p.property_id
    WHERE COALESCE(p.latest_deed_date, '1900-01-01'::date) < lm.sale_date
       OR p.property_id IN (SELECT property_id FROM touched_recent)
  ),
  upd_sales AS (
    UPDATE public.properties p SET
      latest_deed_date    = c.sale_date,
      latest_sale_price   = COALESCE(c.sold_price, p.latest_sale_price),
      latest_sale_grantor = COALESCE(c.seller,     p.latest_sale_grantor),
      latest_deed_grantee = COALESCE(c.buyer,      p.latest_deed_grantee),
      updated_at = now()
    FROM candidates c
    WHERE p.property_id = c.property_id
      AND (p.latest_deed_date IS DISTINCT FROM c.sale_date
        OR p.latest_sale_price IS DISTINCT FROM c.sold_price
        OR p.latest_sale_grantor IS DISTINCT FROM c.seller
        OR p.latest_deed_grantee IS DISTINCT FROM c.buyer)
    RETURNING 1
  )
  SELECT count(*) INTO v_sale_updated FROM upd_sales;

  RETURN jsonb_build_object(
    'sales_propagation_fixed', v_sale_updated,
    'ownership_owner_id_fixed', 0,
    'ownership_skipped_reason', 'gov.ownership_history is point-in-time only (transfer_date)',
    'lookback_hours', p_lookback_hours,
    'ran_at', now()
  );
END $$;

SELECT cron.schedule(
  'gov-propagate-recompute-tick',
  '30 3 * * *',
  $$ SELECT public.propagate_sales_recompute(48) $$
);
