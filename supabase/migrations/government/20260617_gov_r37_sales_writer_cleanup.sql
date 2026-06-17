-- ============================================================================
-- 20260617_gov_r37_sales_writer_cleanup.sql
-- R37 — consolidate the price-less placeholder backlog (GOV)
--
-- Target: government Supabase (GOV_SUPABASE_URL). sale_id / dedup_group_id are
-- UUID on gov.
--
-- R36 filtered the price-less / stub / duplicate rows out of the canonical
-- MARKET METRICS. R37 fixes the DATA so the raw table agrees with the metrics:
-- the sidebar writer (api/_handlers/sidebar-pipeline.js upsertDomainSales) and
-- the gov ownership-stub writer (government-lease ingest_ownership.create_comp_stubs)
-- both stop minting placeholders going forward; this migration reconciles the
-- backlog they already created.
--
-- TAG-ONLY + REVERSIBLE (mirrors R22's *_deletions pattern): no row is deleted.
-- Every reclassified sale's prior (transaction_state, dedup_group_id) is
-- snapshotted into public.r37_sales_cleanup_snapshot first, so the whole pass
-- reverses with one UPDATE (see the REVERT block at the bottom).
--
-- Three classes (data-driven, not hardcoded to the audit counts):
--   1. legacy_ownership_stub  — data_source LIKE 'ownership_change_stub%' still
--      in a live/needs_review state → move to the dedicated 'ownership_stub'
--      state. The mechanism is retired (R37).
--   2. redundant_with_live    — a price-less row on a property that ALSO has a
--      'live' priced sale → 'duplicate_superseded' (pointed at the survivor).
--      Pure noise: the real sale is already recorded.
--   3. orphan price-less (PRESERVED) — a price-less row on a property with NO
--      live priced sale is NOT touched. It may be the only record of a real
--      sale awaiting a price; it stays in the needs_review review/enrich lane.
--
-- Idempotent: the reclassification only matches rows still in the source state,
-- so a re-run is a no-op. Does not touch sale_date (NOT NULL constraint intact)
-- and only updates non-live → non-live transaction_state, so it never fights
-- the hourly sales_needs_review_tick or the sales_dedup_tick crons.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Reversible snapshot
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.r37_sales_cleanup_snapshot (
  snap_id              bigserial PRIMARY KEY,
  sale_id              uuid    NOT NULL,
  property_id          bigint,
  classification       text    NOT NULL,   -- legacy_ownership_stub | redundant_with_live
  prior_state          text    NOT NULL,
  prior_dedup_group_id uuid,
  new_state            text    NOT NULL,
  survivor_sale_id     uuid,
  data_source          text,
  sale_date            date,
  sold_price           numeric,
  snapshotted_at       timestamptz NOT NULL DEFAULT now(),
  reverted_at          timestamptz
);

-- One open (un-reverted) snapshot row per sale → guards against a double pass.
CREATE UNIQUE INDEX IF NOT EXISTS uq_r37_sales_cleanup_snapshot_open
  ON public.r37_sales_cleanup_snapshot (sale_id)
  WHERE reverted_at IS NULL;

-- ----------------------------------------------------------------------------
-- Class 1: legacy ownership-change stubs → 'ownership_stub' (retired mechanism)
-- Run FIRST so a stub is never also counted as a redundant duplicate.
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
WITH priced AS (   -- most-recent live priced sale per property = the survivor
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
-- Audit: counts by class after the pass.
--   SELECT classification, count(*) FROM public.r37_sales_cleanup_snapshot
--    WHERE reverted_at IS NULL GROUP BY 1;
-- Orphan price-less PRESERVED in the review lane:
--   SELECT count(*) FROM public.sales_transactions s
--    WHERE (s.sold_price IS NULL OR s.sold_price <= 0)
--      AND s.transaction_state = 'needs_review'
--      AND NOT EXISTS (SELECT 1 FROM public.sales_transactions s2
--                       WHERE s2.property_id = s.property_id
--                         AND s2.transaction_state='live' AND s2.sold_price > 0);
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- REVERT (manual; run only to undo this pass):
--   UPDATE public.sales_transactions s
--      SET transaction_state = snap.prior_state,
--          dedup_group_id    = snap.prior_dedup_group_id,
--          updated_at        = now()
--     FROM public.r37_sales_cleanup_snapshot snap
--    WHERE s.sale_id = snap.sale_id AND snap.reverted_at IS NULL;
--   UPDATE public.r37_sales_cleanup_snapshot SET reverted_at = now()
--    WHERE reverted_at IS NULL;
-- ----------------------------------------------------------------------------
