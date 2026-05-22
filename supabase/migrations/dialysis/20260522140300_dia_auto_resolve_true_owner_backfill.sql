-- ============================================================================
-- 20260522140300_dia_auto_resolve_true_owner_backfill.sql
-- DEVELOPER_BD_AUDIT_v3 — Phase A Topic 1 / WS3-e
--
-- Backfill pass that mirrors the sidebar-pipeline.js auto-resolve (lines
-- 7114-7167): for every recorded_owner without true_owner_id, find or
-- create the canonical true_owner and link. Also propagates the linkage
-- to ownership_history and sales_transactions buyer rows.
--
-- Filters:
--   - Skip federal-government anti-pattern names (USA, U S A, Federal, etc.)
--   - Skip obvious lender/mortgage company patterns (handled separately)
--
-- Multi-form name matching because the existing true_owners.normalized_name
-- column was computed by a different (buggy) normalizer than
-- public.dia_normalize_for_match — so we match on BOTH forms to maximize
-- linkage to existing canonical entities.
-- ============================================================================

-- PASS A: link recorded_owners to existing true_owners via multi-form name match
WITH to_link AS (
  SELECT DISTINCT ON (ro.recorded_owner_id)
    ro.recorded_owner_id, to_.true_owner_id
  FROM public.recorded_owners ro
  JOIN public.true_owners to_
    ON public.dia_normalize_for_match(to_.name) = public.dia_normalize_for_match(ro.name)
       OR LOWER(TRIM(to_.normalized_name)) = LOWER(TRIM(public.dia_normalize_for_match(ro.name)))
  WHERE ro.true_owner_id IS NULL
    AND ro.name IS NOT NULL AND TRIM(ro.name) <> ''
    AND ro.name !~* '^(u\.?\s*s\.?\s*a\.?|united states|us government|us treasury|federal government)\s*$'
    AND ro.name !~* '(mortgage|loan servic|trustee for cmbs|^bank of |^wells fargo)'
  ORDER BY ro.recorded_owner_id, to_.true_owner_id
)
UPDATE public.recorded_owners ro
SET true_owner_id = tl.true_owner_id
FROM to_link tl
WHERE ro.recorded_owner_id = tl.recorded_owner_id;

-- PASS B: create new true_owners for recorded_owners with no canonical match
INSERT INTO public.true_owners (name, normalized_name, city, state)
SELECT * FROM (
  SELECT DISTINCT ON (norm)
    ro.name, norm, ro.city, ro.state
  FROM public.recorded_owners ro
  CROSS JOIN LATERAL (SELECT public.dia_normalize_for_match(ro.name) AS norm) n
  WHERE ro.true_owner_id IS NULL
    AND ro.name IS NOT NULL AND TRIM(ro.name) <> ''
    AND ro.name !~* '^(u\.?\s*s\.?\s*a\.?|united states|us government|us treasury|federal government)\s*$'
    AND ro.name !~* '(mortgage|loan servic|trustee for cmbs|^bank of |^wells fargo)'
    AND NOT EXISTS (
      SELECT 1 FROM public.true_owners to_
      WHERE to_.normalized_name = n.norm
         OR public.dia_normalize_for_match(to_.name) = n.norm
         OR LOWER(TRIM(to_.normalized_name)) = LOWER(TRIM(n.norm))
    )
  ORDER BY norm, ro.recorded_owner_id
) u;

-- PASS C: link any newly-inserted true_owners back to their recorded_owners
UPDATE public.recorded_owners ro
SET true_owner_id = to_.true_owner_id
FROM public.true_owners to_
WHERE ro.true_owner_id IS NULL
  AND ro.name IS NOT NULL
  AND (
    public.dia_normalize_for_match(to_.name) = public.dia_normalize_for_match(ro.name)
    OR LOWER(TRIM(to_.normalized_name)) = LOWER(TRIM(public.dia_normalize_for_match(ro.name)))
  );

-- PASS D: propagate true_owner_id onto ownership_history
UPDATE public.ownership_history oh
SET true_owner_id = ro.true_owner_id
FROM public.recorded_owners ro
WHERE oh.recorded_owner_id = ro.recorded_owner_id
  AND oh.true_owner_id IS NULL
  AND ro.true_owner_id IS NOT NULL;

-- PASS E: propagate true_owner_id onto sales_transactions (buyer side)
UPDATE public.sales_transactions s
SET true_owner_id = ro.true_owner_id
FROM public.recorded_owners ro
WHERE s.recorded_owner_id = ro.recorded_owner_id
  AND s.true_owner_id IS NULL
  AND ro.true_owner_id IS NOT NULL;
