-- Round 76ek.k (2026-05-08) — gov DB: align property_financials schema +
-- pipeline-health observability views.
--
-- Two corrections in one migration:
--
-- 1. SCHEMA FIX. Round 76ek.a's CREATE TABLE IF NOT EXISTS public.property_financials
--    was a no-op against an existing 98,510-row legacy table that uses a
--    different column convention (financial_id PK; total_re_taxes / total_opex /
--    noi_psf / cap_rate_implied / data_source / confidence; no is_actual,
--    gross_income, vacancy, source, etc.). Round 76ek.e's writer
--    upsertPropertyFinancials silently failed on every gov capture because the
--    payload references columns that didn't exist. Fix: add the missing dia-
--    aligned columns. Existing legacy rows keep their own columns and have
--    NULL on the new ones; new costar_cmbs_loan / costar_financial_history
--    captures populate both shapes for forward + backward compatibility.
--
--    Cannot enforce CHECK (is_actual=true) because 98k existing rows have NULL
--    is_actual; the application-side filter still ensures new writes always
--    set is_actual=true.
--
--    The Round 76ek.e writer was also updated to use financial_id (gov) vs id
--    (dia) for primary key references — see the JS change in this round.
--
-- 2. OBSERVABILITY VIEWS. Two read-only health views give the operator a
--    one-line check on the pipeline state across all the new tables:
--
--    - v_cmbs_pipeline_health: snapshot of every metric we care about
--      (loans with costar_loan_id, snapshot count, top-tenant count,
--      commentary count, financials count, llc-research enrichment count,
--      cap_rate_quality distribution).
--
--    - v_llc_research_queue_health: queue depth by status (queued, in_progress,
--      done, failed, etc.) with retry-attempts surfacing.

BEGIN;

-- ── 1. Schema alignment: ADD the dia-aligned columns ────────────────────────
ALTER TABLE public.property_financials
  ADD COLUMN IF NOT EXISTS period_end_date         date,
  ADD COLUMN IF NOT EXISTS source                  text,
  ADD COLUMN IF NOT EXISTS is_actual               boolean,
  ADD COLUMN IF NOT EXISTS gross_income            numeric,
  ADD COLUMN IF NOT EXISTS vacancy                 numeric,
  ADD COLUMN IF NOT EXISTS effective_gross_income  numeric,
  ADD COLUMN IF NOT EXISTS operating_expenses      numeric,
  ADD COLUMN IF NOT EXISTS taxes                   numeric,
  ADD COLUMN IF NOT EXISTS insurance               numeric,
  ADD COLUMN IF NOT EXISTS cam                     numeric,
  ADD COLUMN IF NOT EXISTS capex                   numeric,
  ADD COLUMN IF NOT EXISTS source_url              text;

-- Partial unique on the new shape so re-captures upsert (matches dia table's
-- UNIQUE (property_id, fiscal_year, source)). Partial because legacy rows
-- have source IS NULL.
CREATE UNIQUE INDEX IF NOT EXISTS property_financials_propyear_source_uniq
  ON public.property_financials (property_id, fiscal_year, source)
  WHERE source IS NOT NULL;

-- ── 2. Pipeline-health observability views ──────────────────────────────────
CREATE OR REPLACE VIEW public.v_cmbs_pipeline_health AS
WITH counts AS (
  SELECT
    -- CMBS loan facts
    (SELECT count(*) FROM public.loans WHERE costar_loan_id IS NOT NULL)
      AS loans_with_costar_loan_id,
    (SELECT count(DISTINCT property_id) FROM public.loans WHERE costar_loan_id IS NOT NULL)
      AS properties_with_cmbs_loans,

    -- CMBS time-series snapshots
    (SELECT count(*) FROM public.loan_snapshots) AS loan_snapshots_total,
    (SELECT count(DISTINCT loan_id) FROM public.loan_snapshots) AS loans_with_snapshots,
    (SELECT max(as_of_date) FROM public.loan_snapshots) AS latest_snapshot_date,

    -- Top-tenants captured per snapshot
    (SELECT count(*) FROM public.loan_top_tenants) AS loan_top_tenants_total,

    -- Commentary entries
    (SELECT count(*) FROM public.loan_commentary) AS loan_commentary_total,
    (SELECT count(DISTINCT loan_id) FROM public.loan_commentary) AS loans_with_commentary,

    -- Property financials. _actual is the new pipeline's contribution;
    -- _total includes 98k legacy rows from the pre-Round-76ek ingest.
    (SELECT count(*) FROM public.property_financials WHERE is_actual = true)
      AS property_financials_actual,
    (SELECT count(DISTINCT property_id) FROM public.property_financials WHERE is_actual = true)
      AS properties_with_financials_actual,
    (SELECT count(*) FROM public.property_financials) AS property_financials_total,

    -- LLC research enrichment
    (SELECT count(*) FROM public.recorded_owners
       WHERE llc_research_at IS NOT NULL) AS owners_researched,
    (SELECT count(*) FROM public.recorded_owners
       WHERE manager_name IS NOT NULL) AS owners_with_manager,
    (SELECT count(*) FROM public.recorded_owners
       WHERE registered_agent_name IS NOT NULL) AS owners_with_agent,

    -- Cap-rate provenance distribution on sales
    (SELECT count(*) FROM public.sales_transactions WHERE cap_rate_quality = 'cmbs_audited')   AS caps_cmbs_audited,
    (SELECT count(*) FROM public.sales_transactions WHERE cap_rate_quality = 'om_actual')      AS caps_om_actual,
    (SELECT count(*) FROM public.sales_transactions WHERE cap_rate_quality = 'om_pro_forma')   AS caps_om_pro_forma,
    (SELECT count(*) FROM public.sales_transactions WHERE cap_rate_quality = 'market_implied') AS caps_market_implied
)
SELECT * FROM counts;

COMMENT ON VIEW public.v_cmbs_pipeline_health IS
  'Round 76ek.k: snapshot of CMBS + LLC research pipeline health. '
  'property_financials_total includes 98k legacy rows from a pre-Round-76ek '
  'ingest; property_financials_actual counts only Round 76ek.e captures.';

CREATE OR REPLACE VIEW public.v_llc_research_queue_health AS
SELECT
  status,
  count(*) AS row_count,
  min(created_at) AS oldest_created_at,
  max(last_attempt_at) AS most_recent_attempt,
  count(*) FILTER (WHERE attempts >= 3) AS rows_with_3plus_attempts
FROM public.llc_research_queue
GROUP BY status
ORDER BY status;

COMMENT ON VIEW public.v_llc_research_queue_health IS
  'Round 76ek.k: LLC research queue depth by status. Use to triage the '
  'llc-research-tick worker output.';

COMMIT;

-- Verification:
--   SELECT * FROM v_cmbs_pipeline_health;
--   SELECT * FROM v_llc_research_queue_health;
