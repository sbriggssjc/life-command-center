-- CONNECTIVITY #1b — drain-gate tightening (dia): exclude null-ish "no owner
-- known" placeholder names (Unknown / N/A / None / TBD / Undisclosed / Various)
-- from v_bridge_eligible_owners. Surfaced on the capped→drain dia conservative
-- pass (a true_owner literally named "Unknown" was eligible). Whole-name
-- anchored — "Various Partners LLC" still passes. CREATE OR REPLACE; the body is
-- the 20260617120000 view + one WHERE line. Mirrors public.lcc_owner_name_is_junk.
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
  t.current_property_count
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
  AND t.name !~* '^\s*\d{5,}\s*(ira|llc|l\.l\.c|lp|llp|inc|corp|trust)?\s*$'
  AND t.name !~* '^\s*\d{4,}\s+ira\s*$'
  AND t.name !~* ':\s*(yes|no)\s*$'
  AND t.name !~* '^\s*(1031\s+)?exchange\s+buyer\s*$'
  AND t.name !~* '^\s*(buyer|seller|escrow)\s*$'
  AND t.name !~* '^\s*(unknown(\s+owner)?|n/?a|n\.a\.?|none|tbd|not\s+available|undisclosed|various)\s*$'
  AND t.name !~ '\(\d{3}\)\s*\d{3}[-.\s]?\d{4}'
  AND t.name !~ '\m\d{3}[-.]\d{3}[-.]\d{4}\M'
  AND t.name !~* '(buyer|seller)\s*contacts?'
  AND t.name !~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
  AND t.name !~* '\(\s*[pcmf]\s*\)';

GRANT SELECT ON public.v_bridge_eligible_owners TO anon, authenticated;
