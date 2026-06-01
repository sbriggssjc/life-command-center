-- =============================================================================
-- Migration: cm_gov_cap_by_credit_q — R66e credit classifier accuracy
-- Project:   government (scknotsqkcheojiaewwh)
-- Date:       2026-06-01
--
-- Audit fix #2 (gov credit tiers). KEY FINDING: the gov-leased portfolio is
-- ~95% FEDERAL by nature (SSA/GSA/FBI/DEA/ICE/IRS/CBP/VA/USPS...). The "missing
-- state/municipal" symptom was NOT mainly a classifier bug — state (~14-24 real)
-- and municipal (~33 real) deals are genuinely rare in this data. But the
-- classifier did have real ERRORS we fixed:
--   * Federal misses now recovered (spelled-out "General Services Administration",
--     VA clinics, Military Entrance/MEPS, NOAA, Coast Guard, Border Patrol, Dept
--     of Energy, acronyms USGS/BLM/NPS/FWS/MSHA/AOC/DOJ/DOD/DHS/CBP/ICE/USCIS/FEC,
--     OSHA, courthouse, field office). Federal 2,104 -> 2,131.
--   * government_type 'local' now maps to MUNICIPAL (was state); city/county
--     agency strings now classify municipal. Municipal lines now render in 28
--     quarters (was ~0).
--   * State de-polluted (federal "U.S. Department of Labor" no longer leaks in);
--     state now ~14 clean real "State of X" deals (11 quarters).
--   * Non-government tenants (Fresenius, LLCs, Amazon, Aramark, Regus, etc.) are
--     correctly left UNCLASSIFIED (dropped from the credit chart).
--
-- HONEST LIMIT: state/municipal lines remain THIN because the underlying
-- portfolio is federal — not a code bug. To match the master's fuller state/muni
-- lines, capture more state/local comps OR hand-enter a credit_tier at intake
-- (the master hand-enters TYPE on every comp). Column contract unchanged.
-- Validated read-only + applied to prod 2026-06-01.
-- =============================================================================
CREATE OR REPLACE VIEW public.cm_gov_cap_by_credit_q AS
 WITH base AS (
   SELECT (date_trunc('quarter', s.sale_date::timestamptz) + '3 mons -1 days'::interval)::date AS period_end,
     s.sale_date,
     CASE WHEN s.cap_rate_quality = 'implausible_unverified' THEN NULL::numeric ELSE s.sold_cap_rate END AS cap,
     CASE
       WHEN lower(s.government_type) ~~* '%municipal%' OR lower(s.government_type) ~~* '%local%' THEN 'municipal'
       WHEN lower(s.government_type) ~~* '%state%' THEN 'state'
       WHEN lower(s.government_type) ~~* '%federal%' THEN 'federal'
       WHEN s.agency ~* '(\mu\.?s\.?\M|united states|^gsa|\mgsa\M|general services admin|federal|national|department of (defense|justice|energy|labor|transportation|veterans|homeland|the treasury)|veterans|\mva\M|va clinic|va outpatient|va medical|homeland|treasury|\mfbi\M|\mirs\M|\musda\M|\musgs\M|\musps\M|postal|social security|\mssa\M|customs|immigration|\mice\M|\muscis\M|\mcbp\M|\mepa\M|\mfda\M|\mdea\M|drug enforcement|\mdoj\M|\mdod\M|\mdhs\M|\matf\M|\mblm\M|\mnps\M|\mfws\M|\mmsha\M|\maoc\M|\mfec\M|\mnoaa\M|oceanic and atmospheric|forest service|army|navy|naval|air force|coast guard|border patrol|bureau of|military entrance|\mmeps\M|\mosha\M|courthouse|substance abuse and mental health|field office)' THEN 'federal'
       WHEN s.agency ~* '(county of|\mcounty\M|city of|\mcity\M|town of|village of|borough of|municipal|public schools|metropolitan|council of governments|sheriff|public works)' THEN 'municipal'
       WHEN s.agency ~* '(state of|commonwealth of|district of columbia|department of (administration|family|protective|child support|corrections|revenue)|state properties|\mstate\M|board of cooperative)' THEN 'state'
       ELSE NULL
     END AS credit_class
   FROM sales_transactions s
   WHERE s.sale_date IS NOT NULL AND s.sold_price IS NOT NULL AND s.sold_price > 0
     AND s.sold_cap_rate IS NOT NULL AND s.sold_cap_rate >= 0.04 AND s.sold_cap_rate <= 0.12
     AND s.sale_date <= cm_last_completed_quarter_end()
 ), quarters AS (SELECT DISTINCT period_end FROM base),
 ttm AS (
   SELECT q.period_end,
     avg(b.cap) FILTER (WHERE b.credit_class='federal')   AS federal_avg,
     count(*)   FILTER (WHERE b.credit_class='federal')   AS federal_n,
     avg(b.cap) FILTER (WHERE b.credit_class='state')     AS state_avg,
     count(*)   FILTER (WHERE b.credit_class='state')     AS state_n,
     avg(b.cap) FILTER (WHERE b.credit_class='municipal') AS muni_avg,
     count(*)   FILTER (WHERE b.credit_class='municipal') AS muni_n
   FROM quarters q
   LEFT JOIN base b ON b.sale_date > (q.period_end - '1 year'::interval)::date AND b.sale_date <= q.period_end
   GROUP BY q.period_end
 )
 SELECT period_end, 'all'::text AS subspecialty,
   CASE WHEN federal_n >= 3 THEN federal_avg END AS federal_cap,
   CASE WHEN state_n   >= 2 THEN state_avg   END AS state_cap,
   CASE WHEN muni_n    >= 2 THEN muni_avg    END AS municipal_cap
 FROM ttm ORDER BY period_end;
