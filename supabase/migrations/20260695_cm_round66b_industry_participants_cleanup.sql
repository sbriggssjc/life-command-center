-- =============================================================================
-- Migration: cm_dialysis_industry_participants — R66b cleanup
-- Project:   Dialysis_DB (zqzrriwuavgrquhisnoa)
-- Date:       2026-06-01
--
-- R66's cleanup removed "Unreported" but left THREE overlapping catch-all rows
-- in the export: "Independent" (#3, literal chain_organization value, 749),
-- "Other" (#7, literal value, 102), and the new "Other / Independent" remainder
-- (#11). The user's note ("clean this up") is only resolved when there is ONE
-- remainder bucket.
--
-- Fix: treat NULL + the literal labels independent/other/unreported/unknown/
-- n/a/none/'' as a single __CATCHALL__ that never competes for the Top-10, and
-- fold them all into one "Independent & Other Operators" row. Genuine named
-- operators (incl. "Independent Dialysis Foundation (IDF)") are preserved.
-- Column contract unchanged (period_end, subspecialty, rank, operator,
-- clinic_count, pct_of_market). Validated read-only + applied to prod 2026-06-01.
-- =============================================================================
CREATE OR REPLACE VIEW public.cm_dialysis_industry_participants AS
 WITH base AS (
   SELECT CASE
            WHEN chain_organization IS NULL THEN '__CATCHALL__'
            WHEN lower(btrim(chain_organization)) IN ('independent','other','unreported','unknown','n/a','none','') THEN '__CATCHALL__'
            ELSE btrim(chain_organization)
          END AS operator
   FROM medicare_clinics
 ), tot AS (SELECT count(*)::numeric AS n FROM base),
 agg AS (
   SELECT operator, count(*)::integer AS clinic_count,
     count(*)::numeric / (SELECT n FROM tot) AS pct_of_market
   FROM base GROUP BY operator
 ), ranked AS (
   SELECT operator, clinic_count, pct_of_market,
     row_number() OVER (ORDER BY clinic_count DESC) AS rn
   FROM agg WHERE operator <> '__CATCHALL__'
 ), top10 AS (
   SELECT rn::integer AS rank, operator, clinic_count, pct_of_market FROM ranked WHERE rn <= 10
 ), other AS (
   SELECT 11 AS rank, 'Independent & Other Operators'::text AS operator,
     ( (SELECT COALESCE(sum(clinic_count),0) FROM ranked WHERE rn > 10)
       + (SELECT COALESCE(clinic_count,0) FROM agg WHERE operator='__CATCHALL__') )::integer AS clinic_count,
     ( (SELECT COALESCE(sum(pct_of_market),0) FROM ranked WHERE rn > 10)
       + (SELECT COALESCE(pct_of_market,0) FROM agg WHERE operator='__CATCHALL__') ) AS pct_of_market
 )
 SELECT CURRENT_DATE AS period_end, 'all'::text AS subspecialty, u.rank, u.operator, u.clinic_count, u.pct_of_market
 FROM (SELECT * FROM top10 UNION ALL SELECT * FROM other WHERE clinic_count > 0) u
 ORDER BY u.rank;
