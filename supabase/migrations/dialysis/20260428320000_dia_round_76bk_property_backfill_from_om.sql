-- ============================================================================
-- Round 76bk — Backfill dia.properties from existing OM extractions
--
-- Audit found a propagation gap Scott noticed: of 1,124 OM extractions in
-- last 14 days, 387 captured building_sf and 351 captured year_built —
-- but those values were not making it onto dia.properties.
--
-- Root cause: api/_handlers/intake-promoter.js promoteDiaPropertyFromOm()
-- patched year_built, lot_sf, parcel_number, lease_commencement, and the
-- anchor_rent trio — but NOT building_size and NOT land_area. Forward
-- path fixed in the JS commit; this migration backfills the existing
-- properties from staged_intake_extractions data already in LCC Opps.
--
-- 68 (property_id, building_sf, year_built, lot_sf_or_acres) tuples
-- ferried over from `staged_intake_extractions JOIN
-- staged_intake_promotions WHERE pipeline_result.domain='dialysis'` and
-- applied with the same conservative-fill semantics: only fill NULL or 0.
-- 61 properties patched (a few already had values from earlier touch).
--
-- Apply on dialysis project (zqzrriwuavgrquhisnoa).
-- ============================================================================

WITH ext(pid, bsf, yr, lot_sf_or_acres) AS (VALUES
  (22023, 10300, 1970, 0.96), (22484, 7203, 2019, 1.6), (22633, 6400, NULL, 2.3),
  (22676, 7002, 2019, 43560), (23052, 3528, 1999, 41382), (23289, 10655, 2016, 10890),
  (23354, 10533, 2018, 100711), (23400, 6173, 2019, 49222), (23483, 6064, 2016, 60984),
  (24653, 6416, 2024, 35295), (24655, 10316, 2006, 44867.28), (25114, 4320, 2004, 84513),
  (25203, 11040, 1989, 0.94), (25292, 7728, 1996, 54885.6), (25336, 16773, 1999, 169013),
  (25553, 6515, 1991, 35734), (25603, 8732, 2016, 57064), (25959, 5524, 2014, 44250),
  (26113, 5920, 2000, NULL), (27320, 7060, 1981, 51030), (27730, 5960, 1996, 72273.6),
  (27819, 6260, 2010, 42738.08), (27843, 7917, 2015, 125453), (27948, 8156, 1996, 54450),
  (28020, 8103, 2005, 43560), (28046, 7154, 2017, 101934), (28135, 4949, 2012, 90369),
  (28334, 4696, 2013, 23087), (28749, 6104, 1996, 65340), (29100, 16872, 1966, 50483),
  (29237, 7300, 2015, 47045), (29687, 6043, 2002, 55547), (29724, 6387, 2006, 56706),
  (29799, 14600, 1991, NULL), (30119, 11987, 1987, 51436), (31857, 5400, 2013, NULL),
  (31870, 8090, 2018, 1.89), (33743, 7536, 2004, 59187.36), (33976, 5995, 2012, 1.28),
  (35104, 5000, 1995, NULL), (35210, 6342, 2014, 37461.6), (35380, 15896, 1955, 51836.84),
  (35389, 5085, 1995, 26571), (35430, 5353, 2007, 19166), (35474, 8998, 2020, 48687.36),
  (35478, 28010, 1984, 90716), (35481, 6326, 1999, 15246), (35585, 6262, 2015, 104544),
  (35586, 10560, 1954, NULL), (35588, 23000, 2018, 211266), (35605, 11438, 1900, NULL),
  (35619, 5600, 1994, NULL), (35626, 15390, 2026, 46552.8), (35636, 6335, 2014, 36232.8),
  (35637, 30015, 2019, 92299), (35657, 5460, 2022, 66211), (35815, 8132, 1999, 23967),
  (36048, 5980, 1994, 47480), (36851, 6344, 2006, NULL), (37490, 13750, 2016, 63561.6),
  (37500, 5600, 2011, 2.42), (1415318, 7655, 2013, 56628)
)
UPDATE public.properties p
   SET building_size = CASE
        WHEN (p.building_size IS NULL OR p.building_size = 0)
         AND ext.bsf > 100 AND ext.bsf < 5000000
        THEN ext.bsf ELSE p.building_size END,
       year_built = CASE
        WHEN p.year_built IS NULL AND ext.yr BETWEEN 1800 AND 2030
        THEN ext.yr ELSE p.year_built END,
       land_area = CASE
        WHEN (p.land_area IS NULL OR p.land_area = 0) AND ext.lot_sf_or_acres IS NOT NULL
        THEN CASE
              WHEN ext.lot_sf_or_acres < 100 THEN ext.lot_sf_or_acres
              ELSE ROUND((ext.lot_sf_or_acres / 43560.0)::numeric, 3)
             END
        ELSE p.land_area END
  FROM ext WHERE p.property_id = ext.pid;
