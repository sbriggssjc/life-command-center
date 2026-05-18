-- ============================================================================
-- QA-19 (2026-05-18, gov): norm_text was clobbering canonical address data.
--
-- The previous norm_text() did `initcap(trim(s))` which turned
-- "1200 New Jersey Ave SE" → "1200 New Jersey Ave Se" on every read. After
-- QA-12 + QA-18 canonicalized properties.address, v_property_detail re-
-- stripped the data via norm_text on every query, undoing both backfills
-- at read time. Same story for v_lease_detail, v_ownership_current, and
-- v_ownership_chain (all wrap columns in norm_text).
--
-- New behavior (one function, four views fixed in one shot):
--   • Mixed-case input (has at least one upper AND one lower char): trust
--     the upstream, just trim. Most canonicalized data lands here.
--   • All-uppercase or all-lowercase input (legacy ingest from upstream
--     pipelines): smart title-case via the same logic as titlecase_address,
--     but with an expanded abbreviation preserve-set (adds GSA, IRS, DOJ,
--     FBI, VA, USPS, DOD, etc. plus direction codes SE/SW/NE/NW).
--
-- Verified at view level:
--   norm_text('1200 NEW JERSEY AVE SE') → "1200 New Jersey Ave SE"
--   norm_text('1200 New Jersey Ave SE') → "1200 New Jersey Ave SE"
--   norm_text('GSA HEADQUARTERS')        → "GSA Headquarters"
--   norm_text('po box 123')              → "PO Box 123"
--   norm_text('WASHINGTON')              → "Washington"
--
-- Already applied to gov (scknotsqkcheojiaewwh) on 2026-05-18 via Supabase
-- MCP. Companion dia migration applies the same change with dia-specific
-- abbreviations (DVA, FMC, CMS, etc.).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.norm_text(s text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH t AS (SELECT trim(coalesce(s, '')) AS v)
  SELECT CASE
    WHEN t.v = '' THEN NULL
    -- Mixed case (already canonical) → trust upstream
    WHEN t.v <> upper(t.v) AND t.v <> lower(t.v) THEN t.v
    -- All upper or all lower → smart title-case, preserve known abbreviations
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
            'NSF','GAO','DHA'
          ) THEN upper(w)
          ELSE initcap(lower(w))
        END
      FROM unnest(regexp_split_to_array(t.v, '\s+')) AS w
      WHERE w <> ''
    ), ' '), '')
  END
  FROM t;
$$;

COMMENT ON FUNCTION public.norm_text(text) IS
  'QA-19 (2026-05-18): mixed-case inputs are trusted (just trimmed) so canonical data from QA-12/QA-18 backfills isn''t clobbered. All-upper or all-lower legacy inputs get smart title-cased with direction/agency abbreviation preservation.';
