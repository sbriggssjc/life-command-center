-- ============================================================================
-- QA-19 (2026-05-18, dia): mirror of gov norm_text fix with dia-specific
-- abbreviations added (DVA, FMC, CMS, ESRD, QIP, CKD, NPI).
--
-- See supabase/migrations/government/20260518190000_gov_qa19_norm_text_preserve_abbreviations.sql
-- for the full discovery writeup.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.norm_text(s text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH t AS (SELECT trim(coalesce(s, '')) AS v)
  SELECT CASE
    WHEN t.v = '' THEN NULL
    WHEN t.v <> upper(t.v) AND t.v <> lower(t.v) THEN t.v
    ELSE NULLIF(array_to_string(ARRAY(
      SELECT
        CASE
          WHEN w ~ '^[0-9]+(st|nd|rd|th)$' THEN lower(w)
          WHEN w ~ '^[0-9]' THEN w
          WHEN upper(w) IN (
            'N','S','E','W','NE','NW','SE','SW',
            'PO','POB',
            'GSA','IRS','DOJ','FBI','VA','USPS','DOD','HHS','FDA','NIH','CDC',
            'DOL','DOC','DHS','ICE','CBP','USCIS','TSA','USSS','ATF','DEA',
            'USMS','BOP','HUD','DOT','FAA','FEMA','OPM','SEC','BLS','NRC',
            'NLRB','EEOC','EPA','NOAA','USGS','USDA','DOE','USACE','NASA',
            'USAF','USMC','USCG','LSC','UHT','OSHA','FCC','FTC','SBA',
            'NSF','GAO','DHA',
            -- Dia-specific
            'DVA','FMC','NPI','CMS','ESRD','QIP','CKD'
          ) THEN upper(w)
          ELSE initcap(lower(w))
        END
      FROM unnest(regexp_split_to_array(t.v, '\s+')) AS w
      WHERE w <> ''
    ), ' '), '')
  END
  FROM t;
$$;
