-- R25 Unit 2 — de-junk the P-CONTACT prospecting lane (2026-06-15)
--
-- A daily-driver walk found non-targets surfacing as prospecting contacts in
-- P-CONTACT: bare role labels ("Realtor"), label-colon fragments
-- ("Description:", "Mill Levy: 92.281", "CPA:16"), the GSA self artifact
-- ("GSA (US Gov't)"), and locale / foreign-address fragments ("Mexico",
-- "France", "Paris, PAR 75009", "Pedregal 24 oficina 423"). Two parts:
--
--   1. SOFT-FLAG the existing capture artifacts (`metadata.junk_name_flagged`),
--      a SQL mirror of `isJunkProspectName()` in api/_shared/entity-link.js, so
--      they route into the existing junk_entity_name Decision Center lane (the
--      lcc_refresh_decisions seed keys on the flag; junk_name_reviewed is left
--      unset so they surface for disposition). Reversible, never hard-deleted.
--      Locale matches are EXACT-anchored (^mexico$) so "State of New Mexico" and
--      "123 Mexico St" still pass.
--
--   2. EXCLUDE junk_name_flagged entities from the P-CONTACT branch of
--      v_priority_queue_live (the R11 follow-up, never done). This also drops
--      the ~40 already-flagged junk that were sitting in P-CONTACT. Applied as a
--      GUARDED DYNAMIC REPLACE of the single P-CONTACT predicate so every other
--      band stays byte-identical and a future view-shape drift aborts loudly
--      (rather than silently mis-patching).
--
-- Additive + cache-or-live safe. Idempotent.

-- ---------------------------------------------------------------------------
-- Part 1 — soft-flag the existing prospect-junk artifacts
-- ---------------------------------------------------------------------------
UPDATE public.entities e
SET metadata = COALESCE(e.metadata, '{}'::jsonb)
             || jsonb_build_object('junk_name_flagged', true,
                                   'junk_name_source', 'r25_unit2_prospect_junk')
WHERE e.merged_into_entity_id IS NULL
  AND COALESCE((e.metadata ->> 'junk_name_flagged')::boolean, false) = false
  AND (
       e.name ~* '^\s*(realtor|broker|agent|investment\s+specialist|commercial\s+advisor|listing\s+agent|sales\s+associate|principal\s+broker)\s*$'
    OR e.name ~* '^[A-Za-z][A-Za-z .&''/-]*:\s*[\d.,%]*\s*$'
    OR e.name ~* '\mGSA\M\s*\(\s*US'
    OR e.name ~* '\moficina\M'
    OR e.name ~* '\mPAR\s+\d{4,5}\M'
    OR e.name ~* '^\s*(mexico|paris|france|canada|spain|london|madrid|toronto|berlin|tokyo|rome|england)\s*$'
  );

-- ---------------------------------------------------------------------------
-- Part 2 — exclude junk_name_flagged from the P-CONTACT branch
-- ---------------------------------------------------------------------------
DO $r25u2$
DECLARE
  v_def text;
  v_new text;
  v_search text;
  v_replace text;
BEGIN
  v_def := pg_get_viewdef('public.v_priority_queue_live'::regclass, true);

  -- Idempotency: the junk exclusion's anchor text is unique to this patch.
  IF position('je.id = cs.entity_id AND COALESCE((je.metadata' IN v_def) > 0 THEN
    RAISE NOTICE 'R25 Unit 2: P-CONTACT junk exclusion already present — skipping view replace';
    RETURN;
  END IF;

  -- The reachable_cadence NOT EXISTS with the `rc` alias is UNIQUE to the
  -- P-CONTACT branch (P0/P6/P7 use the IN (SELECT ... FROM reachable_cadence)
  -- form). Append a junk-name NOT EXISTS right after it.
  v_search := 'WHERE cs.next_touch_due IS NOT NULL AND cs.next_touch_due <= now() AND cs.entity_id IS NOT NULL AND NOT (EXISTS ( SELECT 1
           FROM reachable_cadence rc
          WHERE rc.entity_id = cs.entity_id))';
  v_replace := v_search || ' AND NOT (EXISTS ( SELECT 1
           FROM entities je
          WHERE je.id = cs.entity_id AND COALESCE((je.metadata ->> ''junk_name_flagged''::text)::boolean, false) = true))';

  v_new := replace(v_def, v_search, v_replace);
  IF v_new = v_def THEN
    RAISE EXCEPTION 'R25 Unit 2: P-CONTACT predicate not found in v_priority_queue_live — view shape changed, aborting';
  END IF;

  EXECUTE 'CREATE OR REPLACE VIEW public.v_priority_queue_live AS ' || v_new;
END
$r25u2$;
