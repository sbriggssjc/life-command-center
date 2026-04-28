-- ============================================================================
-- Round 76bg (gov) — Agency name canonicalizer
--
-- Scott observed agency names vary wildly: SSA / Social Security Administration,
-- VA / VETERANS AFFAIRS / US Department of Veterans Affairs, GSA / General Services
-- Administration, USPS / United States Postal Service, etc.
--
-- canonicalize_agency(text) returns short code (SSA/GSA/VA/IRS/FBI/USPS/...)
-- canonicalize_agency_full(short) returns canonical long name
--
-- 50 federal agencies covered. agency / tenant_agency text stays unchanged
-- (so per-field-office naming is preserved); agency_canonical + agency_full
-- columns added to properties / leases / sales_transactions.
--
-- Coverage from initial backfill (2026-04-28):
--   2,804 / 7,722 properties (36%) canonicalized into 43 distinct codes
--   3,533 / 9,266 leases (38%)
--   1,226 / 4,711 sales (26%)
-- Remaining ~64% are SSA branch/field-office names that don't have the
-- agency name in the text (e.g. "PITTSBURGH FIELD OFFICE (PA)" — could be
-- SSA, VA, ICE, etc — needs lease_number prefix inference, deferred).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.canonicalize_agency(p_input text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH s AS (SELECT lower(trim(coalesce(p_input, ''))) AS x)
  SELECT CASE
    WHEN x ~ '\msocial security|^ssa$|^ssa[^a-z]' THEN 'SSA'
    WHEN x ~ '\mgeneral services administration|^gsa$|^gsa[^a-z]' THEN 'GSA'
    WHEN x ~ '\minternal revenue|^irs$|^irs[^a-z]' THEN 'IRS'
    WHEN x ~ '\mfederal bureau of investigation|^fbi$|^fbi[^a-z]' THEN 'FBI'
    WHEN x ~ '\mveterans affairs|veterans health|department of veterans|^va$|^va[^a-z]|\mvha\M' THEN 'VA'
    WHEN x ~ '\mhealth and human services|^hhs$|^hhs[^a-z]' THEN 'HHS'
    WHEN x ~ '\mcenters for disease control|^cdc$|^cdc[^a-z]' THEN 'CDC'
    WHEN x ~ '\mfood and drug administration|^fda$|^fda[^a-z]' THEN 'FDA'
    WHEN x ~ '\mnational institutes of health|^nih$|^nih[^a-z]' THEN 'NIH'
    WHEN x ~ 'postal service|post office|^usps$|^usps[^a-z]' THEN 'USPS'
    WHEN x ~ 'department of labor|labor department|^dol$|^dol[^a-z]' THEN 'DOL'
    WHEN x ~ 'department of commerce|commerce department|^doc$|^doc[^a-z]' THEN 'DOC'
    WHEN x ~ 'department of the treasury|^treas|^treasury' THEN 'TREAS'
    WHEN x ~ 'department of justice|justice department|^doj$|^doj[^a-z]' THEN 'DOJ'
    WHEN x ~ 'department of homeland security|^dhs$|^dhs[^a-z]' THEN 'DHS'
    WHEN x ~ 'immigration and customs|^ice$|^ice[^a-z]' THEN 'ICE'
    WHEN x ~ 'customs and border|border protection|^cbp$|^cbp[^a-z]' THEN 'CBP'
    WHEN x ~ 'citizenship and immigration|^uscis' THEN 'USCIS'
    WHEN x ~ 'transportation security|^tsa$|^tsa[^a-z]' THEN 'TSA'
    WHEN x ~ 'secret service|^usss' THEN 'USSS'
    WHEN x ~ '^atf|alcohol[, ]+tobacco' THEN 'ATF'
    WHEN x ~ 'drug enforcement|^dea$|^dea[^a-z]' THEN 'DEA'
    WHEN x ~ 'marshals service|^usms' THEN 'USMS'
    WHEN x ~ 'department of defense|^dod$|^dod[^a-z]' THEN 'DOD'
    WHEN x ~ '^army|department of the army' THEN 'ARMY'
    WHEN x ~ '^navy|department of the navy' THEN 'NAVY'
    WHEN x ~ 'air force|^usaf' THEN 'USAF'
    WHEN x ~ 'marine corps|^usmc' THEN 'USMC'
    WHEN x ~ 'coast guard|^uscg' THEN 'USCG'
    WHEN x ~ 'environmental protection|^epa$|^epa[^a-z]' THEN 'EPA'
    WHEN x ~ '^noaa|national oceanic' THEN 'NOAA'
    WHEN x ~ 'geological survey|^usgs' THEN 'USGS'
    WHEN x ~ 'department of agriculture|^usda' THEN 'USDA'
    WHEN x ~ 'department of energy|^doe$|^doe[^a-z]' THEN 'DOE'
    WHEN x ~ 'department of transportation|^dot$|^dot[^a-z]' THEN 'DOT'
    WHEN x ~ 'federal aviation|^faa$|^faa[^a-z]' THEN 'FAA'
    WHEN x ~ 'federal emergency|^fema' THEN 'FEMA'
    WHEN x ~ 'office of personnel|^opm$|^opm[^a-z]' THEN 'OPM'
    WHEN x ~ 'securities and exchange|^sec$|^sec[^a-z]' THEN 'SEC'
    WHEN x ~ 'bureau of labor statistics|^bls$|^bls[^a-z]' THEN 'BLS'
    WHEN x ~ 'nuclear regulatory|^nrc$|^nrc[^a-z]' THEN 'NRC'
    WHEN x ~ 'national labor relations|^nlrb' THEN 'NLRB'
    WHEN x ~ 'equal employment|^eeoc' THEN 'EEOC'
    WHEN x ~ 'housing and urban|^hud$|^hud[^a-z]' THEN 'HUD'
    WHEN x ~ 'department of state|^state department|^state$' THEN 'STATE'
    WHEN x ~ 'department of the interior|^doi$|^doi[^a-z]|^interior$' THEN 'DOI'
    WHEN x ~ 'department of education|^education$|^ed$' THEN 'ED'
    WHEN x ~ 'legal services corporation|^lsc$|^lsc[^a-z]' THEN 'LSC'
    WHEN x ~ 'bureau of prisons|^bop$|^bop[^a-z]' THEN 'BOP'
    WHEN x ~ 'army corps of engineers|^usace' THEN 'USACE'
    ELSE NULL
  END FROM s;
$$;

CREATE OR REPLACE FUNCTION public.canonicalize_agency_full(p_short text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE upper(coalesce(p_short, ''))
    WHEN 'SSA' THEN 'Social Security Administration'
    WHEN 'GSA' THEN 'General Services Administration'
    WHEN 'IRS' THEN 'Internal Revenue Service'
    WHEN 'FBI' THEN 'Federal Bureau of Investigation'
    WHEN 'VA' THEN 'Department of Veterans Affairs'
    WHEN 'HHS' THEN 'Department of Health and Human Services'
    WHEN 'USPS' THEN 'United States Postal Service'
    WHEN 'DOL' THEN 'Department of Labor'
    WHEN 'TREAS' THEN 'Department of the Treasury'
    WHEN 'DOJ' THEN 'Department of Justice'
    WHEN 'DHS' THEN 'Department of Homeland Security'
    WHEN 'ICE' THEN 'U.S. Immigration and Customs Enforcement'
    WHEN 'CBP' THEN 'U.S. Customs and Border Protection'
    WHEN 'USCIS' THEN 'U.S. Citizenship and Immigration Services'
    WHEN 'TSA' THEN 'Transportation Security Administration'
    WHEN 'DEA' THEN 'Drug Enforcement Administration'
    WHEN 'USMS' THEN 'U.S. Marshals Service'
    WHEN 'DOD' THEN 'Department of Defense'
    WHEN 'EPA' THEN 'Environmental Protection Agency'
    WHEN 'USDA' THEN 'U.S. Department of Agriculture'
    WHEN 'DOE' THEN 'Department of Energy'
    WHEN 'DOT' THEN 'Department of Transportation'
    WHEN 'FAA' THEN 'Federal Aviation Administration'
    WHEN 'FEMA' THEN 'Federal Emergency Management Agency'
    WHEN 'OPM' THEN 'Office of Personnel Management'
    WHEN 'HUD' THEN 'Department of Housing and Urban Development'
    WHEN 'STATE' THEN 'Department of State'
    WHEN 'DOI' THEN 'Department of the Interior'
    WHEN 'ED' THEN 'Department of Education'
    WHEN 'LSC' THEN 'Legal Services Corporation'
    WHEN 'BOP' THEN 'Federal Bureau of Prisons'
    WHEN 'USACE' THEN 'U.S. Army Corps of Engineers'
    ELSE upper(coalesce(p_short, ''))
  END;
$$;

ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS agency_canonical text;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS agency_full text;
ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS agency_canonical text;
ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS agency_full text;
ALTER TABLE public.sales_transactions ADD COLUMN IF NOT EXISTS agency_canonical text;
ALTER TABLE public.sales_transactions ADD COLUMN IF NOT EXISTS agency_full text;

UPDATE public.properties
   SET agency_canonical = canonicalize_agency(agency),
       agency_full = canonicalize_agency_full(canonicalize_agency(agency))
 WHERE agency IS NOT NULL AND agency_canonical IS NULL;

UPDATE public.leases
   SET agency_canonical = canonicalize_agency(tenant_agency),
       agency_full = canonicalize_agency_full(canonicalize_agency(tenant_agency))
 WHERE tenant_agency IS NOT NULL AND agency_canonical IS NULL;

UPDATE public.sales_transactions
   SET agency_canonical = canonicalize_agency(agency),
       agency_full = canonicalize_agency_full(canonicalize_agency(agency))
 WHERE agency IS NOT NULL AND agency_canonical IS NULL;
