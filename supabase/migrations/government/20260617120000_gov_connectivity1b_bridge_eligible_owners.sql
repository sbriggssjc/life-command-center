-- ===========================================================================
-- CONNECTIVITY #1b — Step C: gov bridge-eligibility view (the live FK join)
-- Target DB: government (scknotsqkcheojiaewwh)
-- Date: 2026-06-17
--
-- gov sibling of the dia v_bridge_eligible_owners. gov has NO recorded_owner →
-- true_owner FK (the gov recorded model differs), so the in-use signal is the
-- direct `properties.true_owner_id` FK. gov true_owners also have no
-- `is_operator_not_owner` flag (no dialysis-operator confusion) and no
-- `current_property_count` counter — so the conservative tier keys on a
-- non-archived property reference (consistent with R23's archived-exclusion
-- doctrine for the value mirror).
--
-- Eligibility = a real, in-use, non-junk gov true owner:
--   * not merged away (merged_into_true_owner_id IS NULL)
--   * in-use: referenced by any properties.true_owner_id
--   * name passes the placeholder + structural junk guard (SQL mirror of
--     entity-link.js isJunkEntityName / public.lcc_owner_name_is_junk).
-- `is_current_owner` = referenced by a NON-archived property (the conservative
-- tier). owner=postgres view + anon grant so the LCC owner-bridge pulls it via
-- the anon key (RLS-bypass like the sibling v_*_portfolio views). Additive +
-- idempotent.
-- ===========================================================================

CREATE OR REPLACE VIEW public.v_bridge_eligible_owners AS
SELECT
  t.true_owner_id,
  t.name,
  t.owner_role,
  t.owner_role_source,
  t.owner_role_confidence,
  EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.true_owner_id = t.true_owner_id
      AND p.status IS DISTINCT FROM 'archived'
  ) AS is_current_owner
FROM public.true_owners t
WHERE t.merged_into_true_owner_id IS NULL
  AND t.name IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.true_owner_id = t.true_owner_id
  )
  -- Placeholder / form-field / account-number owner cells (CONNECTIVITY #1b).
  AND t.name !~* '^\s*\d{5,}\s*(ira|llc|l\.l\.c|lp|llp|inc|corp|trust)?\s*$'
  AND t.name !~* '^\s*\d{4,}\s+ira\s*$'
  AND t.name !~* ':\s*(yes|no)\s*$'
  AND t.name !~* '^\s*(1031\s+)?exchange\s+buyer\s*$'
  AND t.name !~* '^\s*(buyer|seller|escrow)\s*$'
  -- Structural junk (phone / email / contacts-header / phone-type bleed).
  AND t.name !~ '\(\d{3}\)\s*\d{3}[-.\s]?\d{4}'
  AND t.name !~ '\m\d{3}[-.]\d{3}[-.]\d{4}\M'
  AND t.name !~* '(buyer|seller)\s*contacts?'
  AND t.name !~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
  AND t.name !~* '\(\s*[pcmf]\s*\)';

GRANT SELECT ON public.v_bridge_eligible_owners TO anon, authenticated;

COMMENT ON VIEW public.v_bridge_eligible_owners IS
  'CONNECTIVITY #1b: in-use, non-junk gov true_owners eligible for the LCC owner-'
  'bridge. gov has no recorded_owner->true_owner FK, so in-use keys on '
  'properties.true_owner_id; is_current_owner = referenced by a non-archived '
  'property (conservative tier).';
