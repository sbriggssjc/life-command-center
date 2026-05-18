-- ============================================================================
-- QA-30 (2026-05-18, gov): canonicalize_agency expansion for FBI hyphen
-- variant + FCC.
--
-- QA-28's Chrome probe surfaced three federal misses that the
-- post-QA-24 canonicalizer regex didn't catch:
--   • "Federal Bureau-Investigation"        (1 prop) — hyphen separator
--   • "Federal Communications Commission"   (1 prop) — FCC not in map
--   • "FCC"                                  (2 props) — FCC not in map
--
-- The QA-24 regex `federal\s+bureau\s+of\s+investigation` requires "of"
-- with whitespace separators. The hyphen variant slipped through.
--
-- Fix:
--   (a) FBI line broadened to `federal\s+bureau[\s-]+(of[\s-]+)?investigation`
--       — accepts space or hyphen between bureau/of/investigation, and
--       makes "of" optional. Matches all of:
--         "fbi"
--         "federal bureau of investigation"
--         "federal bureau-investigation"
--         "federal bureau-of-investigation"
--   (b) New FCC line: `\m(fcc|federal\s+communications\s+commission)\M`
--
-- Verified live: all 4 affected properties now canonicalize to FBI (1) or
-- FCC (3) correctly. Total federal-agency precision improved by 4 rows.
-- Builds on QA-24 (singular Veteran Affairs).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.canonicalize_agency(p_input text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $function$
  WITH s AS (SELECT lower(trim(coalesce(p_input, ''))) AS x)
  SELECT CASE
    WHEN x ~ '\m(ssa|social\s+security)\M' THEN 'SSA'
    WHEN x ~ '\m(gsa|general\s+services\s+administration)\M' THEN 'GSA'
    WHEN x ~ '\m(irs|internal\s+revenue)\M' THEN 'IRS'
    -- QA-30 (2026-05-18): handle hyphen variant "Federal Bureau-Investigation"
    -- which the QA-24 regex `federal\s+bureau\s+of\s+investigation` did not
    -- match (no "of", hyphen separator). New form accepts space or hyphen
    -- between "bureau" / "of" / "investigation".
    WHEN x ~ '\m(fbi|federal\s+bureau[\s-]+(of[\s-]+)?investigation)\M' THEN 'FBI'

    -- QA-24 (2026-05-18): "veterans?" handles both "veteran" (singular) and
    -- "veterans" (plural). Was missing the singular form, leaving 1,217
    -- "US Department of Veteran Affairs" rows uncanonicalized.
    WHEN x ~ '\m(va|veterans?\s+affairs|veterans?\s+health|vha|department\s+of\s+veterans?)\M' THEN 'VA'

    WHEN x ~ '\m(hhs|health\s+and\s+human\s+services)\M' THEN 'HHS'
    WHEN x ~ '\m(cdc|centers\s+for\s+disease\s+control)\M' THEN 'CDC'
    WHEN x ~ '\m(fda|food\s+and\s+drug\s+administration)\M' THEN 'FDA'
    WHEN x ~ '\m(nih|national\s+institutes\s+of\s+health)\M' THEN 'NIH'
    WHEN x ~ '\m(usps|u\.?s\.?\s+postal\s+service|united\s+states\s+postal\s+service|post\s+office)\M' THEN 'USPS'
    WHEN x ~ '\m(dol|department\s+of\s+labor|labor\s+department)\M' THEN 'DOL'
    WHEN x ~ '\m(doc|department\s+of\s+commerce|commerce\s+department)\M' THEN 'DOC'
    WHEN x ~ '\m(treasury|department\s+of\s+the\s+treasury)\M' THEN 'TREAS'
    WHEN x ~ '\m(doj|department\s+of\s+justice|justice\s+department)\M' THEN 'DOJ'
    WHEN x ~ '\m(dhs|department\s+of\s+homeland\s+security)\M' THEN 'DHS'
    WHEN x ~ '\m(ice|immigration\s+and\s+customs)\M' THEN 'ICE'
    WHEN x ~ '\m(cbp|customs\s+and\s+border|border\s+protection|customs(?!.*broker))\M' THEN 'CBP'
    WHEN x ~ '\m(uscis|citizenship\s+and\s+immigration)\M' THEN 'USCIS'
    WHEN x ~ '\m(tsa|transportation\s+security)\M' THEN 'TSA'
    WHEN x ~ '\m(secret\s+service|usss)\M' THEN 'USSS'
    WHEN x ~ '\m(atf|alcohol,?\s+tobacco)\M' THEN 'ATF'
    WHEN x ~ '\m(dea|drug\s+enforcement)\M' THEN 'DEA'
    WHEN x ~ '\m(usms|u\.?s\.?\s+marshals|marshals\s+service)\M' THEN 'USMS'
    WHEN x ~ '\m(dod|department\s+of\s+defense)\M' THEN 'DOD'
    WHEN x ~ '\m(army)\M' THEN 'ARMY'
    WHEN x ~ '\m(navy|department\s+of\s+the\s+navy)\M' THEN 'NAVY'
    WHEN x ~ '\m(air\s+force|usaf)\M' THEN 'USAF'
    WHEN x ~ '\m(marine\s+corps|usmc)\M' THEN 'USMC'
    WHEN x ~ '\m(coast\s+guard|uscg)\M' THEN 'USCG'
    WHEN x ~ '\m(epa|environmental\s+protection)\M' THEN 'EPA'
    WHEN x ~ '\m(noaa|national\s+oceanic)\M' THEN 'NOAA'
    WHEN x ~ '\m(usgs|geological\s+survey)\M' THEN 'USGS'
    WHEN x ~ '\m(usda|department\s+of\s+agriculture)\M' THEN 'USDA'
    WHEN x ~ '\m(doe|department\s+of\s+energy)\M' THEN 'DOE'
    WHEN x ~ '\m(dot|department\s+of\s+transportation)\M' THEN 'DOT'
    WHEN x ~ '\m(faa|federal\s+aviation)\M' THEN 'FAA'
    -- QA-30 (2026-05-18): added FCC. 3 properties live on gov with raw
    -- agency "FCC" (2) and "Federal Communications Commission" (1) that
    -- the canonicalizer previously returned NULL for.
    WHEN x ~ '\m(fcc|federal\s+communications\s+commission)\M' THEN 'FCC'
    WHEN x ~ '\m(fema|federal\s+emergency\s+management)\M' THEN 'FEMA'
    WHEN x ~ '\m(opm|office\s+of\s+personnel\s+management)\M' THEN 'OPM'
    WHEN x ~ '\m(sec|securities\s+and\s+exchange)\M' THEN 'SEC'
    WHEN x ~ '\m(bls|bureau\s+of\s+labor\s+statistics)\M' THEN 'BLS'
    WHEN x ~ '\m(nrc|nuclear\s+regulatory)\M' THEN 'NRC'
    WHEN x ~ '\m(nlrb|national\s+labor\s+relations)\M' THEN 'NLRB'
    WHEN x ~ '\m(eeoc|equal\s+employment\s+opportunity)\M' THEN 'EEOC'
    WHEN x ~ '\m(hud|housing\s+and\s+urban\s+development)\M' THEN 'HUD'
    WHEN x ~ '\m(state|department\s+of\s+state)\M' THEN 'STATE'
    WHEN x ~ '\m(interior|department\s+of\s+the\s+interior|doi)\M' THEN 'DOI'
    WHEN x ~ '\m(education|department\s+of\s+education)\M' THEN 'ED'
    WHEN x ~ '\m(lsc|legal\s+services\s+corporation)\M' THEN 'LSC'
    WHEN x ~ '\m(bop|bureau\s+of\s+prisons|federal\s+bureau\s+of\s+prisons)\M' THEN 'BOP'
    WHEN x ~ '\m(daca|defense\s+commissary)\M' THEN 'DCA'
    WHEN x ~ '\m(usace|u\.?s\.?\s+army\s+corps\s+of\s+engineers)\M' THEN 'USACE'
    ELSE NULL
  END FROM s;
$function$;

COMMENT ON FUNCTION public.canonicalize_agency(text) IS
  'QA-30 (2026-05-18): added FCC alternative and broadened FBI regex to accept hyphen variant "Federal Bureau-Investigation". Builds on QA-24 (singular Veteran Affairs).';

-- Re-canonicalize affected properties
UPDATE public.properties
SET agency_canonical = public.canonicalize_agency(agency)
WHERE agency IS NOT NULL
  AND agency_canonical IS DISTINCT FROM public.canonicalize_agency(agency)
  AND public.canonicalize_agency(agency) IS NOT NULL;
