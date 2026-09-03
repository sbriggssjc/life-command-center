-- UX-T1a-debt follow-up: lcc_mirror_tick has TWO MORE leg gates that the first pass
-- missed, and the leg was silently skipped because of them.
-- APPLIED LIVE to xengecqvemvfknjvbvrq 2026-09-03.
--
-- ⚠️ THE LESSON, PAID FOR IN THIS ROUND: teaching the tick a new leg needs FIVE edits,
-- not three -- the keyset key column, the apply dispatch, the source path/select, the
-- DEFAULT leg array, and a hard-coded allowlist `IF v_leg NOT IN (...) THEN CONTINUE`.
-- The first migration made three of them, every assertion passed, every wiring probe
-- (path / dispatch / keycol present in the definition) returned true, and the leg still
-- did nothing: `lcc_mirror_tick('loan_maturity', ...)` returned
-- {"fired":0,"errors":0,"applied":0,"consumed":0} -- which is byte-identical to a leg
-- that is genuinely caught up. It was found by WALKING the leg and reading the state
-- delta, never by the wiring assertions.
-- A `CONTINUE` in an allowlist is invisible to a detector that only asks whether the new
-- code is PRESENT. Assert on the state delta (rows landed), never on the wiring.

DO $outer$
DECLARE
  v_def text;
  l_old text := 'ARRAY[''property_attributes'',''property_owner_facts'',''listing_events''] ELSE ARRAY[p_leg] END;';
  l_new text := 'ARRAY[''property_attributes'',''property_owner_facts'',''listing_events'',''loan_maturity''] ELSE ARRAY[p_leg] END;';
  g_old text := 'IF v_leg NOT IN (''property_attributes'',''property_owner_facts'',''listing_events'') THEN CONTINUE; END IF;';
  g_new text := 'IF v_leg NOT IN (''property_attributes'',''property_owner_facts'',''listing_events'',''loan_maturity'') THEN CONTINUE; END IF;';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='lcc_mirror_tick';
  IF v_def IS NULL THEN RAISE EXCEPTION 'lcc_mirror_tick not found'; END IF;

  IF position(l_new IN v_def) > 0 AND position(g_new IN v_def) > 0 THEN
    RAISE NOTICE 'already applied'; RETURN;
  END IF;
  IF position(l_old IN v_def) = 0 OR position(g_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'UX-T1a-debt: leg array (%) or allowlist guard (%) not found verbatim',
      position(l_old IN v_def) > 0, position(g_old IN v_def) > 0;
  END IF;

  v_def := replace(v_def, l_old, l_new);
  v_def := replace(v_def, g_old, g_new);
  IF position(l_new IN v_def)=0 OR position(g_new IN v_def)=0 THEN
    RAISE EXCEPTION 'UX-T1a-debt: replacement did not take';
  END IF;
  EXECUTE v_def;
END $outer$;

-- After this, lcc_mirror_tick('loan_maturity', null) returns fired:2 and, on the next
-- tick, applied:568 / consumed:2 -- gov 413 + dia 155, matching both sources exactly.
