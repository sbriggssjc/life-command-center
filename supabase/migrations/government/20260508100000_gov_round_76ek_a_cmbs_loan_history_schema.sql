-- Round 76ek.a — government DB CMBS loan-history schema.
--
-- The CoStar Loan Details page (product.costar.com/detail/lookup/{N}/loan)
-- exposes time-series CMBS data we currently do not capture:
--   - NOI / DSCR / debt-service / occupancy as-of-date snapshots
--   - top-tenant rent-roll snapshots (tenant + expiration + occupied SF) at each
--     CMBS reporting date
--   - dated commentary entries (e.g. "Delinquency – December 2020: …")
--   - servicer / special servicer / sponsor / multiple historical loans per
--     property
--
-- Government deals are full-service / modified-gross, so cap rates are
-- computed off NOI rather than net rent. CMBS-grade NOI is the most
-- authoritative source we get, and we want every reporting snapshot so we can
-- model historical NOI / DSCR / occupancy trends and feed cap-rate provenance.
--
-- This migration:
--   1. Extends gov.loans with the few CMBS-specific fields it doesn't already
--      cover (servicer, special_servicer, sponsor, watchlist, etc.).
--   2. Adds three child tables for the time-series payload:
--        gov.loan_snapshots          — one row per CMBS reporting date
--        gov.loan_top_tenants        — one row per tenant per snapshot
--        gov.loan_commentary         — one row per dated narrative entry
--   3. Adds gov.property_financials  — actual operating financials by year.
--      MARKET / submarket-AVERAGE rows are explicitly rejected at the parser
--      layer and never reach this table; everything here is is_actual=true.
--   4. Adds cap-rate provenance columns on gov.sales_transactions so each
--      cap_rate row points at the NOI source it was computed from.
--
-- All FKs ON DELETE CASCADE so wiping a loan/snapshot purges its dependents.

BEGIN;

-- ── 1. gov.loans column extensions ──────────────────────────────────────────
ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS originator           text,
  ADD COLUMN IF NOT EXISTS servicer             text,
  ADD COLUMN IF NOT EXISTS special_servicer     text,
  ADD COLUMN IF NOT EXISTS sponsor              text,
  ADD COLUMN IF NOT EXISTS num_delinquent       integer,
  ADD COLUMN IF NOT EXISTS modification         boolean,
  ADD COLUMN IF NOT EXISTS watchlist            text,
  ADD COLUMN IF NOT EXISTS special_servicing    text,
  ADD COLUMN IF NOT EXISTS status_at_disposal   text,
  ADD COLUMN IF NOT EXISTS balloon_maturity     boolean,
  ADD COLUMN IF NOT EXISTS pay_frequency        text,
  ADD COLUMN IF NOT EXISTS num_collateral       integer,
  ADD COLUMN IF NOT EXISTS pct_of_total_loan    numeric,
  ADD COLUMN IF NOT EXISTS origination_appraisal numeric,
  ADD COLUMN IF NOT EXISTS appraisal_date       date,
  ADD COLUMN IF NOT EXISTS costar_loan_id       text,
  ADD COLUMN IF NOT EXISTS source_url           text;

CREATE UNIQUE INDEX IF NOT EXISTS loans_costar_loan_id_uniq
  ON public.loans (costar_loan_id)
  WHERE costar_loan_id IS NOT NULL;

-- ── 2a. gov.loan_snapshots ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.loan_snapshots (
  snapshot_id      bigserial PRIMARY KEY,
  loan_id          uuid NOT NULL
                     REFERENCES public.loans(loan_id) ON DELETE CASCADE,
  as_of_date       date NOT NULL,
  noi              numeric,
  noi_dscr         numeric,
  debt_service     numeric,
  gla              numeric,
  occupied_sf      numeric,
  occupancy_pct    numeric,
  loan_balance     numeric,
  data_source      text DEFAULT 'costar_cmbs_loan',
  source_url       text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  UNIQUE (loan_id, as_of_date)
);

CREATE INDEX IF NOT EXISTS loan_snapshots_loan_id_idx
  ON public.loan_snapshots (loan_id);
CREATE INDEX IF NOT EXISTS loan_snapshots_as_of_date_idx
  ON public.loan_snapshots (as_of_date);

-- ── 2b. gov.loan_top_tenants ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.loan_top_tenants (
  id               bigserial PRIMARY KEY,
  snapshot_id      bigint NOT NULL
                     REFERENCES public.loan_snapshots(snapshot_id) ON DELETE CASCADE,
  rank             integer,
  tenant_name      text NOT NULL,
  expiration_date  date,
  occupied_sf      numeric,
  data_source      text DEFAULT 'costar_cmbs_loan',
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS loan_top_tenants_snapshot_id_idx
  ON public.loan_top_tenants (snapshot_id);

-- ── 2c. gov.loan_commentary ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.loan_commentary (
  id               bigserial PRIMARY KEY,
  loan_id          uuid NOT NULL
                     REFERENCES public.loans(loan_id) ON DELETE CASCADE,
  rank             integer,
  entry_date       date,
  entry_label      text,                 -- "Delinquency – December 2020"
  body             text NOT NULL,
  data_source      text DEFAULT 'costar_cmbs_loan',
  source_url       text,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS loan_commentary_loan_id_idx
  ON public.loan_commentary (loan_id);
CREATE INDEX IF NOT EXISTS loan_commentary_entry_date_idx
  ON public.loan_commentary (entry_date);

-- The (loan_id, entry_label) combo is the natural identity but `entry_label`
-- can be NULL on free-form entries. Use a partial unique index only on the
-- labelled subset to avoid false dedup-collisions on NULL labels.
CREATE UNIQUE INDEX IF NOT EXISTS loan_commentary_loan_label_uniq
  ON public.loan_commentary (loan_id, entry_label)
  WHERE entry_label IS NOT NULL;

-- ── 3. gov.property_financials ──────────────────────────────────────────────
-- Actual operating financials only. Parser-side filter rejects market /
-- submarket avg rows; this table assumes is_actual=true on every insert.
CREATE TABLE IF NOT EXISTS public.property_financials (
  id                       bigserial PRIMARY KEY,
  property_id              bigint NOT NULL
                             REFERENCES public.properties(property_id) ON DELETE CASCADE,
  fiscal_year              integer NOT NULL,
  period_end_date          date,
  source                   text NOT NULL DEFAULT 'costar_cmbs_loan',
                                    -- 'costar_cmbs_loan' | 'costar_financial_history'
                                    -- | 'om_actual' | 'manual'
  is_actual                boolean NOT NULL DEFAULT true
                             CHECK (is_actual = true),
  gross_income             numeric,
  vacancy                  numeric,
  effective_gross_income   numeric,
  operating_expenses       numeric,
  taxes                    numeric,
  insurance                numeric,
  cam                      numeric,
  noi                      numeric,
  capex                    numeric,
  notes                    text,
  source_url               text,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now(),
  UNIQUE (property_id, fiscal_year, source)
);

CREATE INDEX IF NOT EXISTS property_financials_property_id_idx
  ON public.property_financials (property_id);
CREATE INDEX IF NOT EXISTS property_financials_fiscal_year_idx
  ON public.property_financials (fiscal_year);

-- ── 4. cap-rate provenance on gov.sales_transactions ────────────────────────
ALTER TABLE public.sales_transactions
  ADD COLUMN IF NOT EXISTS cap_rate_noi_source_table text,
  ADD COLUMN IF NOT EXISTS cap_rate_noi_source_id    bigint,
  ADD COLUMN IF NOT EXISTS cap_rate_quality          text;

ALTER TABLE public.sales_transactions
  DROP CONSTRAINT IF EXISTS sales_transactions_cap_rate_quality_check;

ALTER TABLE public.sales_transactions
  ADD CONSTRAINT sales_transactions_cap_rate_quality_check
    CHECK (cap_rate_quality IS NULL
        OR cap_rate_quality IN ('cmbs_audited','om_actual','om_pro_forma','market_implied'));

COMMIT;

-- Verification:
--   SELECT to_regclass('public.loan_snapshots'),
--          to_regclass('public.loan_top_tenants'),
--          to_regclass('public.loan_commentary'),
--          to_regclass('public.property_financials');
--   SELECT column_name
--     FROM information_schema.columns
--    WHERE table_name='loans' AND column_name IN ('servicer','sponsor','watchlist');
--   SELECT column_name
--     FROM information_schema.columns
--    WHERE table_name='sales_transactions' AND column_name LIKE 'cap_rate_%';
