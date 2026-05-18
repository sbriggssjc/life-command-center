-- ============================================================================
-- QA-18 (2026-05-18, gov): Title-case the street-name part of addresses.
--
-- QA-12 fixed direction suffixes (Se→SE) but left full-lowercase addresses
-- like "240 w 5th ave" untouched. QA pass #2 surfaced one such address
-- in the Agency Drift widget on the Research page. This adds a broader
-- title-case function that handles:
--   • Title-case ordinary words: "main" → "Main", "ave" → "Ave"
--   • Keep direction abbreviations uppercase: N/S/E/W/NE/NW/SE/SW
--   • Keep "PO" uppercase (PO Box convention)
--   • Leave ordinals alone: "5th" stays "5th" (not "5Th")
--   • Leave digit-starting words alone: "240", "1200"
--
-- The UPDATE is gated on a predicate that only matches addresses with at
-- least one all-lowercase word, so addresses like "McMillan Blvd" (mixed
-- case) are NOT touched — we don't want to collapse correct mixed-case
-- names to "Mcmillan".
--
-- Backfill: 10,787 → 80 remaining on gov (the 80 are mostly addresses where
-- the only remaining lowercase word is a correct ordinal like "5th").
--
-- No trigger — title-casing on every UPDATE would clobber mixed-case
-- proper names. The existing QA-12 trigger handles direction suffixes
-- (which can't lose information) on writes.
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

COMMENT ON FUNCTION public.titlecase_address(text) IS
  'QA-18: title-case a street address. Preserves digit-starting words, ordinals, direction abbreviations (N/NE/SE/etc.), and "PO" (Box). Strips internal mixed-case names to title-case (McMillan→Mcmillan) — gated callers should only apply to addresses with at least one all-lowercase word to avoid clobbering correct names.';

UPDATE public.properties
SET address = public.titlecase_address(address)
WHERE address IS NOT NULL
  AND address ~ '\m[a-z]+\M'
  AND address IS DISTINCT FROM public.titlecase_address(address);
