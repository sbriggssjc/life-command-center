-- Topic 15 (audit §11.32): slim anon-readable sales_transactions view
-- for the LCC listing-event watcher.
--
-- gov.sales_transactions is RLS-protected. The LCC watcher needs a
-- non-PII subset to populate lcc_listing_events. This view exposes
-- only the deal-shape columns (sale_id, property_id, dates, price,
-- buyer/seller names, cap rate, source) and grants anon SELECT,
-- mirroring the existing §11.23 / §11.28 patterns.
--
-- Buyer/seller NAMES are kept (already publicly visible from county
-- deed records that gov.sales_transactions ingests). Anything beyond
-- that — contact info, notes, internal commentary — stays behind RLS.

BEGIN;

DROP VIEW IF EXISTS public.v_sales_transactions_portfolio;

-- Note: gov.sales_transactions uses sold_price/buyer/seller/sold_cap_rate
-- (vs dia's sale_price/buyer_name/seller_name/cap_rate). Aliased to a
-- common shape here so the LCC watcher can use the same pg_net pull
-- shape against both domains.
CREATE VIEW public.v_sales_transactions_portfolio AS
SELECT
  sale_id,
  property_id,
  sale_date,
  sold_price       AS sale_price,
  buyer            AS buyer_name,
  seller           AS seller_name,
  sold_cap_rate    AS cap_rate,
  data_source,
  created_at,
  updated_at
FROM public.sales_transactions
WHERE property_id IS NOT NULL
  AND sale_date IS NOT NULL;

GRANT SELECT ON public.v_sales_transactions_portfolio TO anon, authenticated;

COMMENT ON VIEW public.v_sales_transactions_portfolio IS
  'Non-PII deal-shape slice of sales_transactions for LCC listing-event '
  'watcher. SECURITY DEFINER (default) so anon can read while '
  'sales_transactions itself stays RLS-protected.';

COMMIT;
