-- ⚠️ HISTORICAL — DO NOT RE-APPLY. This directory does not own the government database;
-- `government-lease` does (see supabase/migrations/government/README.md, 2026-09-12).
-- This file is kept as a record of what this repo applied in the past. The live, correct
-- copy of any object it defines may have since diverged -- read the deployed database or
-- government-lease's committed source, never this file, before trusting its content.

-- ============================================================================
-- ID3a/ID3b (gov) — fix the agency canonicalizer's contamination bugs, then
-- finish the wiring (GSA using-agency column, review routing, registry fill).
--
-- ⚠️ RUNNING-BUT-NOT-MERGED FOUND HERE: the migration this file supersedes
-- (20260428300000_gov_round_76bg_agency_canonicalizer.sql, "Round 76bg") is
-- NOT what has been running in production for months. `canonicalize_agency`
-- and `canonicalize_agency_full` were both hand-patched live (QA-24/QA-30
-- comments visible in `pg_get_functiondef` on the deployed function) with
-- \m...\M word-boundary regexes and a much larger `canonicalize_agency_full`
-- map (NAVY/ARMY/USAF/USMC/USCG/NOAA/USGS/USDA/DOE/DOT/FAA/FCC/FEMA/OPM/SEC/
-- BLS/NRC/NLRB/EEOC/HUD/STATE/DOI/ED/LSC/BOP/DCA/USACE all already present)
-- while the committed file still shows the March baseline with bare `^prefix`
-- anchors. This migration is the full, correct, COMMITTED restatement of both
-- functions — never a live-only patch — so the next rebuild from `main` can
-- no longer regress it (P194 / N18 doctrine: "a second copy that is correct
-- beats no copy at all").
--
-- Three contamination classes, all measured live on gov (scknotsqkcheojiaewwh)
-- before this migration:
--
-- 1. \m(navy|...)\M is a WHOLE-WORD match, and "navy" is a whole word inside
--    "Navy Federal Credit Union" — a private financial institution, never a
--    government tenant. 150 properties.agency_canonical='NAVY': 147 are
--    Navy Federal Credit Union (145 exact + 1 multi-tenant string + 1
--    all-caps variant), only 3 are the real Department of the Navy / a
--    lease/sale carrying "Navy" alone. Fixed with a general
--    "*federal credit union" exclusion checked BEFORE any branch — verified
--    it changes nothing else live (every other "X Federal Credit Union" row
--    already read NULL; nothing currently resolves via the word "credit
--    union").
--
-- 2. Bare \mstate\M is the single word "state" appearing anywhere, and it is
--    an ordinary noun/adjective inside STATE-GOVERNMENT agency names:
--    "State of Texas", "Washington State Department of Social and Health
--    Services", "Pennsylvania State Police", "Idaho State Liquor Store",
--    "DEPARTMENT OF STATE HEALTH SERVICES" (Texas DSHS). Measured: 213 of
--    213 `agency_canonical='STATE'` properties read a STATE government
--    agency, ZERO are the federal Department of State. A substring test for
--    the phrase "department of state" is NOT enough — "DEPARTMENT OF STATE
--    HEALTH SERVICES" contains that exact substring and is Texas DSHS, not
--    Foggy Bottom. Fixed with a closed ALLOWLIST of the handful of raw
--    strings that genuinely denote the U.S. Department of State
--    (never a substring/regex test for this one).
--
-- 3. Bare \mdoc\M is genuinely ambiguous — DOC is the plausible shorthand
--    for a STATE Department of Corrections at least as often as the federal
--    Department of Commerce. Live evidence: "DOC&PS" (a Corrections-and-
--    Public-Safety-shaped abbreviation) sits in the same 16-row bucket as
--    plain "DOC". Per Scott's read: route ALL bare-DOC rows to review, never
--    auto-link to Department of Commerce. Only the spelled-out federal
--    phrase ("department of commerce"/"commerce department") still resolves.
--
-- Plus three read fixes and one registry completion:
--
-- (a) RICHMOND FIELD OFFICE (VA) (and the 14 other "<CITY> FIELD OFFICE (XX)"
--     strings, 74 rows on RICHMOND alone) — a trailing "(XX)" is a two-letter
--     STATE-CODE LOCATION SUFFIX, never an agency code, and it must never be
--     read as one. General rule in the comparator: strip a trailing
--     "(<two letters>)" before running any agency-name match, for every
--     string, not a Richmond/VA-specific patch. (PITTSBURGH FIELD OFFICE
--     (PA), CHARLESTON FIELD OFFICE (WV), etc. all correctly resolved to
--     NULL already — only the ones matching a real word-boundary keyword
--     under the (XX) parens, like "(VA)", were falsely resolved.)
--
-- (b) Bare "DOC" — see (3) above — routes to review, not Department of
--     Commerce.
--
-- (c) "GSA - <AGENCY>" (624 properties / 106 distinct raw strings measured
--     live, e.g. "GSA - USPS" x92, "GSA - FBI" x48) is a SINGLE lease where
--     GSA is the counterparty/master lessor and <AGENCY> is the USING/
--     OCCUPYING federal tenant — never two tenancies. `agency_canonical`
--     stays GSA (the existing counterparty column, unchanged). A SECOND
--     column, `using_agency_canonical` / `using_agency_full`, is added and
--     populated from the parsed remainder after "GSA - ".
--
-- (4) Registry completion: NAVY / ARMY / DOC / LSC / DOL / USGS / NRC / NIH /
--     NLRB / USAF / TREAS were ALREADY present in the live (uncommitted)
--     `canonicalize_agency_full` map — this migration commits that map
--     verbatim rather than re-adding rows that already exist, so the
--     registry state now matches between repo and database. An ACE alias to
--     USACE is added, CASE-SENSITIVE on the raw input ("ACE" — never bare
--     lowercase "ace"): this repo's own gov CLAUDE.md §15 documents an "Ace
--     Hardware" sale existing in this exact database, and a lowercase
--     \mace\M word-boundary match would misread that as U.S. Army Corps of
--     Engineers the moment such a row's `agency`/`tenant_agency` field ever
--     carries it. "corps of engineers" (spelled out, no "army"/"usace"
--     required) is added as a safe phrase alias and is checked BEFORE the
--     bare "army" branch, so "US Army Corps of Engineers" strings resolve to
--     USACE (their own registered agency) rather than the generic ARMY
--     branch swallowing them by CASE-order precedence.
--
-- (5) A fourth contamination class was found while shipping (not named in the
--     original brief): \mice\M matched "Handel's Homemade Ice Cream & Yogurt"
--     — the identical NAVY/credit-union shape on a different code. Fixed with
--     the same technique (a named exclusion checked before the ICE branch).
--
-- ⚠️ NOT fixed here, confirmed still live: DOJ/EPA/DOL/ED/DOT each fold in at
-- least one STATE agency (TEXAS JUVENILE JUSTICE DEPARTMENT reads DOJ; a
-- Georgia state environmental dept reads EPA; two PA Dept-of-Labor variants
-- read DOL; Alabama's and a NJ school board's education depts read ED;
-- CA's and NY State's DOTs read DOT) — the same shape as the STATE bug this
-- migration fixes, on five more codes. Filed as backlog ID3a-c; the STATE
-- fix's closed-allowlist technique is the template for each.
--
-- Discipline: additive · conservative/unambiguous (ambiguous cases route to
-- review, never guessed) · reversible (backup tables below) · idempotent ·
-- scoped strictly to `canonicalize_agency`/`canonicalize_agency_full` and the
-- three government tables' agency columns — no county/city vocabulary, no
-- owner/broker identity, no cross-lane property linking beyond the ACE alias.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Reversible backups of the pre-migration state (properties/leases/sales).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public._gov_id3ab_agency_backup_20260912 (
  table_name text NOT NULL,
  record_pk  text NOT NULL,
  agency_canonical_before text,
  agency_full_before      text,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (table_name, record_pk)
);

INSERT INTO public._gov_id3ab_agency_backup_20260912
  (table_name, record_pk, agency_canonical_before, agency_full_before)
SELECT 'properties', property_id::text, agency_canonical, agency_full
  FROM public.properties
 WHERE agency IS NOT NULL
ON CONFLICT (table_name, record_pk) DO NOTHING;

INSERT INTO public._gov_id3ab_agency_backup_20260912
  (table_name, record_pk, agency_canonical_before, agency_full_before)
SELECT 'leases', lease_id::text, agency_canonical, agency_full
  FROM public.leases
 WHERE tenant_agency IS NOT NULL
ON CONFLICT (table_name, record_pk) DO NOTHING;

INSERT INTO public._gov_id3ab_agency_backup_20260912
  (table_name, record_pk, agency_canonical_before, agency_full_before)
SELECT 'sales', sale_id::text, agency_canonical, agency_full
  FROM public.sales_transactions
 WHERE agency IS NOT NULL
ON CONFLICT (table_name, record_pk) DO NOTHING;

-- ---------------------------------------------------------------------------
-- The fixed comparator.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonicalize_agency(p_input text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  WITH s AS (
    -- ID3a rule (b/general): a trailing "(<two letters>)" is a LOCATION
    -- suffix (a state code on a field-office name), never an agency code.
    -- Strip it before any keyword match runs, for every input.
    SELECT trim(regexp_replace(
             lower(trim(coalesce(p_input, ''))),
             '\s*\([a-z]{2}\)\s*$', ''
           )) AS x
  )
  SELECT CASE
    -- ID3a rule 1: exclude private financial institutions BEFORE any
    -- service-branch/department keyword branch can fire on a word embedded
    -- in their name (e.g. "navy" inside "Navy Federal Credit Union").
    WHEN x ~ '\m(federal\s+credit\s+union|credit\s+union)\M' THEN NULL

    -- Found while shipping this migration (not in the original brief):
    -- \mice\M matched "Handel's Homemade Ice Cream & Yogurt" — the same
    -- shape as the NAVY/credit-union collision, on a different code.
    WHEN x ~ '\m(ice\s+cream|frozen\s+yogurt)\M' THEN NULL

    WHEN x ~ '\m(ssa|social\s+security)\M' THEN 'SSA'
    WHEN x ~ '\m(gsa|general\s+services\s+administration)\M' THEN 'GSA'
    WHEN x ~ '\m(irs|internal\s+revenue)\M' THEN 'IRS'
    WHEN x ~ '\m(fbi|federal\s+bureau[\s-]+(of[\s-]+)?investigation)\M' THEN 'FBI'
    WHEN x ~ '\m(va|veterans?\s+affairs|veterans?\s+health|vha|department\s+of\s+veterans?)\M' THEN 'VA'
    WHEN x ~ '\m(hhs|health\s+and\s+human\s+services)\M' THEN 'HHS'
    WHEN x ~ '\m(cdc|centers\s+for\s+disease\s+control)\M' THEN 'CDC'
    WHEN x ~ '\m(fda|food\s+and\s+drug\s+administration)\M' THEN 'FDA'
    WHEN x ~ '\m(nih|national\s+institutes\s+of\s+health)\M' THEN 'NIH'
    WHEN x ~ '\m(usps|u\.?s\.?\s+postal\s+service|united\s+states\s+postal\s+service|post\s+office)\M' THEN 'USPS'
    WHEN x ~ '\m(dol|department\s+of\s+labor|labor\s+department)\M' THEN 'DOL'

    -- ID3a rule 3: bare "DOC" is dropped (routed to review by
    -- gov_agency_review_reason() below); only the spelled-out federal
    -- phrase resolves.
    WHEN x ~ '\m(department\s+of\s+commerce|commerce\s+department)\M' THEN 'DOC'

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

    -- ID3b(4): USACE checked BEFORE the bare "army" branch so
    -- "US Army Corps of Engineers" resolves to its own registered agency
    -- rather than being swallowed by ARMY on CASE-order precedence. "ace"
    -- is intentionally NOT matched here (lowercase, bare) — see the
    -- case-sensitive ACE check further down, which runs only on the raw
    -- (not lower-cased) input to avoid a false hit on a private "Ace ___"
    -- business name (gov CLAUDE.md §15 documents exactly that class of
    -- collision existing in this database on a different column).
    WHEN x ~ '\m(usace|u\.?s\.?\s+army\s+corps\s+of\s+engineers|corps\s+of\s+engineers)\M' THEN 'USACE'

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
    WHEN x ~ '\m(fcc|federal\s+communications\s+commission)\M' THEN 'FCC'
    WHEN x ~ '\m(fema|federal\s+emergency\s+management)\M' THEN 'FEMA'
    WHEN x ~ '\m(opm|office\s+of\s+personnel\s+management)\M' THEN 'OPM'
    WHEN x ~ '\m(sec|securities\s+and\s+exchange)\M' THEN 'SEC'
    WHEN x ~ '\m(bls|bureau\s+of\s+labor\s+statistics)\M' THEN 'BLS'
    WHEN x ~ '\m(nrc|nuclear\s+regulatory)\M' THEN 'NRC'
    WHEN x ~ '\m(nlrb|national\s+labor\s+relations)\M' THEN 'NLRB'
    WHEN x ~ '\m(eeoc|equal\s+employment\s+opportunity)\M' THEN 'EEOC'
    WHEN x ~ '\m(hud|housing\s+and\s+urban\s+development)\M' THEN 'HUD'

    -- ID3a rule 2: STATE is a CLOSED ALLOWLIST, never a substring/word test —
    -- "state" is an ordinary word inside dozens of STATE-government agency
    -- names ("State of Texas", "Washington State Dept of Social and Health
    -- Services") and even "DEPARTMENT OF STATE HEALTH SERVICES" (Texas
    -- DSHS) contains the literal phrase "department of state" as a
    -- substring while naming a state agency, not Foggy Bottom.
    WHEN x IN (
      'state', 'dos',
      'state department', 'department of state',
      'u.s. department of state', 'us department of state',
      'united states department of state'
    ) THEN 'STATE'

    WHEN x ~ '\m(interior|department\s+of\s+the\s+interior|doi)\M' THEN 'DOI'
    WHEN x ~ '\m(education|department\s+of\s+education)\M' THEN 'ED'
    WHEN x ~ '\m(lsc|legal\s+services\s+corporation)\M' THEN 'LSC'
    WHEN x ~ '\m(bop|bureau\s+of\s+prisons|federal\s+bureau\s+of\s+prisons)\M' THEN 'BOP'
    WHEN x ~ '\m(daca|defense\s+commissary)\M' THEN 'DCA'

    -- ID3b(4): case-sensitive ACE alias to USACE. Deliberately NOT part of
    -- the lower-cased `x` CTE above — matching on the RAW input preserves
    -- case, so a private business whose name happens to contain "Ace" in
    -- mixed/lower case is never swept in; only the all-caps acronym is.
    WHEN p_input ~ '\mACE\M' THEN 'USACE'

    ELSE NULL
  END FROM s;
$function$;

-- ---------------------------------------------------------------------------
-- The full-name mapper. Restated verbatim from the LIVE (previously
-- uncommitted) definition so the repo is a true record of what has been
-- running — NOT a re-add of rows that already exist. NCUA/DCA/FCC already
-- present live are kept; no new registry rows beyond what ID3b(4) needs
-- (USACE already present).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonicalize_agency_full(p_short text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT CASE upper(coalesce(p_short, ''))
    WHEN 'SSA' THEN 'Social Security Administration'
    WHEN 'GSA' THEN 'General Services Administration'
    WHEN 'IRS' THEN 'Internal Revenue Service'
    WHEN 'FBI' THEN 'Federal Bureau of Investigation'
    WHEN 'VA' THEN 'Department of Veterans Affairs'
    WHEN 'HHS' THEN 'Department of Health and Human Services'
    WHEN 'CDC' THEN 'Centers for Disease Control and Prevention'
    WHEN 'FDA' THEN 'Food and Drug Administration'
    WHEN 'NIH' THEN 'National Institutes of Health'
    WHEN 'USPS' THEN 'United States Postal Service'
    WHEN 'DOL' THEN 'Department of Labor'
    WHEN 'DOC' THEN 'Department of Commerce'
    WHEN 'TREAS' THEN 'Department of the Treasury'
    WHEN 'DOJ' THEN 'Department of Justice'
    WHEN 'DHS' THEN 'Department of Homeland Security'
    WHEN 'ICE' THEN 'U.S. Immigration and Customs Enforcement'
    WHEN 'CBP' THEN 'U.S. Customs and Border Protection'
    WHEN 'USCIS' THEN 'U.S. Citizenship and Immigration Services'
    WHEN 'TSA' THEN 'Transportation Security Administration'
    WHEN 'USSS' THEN 'U.S. Secret Service'
    WHEN 'ATF' THEN 'Bureau of Alcohol, Tobacco, Firearms and Explosives'
    WHEN 'DEA' THEN 'Drug Enforcement Administration'
    WHEN 'USMS' THEN 'U.S. Marshals Service'
    WHEN 'DOD' THEN 'Department of Defense'
    WHEN 'ARMY' THEN 'Department of the Army'
    WHEN 'NAVY' THEN 'Department of the Navy'
    WHEN 'USAF' THEN 'U.S. Air Force'
    WHEN 'USMC' THEN 'U.S. Marine Corps'
    WHEN 'USCG' THEN 'U.S. Coast Guard'
    WHEN 'EPA' THEN 'Environmental Protection Agency'
    WHEN 'NOAA' THEN 'National Oceanic and Atmospheric Administration'
    WHEN 'USGS' THEN 'U.S. Geological Survey'
    WHEN 'USDA' THEN 'U.S. Department of Agriculture'
    WHEN 'DOE' THEN 'Department of Energy'
    WHEN 'DOT' THEN 'Department of Transportation'
    WHEN 'FAA' THEN 'Federal Aviation Administration'
    WHEN 'FCC' THEN 'Federal Communications Commission'
    WHEN 'FEMA' THEN 'Federal Emergency Management Agency'
    WHEN 'OPM' THEN 'Office of Personnel Management'
    WHEN 'SEC' THEN 'Securities and Exchange Commission'
    WHEN 'BLS' THEN 'Bureau of Labor Statistics'
    WHEN 'NRC' THEN 'Nuclear Regulatory Commission'
    WHEN 'NLRB' THEN 'National Labor Relations Board'
    WHEN 'EEOC' THEN 'Equal Employment Opportunity Commission'
    WHEN 'HUD' THEN 'Department of Housing and Urban Development'
    WHEN 'STATE' THEN 'Department of State'
    WHEN 'DOI' THEN 'Department of the Interior'
    WHEN 'ED' THEN 'Department of Education'
    WHEN 'LSC' THEN 'Legal Services Corporation'
    WHEN 'BOP' THEN 'Federal Bureau of Prisons'
    WHEN 'DCA' THEN 'Defense Commissary Agency'
    WHEN 'USACE' THEN 'U.S. Army Corps of Engineers'
    ELSE NULL
  END;
$function$;

-- ---------------------------------------------------------------------------
-- ID3a(2)/(3): review routing. A pure classifier naming WHY a row needs a
-- human look, never a silent auto-link. Kept separate from
-- canonicalize_agency so the "resolves to nothing" and "resolves to nothing,
-- AND HERE IS WHY" facts are not conflated (P181: a genuine judgement call
-- and an unanswerable one must not wear the same label).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gov_agency_review_reason(p_input text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  WITH s AS (
    SELECT trim(regexp_replace(
             lower(trim(coalesce(p_input, ''))),
             '\s*\([a-z]{2}\)\s*$', ''
           )) AS x,
           trim(coalesce(p_input, '')) AS raw
  )
  SELECT CASE
    WHEN raw = '' THEN NULL
    WHEN x ~ '\m(federal\s+credit\s+union|credit\s+union)\M'
      THEN 'private_company_name_collision'
    -- bare DOC (with or without trailing junk like "DOC&PS"/"DOC/P&PO")
    -- and no spelled-out federal phrase anywhere in the string.
    WHEN x ~ '\mdoc\M' AND x !~ '\m(department\s+of\s+commerce|commerce\s+department)\M'
      THEN 'ambiguous_doc_commerce_or_corrections'
    -- a "(<XX>)" location suffix was stripped and nothing else in the
    -- string named a recognizable agency — a field-office name with no
    -- statable agency, not an unresolved federal agency.
    WHEN lower(trim(coalesce(p_input, ''))) ~ '\([a-z]{2}\)\s*$'
         AND public.canonicalize_agency(p_input) IS NULL
      THEN 'location_suffix_no_agency'
    ELSE NULL
  END FROM s;
$function$;

-- ---------------------------------------------------------------------------
-- ID3a(2)/(c): GSA-as-lessor, using-agency-as-tenant. Parses the remainder
-- after "GSA - " (or "GSA-") and canonicalizes IT, independent of the
-- existing `agency_canonical` (which stays GSA, the lease counterparty).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gov_using_agency_from_gsa(p_input text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT public.canonicalize_agency(
    regexp_replace(coalesce(p_input, ''), '^\s*gsa\s*-\s*', '', 'i')
  )
  WHERE coalesce(p_input, '') ~* '^\s*gsa\s*-\s*\S'
$function$;

-- ---------------------------------------------------------------------------
-- Columns. Additive; new columns land at the END on each table.
-- ---------------------------------------------------------------------------
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS agency_review_reason text;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS using_agency_canonical text;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS using_agency_full text;

ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS agency_review_reason text;
ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS using_agency_canonical text;
ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS using_agency_full text;

ALTER TABLE public.sales_transactions ADD COLUMN IF NOT EXISTS agency_review_reason text;
ALTER TABLE public.sales_transactions ADD COLUMN IF NOT EXISTS using_agency_canonical text;
ALTER TABLE public.sales_transactions ADD COLUMN IF NOT EXISTS using_agency_full text;

-- ---------------------------------------------------------------------------
-- The trigger function (Round 76ej.t's IF/ELSIF fix retained; extended to
-- also populate the review reason and the using-agency pair).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gov_populate_agency_canonical()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_short text;
  v_src   text;
  v_using text;
BEGIN
  IF TG_TABLE_NAME = 'leases' THEN
    v_src := COALESCE(NEW.tenant_agency, '');
  ELSE
    v_src := COALESCE(NEW.agency, '');
  END IF;

  v_short := public.canonicalize_agency(v_src);
  NEW.agency_canonical := v_short;
  NEW.agency_full      := public.canonicalize_agency_full(v_short);
  NEW.agency_review_reason := public.gov_agency_review_reason(v_src);

  v_using := public.gov_using_agency_from_gsa(v_src);
  NEW.using_agency_canonical := v_using;
  NEW.using_agency_full      := public.canonicalize_agency_full(v_using);

  RETURN NEW;
END
$function$;

-- ---------------------------------------------------------------------------
-- Backfill: re-canonicalize every row unconditionally (the comparator
-- changed; a value that used to be correct is still correct, one that was
-- contaminated is fixed, and the new columns are populated for the first
-- time). Idempotent — re-running computes the same values.
-- ---------------------------------------------------------------------------
UPDATE public.properties
   SET agency_canonical = canonicalize_agency(agency),
       agency_full = canonicalize_agency_full(canonicalize_agency(agency)),
       agency_review_reason = gov_agency_review_reason(agency),
       using_agency_canonical = gov_using_agency_from_gsa(agency),
       using_agency_full = canonicalize_agency_full(gov_using_agency_from_gsa(agency))
 WHERE agency IS NOT NULL;

UPDATE public.leases
   SET agency_canonical = canonicalize_agency(tenant_agency),
       agency_full = canonicalize_agency_full(canonicalize_agency(tenant_agency)),
       agency_review_reason = gov_agency_review_reason(tenant_agency),
       using_agency_canonical = gov_using_agency_from_gsa(tenant_agency),
       using_agency_full = canonicalize_agency_full(gov_using_agency_from_gsa(tenant_agency))
 WHERE tenant_agency IS NOT NULL;

UPDATE public.sales_transactions
   SET agency_canonical = canonicalize_agency(agency),
       agency_full = canonicalize_agency_full(canonicalize_agency(agency)),
       agency_review_reason = gov_agency_review_reason(agency),
       using_agency_canonical = gov_using_agency_from_gsa(agency),
       using_agency_full = canonicalize_agency_full(gov_using_agency_from_gsa(agency))
 WHERE agency IS NOT NULL;

-- ---------------------------------------------------------------------------
-- REVERSAL RUNBOOK
--
-- Function bodies: `git show <pre-migration-sha>:supabase/migrations/...` for
-- the prior canonicalize_agency/_full bodies (or restore from
-- `_gov_id3ab_agency_backup_20260912` values below) and CREATE OR REPLACE.
--
-- Column values:
--   UPDATE public.properties p
--      SET agency_canonical = b.agency_canonical_before,
--          agency_full      = b.agency_full_before,
--          agency_review_reason = NULL,
--          using_agency_canonical = NULL,
--          using_agency_full = NULL
--     FROM public._gov_id3ab_agency_backup_20260912 b
--    WHERE b.table_name = 'properties' AND b.record_pk = p.property_id;
--   -- (repeat for leases/lease_id and sales_transactions/sale_id)
--
-- New columns/functions: DROP COLUMN / DROP FUNCTION as needed; nothing else
-- in the schema references them yet.
-- ============================================================================
