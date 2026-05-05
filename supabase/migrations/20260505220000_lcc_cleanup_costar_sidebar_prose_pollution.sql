-- Round 76ej.n cleanup (2026-05-05) — clear stored prose-fragment junk
-- from entity.metadata that was stamped onto LCC entities by the
-- pre-fix CREXi findTextElement() heuristic.
--
-- The crexi.js parser fix (commits e601358 / 5a685c9) prevents NEW
-- captures from poisoning these fields, and the sidepanel.js read
-- filter (commit 4b2db4c) hides existing junk at render time. This
-- migration is the third leg: a one-shot UPDATE that removes the
-- junk from storage so the values are gone permanently regardless
-- of extension state.
--
-- Patterns being cleaned:
--   tenant_name = "Quality Construction and new HVAC systems"
--                  (and any other value matching the same prose
--                   shape — long, contains HVAC, descriptive
--                   phrase rather than a tenant noun-phrase)
--   cap_rate    = "Valuation Metrics" (and any other non-numeric
--                   value where a numeric is expected)
--
-- The cleanup is idempotent: re-running it on already-clean data
-- is a no-op because the WHERE clauses only match the junk shapes.

BEGIN;

-- 1. Tenant name — clear values that match the heuristic-pollution
-- shape. Anchored regexes so we don't accidentally null out
-- legitimate tenant names that happen to contain "and".
UPDATE public.entities
SET    metadata = metadata - 'tenant_name'
WHERE  metadata ? 'tenant_name'
  AND  metadata->>'tenant_name' IS NOT NULL
  AND  (
        length(metadata->>'tenant_name') > 60
     OR metadata->>'tenant_name' ~* '\yhvac\y'
     OR metadata->>'tenant_name' ~* '\y(quality|new|recent|modern)\s+construction\y'
     OR metadata->>'tenant_name' ~* '\y(systems?|amenities|features?|upgrades?|improvements?)\y.*\yand\y'
     OR metadata->>'tenant_name' ~* '\yand\y.*\y(systems?|amenities|features?|hvac|construction|upgrades?)\y'
     OR metadata->>'tenant_name' ~* '^(valuation\s+metrics|investment\s+highlights?|property\s+overview|sale\s+highlights?|key\s+highlights?|executive\s+summary)$'
       );

UPDATE public.entities
SET    metadata = metadata - 'primary_tenant'
WHERE  metadata ? 'primary_tenant'
  AND  metadata->>'primary_tenant' IS NOT NULL
  AND  (
        length(metadata->>'primary_tenant') > 60
     OR metadata->>'primary_tenant' ~* '\yhvac\y'
     OR metadata->>'primary_tenant' ~* '\y(quality|new|recent|modern)\s+construction\y'
     OR metadata->>'primary_tenant' ~* '\y(systems?|amenities|features?|upgrades?|improvements?)\y.*\yand\y'
     OR metadata->>'primary_tenant' ~* '\yand\y.*\y(systems?|amenities|features?|hvac|construction|upgrades?)\y'
     OR metadata->>'primary_tenant' ~* '^(valuation\s+metrics|investment\s+highlights?|property\s+overview|sale\s+highlights?|key\s+highlights?|executive\s+summary)$'
       );

-- 2. Numeric-flavored fields — clear any value that doesn't contain
-- a digit. "Valuation Metrics", "Investment Highlights", "Property
-- Overview" all fail the digit check; real values like "8.25%",
-- "$573,546", "59,878", "2007" all pass.
UPDATE public.entities
SET    metadata = metadata - key
FROM   (
  SELECT  unnest(ARRAY[
            'cap_rate', 'noi', 'asking_price', 'price_per_sf',
            'occupancy', 'square_footage', 'year_built',
            'acreage', 'stories', 'lease_term', 'remaining_term'
          ]) AS key
) k
WHERE  metadata ? k.key
  AND  metadata->>(k.key) IS NOT NULL
  AND  metadata->>(k.key) !~ '[0-9]';

COMMIT;

-- Audit: how many entities still carry one of the cleaned fields
-- with a non-numeric / prose-shaped value (should be 0 after the
-- migration runs):
--
-- SELECT count(*) AS still_polluted
-- FROM   public.entities
-- WHERE  metadata->>'tenant_name' ~* '\yhvac\y'
--    OR  (metadata ? 'cap_rate' AND metadata->>'cap_rate' !~ '[0-9]')
--    OR  (metadata ? 'noi'      AND metadata->>'noi'      !~ '[0-9]');
