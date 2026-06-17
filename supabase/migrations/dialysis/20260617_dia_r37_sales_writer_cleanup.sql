-- ============================================================================
-- 20260617_dia_r37_sales_writer_cleanup.sql
-- R37 — consolidate the price-less placeholder backlog (DIA)
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL). sale_id / dedup_group_id /
-- property_id are INTEGER/BIGINT on dia (NOT uuid — that is the only difference
-- from the gov mirror 20260617_gov_r37_sales_writer_cleanup.sql; see that file
-- header for the full rationale).
--
-- The sales writer (api/_handlers/sidebar-pipeline.js upsertDomainSales) is the
-- SHARED dia+gov writer, so dia accumulated the same price-less re-capture
-- placeholders. The ownership-change-stub mechanism appears retired on dia (0
-- rows in the 30-day audit window) but Class 1 is included for parity and
-- self-heals any residual rows.
--
-- TAG-ONLY + REVERSIBLE: snapshot prior (transaction_state, dedup_group_id)
-- into public.r37_sales_cleanup_snapshot, then reclassify. Orphan price-less
-- (no live priced sale on the property) is PRESERVED in the needs_review lane.
-- Idempotent; never touches sale_date; only moves non-live → non-live so it
-- doesn't fight the hourly sales_needs_review_tick / sales_dedup_tick crons.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Reversible snapshot (dia: sale_id / dedup_group_id are INTEGER)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.r37_sales_cleanup_snapshot (
  snap_id              bigserial PRIMARY KEY,
  sale_id              bigint  NOT NULL,
  property_id          bigint,
  classification       text    NOT NULL,   -- legacy_ownership_stub | redundant_with_live
  prior_state          text    NOT NULL,
  prior_dedup_group_id bigint,
  new_state            text    NOT NULL,
  survivor_sale_id     bigint,
  data_source          text,
  sale_date            date,
  sold_price           numeric,
  snapshotted_at       timestamptz NOT NULL DEFAULT now(),
  reverted_at          timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_r37_sales_cleanup_snapshot_open
  ON public.r37_sales_cleanup_snapshot (sale_id)
  WHERE reverted_at IS NULL;

-- ----------------------------------------------------------------------------
-- Class 1: legacy ownership-change stubs → 'ownership_stub' (run FIRST)
-- ----------------------------------------------------------------------------
WITH targets AS (
  SELECT s.sale_id, s.property_id, s.transaction_state AS prior_state,
         s.dedup_group_id AS prior_dedup_group_id,
         s.data_source, s.sale_date, s.sold_price
  FROM public.sales_transactions s
  WHERE COALESCE(s.data_source,'') LIKE 'ownership_change_stub%'
    AND s.transaction_state IN ('live','needs_review')
),
snap AS (
  INSERT INTO public.r37_sales_cleanup_snapshot
    (sale_id, property_id, classification, prior_state, prior_dedup_group_id,
     new_state, survivor_sale_id, data_source, sale_date, sold_price)
  SELECT sale_id, property_id, 'legacy_ownership_stub', prior_state, prior_dedup_group_id,
         'ownership_stub', NULL, data_source, sale_date, sold_price
  FROM targets
  ON CONFLICT (sale_id) WHERE reverted_at IS NULL DO NOTHING
  RETURNING sale_id
)
UPDATE public.sales_transactions s
   SET transaction_state = 'ownership_stub', updated_at = now()
  FROM targets t
 WHERE s.sale_id = t.sale_id;

-- ----------------------------------------------------------------------------
-- Class 2: redundant-with-live price-less rows → 'duplicate_superseded'
-- ----------------------------------------------------------------------------
WITH priced AS (
  SELECT property_id,
         (array_agg(sale_id ORDER BY sale_date DESC, sold_price DESC))[1] AS survivor_sale_id
  FROM public.sales_transactions
  WHERE transaction_state = 'live' AND sold_price > 0
  GROUP BY property_id
),
targets AS (
  SELECT s.sale_id, s.property_id, s.transaction_state AS prior_state,
         s.dedup_group_id AS prior_dedup_group_id,
         s.data_source, s.sale_date, s.sold_price, p.survivor_sale_id
  FROM public.sales_transactions s
  JOIN priced p ON p.property_id = s.property_id
  WHERE (s.sold_price IS NULL OR s.sold_price <= 0)
    AND s.transaction_state IN ('live','needs_review')
    AND COALESCE(s.data_source,'') NOT LIKE 'ownership_change_stub%'
),
snap AS (
  INSERT INTO public.r37_sales_cleanup_snapshot
    (sale_id, property_id, classification, prior_state, prior_dedup_group_id,
     new_state, survivor_sale_id, data_source, sale_date, sold_price)
  SELECT sale_id, property_id, 'redundant_with_live', prior_state, prior_dedup_group_id,
         'duplicate_superseded', survivor_sale_id, data_source, sale_date, sold_price
  FROM targets
  ON CONFLICT (sale_id) WHERE reverted_at IS NULL DO NOTHING
  RETURNING sale_id
)
UPDATE public.sales_transactions s
   SET transaction_state = 'duplicate_superseded',
       dedup_group_id    = t.survivor_sale_id,
       updated_at        = now()
  FROM targets t
 WHERE s.sale_id = t.sale_id;

-- ----------------------------------------------------------------------------
-- Audit / REVERT: identical to the gov mirror.
--   SELECT classification, count(*) FROM public.r37_sales_cleanup_snapshot
--    WHERE reverted_at IS NULL GROUP BY 1;
--
--   UPDATE public.sales_transactions s
--      SET transaction_state = snap.prior_state,
--          dedup_group_id    = snap.prior_dedup_group_id,
--          updated_at        = now()
--     FROM public.r37_sales_cleanup_snapshot snap
--    WHERE s.sale_id = snap.sale_id AND snap.reverted_at IS NULL;
--   UPDATE public.r37_sales_cleanup_snapshot SET reverted_at = now()
--    WHERE reverted_at IS NULL;
-- ----------------------------------------------------------------------------
