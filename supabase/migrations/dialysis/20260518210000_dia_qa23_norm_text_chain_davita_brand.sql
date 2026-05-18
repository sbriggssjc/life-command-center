-- ============================================================================
-- QA-23 (2026-05-18, dia): chain canonicalize_davita_brand into norm_text
-- so v_property_detail.page_title (and the other 3 norm_text-dependent
-- views) get correct "DaVita" branding too — not just the underlying
-- properties.tenant column that QA-22 backfilled.
--
-- Discovery: QA pass #6 verification opened a DaVita-tenanted dia
-- property and the detail panel header still read "Davita Lakewood
-- Community Dialysis Center" even though QA-22's properties.tenant
-- backfill went 2,531 bad → 0. Root cause: v_property_detail__base builds
-- page_title from:
--   COALESCE(norm_text(pl.tenant), norm_text(pmc.facility_name),
--            norm_text(p.tenant::text), norm_text(p.address))
-- It pulls from leases.tenant and medicare_clinics.facility_name FIRST,
-- not from properties.tenant. Those two tables had:
--   • leases.tenant: 2,348 rows with "Davita" prefix
--   • medicare_clinics.facility_name: 6 rows with "Davita"
-- none of which were touched by QA-22.
--
-- Fix: chain canonicalize_davita_brand onto norm_text's output. Applies
-- to ALL paths (trusted-mixed-case AND smart-title-case), so mixed-case
-- inputs like "Davita Lakewood Community Dialysis Center" — which would
-- otherwise be trusted as-is by the QA-19 norm_text — also get the brand
-- correction. Idempotent (DaVita stays DaVita) and cheap (one
-- regex_replace), so safe to add to every read.
--
-- One function changed, 4 dependent views auto-fixed (v_property_detail,
-- v_lease_detail, v_ownership_current, v_ownership_chain).
--
-- Verified: v_property_detail.page_title for property 38564
--   Before: "Davita Lakewood Community Dialysis Center – Lakewood, WA"
--   After:  "DaVita Lakewood Community Dialysis Center – Lakewood, WA"
-- ============================================================================

CREATE OR REPLACE FUNCTION public.norm_text(s text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH t AS (SELECT trim(coalesce(s, '')) AS v),
  base AS (
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
              'DVA','FMC','NPI','CMS','ESRD','QIP','CKD'
            ) THEN upper(w)
            ELSE initcap(lower(w))
          END
        FROM unnest(regexp_split_to_array(t.v, '\s+')) AS w
        WHERE w <> ''
      ), ' '), '')
    END AS r
    FROM t
  )
  SELECT CASE
    WHEN base.r IS NULL THEN NULL
    ELSE public.canonicalize_davita_brand(base.r)
  END
  FROM base;
$$;

COMMENT ON FUNCTION public.norm_text(text) IS
  'QA-23 (2026-05-18): chains canonicalize_davita_brand onto the existing QA-19 norm_text. Mixed-case inputs still trusted; all-upper/lower still smart-title-cased; PLUS any "Davita"/"DAVITA" inside the result gets canonicalized to "DaVita".';
