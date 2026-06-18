-- ===========================================================================
-- CONNECTIVITY #1b — Step C: dia bridge-eligibility view (the live join, not
-- the stale counter)
-- Target DB: Dialysis_DB (zqzrriwuavgrquhisnoa)
-- Date: 2026-06-17
--
-- CONNECTIVITY #1 widened owner-bridge eligibility from "classified" to "in-use
-- real owner". The #1b gate found the denormalized `true_owners.current_property_
-- count` UNDERCOUNTS current owners (live: cpc>0 = 571 vs the live active-
-- ownership_history join = ~1,022 — and the broad in-use set is ~3,597), so a
-- bridge keyed on the counter misses ~450 current owners. This view defines
-- eligibility off the LIVE join so the gov + broad passes use one mechanism per
-- domain (gov's sibling keys on properties.true_owner_id since gov has no
-- recorded_owner→true_owner FK).
--
-- Eligibility = a real, in-use, non-operator true owner whose name is not
-- placeholder/structural junk:
--   * not merged away (merged_into_true_owner_id IS NULL)
--   * NOT an operator mis-recorded as owner (is_operator_not_owner = false)
--   * in-use: referenced by a non-merged recorded_owner OR an active
--     ownership_history row
--   * name passes the placeholder + structural junk guard (the SQL mirror of
--     entity-link.js isJunkEntityName / public.lcc_owner_name_is_junk on LCC Opps)
-- `is_current_owner` marks the CONSERVATIVE tier (owns property right now, via
-- the live active-ownership join) so the bridge can drain current-owners first.
-- `current_property_count` is carried for the drift audit ONLY (do not gate on it).
--
-- owner=postgres view (created by the migration role) so anon PostgREST reads
-- bypass RLS like the sibling v_*_portfolio views; the LCC owner-bridge pulls it
-- via the anon key. Additive + idempotent (CREATE OR REPLACE).
-- ===========================================================================

CREATE OR REPLACE VIEW public.v_bridge_eligible_owners AS
SELECT
  t.true_owner_id,
  t.name,
  t.owner_role,
  t.owner_role_source,
  t.owner_role_confidence,
  EXISTS (
    SELECT 1 FROM public.ownership_history oh
    WHERE oh.true_owner_id = t.true_owner_id
      AND oh.ownership_state = 'active'
      AND oh.ownership_end IS NULL
  ) AS is_current_owner,
  t.current_property_count   -- drift-audit only; eligibility uses the live join
FROM public.true_owners t
WHERE t.merged_into_true_owner_id IS NULL
  AND COALESCE(t.is_operator_not_owner, false) = false
  AND t.name IS NOT NULL
  AND (
    EXISTS (
      SELECT 1 FROM public.recorded_owners r
      WHERE r.true_owner_id = t.true_owner_id
        AND r.merged_into_recorded_owner_id IS NULL
    )
    OR EXISTS (
      SELECT 1 FROM public.ownership_history oh
      WHERE oh.true_owner_id = t.true_owner_id
        AND oh.ownership_state = 'active'
        AND oh.ownership_end IS NULL
    )
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
  'CONNECTIVITY #1b: in-use, non-operator, non-junk dia true_owners eligible for '
  'the LCC owner-bridge. Eligibility uses the LIVE recorded_owner / ownership_'
  'history join (NOT the stale current_property_count). is_current_owner = the '
  'conservative tier (owns property now). One view per domain; gov keys on '
  'properties.true_owner_id.';
