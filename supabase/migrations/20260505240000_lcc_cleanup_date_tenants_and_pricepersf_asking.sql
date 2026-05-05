-- Round 76ej.s cleanup (2026-05-05) — date-shaped tenant junk +
-- asking-price-as-price-per-sf cleanup.
--
-- Companion to migration 20260505220000_lcc_cleanup_costar_sidebar_prose_pollution.sql.
-- That migration cleared the prose-fragment / non-digit values
-- but missed two real-world patterns the EPA Houston / Athens VA
-- listings exposed:
--
--  1. Date-shaped tenant_name. The EPA listing stored
--     "Lease Commencement 07/01/2025" as the tenant name because
--     pre-fix CREXi heuristic returned the row adjacent to the
--     "Lease" label. The previous cleanup didn't have a date
--     pattern. Add it now.
--
--  2. asking_price storing the Price/SF value (e.g. "$254", "$432")
--     because of the lookupCrexiField single-word fuzzy match that
--     returned price-per-sqft when the page didn't expose an
--     "Asking Price" structured row. The fix in commit e601358
--     (multi-word-only fuzzy) prevents new captures from doing
--     this, but already-stored entities still carry the bad value.
--     Detect by: asking_price has a digit (so the prior numeric
--     cleanup didn't touch it) but the absolute value is implausibly
--     small for a sale price (< $1,000) — those are price-per-SF
--     leaks.
--
-- Idempotent — re-running on clean data is a no-op.

BEGIN;

-- 1a. Date-shaped tenant_name / primary_tenant.
UPDATE public.entities
SET    metadata = metadata - 'tenant_name'
WHERE  metadata ? 'tenant_name'
  AND  metadata->>'tenant_name' IS NOT NULL
  AND  (
        metadata->>'tenant_name' ~* '\y(lease\s+commencement|lease\s+expiration|lease\s+date|lease\s+term|since|effective)\y'
     OR metadata->>'tenant_name' ~  '\d{1,2}/\d{1,2}/\d{2,4}'
     OR metadata->>'tenant_name' ~* '\y(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}\y'
     OR metadata->>'tenant_name' ~  '\y\d{4}-\d{1,2}-\d{1,2}\y'
       );

UPDATE public.entities
SET    metadata = metadata - 'primary_tenant'
WHERE  metadata ? 'primary_tenant'
  AND  metadata->>'primary_tenant' IS NOT NULL
  AND  (
        metadata->>'primary_tenant' ~* '\y(lease\s+commencement|lease\s+expiration|lease\s+date|lease\s+term|since|effective)\y'
     OR metadata->>'primary_tenant' ~  '\d{1,2}/\d{1,2}/\d{2,4}'
     OR metadata->>'primary_tenant' ~* '\y(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}\y'
     OR metadata->>'primary_tenant' ~  '\y\d{4}-\d{1,2}-\d{1,2}\y'
       );

-- 2. asking_price values that are actually price-per-SF leaks.
-- Strip the value when its parsed magnitude is below $1,000 — no
-- realistic asking_price for a CRE listing is under four figures.
-- This catches "$254" (Athens), "$432" (EPA), and similar.
UPDATE public.entities
SET    metadata = metadata - 'asking_price'
WHERE  metadata ? 'asking_price'
  AND  metadata->>'asking_price' IS NOT NULL
  AND  metadata->>'asking_price' <> ''
  AND  CASE
         WHEN metadata->>'asking_price' ~ '[0-9]'
           THEN (regexp_replace(metadata->>'asking_price', '[^0-9.]', '', 'g'))::numeric < 1000
         ELSE TRUE
       END;

COMMIT;
