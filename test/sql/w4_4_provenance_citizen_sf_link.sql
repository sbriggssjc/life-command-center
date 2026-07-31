-- ============================================================================
-- W4.4 · provenance-citizen ladder proof — splink_v1 / sf_link_review_human
--
-- Target: LCC Opps (OPS_SUPABASE_URL, ref xengecqvemvfknjvbvrq)
--
-- Re-runnable, self-asserting, 0-residue proof that the W4.4 registration
-- (migration 20260819120000) makes the SF-link writers first-class field-priority
-- citizens with the correct trust order:
--   sf_link_review_human (priority 1, human)  >  splink_v1 (priority 50, model)
-- It exercises lcc_merge_field on the REAL registered rows (gov.true_owners /
-- sf_account_id) so it is a genuine registry-shape test, not a synthetic ladder.
--
--   A  model tries to override a human-held value  -> SKIP  (human is untouchable)
--   B  human overrides a model-held value          -> WRITE (human wins)
--
-- Run as one statement: a failed assertion RAISES and rolls the whole block back
-- (synthetic ledger rows never persist); on success it deletes its own synthetic
-- field_provenance rows. The registered field_source_priority rows are never
-- touched.
-- ============================================================================
DO $t$
DECLARE d text;
BEGIN
  -- A: human writes first (authority), then the model tries a different value.
  PERFORM public.lcc_merge_field(NULL,'gov_db','gov.true_owners','zz_w4_4_pk','sf_account_id','"SF-HUMAN"'::jsonb,'sf_link_review_human','t',0.99,NULL);
  SELECT decision INTO d FROM public.lcc_merge_field(NULL,'gov_db','gov.true_owners','zz_w4_4_pk','sf_account_id','"SF-MODEL"'::jsonb,'splink_v1','t',0.9,NULL);
  IF d <> 'skip' THEN RAISE EXCEPTION 'A FAIL: model over human expected skip, got %', d; END IF;

  -- B: model writes first, then the human overrides with a different value.
  PERFORM public.lcc_merge_field(NULL,'gov_db','gov.true_owners','zz_w4_4_pk2','sf_account_id','"SF-MODEL"'::jsonb,'splink_v1','t',0.9,NULL);
  SELECT decision INTO d FROM public.lcc_merge_field(NULL,'gov_db','gov.true_owners','zz_w4_4_pk2','sf_account_id','"SF-HUMAN"'::jsonb,'sf_link_review_human','t',0.99,NULL);
  IF d <> 'write' THEN RAISE EXCEPTION 'B FAIL: human over model expected write, got %', d; END IF;

  -- 0-residue: remove only the synthetic ledger rows for the two test PKs.
  DELETE FROM public.field_provenance
   WHERE target_table='gov.true_owners'
     AND record_pk_value IN ('zz_w4_4_pk','zz_w4_4_pk2')
     AND field_name='sf_account_id';

  RAISE NOTICE 'W4.4 provenance-citizen ladder proof PASSED (human>model; 0 residue)';
END $t$;
