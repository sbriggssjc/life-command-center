-- ============================================================================
-- 20260522160000_dia_true_owner_merge_duplicates.sql
-- DEVELOPER_BD_AUDIT_v3 — Phase A Topic 1.6 (Entity Resolution, dia case-only)
--
-- Adds merged_into_true_owner_id column to true_owners and marks case-only
-- duplicates (entities with identical normalized names but different case/
-- punctuation). The duplicate rows are NOT deleted — read paths follow the
-- merge chain via COALESCE(merged_into_true_owner_id, true_owner_id).
--
-- This is the SAFE entity-resolution scope: only merges entities where
-- public.dia_normalize_for_match(name) produces identical output. Fuzzy
-- merges (Levenshtein, abbreviation expansion like "Dev" → "Development")
-- are deferred to a separate manual-review round.
--
-- Pre-state on 2026-05-22: 131 dia true_owners rows will be marked as
-- duplicates (124 canonical entities surviving).
--
-- Canonical selection priority:
--   1. Prefer rows already classified with a strong owner_role
--      (developer / user_owner / operator > buyer > unknown)
--   2. Prefer rows with more populated metadata (city, state, contact_id)
--   3. Tie-break by lowest UUID for determinism
-- ============================================================================

ALTER TABLE public.true_owners
  ADD COLUMN IF NOT EXISTS merged_into_true_owner_id UUID
    REFERENCES public.true_owners(true_owner_id);

CREATE INDEX IF NOT EXISTS idx_true_owners_merged_into
  ON public.true_owners (merged_into_true_owner_id)
  WHERE merged_into_true_owner_id IS NOT NULL;

COMMENT ON COLUMN public.true_owners.merged_into_true_owner_id IS
  'DEVELOPER_BD_AUDIT_v3 §11.8 Topic 1.6 entity resolution. When set, this '
  'row is a known case-only duplicate of the referenced canonical row. Read '
  'paths must follow the merge chain via COALESCE(merged_into_true_owner_id, '
  'true_owner_id) to consolidate stats across variants. Duplicate rows are '
  'NOT deleted (preserves FK integrity); they remain queryable but should '
  'not be treated as distinct entities.';

-- Mark case-only duplicates
WITH canonical_pick AS (
  SELECT
    true_owner_id,
    public.dia_normalize_for_match(name) AS norm,
    ROW_NUMBER() OVER (
      PARTITION BY public.dia_normalize_for_match(name)
      ORDER BY
        -- 1. Prefer rows with strong owner_role classification
        (CASE
          WHEN owner_role IN ('developer','user_owner','operator') THEN 0
          WHEN owner_role = 'buyer' THEN 1
          WHEN owner_role = 'unknown' THEN 2
          ELSE 3
        END),
        -- 2. Prefer rows with more populated metadata
        ((CASE WHEN city IS NOT NULL THEN 1 ELSE 0 END) +
         (CASE WHEN state IS NOT NULL THEN 1 ELSE 0 END) +
         (CASE WHEN contact_id IS NOT NULL THEN 1 ELSE 0 END) +
         (CASE WHEN salesforce_id IS NOT NULL THEN 1 ELSE 0 END)) DESC,
        -- 3. Tie-break: lowest UUID for determinism
        true_owner_id
    ) AS rn
  FROM public.true_owners
  WHERE name IS NOT NULL AND TRIM(name) <> ''
    AND merged_into_true_owner_id IS NULL  -- idempotent: skip already-merged rows
),
to_merge AS (
  SELECT
    cp.true_owner_id AS dup_id,
    canonical.true_owner_id AS canonical_id
  FROM canonical_pick cp
  JOIN canonical_pick canonical ON canonical.norm = cp.norm AND canonical.rn = 1
  WHERE cp.rn > 1
)
UPDATE public.true_owners t
SET merged_into_true_owner_id = tm.canonical_id
FROM to_merge tm
WHERE t.true_owner_id = tm.dup_id;

-- Helper view for downstream consumers
CREATE OR REPLACE VIEW public.v_dia_true_owner_canonical AS
SELECT
  true_owner_id,
  COALESCE(merged_into_true_owner_id, true_owner_id) AS canonical_true_owner_id
FROM public.true_owners;

ALTER VIEW public.v_dia_true_owner_canonical SET (security_invoker = true);

COMMENT ON VIEW public.v_dia_true_owner_canonical IS
  'DEVELOPER_BD_AUDIT_v3 §11.8 Topic 1.6 helper. Resolves any true_owner_id '
  '(canonical or duplicate) to its canonical_true_owner_id. Use in JOINs '
  'when read paths need merge-aware aggregation.';
