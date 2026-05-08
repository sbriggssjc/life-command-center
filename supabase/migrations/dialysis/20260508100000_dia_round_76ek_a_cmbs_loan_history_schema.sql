-- Round 76ek.a — dialysis DB CMBS loan-history schema (mirror of gov).
--
-- Dialysis deals are typically NN/NNN, so cap rates are computed off net
-- rent and the CMBS NOI/DSCR detail rarely matters. The exception is a
-- handful of multi-tenant modified-gross deals where it does. Rather than
-- silently store CMBS snapshots for every dia property, this migration
-- adds an opt-in flag (dia.properties.track_cmbs_snapshots) so the sidebar
-- pipeline only fans out snapshot/top-tenant/financial rows for properties
-- that have been explicitly flagged.
--
-- Loan record metadata + dated commentary entries DO write for every dia
-- property, regardless of the flag — those are cheap and useful BD context
-- everywhere (e.g. who's the lender, what's the prepayment status).
--
-- This mirrors gov's schema with one important difference: dia.loans uses
-- `loan_id INTEGER` (not UUID), so the FKs from the new tables are typed
-- accordingly. dia.sales_transactions already has cap_rate_method,
-- cap_rate_notes, cap_rate_confidence, stated_cap_rate, calculated_cap_rate,
-- rent_at_sale, rent_source — we add only the new noi_source_* + quality
-- columns to keep the four-tier audited / om_actual / om_pro_forma /
-- market_implied ladder consistent with gov.

BEGIN;

-- ── 1. dia.loans column extensions (only the CMBS-specific subset) ──────────
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

-- ── 2. dia.properties opt-in flag ───────────────────────────────────────────
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS track_cmbs_snapshots boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.properties.track_cmbs_snapshots IS
  'Round 76ek.a: opt-in flag for CMBS snapshot / top-tenant / property_financials '
  'fan-out from costar sidebar capture. Default off because dia is mostly NNN. '
  'Set true on the rare modified-gross multi-tenant deals where CMBS NOI matters.';

-- ── 3a. dia.loan_snapshots ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.loan_snapshots (
  snapshot_id      bigserial PRIMARY KEY,
  loan_id          integer NOT NULL
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

-- ── 3b. dia.loan_top_tenants ────────────────────────────────────────────────
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

-- ── 3c. dia.loan_commentary ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.loan_commentary (
  id               bigserial PRIMARY KEY,
  loan_id          integer NOT NULL
                     REFERENCES public.loans(loan_id) ON DELETE CASCADE,
  rank             integer,
  entry_date       date,
  entry_label      text,
  body             text NOT NULL,
  data_source      text DEFAULT 'costar_cmbs_loan',
  source_url       text,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS loan_commentary_loan_id_idx
  ON public.loan_commentary (loan_id);
CREATE INDEX IF NOT EXISTS loan_commentary_entry_date_idx
  ON public.loan_commentary (entry_date);

CREATE UNIQUE INDEX IF NOT EXISTS loan_commentary_loan_label_uniq
  ON public.loan_commentary (loan_id, entry_label)
  WHERE entry_label IS NOT NULL;

-- ── 4. dia.property_financials ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.property_financials (
  id                       bigserial PRIMARY KEY,
  property_id              integer NOT NULL
                             REFERENCES public.properties(property_id) ON DELETE CASCADE,
  fiscal_year              integer NOT NULL,
  period_end_date          date,
  source                   text NOT NULL DEFAULT 'costar_cmbs_loan',
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

-- ── 5. cap-rate provenance on dia.sales_transactions ────────────────────────
-- dia.sales_transactions already carries cap_rate_method / cap_rate_notes /
-- cap_rate_confidence / stated_cap_rate / calculated_cap_rate / rent_source.
-- The new fields complete the picture:
--   - cap_rate_noi_source_table / cap_rate_noi_source_id: pointer to the
--     loan_snapshot or property_financials row whose NOI fed the cap_rate.
--   - cap_rate_quality: the four-tier ladder shared with gov.
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
