-- Normalize dialysis.properties.state so the Properties tab state facet
-- shows a clean, deduplicated list of canonical US codes.
--
-- Before this migration, the column contained a mix of:
--   * lowercase codes ("al")
--   * leading/trailing whitespace ("AL ")
--   * full state names ("Alabama")
--   * foreign country codes (AD, AG, …)
--
-- This migration performs two passes:
--   1) Trim + uppercase every non-null value (fixes whitespace + casing).
--   2) Map the most common full-name spellings back to their 2-letter codes.
--   3) NULL out any value that is not in the canonical 50 states + DC + the
--      5 inhabited US territories (PR, VI, GU, AS, MP).
--
-- Run as a one-off against the dialysis Supabase project. Idempotent.

BEGIN;

-- 1. Trim + uppercase
UPDATE properties
   SET state = upper(trim(state))
 WHERE state IS NOT NULL
   AND state <> upper(trim(state));

-- 2. Expand common full-name spellings to 2-letter codes
UPDATE properties SET state = CASE state
    WHEN 'ALABAMA'        THEN 'AL'
    WHEN 'ALASKA'         THEN 'AK'
    WHEN 'ARIZONA'        THEN 'AZ'
    WHEN 'ARKANSAS'       THEN 'AR'
    WHEN 'CALIFORNIA'     THEN 'CA'
    WHEN 'COLORADO'       THEN 'CO'
    WHEN 'CONNECTICUT'    THEN 'CT'
    WHEN 'DELAWARE'       THEN 'DE'
    WHEN 'FLORIDA'        THEN 'FL'
    WHEN 'GEORGIA'        THEN 'GA'
    WHEN 'HAWAII'         THEN 'HI'
    WHEN 'IDAHO'          THEN 'ID'
    WHEN 'ILLINOIS'       THEN 'IL'
    WHEN 'INDIANA'        THEN 'IN'
    WHEN 'IOWA'           THEN 'IA'
    WHEN 'KANSAS'         THEN 'KS'
    WHEN 'KENTUCKY'       THEN 'KY'
    WHEN 'LOUISIANA'      THEN 'LA'
    WHEN 'MAINE'          THEN 'ME'
    WHEN 'MARYLAND'       THEN 'MD'
    WHEN 'MASSACHUSETTS'  THEN 'MA'
    WHEN 'MICHIGAN'       THEN 'MI'
    WHEN 'MINNESOTA'      THEN 'MN'
    WHEN 'MISSISSIPPI'    THEN 'MS'
    WHEN 'MISSOURI'       THEN 'MO'
    WHEN 'MONTANA'        THEN 'MT'
    WHEN 'NEBRASKA'       THEN 'NE'
    WHEN 'NEVADA'         THEN 'NV'
    WHEN 'NEW HAMPSHIRE'  THEN 'NH'
    WHEN 'NEW JERSEY'     THEN 'NJ'
    WHEN 'NEW MEXICO'     THEN 'NM'
    WHEN 'NEW YORK'       THEN 'NY'
    WHEN 'NORTH CAROLINA' THEN 'NC'
    WHEN 'NORTH DAKOTA'   THEN 'ND'
    WHEN 'OHIO'           THEN 'OH'
    WHEN 'OKLAHOMA'       THEN 'OK'
    WHEN 'OREGON'         THEN 'OR'
    WHEN 'PENNSYLVANIA'   THEN 'PA'
    WHEN 'RHODE ISLAND'   THEN 'RI'
    WHEN 'SOUTH CAROLINA' THEN 'SC'
    WHEN 'SOUTH DAKOTA'   THEN 'SD'
    WHEN 'TENNESSEE'      THEN 'TN'
    WHEN 'TEXAS'          THEN 'TX'
    WHEN 'UTAH'           THEN 'UT'
    WHEN 'VERMONT'        THEN 'VT'
    WHEN 'VIRGINIA'       THEN 'VA'
    WHEN 'WASHINGTON'     THEN 'WA'
    WHEN 'WEST VIRGINIA'  THEN 'WV'
    WHEN 'WISCONSIN'      THEN 'WI'
    WHEN 'WYOMING'        THEN 'WY'
    WHEN 'DISTRICT OF COLUMBIA' THEN 'DC'
    WHEN 'PUERTO RICO'    THEN 'PR'
    WHEN 'VIRGIN ISLANDS' THEN 'VI'
    WHEN 'U.S. VIRGIN ISLANDS' THEN 'VI'
    WHEN 'GUAM'           THEN 'GU'
    WHEN 'AMERICAN SAMOA' THEN 'AS'
    WHEN 'NORTHERN MARIANA ISLANDS' THEN 'MP'
    ELSE state
  END
 WHERE state IS NOT NULL
   AND length(state) > 2;

-- 3. Drop anything still non-canonical (foreign codes like AD, AG, misc junk)
UPDATE properties
   SET state = NULL
 WHERE state IS NOT NULL
   AND state NOT IN (
     'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
     'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
     'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
     'VA','WA','WV','WI','WY','DC','PR','VI','GU','AS','MP'
   );

-- Sanity check: the distinct set should now be <= 56 rows
-- SELECT state, count(*) FROM properties GROUP BY 1 ORDER BY 1;

COMMIT;
