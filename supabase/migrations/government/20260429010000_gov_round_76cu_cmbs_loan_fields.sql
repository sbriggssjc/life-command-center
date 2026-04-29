-- ============================================================================
-- Round 76cu — CMBS loan enrichment (gov). Same shape as dia.
-- Gov loans schema differs slightly: term_years vs loan_term, interest_rate
-- vs interest_rate_percent. The CMBS columns are identical.
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

CREATE INDEX IF NOT EXISTS loans_cmbs_deal_name_idx
  ON public.loans (cmbs_deal_name)
  WHERE cmbs_deal_name IS NOT NULL;

CREATE OR REPLACE VIEW public.v_cmbs_portfolio AS
SELECT
  l.cmbs_deal_name,
  l.cmbs_sponsor,
  l.cmbs_vintage,
  COUNT(DISTINCT l.property_id)                              AS property_count,
  COUNT(*)                                                   AS loan_count,
  SUM(l.loan_amount) FILTER (WHERE l.loan_amount > 0)        AS total_loan_amount,
  AVG(l.interest_rate) FILTER (WHERE l.interest_rate > 0)    AS avg_interest_rate,
  MIN(l.origination_date)                                    AS earliest_origination,
  MAX(l.origination_date)                                    AS latest_origination,
  MIN(l.maturity_date)                                       AS earliest_maturity,
  MAX(l.maturity_date)                                       AS latest_maturity,
  array_agg(DISTINCT p.state ORDER BY p.state)
    FILTER (WHERE p.state IS NOT NULL)                       AS states,
  array_agg(DISTINCT l.property_id)                          AS property_ids
FROM public.loans l
LEFT JOIN public.properties p ON p.property_id = l.property_id
WHERE l.cmbs_deal_name IS NOT NULL
GROUP BY l.cmbs_deal_name, l.cmbs_sponsor, l.cmbs_vintage
ORDER BY total_loan_amount DESC NULLS LAST;

COMMENT ON VIEW public.v_cmbs_portfolio IS
  'Round 76cu: gov CMBS portfolio rollup.';
