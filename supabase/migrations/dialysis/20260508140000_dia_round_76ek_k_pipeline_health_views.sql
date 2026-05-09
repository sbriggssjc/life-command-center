-- Round 76ek.k (2026-05-08) — dia DB: pipeline health view.
-- Mirror of the gov migration; the only schema difference is dia uses
-- state_of_incorporation instead of filing_state on recorded_owners.

CREATE OR REPLACE VIEW public.v_cmbs_pipeline_health AS
WITH counts AS (
  SELECT
    (SELECT count(*) FROM public.loans WHERE costar_loan_id IS NOT NULL)
      AS loans_with_costar_loan_id,
    (SELECT count(DISTINCT property_id) FROM public.loans WHERE costar_loan_id IS NOT NULL)
      AS properties_with_cmbs_loans,

    (SELECT count(*) FROM public.loan_snapshots) AS loan_snapshots_total,
    (SELECT count(DISTINCT loan_id) FROM public.loan_snapshots) AS loans_with_snapshots,
    (SELECT max(as_of_date) FROM public.loan_snapshots) AS latest_snapshot_date,

    (SELECT count(*) FROM public.loan_top_tenants) AS loan_top_tenants_total,

    (SELECT count(*) FROM public.loan_commentary) AS loan_commentary_total,
    (SELECT count(DISTINCT loan_id) FROM public.loan_commentary) AS loans_with_commentary,

    (SELECT count(*) FROM public.property_financials WHERE is_actual = true) AS property_financials_actual,
    (SELECT count(DISTINCT property_id) FROM public.property_financials WHERE is_actual = true)
      AS properties_with_financials,

    (SELECT count(*) FROM public.recorded_owners
       WHERE llc_research_at IS NOT NULL) AS owners_researched,
    (SELECT count(*) FROM public.recorded_owners
       WHERE manager_name IS NOT NULL) AS owners_with_manager,
    (SELECT count(*) FROM public.recorded_owners
       WHERE registered_agent_name IS NOT NULL) AS owners_with_agent,

    -- dia cap_rate_quality usually null (NNN cap rates aren't NOI-derived)
    -- but the columns exist for the rare modified-gross opt-in case.
    (SELECT count(*) FROM public.sales_transactions
       WHERE cap_rate_quality = 'cmbs_audited') AS caps_cmbs_audited,
    (SELECT count(*) FROM public.sales_transactions
       WHERE cap_rate_quality = 'om_actual') AS caps_om_actual,
    (SELECT count(*) FROM public.sales_transactions
       WHERE cap_rate_quality = 'om_pro_forma') AS caps_om_pro_forma,
    (SELECT count(*) FROM public.sales_transactions
       WHERE cap_rate_quality = 'market_implied') AS caps_market_implied
)
SELECT * FROM counts;

COMMENT ON VIEW public.v_cmbs_pipeline_health IS
  'Round 76ek.k: snapshot of CMBS + LLC research pipeline health (dia mirror).';

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
  'Round 76ek.k: LLC research queue depth by terminal/in-progress status (dia).';
