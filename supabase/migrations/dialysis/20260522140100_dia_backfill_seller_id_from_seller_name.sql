-- ============================================================================
-- 20260522140100_dia_backfill_seller_id_from_seller_name.sql
-- DEVELOPER_BD_AUDIT_v3 — Phase A Topic 1 / WS3-a-2
--
-- Resolves sales_transactions.seller_id from the existing seller_name text.
-- Pre-state on 2026-05-22: 74.6% of sales_transactions rows had seller_name
-- populated but only 0.1% had seller_id linked. This gap is the root cause
-- of the "missing developer" problem in ownership_history chain queries —
-- the developer's seller-side row is never created because the seller text
-- is never resolved to a recorded_owners entity.
-- ============================================================================

-- Helper: case-insensitive, punctuation-collapsed normalizer for entity matching.
-- Does NOT strip legal suffixes (LLC/Inc/etc) — those are part of the entity
-- identity. Compare against the existing buggy normalized_name column by
-- recomputing on read in the join below.
CREATE OR REPLACE FUNCTION public.dia_normalize_for_match(s TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT LOWER(TRIM(REGEXP_REPLACE(
    REGEXP_REPLACE(COALESCE(s, ''), '[[:punct:]]+', ' ', 'g'),
    '\s+', ' ', 'g'
  )))
$$;

COMMENT ON FUNCTION public.dia_normalize_for_match IS
  'DEVELOPER_BD_AUDIT_v3 helper. Lowercase + strip punctuation + collapse '
  'whitespace. Does NOT strip legal suffixes. Used to match seller_name text '
  'in sales_transactions to existing recorded_owners.name without depending '
  'on the legacy normalized_name column (which has known normalizer bugs).';

-- Statement 1: insert recorded_owners for seller_names with no normalized match
INSERT INTO public.recorded_owners (name, normalized_name)
SELECT DISTINCT TRIM(s.seller_name), public.dia_normalize_for_match(s.seller_name)
FROM public.sales_transactions s
WHERE s.seller_id IS NULL
  AND s.seller_name IS NOT NULL
  AND TRIM(s.seller_name) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.recorded_owners ro
    WHERE public.dia_normalize_for_match(ro.name) = public.dia_normalize_for_match(s.seller_name)
  );

-- Statement 2: link seller_id from matched recorded_owners (deterministic
-- pick when multiple recorded_owner rows share normalized name — that is a
-- separate dedup problem for WS4 entity resolution).
UPDATE public.sales_transactions s
SET seller_id = ro.recorded_owner_id
FROM (
  SELECT DISTINCT ON (public.dia_normalize_for_match(name))
    recorded_owner_id, public.dia_normalize_for_match(name) AS norm
  FROM public.recorded_owners
  WHERE name IS NOT NULL AND TRIM(name) <> ''
  ORDER BY public.dia_normalize_for_match(name), recorded_owner_id
) ro
WHERE s.seller_id IS NULL
  AND s.seller_name IS NOT NULL
  AND TRIM(s.seller_name) <> ''
  AND ro.norm = public.dia_normalize_for_match(s.seller_name);
