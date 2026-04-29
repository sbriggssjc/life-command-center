
-- ============================================================================
-- Round 76cu — CMBS loan enrichment (dia)
--
-- Round 76ct's RCA parser captures CMBS deal identifiers (e.g. "CFCRE 2016-C6",
-- "GSMS 2014-GC22") into sales_history events as cmbs_deal_name / cmbs_sponsor /
-- cmbs_vintage / cmbs_tranche. This migration adds the matching columns to
-- dia.loans + creates a CMBS portfolio rollup view so the dashboard can
-- show "X dialysis properties securitized into deal Y".
--
-- A CMBS deal is a single conduit pool that finances many properties. Tracking
-- the deal name on the loan row lets us:
--   1. Group exposure by trust on the dashboard (concentration risk)
--   2. Trace when a single deal goes into special servicing → flag every
--      property in that pool as a potential refinance / discounted-payoff
--      opportunity
--   3. Match RCA's CMBS attribution back to a borrower-identified loan
-- ============================================================================

ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS cmbs_deal_name text,
  ADD COLUMN IF NOT EXISTS cmbs_sponsor   text,
  ADD COLUMN IF NOT EXISTS cmbs_vintage   integer,
  ADD COLUMN IF NOT EXISTS cmbs_tranche   text,
  ADD COLUMN IF NOT EXISTS is_cmbs        boolean GENERATED ALWAYS AS (cmbs_deal_name IS NOT NULL) STORED;

ALTER TABLE public.loans
  DROP CONSTRAINT IF EXISTS loans_cmbs_vintage_check;
ALTER TABLE public.loans
  ADD CONSTRAINT loans_cmbs_vintage_check
  CHECK (cmbs_vintage IS NULL OR (cmbs_vintage >= 1990 AND cmbs_vintage <= 2100));

-- Quick index for the common dashboard query "all loans in deal X".
CREATE INDEX IF NOT EXISTS loans_cmbs_deal_name_idx
  ON public.loans (cmbs_deal_name)
  WHERE cmbs_deal_name IS NOT NULL;

-- Rollup view: one row per CMBS deal, with property + loan-amount aggregates.
CREATE OR REPLACE VIEW public.v_cmbs_portfolio AS
SELECT
  l.cmbs_deal_name,
  l.cmbs_sponsor,
  l.cmbs_vintage,
  COUNT(DISTINCT l.property_id)                                      AS property_count,
  COUNT(*)                                                           AS loan_count,
  SUM(l.loan_amount) FILTER (WHERE l.loan_amount > 0)                AS total_loan_amount,
  AVG(l.interest_rate_percent) FILTER (WHERE l.interest_rate_percent > 0)
                                                                     AS avg_interest_rate,
  MIN(l.origination_date)                                            AS earliest_origination,
  MAX(l.origination_date)                                            AS latest_origination,
  MIN(l.maturity_date)                                               AS earliest_maturity,
  MAX(l.maturity_date)                                               AS latest_maturity,
  array_agg(DISTINCT p.state ORDER BY p.state)
    FILTER (WHERE p.state IS NOT NULL)                               AS states,
  array_agg(DISTINCT l.property_id)                                  AS property_ids
FROM public.loans l
LEFT JOIN public.properties p ON p.property_id = l.property_id
WHERE l.cmbs_deal_name IS NOT NULL
GROUP BY l.cmbs_deal_name, l.cmbs_sponsor, l.cmbs_vintage
ORDER BY total_loan_amount DESC NULLS LAST;

COMMENT ON VIEW public.v_cmbs_portfolio IS
  'Round 76cu: one row per CMBS deal, aggregating property count + total loan amount + state spread + maturity windows. Powers the dashboard concentration-risk widget.';

COMMENT ON COLUMN public.loans.cmbs_deal_name IS
  'Round 76cu: identifier of the conduit pool (e.g. "CFCRE 2016-C6"). Captured by extension/content/rca.js from RCA Public Records. NULL for non-CMBS loans.';
COMMENT ON COLUMN public.loans.is_cmbs IS
  'Generated. True iff cmbs_deal_name is set.';
