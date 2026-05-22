-- ============================================================================
-- 20260522160000_gov_true_owner_merge_duplicates.sql
-- DEVELOPER_BD_AUDIT_v3 — Phase A Topic 1.6 (Entity Resolution, gov)
--
-- Same pattern as the dia migration but operating on gov. Pre-state on
-- 2026-05-22: 887 gov true_owners rows will be marked as duplicates (876
-- canonical entities surviving). Gov has much higher entity-resolution debt
-- than dia because every GSA property has its own SPE LLC named after the
-- property location.
-- ============================================================================

ALTER TABLE public.true_owners
  ADD COLUMN IF NOT EXISTS merged_into_true_owner_id UUID
    REFERENCES public.true_owners(true_owner_id);

CREATE INDEX IF NOT EXISTS idx_true_owners_merged_into
  ON public.true_owners (merged_into_true_owner_id)
  WHERE merged_into_true_owner_id IS NOT NULL;

COMMENT ON COLUMN public.true_owners.merged_into_true_owner_id IS
  'DEVELOPER_BD_AUDIT_v3 §11.8 Topic 1.6 entity resolution. When set, this '
  'row is a known case-only duplicate of the referenced canonical row.';

WITH canonical_pick AS (
  SELECT
    true_owner_id,
    public.gov_normalize_for_match(name) AS norm,
    ROW_NUMBER() OVER (
      PARTITION BY public.gov_normalize_for_match(name)
      ORDER BY
        (CASE
          WHEN owner_role IN ('developer','user_owner','operator') THEN 0
          WHEN owner_role = 'buyer' THEN 1
          WHEN owner_role = 'unknown' THEN 2
          ELSE 3
        END),
        ((CASE WHEN state IS NOT NULL THEN 1 ELSE 0 END) +
         (CASE WHEN entity_type IS NOT NULL THEN 1 ELSE 0 END)) DESC,
        true_owner_id
    ) AS rn
  FROM public.true_owners
  WHERE name IS NOT NULL AND TRIM(name) <> ''
    AND merged_into_true_owner_id IS NULL
),
to_merge AS (
  SELECT cp.true_owner_id AS dup_id, canonical.true_owner_id AS canonical_id
  FROM canonical_pick cp
  JOIN canonical_pick canonical ON canonical.norm = cp.norm AND canonical.rn = 1
  WHERE cp.rn > 1
)
UPDATE public.true_owners t
SET merged_into_true_owner_id = tm.canonical_id
FROM to_merge tm
WHERE t.true_owner_id = tm.dup_id;

CREATE OR REPLACE VIEW public.v_gov_true_owner_canonical AS
SELECT
  true_owner_id,
  COALESCE(merged_into_true_owner_id, true_owner_id) AS canonical_true_owner_id
FROM public.true_owners;

ALTER VIEW public.v_gov_true_owner_canonical SET (security_invoker = true);

COMMENT ON VIEW public.v_gov_true_owner_canonical IS
  'DEVELOPER_BD_AUDIT_v3 §11.8 Topic 1.6 helper.';
