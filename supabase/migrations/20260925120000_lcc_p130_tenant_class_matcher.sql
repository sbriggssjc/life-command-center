-- ===========================================================================
-- P130 -- tenant EQUIVALENCE CLASS for matching note titles to properties
-- APPLIED LIVE to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-17.
-- Findings + method: docs/architecture/sf-note-records-ownership-bridge-2026-08.md
-- ===========================================================================
-- RESULT: in-scope note-title match 38.2% -> 61.0% (+1,045 tuples, 0 lost).
--
-- MY FIRST ATTEMPT WAS A NET LOSS DRESSED AS A GAIN. A normaliser that mapped
-- team shorthand to full names (DVA -> DAVITA, VA -> VETERANS AFFAIRS) scored
-- 37.9% -> 40.9%, which reads like progress. It was +654 newly matched and
-- -514 BROKEN. Net +3 points.
--
-- Cause: I aliased toward the full name without checking what LCC stores. LCC
-- stores BOTH, inconsistently:
--   DaVita  DAVITA KIDNEY CARE 1777 | DAVITA 262
--   GSA     GENERAL SERVICES ADMINISTRATION 1299 | GSA 171 | ...GSA 160
--   SSA     SSA 725 | GSA SOCIAL SECURITY ADMIN 150
--   VA      VA 212 | US DEPARTMENT OF VETERANS AFFAIRS 133 | VETERANS AFFAIRS 130
-- Mapping to any single canonical form breaks every row using the other form.
--
-- THE FIX is an equivalence CLASS applied to BOTH sides, not a one-way alias.
-- Every spelling -- note-side shorthand and LCC-side verbosity alike -- folds
-- onto one neutral token, and a match is "same class". Zero losses, because
-- nothing is rewritten toward one vocabulary.
--
-- It also promotes the parenthetical on property-type codes:
--   Multi (CBP) -> CBP, MOB (SSA) -> SSA
-- which is what makes the 1,262-row MULTI token usable at all.
--
-- LESSON: a normalisation that improves a headline number can still be
-- destroying matches underneath it. Any before/after MUST count newly-matched
-- and lost SEPARATELY -- one percentage would have said "+3 points, ship it"
-- and hidden 514 regressions.
--
-- Read-only helper. Writes nothing; used by the matching pass.
-- REVERSAL: DROP FUNCTION lcc_tenant_class(text);
-- ===========================================================================

CREATE OR REPLACE FUNCTION lcc_tenant_class(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH s0 AS (SELECT coalesce(p,'') t),
  -- property-type code carrying the real tenant in parentheses
  s1 AS (SELECT CASE WHEN t ~* '^(multi|mob|portfolio|asc)\s*\('
                     THEN regexp_replace(t,'^[^(]*\(([^)]+)\).*$','\1') ELSE t END t FROM s0),
  -- strip deal/status modifiers, then punctuation
  s2 AS (SELECT upper(btrim(regexp_replace(
           regexp_replace(t,'\s*[-–(]\s*(MT|M/T|ST|G/L|Leasehold|Condo|SOLD|Sold|Under Contract|Vacant|no costar)\s*\)?','','gi'),
           '[^A-Za-z0-9 ]',' ','g'))) t FROM s1),
  s3 AS (SELECT btrim(regexp_replace(t,'\s+',' ','g')) t FROM s2)
  SELECT CASE
    WHEN t ~ '\m(DVA|DAVITA)\M'                               THEN 'DAVITA'
    WHEN t ~ '\m(FMC|FRESENIUS)\M'                            THEN 'FRESENIUS'
    WHEN t ~ '\mSSA\M' OR t LIKE '%SOCIAL SECURITY%'          THEN 'SSA'
    WHEN t ~ '\mGSA\M' OR t LIKE '%GENERAL SERVICES ADMIN%'   THEN 'GSA'
    WHEN t ~ '\mVA\M'  OR t LIKE '%VETERANS AFFAIRS%'         THEN 'VA'
    WHEN t ~ '\mUSPS\M' OR t LIKE '%POSTAL SERVICE%'          THEN 'USPS'
    WHEN t ~ '\mUSDA\M' OR t LIKE '%AGRICULTURE%'             THEN 'USDA'
    WHEN t ~ '\mBLM\M' OR t LIKE '%BUREAU OF LAND%'           THEN 'BLM'
    WHEN t ~ '\mICE\M' OR t LIKE '%IMMIGRATION AND CUSTOMS%'  THEN 'ICE'
    WHEN t ~ '\mFBI\M' OR t LIKE '%FEDERAL BUREAU OF INVEST%' THEN 'FBI'
    WHEN t ~ '\mFPUC\M'                                       THEN 'FPUC'
    ELSE t END
  FROM s3;
$$;

COMMENT ON FUNCTION lcc_tenant_class(text) IS
  'P130: fold a tenant string onto an equivalence class so note-title shorthand (DVA, FMC, SSA) and LCC vocabulary (DaVita Kidney Care, Fresenius Medical Care, GSA Social Security Admin) collapse to the same token. Apply to BOTH sides. Deliberately NOT a one-way alias -- LCC stores several spellings per tenant, so canonicalising to one breaks the others (measured: -514 matches).';
