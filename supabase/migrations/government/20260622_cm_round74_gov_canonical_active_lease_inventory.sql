-- =============================================================================
-- CM Round 74 — gov: ONE canonical active-lease-inventory definition (≈ 8,000).
-- Project: government-lease (scknotsqkcheojiaewwh). APPLIED LIVE 2026-06-22.
-- Implements CM_EXPORT_CHART_AUDIT_2026-06-22 Task 1 (gov leg).
--
-- PROBLEM (grounded live 2026-06-22 on gsa_leases, the GSA footprint source):
--   gsa_leases total (one row per lease_number, none superseded)        = 7,892  <- Scott's ~8,000
--   strict lease_expiration > now() AND termination_date null/future     = 4,602  <- the "Total Active
--                                                                                     Leases" / 4,734
--   leases table unexpired (a DIFFERENT table)                           =   302
-- The strict filter is wrong twice: (1) gsa_leases.termination_date is the GSA
-- "TERMN" soft-term / early-termination OPTION date (populated on most leases),
-- NOT a "this lease is dead" flag; (2) GSA holdover means an expired lease can
-- still be occupied and is still active inventory. latest_action carries no dead
-- state (New/Replacing, Succeeding, Renewal, New, Extension, Holdover 257,
-- Superseding) and zero rows are superseded by a successor.
--
-- CANONICAL DEFINITION: cm_gov_active_lease_inventory(as_of) = every current-feed
-- gsa_lease commenced by as_of (lease_effective <= as_of), IGNORING expiration and
-- termination_date (holdover stays in inventory). At as_of = today this is 7,892.
-- Reversible: re-apply the prior DDL of the two repointed views; DROP the function
-- + the new _q view.
-- =============================================================================

-- 1) The single source of truth for "active GSA lease inventory at a point in time".
CREATE OR REPLACE FUNCTION public.cm_gov_active_lease_inventory(as_of date)
RETURNS SETOF public.gsa_leases
LANGUAGE sql STABLE AS $$
  SELECT gl.*
  FROM public.gsa_leases gl
  WHERE gl.lease_effective IS NOT NULL
    AND gl.lease_effective <= as_of
    -- holdover-inclusive: expiration_date and termination_date are deliberately
    -- NOT filtered (TERMN = soft-term option date; expired-but-occupied = active).
    -- gsa_leases is already deduped to the current lease per location (no row is
    -- superseded by a successor — verified live), so no per-property dedup needed.
$$;
GRANT EXECUTE ON FUNCTION public.cm_gov_active_lease_inventory(date) TO anon, authenticated, service_role;

-- 2) Repoint Data_Inventory_State at the canonical inventory (holdover-inclusive)
--    instead of the strict expiration/termination filter. SAME column shape
--    (current top-states snapshot) so the export is unchanged; total 4,602 -> 7,892.
CREATE OR REPLACE VIEW public.cm_gov_leased_inventory_by_state AS
 WITH current_leases AS (
   SELECT gl.state, gl.lease_rsf, gl.annual_rent
   FROM public.cm_gov_active_lease_inventory(current_date) gl
   WHERE gl.state IS NOT NULL AND btrim(gl.state) <> ''
 )
 SELECT state,
    count(*) AS lease_count,
    sum(lease_rsf) AS total_rsf,
    sum(annual_rent) AS total_annual_rent,
    CASE WHEN sum(lease_rsf) > 0 THEN sum(annual_rent) / sum(lease_rsf)::numeric ELSE NULL::numeric END AS avg_rent_psf,
    rank() OVER (ORDER BY sum(lease_rsf) DESC NULLS LAST) AS rank_by_rsf
   FROM current_leases
  GROUP BY state
  ORDER BY sum(lease_rsf) DESC;

-- 3) Foundation for Scott's "stacked by state over time to ~8,000" request:
--    a quarterly time series of the canonical inventory by state. Entry-cumulative
--    (a lease counts from its commencement onward; holdover-inclusive), so it
--    builds up to the 7,892 current total. Charting it as a stacked area is a
--    catalog/template change (follow-up); the data layer is ready here.
CREATE OR REPLACE VIEW public.cm_gov_leased_inventory_by_state_q AS
 WITH q AS (
   SELECT (date_trunc('quarter', g.d) + '3 mons -1 days'::interval)::date AS period_end
   FROM generate_series('2015-01-01'::date::timestamptz, cm_last_completed_quarter_end()::timestamptz, '3 mons'::interval) g(d)
 )
 SELECT q.period_end,
    gl.state,
    count(*) AS lease_count,
    sum(gl.lease_rsf) AS total_rsf,
    sum(gl.annual_rent) AS total_annual_rent
   FROM q
   JOIN public.gsa_leases gl
     ON gl.lease_effective IS NOT NULL AND gl.lease_effective <= q.period_end
    AND gl.state IS NOT NULL AND btrim(gl.state) <> ''
  GROUP BY q.period_end, gl.state
  ORDER BY q.period_end, sum(gl.lease_rsf) DESC NULLS LAST;

-- 4) Termination-rate ACTIVE denominator: holdover-inclusive (was strict
--    expiration/termination => 4,602). total_leases_active is also the export's
--    displayed "Total Active Leases". The terminated_ttm numerator (termination_date
--    in the TTM window) is unchanged — see the audit Task-3 note on termination_date
--    semantics. Column shape unchanged.
CREATE OR REPLACE VIEW public.cm_gov_lease_termination_rate_m AS
 WITH months AS (
   SELECT (date_trunc('month', g.d) + '1 mon -1 days'::interval)::date AS period_end
   FROM generate_series('2013-01-01'::date::timestamptz, cm_last_completed_quarter_end()::timestamptz, '1 mon'::interval) g(d)
 ), active AS (
   SELECT m.period_end,
     count(gl.gsa_lease_id) AS total_leases_active,
     count(gl.gsa_lease_id) FILTER (WHERE gl.latest_action = ANY (ARRAY['Succeeding','Extension'])) AS leases_outside_firm_term
   FROM months m
   LEFT JOIN gsa_leases gl
     ON gl.lease_effective <= m.period_end   -- holdover-inclusive: no expiration/termination filter
   GROUP BY m.period_end
 ), term AS (
   SELECT m.period_end,
     count(gl.gsa_lease_id) AS terminated_ttm,
     count(gl.gsa_lease_id) FILTER (WHERE gl.latest_action = ANY (ARRAY['Succeeding','Extension'])) AS terminated_outside_firm_term
   FROM months m
   LEFT JOIN gsa_leases gl
     ON gl.termination_date > (m.period_end - '1 year'::interval)::date AND gl.termination_date <= m.period_end
   GROUP BY m.period_end
 ), base AS (
   SELECT a.period_end, a.total_leases_active, t.terminated_ttm, a.leases_outside_firm_term, t.terminated_outside_firm_term
   FROM active a JOIN term t USING (period_end)
 )
 SELECT period_end, total_leases_active, terminated_ttm, leases_outside_firm_term, terminated_outside_firm_term,
    round(avg(leases_outside_firm_term) OVER w, 1) AS avg_leases_outside_firm_term_ttm,
    CASE WHEN avg(leases_outside_firm_term) OVER w > 0::numeric
         THEN round(terminated_outside_firm_term::numeric / avg(leases_outside_firm_term) OVER w, 4)
         ELSE NULL::numeric END AS terminated_outside_firm_term_pct
   FROM base
  WINDOW w AS (ORDER BY period_end ROWS BETWEEN 11 PRECEDING AND CURRENT ROW)
  ORDER BY period_end;
