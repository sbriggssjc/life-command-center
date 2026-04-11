-- =====================================================================
-- Address dedup migration — PART 5 of 5: drop the state table
-- =====================================================================
-- Optional tidy-up. Part 1 recreates lcc_dedup_pairs on the next
-- run, so it's fine to leave this table in place if you want to
-- inspect the pairs post-migration. Run this Part when you're done.
-- =====================================================================
BEGIN;
DROP TABLE IF EXISTS lcc_dedup_pairs;
COMMIT;


-- Sanity check (run after Part 5):
--   SELECT normalize_address_txt(address), lower(city), state, count(*)
--     FROM properties
--    WHERE address IS NOT NULL
--    GROUP BY 1, 2, 3 HAVING count(*) > 1;
