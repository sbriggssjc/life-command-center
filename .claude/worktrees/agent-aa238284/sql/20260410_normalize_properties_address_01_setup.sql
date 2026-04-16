-- =====================================================================
-- Address dedup migration — PART 1 of 5: function + state table
-- =====================================================================
-- Run this first. Creates normalize_address_txt() and builds the
-- lcc_dedup_pairs state table that Parts 2–4 consume. Then run
-- Part 2, Part 3, Part 4, Part 5 in order.
--
-- If any Part times out or fails to submit via the Supabase SQL
-- editor, run the whole migration via psql instead:
--
--   psql "<pooler connection string>" \
--     -f sql/20260410_normalize_properties_address_01_setup.sql \
--     -f sql/20260410_normalize_properties_address_02_merge.sql \
--     -f sql/20260410_normalize_properties_address_03_repoint.sql \
--     -f sql/20260410_normalize_properties_address_04_finalize.sql \
--     -f sql/20260410_normalize_properties_address_05_cleanup.sql
--
-- Safe to re-run: Part 1 drops and recreates lcc_dedup_pairs.
-- =====================================================================

BEGIN;
SET LOCAL statement_timeout = 0;

-- LANGUAGE sql (not plpgsql) so the planner can inline the regexp
-- chain into the INSERT INTO lcc_dedup_pairs scan and the Part 4
-- address rewrite, avoiding per-row plpgsql call overhead on what
-- is otherwise a full properties scan.
CREATE OR REPLACE FUNCTION normalize_address_txt(addr text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN addr IS NULL THEN ''
    ELSE lower(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
        btrim(addr),
        '\mStreet\M',    'St',   'gi'),
        '\mAvenue\M',    'Ave',  'gi'),
        '\mBoulevard\M', 'Blvd', 'gi'),
        '\mDrive\M',     'Dr',   'gi'),
        '\mRoad\M',      'Rd',   'gi'),
        '\mLane\M',      'Ln',   'gi'),
        '\mCourt\M',     'Ct',   'gi'),
        '\mPlace\M',     'Pl',   'gi'),
        '\mHighway\M',   'Hwy',  'gi'),
        '\mParkway\M',   'Pkwy', 'gi'),
        '\mCircle\M',    'Cir',  'gi'),
        '\mTrail\M',     'Trl',  'gi'),
        '\s+',           ' ',    'g')
    )
  END
$fn$;

-- Regular table (not TEMP) so state persists between the Part 1–4
-- transactions. Part 5 drops it.
DROP TABLE IF EXISTS lcc_dedup_pairs;
CREATE TABLE lcc_dedup_pairs (
  older_id  text PRIMARY KEY,
  target_id text NOT NULL
);

-- For each (normalized_address, lower(city), state) bucket with more
-- than one row, keep the most-recently-updated property (the CoStar
-- sidebar ingest) and emit one row per older → target pair.
INSERT INTO lcc_dedup_pairs (older_id, target_id)
SELECT grp.ids[k], grp.ids[1]
  FROM (
    SELECT array_agg(property_id::text
                     ORDER BY updated_at DESC NULLS LAST) AS ids
      FROM properties
     WHERE address IS NOT NULL
       AND city    IS NOT NULL
     GROUP BY normalize_address_txt(address), lower(city), state
    HAVING count(*) > 1
  ) grp
  CROSS JOIN LATERAL generate_series(2, array_length(grp.ids, 1)) AS k;

-- Quick check: how many dup pairs did we find?
--   SELECT count(*) FROM lcc_dedup_pairs;

COMMIT;
