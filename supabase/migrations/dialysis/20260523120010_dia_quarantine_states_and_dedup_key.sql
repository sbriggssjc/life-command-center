-- ============================================================================
-- 20260523120010_dia_quarantine_states_and_dedup_key.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — Foundation F2 + Track C1 prep (dia)
--
-- Adds quarantine columns so Track A cleanup can tag rows rather than
-- deleting them. Per Decision #2, duplicate_superseded rows are retained
-- indefinitely.
--
--   sales_transactions.transaction_state       text  (default 'live')
--   sales_transactions.dedup_group_id          uuid  (points at survivor.sale_id)
--   sales_transactions.dedup_natural_key       text  (generated; basis for C1 UNIQUE)
--   ownership_history.ownership_state          text  (default 'active')
--
-- The dedup_natural_key is built so that legitimate same-property /
-- same-month / similar-price sales collide (catching the cross-source
-- duplicate pattern in DATA_INTEGRITY_AUDIT DQ-2). The actual UNIQUE index
-- enforcing this is added in C1 (separate migration) once the existing
-- duplicates have been quarantined by Track A.
--
-- Safe to apply with no behavior change: defaults populate all existing
-- rows in the 'live' / 'active' lane and the generated key is computed
-- automatically.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- sales_transactions: transaction_state + dedup_group_id + dedup_natural_key
-- ----------------------------------------------------------------------------
ALTER TABLE public.sales_transactions
  ADD COLUMN IF NOT EXISTS transaction_state TEXT NOT NULL DEFAULT 'live';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sales_transactions'::regclass
      AND conname = 'chk_sales_transaction_state'
  ) THEN
    ALTER TABLE public.sales_transactions
      ADD CONSTRAINT chk_sales_transaction_state
      CHECK (transaction_state IN (
        'live','duplicate_superseded','ownership_stub',
        'quarantined_implausible','needs_review'
      ));
  END IF;
END $$;

ALTER TABLE public.sales_transactions
  ADD COLUMN IF NOT EXISTS dedup_group_id UUID;

COMMENT ON COLUMN public.sales_transactions.dedup_group_id IS
  'When a row is duplicate_superseded, points at the survivor sale_id within the dedup group. NULL for live survivors.';

-- Generated dedup key: property_id + price rounded to nearest 1k + sale-month.
-- Robust to small price drift (closing vs deed amount) and to recording-date
-- drift within the same month.
--
-- Implementation notes (GENERATED ALWAYS requires IMMUTABLE expressions):
--   * to_char(date,'YYYY-MM') is STABLE (locale-dependent) — avoid.
--   * concat_ws() is also STABLE — avoid; use plain `||` instead.
--   * EXTRACT, lpad, round are IMMUTABLE.
ALTER TABLE public.sales_transactions
  ADD COLUMN IF NOT EXISTS dedup_natural_key TEXT
    GENERATED ALWAYS AS (
      CASE
        WHEN property_id IS NULL OR sold_price IS NULL OR sale_date IS NULL THEN NULL
        ELSE property_id::text
             || '|'
             || lpad((round(sold_price/1000.0)*1000)::bigint::text, 12, '0')
             || '|'
             || EXTRACT(YEAR FROM sale_date)::text
             || '-'
             || lpad(EXTRACT(MONTH FROM sale_date)::text, 2, '0')
      END
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_sales_transactions_dedup_key
  ON public.sales_transactions (dedup_natural_key)
  WHERE transaction_state = 'live' AND dedup_natural_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_transactions_state
  ON public.sales_transactions (transaction_state)
  WHERE transaction_state <> 'live';

-- ----------------------------------------------------------------------------
-- ownership_history: ownership_state
-- ----------------------------------------------------------------------------
ALTER TABLE public.ownership_history
  ADD COLUMN IF NOT EXISTS ownership_state TEXT NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ownership_history'::regclass
      AND conname = 'chk_ownership_state'
  ) THEN
    ALTER TABLE public.ownership_history
      ADD CONSTRAINT chk_ownership_state
      CHECK (ownership_state IN (
        'active','superseded','orphan_no_property','needs_review'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ownership_history_state
  ON public.ownership_history (ownership_state)
  WHERE ownership_state <> 'active';
