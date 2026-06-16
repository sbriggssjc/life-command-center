-- ============================================================================
-- TIER 1 · Unit 2b (root-cause) — lcc_merge_field: same-source = refresh, not conflict
--
-- Target: LCC Opps (OPS_SUPABASE_URL, ref xengecqvemvfknjvbvrq)
--
-- APPLIED LIVE 2026-06-16 with Scott's blessing (fix-first, then drain). The
-- scoping is proven by test/sql/tier1_unit2b_merge_field_scoping.sql (run live,
-- 0 residue): A same-source same-priority diff value -> refresh/WRITE + prior
-- value retained as a recoverable superseded row; B different source same
-- priority -> CONFLICT (the 367 cross-source set's mechanism intact); C a lower
-- source vs a higher-priority current authority -> SKIP (manual@1/curated never
-- overridden); C2 a higher-priority source refreshing itself -> refresh.
--
-- Why: at equal priority with a DIFFERENT value, the function used to always
-- record 'conflict'. But when the incoming source is the SAME as the current
-- authoritative source, that is the source disagreeing with its OWN earlier
-- capture — a refresh, where the newest value should win — not a cross-source
-- dispute. So same-source same-priority different-value now resolves to 'write'
-- (newest wins, supersedes the prior same-source write, which stays recoverable);
-- only a DIFFERENT same-priority source still records 'conflict'. The one-time
-- backlog was drained by lcc_autoresolve_same_source_provenance(); this stops the
-- class from RE-ACCRUING going forward.
--
-- Strictly a reduction in false conflicts: cross-source behavior is byte-identical;
-- the higher/lower-priority branches are untouched. Reversible (re-deploy prior
-- def). Idempotent (CREATE OR REPLACE). Body reproduces the live function verbatim
-- and changes ONLY the `v_new_priority = v_current_priority` branch.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_merge_field(
  p_workspace_id uuid, p_target_database text, p_target_table text, p_record_pk text,
  p_field_name text, p_value jsonb, p_source text, p_source_run_id text,
  p_confidence numeric, p_recorded_by uuid DEFAULT NULL::uuid)
RETURNS TABLE(provenance_id bigint, decision text, decision_reason text,
              current_value jsonb, current_source text, current_priority integer,
              new_priority integer, enforce_mode text)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_current_id        BIGINT;
  v_current_value     JSONB;
  v_current_source    TEXT;
  v_new_priority      INTEGER;
  v_current_priority  INTEGER;
  v_min_conf          NUMERIC;
  v_enforce           TEXT := 'record_only';
  v_decision          TEXT;
  v_reason            TEXT;
  v_inserted_id       BIGINT;
  v_norm_current      TEXT;
  v_norm_new          TEXT;
BEGIN
  SELECT fp.id, fp.value, fp.source
    INTO v_current_id, v_current_value, v_current_source
  FROM public.field_provenance fp
  WHERE fp.target_database = p_target_database
    AND fp.target_table    = p_target_table
    AND fp.record_pk_value = p_record_pk
    AND fp.field_name      = p_field_name
    AND fp.decision        = 'write'
  ORDER BY fp.recorded_at DESC
  LIMIT 1;

  SELECT fsp.priority, fsp.min_confidence, fsp.enforce_mode
    INTO v_new_priority, v_min_conf, v_enforce
  FROM public.field_source_priority fsp
  WHERE fsp.target_table = p_target_table
    AND fsp.field_name   = p_field_name
    AND fsp.source       = p_source
  LIMIT 1;

  IF v_current_id IS NOT NULL THEN
    SELECT fsp.priority INTO v_current_priority
    FROM public.field_source_priority fsp
    WHERE fsp.target_table = p_target_table
      AND fsp.field_name   = p_field_name
      AND fsp.source       = v_current_source
    LIMIT 1;
  END IF;

  v_norm_current := public.lcc_value_normalize_for_compare(v_current_value);
  v_norm_new     := public.lcc_value_normalize_for_compare(p_value);

  IF v_min_conf IS NOT NULL AND p_confidence IS NOT NULL AND p_confidence < v_min_conf THEN
    v_decision := 'skip';
    v_reason   := format('confidence %s below min %s for source %s',
                         p_confidence, v_min_conf, p_source);
  ELSIF v_current_id IS NULL THEN
    v_decision := 'write';
    v_reason   := 'no_prior_provenance';
  ELSIF v_new_priority IS NULL THEN
    IF v_current_value IS NULL OR v_current_value = 'null'::jsonb THEN
      v_decision := 'write';
      v_reason   := 'unregistered_source_filling_blank';
    ELSE
      v_decision := 'skip';
      v_reason   := 'unregistered_source_with_existing_value';
    END IF;
  ELSIF v_current_priority IS NULL THEN
    v_decision := 'write';
    v_reason   := 'replacing_unregistered_source';
  ELSIF v_new_priority < v_current_priority THEN
    v_decision := 'write';
    v_reason   := format('source %s outranks %s (%s < %s)',
                         p_source, v_current_source, v_new_priority, v_current_priority);
  ELSIF v_new_priority = v_current_priority THEN
    IF v_norm_current IS NOT DISTINCT FROM v_norm_new THEN
      v_decision := 'write';
      v_reason   := 'same_priority_same_value_refresh';
    ELSIF p_source = v_current_source THEN
      -- TIER 1 Unit 2 root-cause: the SAME source disagreeing with its own
      -- earlier capture is a refresh (newest wins), not a cross-source dispute.
      v_decision := 'write';
      v_reason   := format('same_source_refresh_newest_wins: was %s, now %s',
                           v_current_value::text, p_value::text);
    ELSE
      v_decision := 'conflict';
      v_reason   := format('same-priority disagreement: was %s (%s), now %s (%s)',
                           v_current_value::text, v_current_source, p_value::text, p_source);
    END IF;
  ELSE
    IF v_norm_current IS DISTINCT FROM v_norm_new THEN
      v_decision := 'skip';
      v_reason   := format('lower-priority source %s (%s) cannot override %s (%s)',
                           p_source, v_new_priority, v_current_source, v_current_priority);
    ELSE
      v_decision := 'skip';
      v_reason   := 'lower_priority_same_value';
    END IF;
  END IF;

  INSERT INTO public.field_provenance AS fp_ins (
    workspace_id, target_database, target_table, record_pk_value,
    field_name, value, source, source_run_id, confidence,
    recorded_by, decision, decision_reason
  ) VALUES (
    p_workspace_id, p_target_database, p_target_table, p_record_pk,
    p_field_name, p_value, p_source, p_source_run_id, p_confidence,
    p_recorded_by, v_decision, v_reason
  )
  RETURNING fp_ins.id INTO v_inserted_id;

  IF v_decision = 'write' AND v_current_id IS NOT NULL THEN
    UPDATE public.field_provenance fp_up
    SET decision = 'superseded', superseded_by_id = v_inserted_id
    WHERE fp_up.id = v_current_id;
  END IF;

  RETURN QUERY SELECT
    v_inserted_id,
    v_decision,
    v_reason,
    v_current_value,
    v_current_source,
    v_current_priority,
    v_new_priority,
    v_enforce;
END $function$;
