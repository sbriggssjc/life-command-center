-- ============================================================================
-- W3.7 rider — backfill entity_match_labels.owner_b for owner_unification rows
--
-- gov-unification verdicts wrote entity_match_labels with owner_b = NULL
-- (api/admin.js owner_unification branch), leaving the Wave-4 training PAIR
-- incomplete: owner_a carried the recorded-owner name but owner_b (the matched
-- contact's resolved name) was dropped. The writer is fixed going forward
-- (owner_b = rc.candidate_display || rc.candidate_name || rc.candidate_company);
-- this migration backfills the pre-existing rows from the linked lcc_decisions
-- row's context, which still carries the resolved name.
--
-- Source of truth: lcc_decisions.context (the owner_unification card snapshot):
--   context->>'candidate_display'  e.g. "Micah Pinney (Legend Development LLC)"
--   context->>'candidate_name'     e.g. "Micah Pinney"
--   context->>'candidate_company'  e.g. "Legend Development LLC"
--
-- Discipline: FILL-BLANKS ONLY (owner_b IS NULL), scoped to the owner_unification
-- seeder, idempotent (re-run = no-op), reversible (see REVERSAL below). Never
-- fabricates — a row with no resolvable candidate name in its decision context is
-- left NULL.
-- ============================================================================

UPDATE public.entity_match_labels l
   SET owner_b = COALESCE(
        NULLIF(TRIM(d.context->>'candidate_display'), ''),
        NULLIF(TRIM(d.context->>'candidate_name'), ''),
        NULLIF(TRIM(d.context->>'candidate_company'), '')
      )
  FROM public.lcc_decisions d
 WHERE d.id = l.decision_id
   AND l.owner_b IS NULL
   AND l.seeder = 'owner_unification'
   AND COALESCE(
        NULLIF(TRIM(d.context->>'candidate_display'), ''),
        NULLIF(TRIM(d.context->>'candidate_name'), ''),
        NULLIF(TRIM(d.context->>'candidate_company'), '')
      ) IS NOT NULL;

-- Verify (expect owner_unification rows with owner_b now populated; any residual
-- NULLs are rows whose decision context carried no candidate name — never faked):
--   SELECT count(*) FILTER (WHERE owner_b IS NOT NULL) AS filled,
--          count(*) FILTER (WHERE owner_b IS NULL)     AS still_null
--   FROM public.entity_match_labels WHERE seeder='owner_unification';
--
-- REVERSAL (owner_b was NULL on every backfilled row, so this is exact):
--   UPDATE public.entity_match_labels l
--      SET owner_b = NULL
--     FROM public.lcc_decisions d
--    WHERE d.id = l.decision_id
--      AND l.seeder = 'owner_unification'
--      AND l.owner_b = COALESCE(
--            NULLIF(TRIM(d.context->>'candidate_display'), ''),
--            NULLIF(TRIM(d.context->>'candidate_name'), ''),
--            NULLIF(TRIM(d.context->>'candidate_company'), ''));
