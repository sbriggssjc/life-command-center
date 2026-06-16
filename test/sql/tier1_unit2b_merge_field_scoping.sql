-- ============================================================================
-- TIER 1 · Unit 2b — lcc_merge_field same-source-refresh scoping proof
--
-- Target: LCC Opps (OPS_SUPABASE_URL, ref xengecqvemvfknjvbvrq)
--
-- Re-runnable, self-asserting, 0-residue regression proof for the root-cause fix
-- (same-source same-priority different value = refresh / newest wins; everything
-- else unchanged). Run as a single statement: any failed assertion RAISES and
-- rolls the whole block back (synthetic rows never persist); on success the block
-- deletes its own synthetic rows. Proves Scott's non-negotiable scoping:
--   A  same source,  same priority, diff value  -> WRITE (refresh, newest wins),
--      and the prior value is RETAINED as a superseded row (reversible).
--   B  DIFFERENT source, same priority, diff value -> CONFLICT (the 367 set's
--      mechanism is intact).
--   C  lower-priority source vs a higher-priority CURRENT authority -> SKIP
--      (a higher/curated/manual@1 authority can never be overridden).
--   C2 a higher-priority source refreshing ITSELF -> WRITE (refresh) — correct.
-- ============================================================================
DO $t$
DECLARE
  d text; rsn text; sup_cnt int;
BEGIN
  INSERT INTO public.field_source_priority (target_table, field_name, source, priority, min_confidence, enforce_mode)
  VALUES ('zz_t1_u2b','f1','costar_sidebar',55,0,'warn'),
         ('zz_t1_u2b','f1','rca',55,0,'warn'),
         ('zz_t1_u2b','f1','manual_decision',1,0,'warn');

  -- A: seed a costar write, then the SAME source re-captures a new value.
  SELECT decision INTO d FROM public.lcc_merge_field(NULL,'dia_db','zz_t1_u2b','1','f1','"A"'::jsonb,'costar_sidebar','t',0.6,NULL);
  IF d <> 'write' THEN RAISE EXCEPTION 'A-seed expected write, got %', d; END IF;
  SELECT decision, decision_reason INTO d, rsn FROM public.lcc_merge_field(NULL,'dia_db','zz_t1_u2b','1','f1','"B"'::jsonb,'costar_sidebar','t',0.6,NULL);
  IF d <> 'write' OR rsn NOT LIKE 'same_source_refresh%' THEN RAISE EXCEPTION 'A FAIL (same-source refresh): decision=% reason=%', d, rsn; END IF;
  SELECT count(*) INTO sup_cnt FROM public.field_provenance
   WHERE target_table='zz_t1_u2b' AND record_pk_value='1' AND field_name='f1' AND value='"A"'::jsonb AND decision='superseded';
  IF sup_cnt < 1 THEN RAISE EXCEPTION 'A FAIL: prior value "A" not retained as a recoverable superseded row'; END IF;

  -- B: a DIFFERENT source at the same priority disagrees -> still conflict.
  SELECT decision INTO d FROM public.lcc_merge_field(NULL,'dia_db','zz_t1_u2b','1','f1','"C"'::jsonb,'rca','t',0.6,NULL);
  IF d <> 'conflict' THEN RAISE EXCEPTION 'B FAIL (cross-source must stay conflict): got %', d; END IF;

  -- C: a higher-priority authority becomes current; a lower source can't override.
  PERFORM public.lcc_merge_field(NULL,'dia_db','zz_t1_u2b','1','f1','"M"'::jsonb,'manual_decision','t',1,NULL); -- @1 outranks @55 -> write
  SELECT decision INTO d FROM public.lcc_merge_field(NULL,'dia_db','zz_t1_u2b','1','f1','"X"'::jsonb,'costar_sidebar','t',0.6,NULL);
  IF d <> 'skip' THEN RAISE EXCEPTION 'C FAIL (higher-priority authority must be protected): got %', d; END IF;

  -- C2: the higher-priority source refreshing itself is a refresh (re-decision).
  SELECT decision, decision_reason INTO d, rsn FROM public.lcc_merge_field(NULL,'dia_db','zz_t1_u2b','1','f1','"M2"'::jsonb,'manual_decision','t',1,NULL);
  IF d <> 'write' OR rsn NOT LIKE 'same_source_refresh%' THEN RAISE EXCEPTION 'C2 FAIL (manual self-refresh): decision=% reason=%', d, rsn; END IF;

  DELETE FROM public.field_provenance     WHERE target_table='zz_t1_u2b';
  DELETE FROM public.field_source_priority WHERE target_table='zz_t1_u2b';
  RAISE NOTICE 'TIER1 Unit2b scoping proof: ALL PASS (A refresh+retained / B conflict / C higher-priority skip / C2 self-refresh)';
END $t$;
