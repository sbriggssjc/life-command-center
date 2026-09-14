-- =============================================================================
-- Government credit-tier classifier — recover mislabeled State / Federal tenants
-- Project: government (scknotsqkcheojiaewwh)
-- Date: 2026-08-12
--
-- Purpose (Cap Rate by Credit Tier chart — "get more state/municipal sales in"):
--   The text classifier in gov_credit_buckets_from_text() already buckets ~97.6%
--   of in-band gov sales, but a residual pool of GENUINE state agencies (and two
--   federal power administrations) were never matched, so their sales never
--   reached cm_gov_cap_by_credit_q. Grounded live 2026-08-12 against the 78
--   in-band, un-bucketed sales: every recoverable row is a real government
--   tenant (validated by hand — 0 private-company matches):
--     STATE  (net-new 13 sales): Dept of Law Enforcement (FDLE), Dept of
--       Commerce, Social Services (VA/Riverside/San Bernardino/AL DHR),
--       Economic Security (AZ DES), Consumer Affairs, Children & Family Services
--       (IL DCFS), Probation & Parole (VA Beach), Disability Determination
--       Services (Utah DDS), Dept of Human Resources (Mobile/AL DHR), Motor
--       Vehicles (CA/GA DMV), Employment Security, Vocational Rehabilitation.
--     FEDERAL (net-new 2 sales): Western Area Power Administration (a DOE Power
--       Marketing Administration — federal).
--
--   This is an ADDITIVE, conservative widening of the classifier only. It never
--   mutates sales_transactions; cm_gov_sale_credit_bucket_expanded and
--   cm_gov_cap_by_credit_q/_m pick up the new buckets on the next read (the CM
--   export reads the views per request, no-store — live immediately, no deploy).
--
--   Discipline: conservative (only unambiguous government agency phrases; no
--   private-tenant over-match — verified live), never-fabricate, reversible
--   (re-apply the prior 20260811124435 body of this function to revert).
--
--   Deliberately NOT added (federal-contamination / low-value risk):
--     * "department of agriculture" / "attorney general" — collide with federal
--       USDA / U.S. Attorney text and would double-bucket a federal sale into
--       state (recovered 0 real state rows in the live pool anyway).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.gov_credit_buckets_from_text(
  p_text text,
  p_government_type text DEFAULT NULL
)
RETURNS TABLE(bucket text, source text, evidence text)
LANGUAGE sql
STABLE
AS $$
  WITH src AS (
    SELECT
      ' ' || regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', ' ', 'g') || ' ' AS txt,
      ' ' || regexp_replace(lower(coalesce(p_government_type, '')), '[^a-z0-9]+', ' ', 'g') || ' ' AS typ,
      left(regexp_replace(coalesce(p_text, p_government_type, ''), '[[:space:]]+', ' ', 'g'), 240) AS ev
  )
  SELECT 'federal'::text, 'explicit_government_type'::text, left(p_government_type, 240)
  FROM src
  WHERE typ LIKE '% federal %'
  UNION
  SELECT 'state'::text, 'explicit_government_type'::text, left(p_government_type, 240)
  FROM src
  WHERE typ LIKE '% state %'
  UNION
  SELECT 'municipal'::text, 'explicit_government_type'::text, left(p_government_type, 240)
  FROM src
  WHERE typ LIKE '% municipal %'
     OR typ LIKE '% local %'
     OR typ LIKE '% county %'
     OR typ LIKE '% city %'
  UNION
  SELECT 'federal'::text, 'text_classifier'::text, ev
  FROM src
  WHERE txt LIKE '% u s %'
     OR txt LIKE '% us %'
     OR txt LIKE '% united states %'
     OR txt LIKE '% general services administration %'
     OR txt LIKE '% gsa %'
     OR txt LIKE '% federal %'
     OR txt LIKE '% department of veteran affairs %'
     OR txt LIKE '% department of veterans affairs %'
     OR txt LIKE '% veteran affairs %'
     OR txt LIKE '% veterans affairs %'
     OR txt LIKE '% va %'
     OR txt LIKE '% social security %'
     OR txt LIKE '% ssa %'
     OR txt LIKE '% irs %'
     OR txt LIKE '% fbi %'
     OR txt LIKE '% dea %'
     OR txt LIKE '% ice %'
     OR txt LIKE '% uscis %'
     OR txt LIKE '% fema %'
     OR txt LIKE '% usda %'
     OR txt LIKE '% hud %'
     OR txt LIKE '% epa %'
     OR txt LIKE '% fda %'
     OR txt LIKE '% doj %'
     OR txt LIKE '% dod %'
     OR txt LIKE '% dhs %'
     OR txt LIKE '% cbp %'
     OR txt LIKE '% tsa %'
     OR txt LIKE '% usps %'
     OR txt LIKE '% postal service %'
     OR txt LIKE '% customs and border %'
     OR txt LIKE '% immigration %'
     OR txt LIKE '% drug enforcement %'
     OR txt LIKE '% army %'
     OR txt LIKE '% navy %'
     OR txt LIKE '% naval %'
     OR txt LIKE '% air force %'
     OR txt LIKE '% coast guard %'
     OR txt LIKE '% border patrol %'
     -- 2026-08-12: DOE Power Marketing Administrations (Western/Bonneville/
     -- Southeastern/Southwestern Area Power Administration) are federal.
     OR txt LIKE '% power administration %'
  UNION
  SELECT 'municipal'::text, 'text_classifier'::text, ev
  FROM src
  WHERE txt LIKE '% municipal %'
     OR txt LIKE '% local %'
     OR txt LIKE '% county of %'
     OR txt LIKE '% county %'
     OR txt LIKE '% city of %'
     OR txt LIKE '% city %'
     OR txt LIKE '% town of %'
     OR txt LIKE '% village of %'
     OR txt LIKE '% borough of %'
     OR txt LIKE '% parish of %'
     OR txt LIKE '% school district %'
     OR txt LIKE '% independent school district %'
     OR txt LIKE '% isd %'
     OR txt LIKE '% municipal utility district %'
     OR txt LIKE '% mud %'
     OR txt LIKE '% water district %'
     OR txt LIKE '% fire district %'
     OR txt LIKE '% police department %'
     OR txt LIKE '% sheriff s office %'
     OR txt LIKE '% public works %'
     OR txt LIKE '% city hall %'
     OR txt LIKE '% county courthouse %'
     OR txt LIKE '% courthouse %'
  UNION
  SELECT 'state'::text, 'text_classifier'::text, ev
  FROM src
  WHERE txt LIKE '% state of %'
     OR txt LIKE '% commonwealth of %'
     OR txt LIKE '% health and human services %'
     OR txt LIKE '% health human services %'
     OR txt LIKE '% human services %'
     OR txt LIKE '% child protective %'
     OR txt LIKE '% childrens protective %'
     OR txt LIKE '% children s protective %'
     OR txt LIKE '% adult protective %'
     OR txt LIKE '% family protective %'
     OR txt LIKE '% department of transportation %'
     OR txt LIKE '% department of corrections %'
     OR txt LIKE '% department of correction %'
     OR txt LIKE '% department of criminal justice %'
     OR txt LIKE '% department of public safety %'
     OR txt LIKE '% department of health %'
     OR txt LIKE '% department of state health %'
     OR txt LIKE '% department of human services %'
     OR txt LIKE '% department of family and protective services %'
     OR txt LIKE '% department of licensing %'
     OR txt LIKE '% department of revenue %'
     OR txt LIKE '% department of labor %'
     OR txt LIKE '% department of education %'
     OR txt LIKE '% criminal justice %'
     OR txt LIKE '% juvenile justice %'
     OR txt LIKE '% parks and wildlife %'
     OR txt LIKE '% park and wildlife %'
     OR txt LIKE '% comptroller %'
     OR txt LIKE '% environmental quality %'
     OR txt LIKE '% lottery commission %'
     OR txt LIKE '% land office %'
     OR txt LIKE '% railroad commission %'
     OR txt LIKE '% workforce commission %'
     OR txt LIKE '% workforce solutions %'
     OR txt LIKE '% workforce development board %'
     OR txt LIKE '% education agency %'
     OR txt LIKE '% administrative hearings %'
     OR txt LIKE '% water development board %'
     OR txt LIKE '% alcoholic beverage commission %'
     OR txt LIKE '% alcoholic beverage control %'
     OR txt LIKE '% licensing and regulation %'
     OR txt LIKE '% securities board %'
     OR txt LIKE '% public safety %'
     OR txt LIKE '% state board %'
     OR txt LIKE '% historical commission %'
     -- 2026-08-12: additional unambiguous state/county-agency phrases recovered
     -- from the live in-band un-bucketed pool (validated: 0 private matches).
     OR txt LIKE '% department of law enforcement %'
     OR txt LIKE '% department of commerce %'
     OR txt LIKE '% social services %'
     OR txt LIKE '% economic security %'
     OR txt LIKE '% consumer affairs %'
     OR txt LIKE '% children and family %'
     OR txt LIKE '% probation and parole %'
     OR txt LIKE '% disability determination %'
     OR txt LIKE '% department of human resources %'
     OR txt LIKE '% motor vehicles %'
     OR txt LIKE '% employment security %'
     OR txt LIKE '% vocational rehabilitation %'
  ORDER BY 1;  -- ORDER BY 1 (not "bucket"): the UNION output column isn't bound to the OUT-param name.
$$;

COMMENT ON FUNCTION public.gov_credit_buckets_from_text(text, text) IS
  'Conservative Federal/State/Municipal classifier for gov tenant/agency text. Returns multiple buckets when evidence supports multiple government tenants. 2026-08-12: added DOE power-administration (federal) + 12 unambiguous state/county-agency phrases (law enforcement, commerce, social services, economic security, consumer affairs, children & family, probation & parole, disability determination, human resources, motor vehicles, employment security, vocational rehabilitation) validated against the live in-band pool with 0 private-tenant over-match.';

GRANT EXECUTE ON FUNCTION public.gov_credit_buckets_from_text(text, text) TO anon, authenticated, service_role;
