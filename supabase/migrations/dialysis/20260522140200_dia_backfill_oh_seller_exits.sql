-- ============================================================================
-- 20260522140200_dia_backfill_oh_seller_exits.sql
-- DEVELOPER_BD_AUDIT_v3 — Phase A Topic 1 / WS3-b
--
-- Creates ownership_history rows for the SELLER side of every recorded sale
-- (where sales_transactions.seller_id was populated in WS3-a-2). The current
-- sidebar pipeline only writes buyer-side OH rows; this backfill closes the
-- seller-exit gap that hides 99.6% of pre-stabilization developers from
-- ownership-chain queries.
--
-- Pre-state on 2026-05-22: of 3,007 sales with a buyer, only 12 (0.4%) had
-- a matching ownership_history row CLOSED at the seller side. The other
-- 99.6% left the prior owner's tenure unrecorded.
--
-- Two-pass strategy:
--   PASS A — UPDATE existing OH rows where the seller already had an open
--            ownership row (rare, but possible if sidebar wrote one). Set
--            end_date to sale_date to close their tenure.
--   PASS B — INSERT new seller-exit OH rows for sellers without existing
--            coverage. start_date = NULL (we don't know acquisition) to
--            avoid the unique (property_id, start_date) index. end_date
--            carries the signal needed for the developer seller-exit rule.
-- ============================================================================

-- PASS A: close any existing open OH rows for sellers that just sold
WITH sales_with_seller AS (
  SELECT sale_id, property_id, sale_date, seller_id
  FROM public.sales_transactions
  WHERE sale_date IS NOT NULL AND seller_id IS NOT NULL
),
to_close AS (
  SELECT DISTINCT ON (oh.ownership_id)
    oh.ownership_id, sws.sale_date, sws.sale_id
  FROM sales_with_seller sws
  JOIN public.ownership_history oh
    ON oh.property_id = sws.property_id
   AND oh.recorded_owner_id = sws.seller_id
   AND (oh.end_date IS NULL OR oh.end_date > sws.sale_date)
   AND (oh.start_date IS NULL OR oh.start_date <= sws.sale_date)
  ORDER BY oh.ownership_id, sws.sale_date
)
UPDATE public.ownership_history oh
SET end_date = tc.sale_date,
    ownership_end = tc.sale_date,
    ownership_source = COALESCE(NULLIF(oh.ownership_source, ''), 'unknown')
                       || '+close_on_seller_exit',
    notes = COALESCE(oh.notes || E'\n', '')
            || 'Backfilled 2026-05-22: closed at sales_transactions.sale_id=' || tc.sale_id::text
FROM to_close tc
WHERE oh.ownership_id = tc.ownership_id;

-- PASS B: insert seller-exit rows where no existing row was closed
WITH sales_with_seller AS (
  SELECT sale_id, property_id, sale_date, sold_price, seller_id
  FROM public.sales_transactions
  WHERE sale_date IS NOT NULL AND seller_id IS NOT NULL
),
to_insert AS (
  SELECT DISTINCT
    sws.sale_id AS exit_sale_id, sws.property_id, sws.sale_date AS exit_date,
    sws.sold_price AS exit_price, sws.seller_id
  FROM sales_with_seller sws
  -- Skip orphan seller_ids that reference a non-existent recorded_owner
  WHERE EXISTS (
    SELECT 1 FROM public.recorded_owners ro
    WHERE ro.recorded_owner_id = sws.seller_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.ownership_history oh
    WHERE oh.property_id = sws.property_id
      AND oh.recorded_owner_id = sws.seller_id
      AND oh.end_date IS NOT NULL
      AND ABS(oh.end_date - sws.sale_date) <= 7
  )
)
INSERT INTO public.ownership_history (
  property_id, recorded_owner_id,
  start_date, end_date,
  ownership_start, ownership_end,
  sale_id, sold_price,
  ownership_source, notes
)
SELECT
  ti.property_id, ti.seller_id,
  NULL, ti.exit_date,                -- start_date NULL to dodge unique index
  NULL, ti.exit_date,
  NULL, ti.exit_price,               -- sale_id NULL: this row reflects the EXIT, not acquisition
  'sales_transactions_seller_exit',
  'Backfilled 2026-05-22: seller-exit OH from sales_transactions.sale_id=' || ti.exit_sale_id::text
FROM to_insert ti;
