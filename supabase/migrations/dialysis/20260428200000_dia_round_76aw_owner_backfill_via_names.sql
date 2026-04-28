-- ============================================================================
-- Round 76aw — backfill properties.recorded_owner_id via name matching
--
-- Wider random-sample audit (Round 76av+) showed only 2/12 sampled
-- properties had recorded_owner_id set even though all had sales activity.
-- Database-wide: 1,422 properties had sales but no recorded_owner_id.
--
-- Round 76ak's earlier backfill only inherited from the linked sale's
-- own recorded_owner_id — but most of those sales also had NULL
-- recorded_owner_id (they're bare CSV imports). Need name-match paths.
--
-- This migration adds three additional backfill passes (idempotent):
--
--   1. From sale.recorded_owner_name → recorded_owners.name (most precise)
--   2. From sale.buyer_name           → recorded_owners.name (next best)
--   3. From deed.grantee              → recorded_owners.name (last resort)
--
-- Result: 1,422 → 647 properties without recorded_owner_id (-55%).
--
-- Apply on dialysis project (zqzrriwuavgrquhisnoa).
-- ============================================================================

-- ── 1. recorded_owner_name match (already-canonical name from sale row) ────
WITH props_holes AS (
  SELECT p.property_id FROM public.properties p
  WHERE p.recorded_owner_id IS NULL
    AND EXISTS (SELECT 1 FROM public.sales_transactions s WHERE s.property_id = p.property_id)
),
candidate AS (
  SELECT DISTINCT ON (s.property_id) s.property_id, ro.recorded_owner_id
  FROM props_holes ph
  JOIN public.sales_transactions s ON s.property_id = ph.property_id
  JOIN public.recorded_owners ro ON normalize_entity_name(ro.name) = normalize_entity_name(s.recorded_owner_name)
  WHERE s.recorded_owner_name IS NOT NULL AND TRIM(s.recorded_owner_name) <> ''
  ORDER BY s.property_id, s.sale_date DESC NULLS LAST, s.sale_id DESC
)
UPDATE public.properties p SET recorded_owner_id = c.recorded_owner_id
  FROM candidate c WHERE p.property_id = c.property_id;

-- ── 2. buyer_name match for properties still missing ─────────────────────
WITH props_holes AS (
  SELECT p.property_id FROM public.properties p
  WHERE p.recorded_owner_id IS NULL
    AND EXISTS (SELECT 1 FROM public.sales_transactions s WHERE s.property_id = p.property_id)
),
candidate AS (
  SELECT DISTINCT ON (s.property_id) s.property_id, ro.recorded_owner_id
  FROM props_holes ph
  JOIN public.sales_transactions s ON s.property_id = ph.property_id
  JOIN public.recorded_owners ro ON normalize_entity_name(ro.name) = normalize_entity_name(s.buyer_name)
  WHERE s.buyer_name IS NOT NULL AND TRIM(s.buyer_name) <> ''
  ORDER BY s.property_id, s.sale_date DESC NULLS LAST, s.sale_id DESC
)
UPDATE public.properties p SET recorded_owner_id = c.recorded_owner_id
  FROM candidate c WHERE p.property_id = c.property_id;

-- ── 3. deed.grantee match for any property still missing (deed = legal owner) ──
WITH props_holes AS (
  SELECT p.property_id FROM public.properties p WHERE p.recorded_owner_id IS NULL
),
candidate AS (
  SELECT DISTINCT ON (d.property_id) d.property_id, ro.recorded_owner_id
  FROM props_holes ph
  JOIN public.deed_records d ON d.property_id = ph.property_id
  JOIN public.recorded_owners ro ON normalize_entity_name(ro.name) = normalize_entity_name(d.grantee)
  WHERE d.grantee IS NOT NULL AND TRIM(d.grantee) <> ''
  ORDER BY d.property_id, d.recording_date DESC NULLS LAST, d.id DESC
)
UPDATE public.properties p SET recorded_owner_id = c.recorded_owner_id
  FROM candidate c WHERE p.property_id = c.property_id;
