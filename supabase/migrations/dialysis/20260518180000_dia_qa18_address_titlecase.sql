-- ============================================================================
-- QA-18 (2026-05-18, dia): mirror of gov title-case fix.
-- See gov/20260518180000_gov_qa18_address_titlecase.sql for the writeup.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.titlecase_address(addr text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT NULLIF(array_to_string(ARRAY(
    SELECT
      CASE
        WHEN w ~ '^[0-9]+(st|nd|rd|th)$' THEN w
        WHEN w ~ '^[0-9]' THEN w
        WHEN upper(w) IN ('N','S','E','W','NE','NW','SE','SW') THEN upper(w)
        WHEN lower(w) = 'po' THEN 'PO'
        ELSE initcap(lower(w))
      END
    FROM unnest(regexp_split_to_array(coalesce(addr, ''), '\s+')) AS w
    WHERE w <> ''
  ), ' '), '');
$$;

UPDATE public.properties
SET address = public.titlecase_address(address)
WHERE address IS NOT NULL
  AND address ~ '\m[a-z]+\M'
  AND address IS DISTINCT FROM public.titlecase_address(address);
