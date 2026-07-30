-- ============================================================================
-- W2.2 — Provenance records EFFECT, not intent (audit 3.3.3 / 3.3.8)
--
-- Target: LCC Opps (OPS_SUPABASE_URL, ref xengecqvemvfknjvbvrq)
--
-- Companion to the sidebar-pipeline.js change that flushes sale provenance from
-- the FILTERED payload actually sent, AFTER the PATCH, and marks the outcome by
-- what LANDED. Two new decision values are needed for that:
--
--   * 'failed_write' — the domain PATCH/INSERT did NOT land, so the ledger must
--     not keep claiming the value was written. Recorded from the sidebar flush
--     when the write result is !ok. If the current live 'write' for the key is
--     OUR OWN just-made optimistic write (the pre-PATCH field-priority gate
--     records a 'write' for allowed fields, via lcc_merge_field, BEFORE the
--     PATCH runs), it is retracted (superseded); a different source's live value
--     is never disturbed by our failure.
--
--   * 'cleared' — a curated column was explicitly set NULL and that write
--     LANDED. Recording it (and superseding the prior live 'write') lets the
--     field be refilled later under warn/strict enforce modes (audit 3.3.8):
--     without a live 'write' row, the next writer decides 'write'
--     (no_prior_provenance) instead of being blocked by a stale value. When
--     there is NO prior live write (e.g. a fresh INSERT whose column is simply
--     blank) nothing is recorded — a blank is not a clearing.
--
-- This migration:
--   1. Widens the field_provenance.decision CHECK to allow the two new values.
--      Purely ADDITIVE (the old four values are a subset), so existing rows
--      validate instantly and it is safe to apply BEFORE the JS deploys.
--   2. Adds lcc_record_field_write_outcome() — the single writer of these two
--      decisions. It takes the SAME per-key advisory-xact-lock domain as
--      lcc_merge_field (W2.1), so it serializes with the hot write path and
--      preserves the single-live-write invariant (uq_field_provenance_live_write
--      is WHERE decision='write'; neither 'failed_write' nor 'cleared' is a
--      'write', so the index is never tripped — but we still supersede the prior
--      live write under the lock so the ledger's "current authoritative value"
--      is consistent).
--
-- Neither the 'failed_write' nor 'cleared' row is decision='write', so this
-- migration does NOT change what lcc_merge_field itself decides — the hot path
-- and its W2.1 concurrency guarantees are untouched.
--
-- ── METRIC DISCONTINUITY (re-baseline) ─────────────────────────────────────
-- The sidebar change repoints the sales_parser_diagnostics written_* booleans
-- at the FILTERED + SUCCEEDED payload (what LANDED) instead of the raw parsed
-- saleData (intent). v_sales_parser_miss_rates_7d is computed FROM those
-- booleans over a rolling 7-day window, so its drop-rate metric changes meaning
-- at cutover and is NOT comparable across the boundary.
--   CUTOVER DATE: 2026-08-12 (this migration + the paired JS Railway deploy).
-- Compare miss rates only within [pre-2026-08-12] or [2026-08-12 onward], never
-- across. A COMMENT ON VIEW records the same so future readers see it in-DB.
--
-- Discipline: additive (widened CHECK, new function, view comment); idempotent
-- (CREATE OR REPLACE / guarded CHECK swap); reversible (footer runbook).
--
-- Deploy ordering: additive schema BEFORE the writer deploy. Applied live to
-- LCC Opps ahead of the Railway redeploy of the paired sidebar-pipeline.js.
--
-- REVERSAL RUNBOOK (footer has exact SQL):
--   * DROP FUNCTION public.lcc_record_field_write_outcome(...);
--   * restore the original decision CHECK (drop the widened one, re-add the
--     4-value CHECK) — only safe once no 'failed_write'/'cleared' rows remain
--     (or after demoting them).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Widen the decision CHECK (additive: old 4 values kept, 2 added)
-- ----------------------------------------------------------------------------
ALTER TABLE public.field_provenance
  DROP CONSTRAINT IF EXISTS field_provenance_decision_check;

ALTER TABLE public.field_provenance
  ADD CONSTRAINT field_provenance_decision_check
  CHECK (decision IN ('write','skip','conflict','superseded','failed_write','cleared'));

COMMENT ON CONSTRAINT field_provenance_decision_check ON public.field_provenance IS
  'W2.2 widened: write|skip|conflict|superseded (merge decisions) + failed_write
   (domain write did not land) + cleared (column explicitly set null and landed).
   failed_write/cleared are written only by lcc_record_field_write_outcome; they
   are NOT decision=''write'' so uq_field_provenance_live_write is never tripped.';

-- ----------------------------------------------------------------------------
-- 2. lcc_record_field_write_outcome — the single writer of failed_write/cleared
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_record_field_write_outcome(
  p_workspace_id uuid, p_target_database text, p_target_table text, p_record_pk text,
  p_field_name text, p_value jsonb, p_source text, p_source_run_id text,
  p_confidence numeric, p_recorded_by uuid, p_decision text)
RETURNS bigint
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_current_id      BIGINT;
  v_current_source  TEXT;
  v_inserted_id     BIGINT;
  v_reason          TEXT;
BEGIN
  IF p_decision NOT IN ('failed_write','cleared') THEN
    RAISE EXCEPTION 'lcc_record_field_write_outcome: unsupported decision % (expected failed_write|cleared)', p_decision;
  END IF;
  IF p_target_database IS NULL OR p_target_table IS NULL
     OR p_record_pk IS NULL OR p_field_name IS NULL OR p_source IS NULL THEN
    RETURN NULL;  -- best-effort: never blow up the write path on a malformed call
  END IF;

  -- Same advisory-lock domain as lcc_merge_field (W2.1) so this serializes with
  -- the hot write path on the SAME key. Held to end of transaction.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      COALESCE(p_target_database,'') || '|' || COALESCE(p_target_table,'') || '|' ||
      COALESCE(p_record_pk,'')       || '|' || COALESCE(p_field_name,''),
      0)
  );

  SELECT fp.id, fp.source
    INTO v_current_id, v_current_source
  FROM public.field_provenance fp
  WHERE fp.target_database = p_target_database
    AND fp.target_table    = p_target_table
    AND fp.record_pk_value = p_record_pk
    AND fp.field_name      = p_field_name
    AND fp.decision        = 'write'
  ORDER BY fp.recorded_at DESC, fp.id DESC
  LIMIT 1;

  IF p_decision = 'cleared' THEN
    -- Nothing recorded on a blank-from-birth field: no prior value == not a clear.
    IF v_current_id IS NULL THEN
      RETURN NULL;
    END IF;
    -- The DB no longer holds the value (the null write landed), regardless of
    -- which source wrote it — supersede so the field can be refilled.
    UPDATE public.field_provenance fp_up
       SET decision = 'superseded'
     WHERE fp_up.id = v_current_id;
    v_reason := 'W2.2: field explicitly cleared (set null) and landed';
  ELSE  -- failed_write
    -- Only retract OUR OWN optimistic same-source write (the pre-PATCH gate
    -- write). Never disturb a different, still-valid source's live value.
    IF v_current_id IS NOT NULL AND v_current_source IS NOT DISTINCT FROM p_source THEN
      UPDATE public.field_provenance fp_up
         SET decision = 'superseded'
       WHERE fp_up.id = v_current_id;
    ELSE
      v_current_id := NULL;  -- do not backfill a forward pointer to a foreign row
    END IF;
    v_reason := 'W2.2: domain write failed — value did not land';
  END IF;

  INSERT INTO public.field_provenance AS fp_ins (
    workspace_id, target_database, target_table, record_pk_value,
    field_name, value, source, source_run_id, confidence,
    recorded_by, decision, decision_reason
  ) VALUES (
    p_workspace_id, p_target_database, p_target_table, p_record_pk,
    p_field_name, p_value, p_source, p_source_run_id, p_confidence,
    p_recorded_by, p_decision, v_reason
  )
  RETURNING fp_ins.id INTO v_inserted_id;

  -- Backfill the forward pointer on the row we just superseded (if any).
  IF v_current_id IS NOT NULL THEN
    UPDATE public.field_provenance fp_up
       SET superseded_by_id = v_inserted_id
     WHERE fp_up.id = v_current_id;
  END IF;

  RETURN v_inserted_id;
END $function$;

COMMENT ON FUNCTION public.lcc_record_field_write_outcome(
  uuid, text, text, text, text, jsonb, text, text, numeric, uuid, text) IS
  'W2.2 (audit 3.3.3/3.3.8): records what a domain write LANDED as —
   decision=''failed_write'' (write did not land; retracts our own optimistic
   same-source live write) or ''cleared'' (column explicitly set null and landed;
   supersedes the prior live write so the field can be refilled under
   warn/strict). Takes the same per-key advisory-xact-lock as lcc_merge_field so
   the single-live-write invariant holds. Best-effort: returns NULL on a
   malformed call or a cleared-with-no-prior-value (a blank is not a clearing).';

GRANT EXECUTE ON FUNCTION public.lcc_record_field_write_outcome(
  uuid, text, text, text, text, jsonb, text, text, numeric, uuid, text)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Record the metric discontinuity in-DB
-- ----------------------------------------------------------------------------
COMMENT ON VIEW public.v_sales_parser_miss_rates_7d IS
  'Sales-parser miss/drop rates over a rolling 7d window from
   sales_parser_diagnostics.written_* booleans. ⚠️ RE-BASELINE 2026-08-12 (W2.2):
   written_* now measures what LANDED (filtered payload + PATCH/INSERT succeeded),
   not parser intent. Drop rates are NOT comparable across 2026-08-12 — compare
   only within [pre-2026-08-12] or [2026-08-12 onward].';

-- ============================================================================
-- VERIFICATION (in-transaction, self-cleaning). Fails the migration on any miss.
-- Proves: (a) failed_write retracts an own-source optimistic write but not a
-- foreign one; (b) cleared supersedes the prior live write; (c) cleared with no
-- prior write records nothing; (d) neither trips uq_field_provenance_live_write.
-- ============================================================================
DO $w2_2_verify$
DECLARE
  v_id            BIGINT;
  v_live_writes   INTEGER;
  v_failed_rows   INTEGER;
  v_cleared_rows  INTEGER;
BEGIN
  -- (a) failed_write retracts an OWN-source optimistic live write.
  INSERT INTO public.field_provenance
    (target_database, target_table, record_pk_value, field_name, value, source, decision, decision_reason)
  VALUES ('lcc_opps','w2_2_selftest','probe_a','c', to_jsonb('X'::text), 'costar_sidebar', 'write', 'seed optimistic');
  PERFORM public.lcc_record_field_write_outcome(
    NULL,'lcc_opps','w2_2_selftest','probe_a','c', to_jsonb('X'::text),
    'costar_sidebar','w2_2_run', 0.6, NULL, 'failed_write');
  SELECT count(*) INTO v_live_writes FROM public.field_provenance
   WHERE target_database='lcc_opps' AND target_table='w2_2_selftest'
     AND record_pk_value='probe_a' AND field_name='c' AND decision='write';
  IF v_live_writes <> 0 THEN
    RAISE EXCEPTION 'W2.2 verify (a): expected own-source optimistic write retracted, still % live', v_live_writes;
  END IF;

  -- (b) failed_write does NOT disturb a DIFFERENT source's live value.
  INSERT INTO public.field_provenance
    (target_database, target_table, record_pk_value, field_name, value, source, decision, decision_reason)
  VALUES ('lcc_opps','w2_2_selftest','probe_b','c', to_jsonb('DEED'::text), 'recorded_deed', 'write', 'seed foreign');
  PERFORM public.lcc_record_field_write_outcome(
    NULL,'lcc_opps','w2_2_selftest','probe_b','c', to_jsonb('X'::text),
    'costar_sidebar','w2_2_run', 0.6, NULL, 'failed_write');
  SELECT count(*) INTO v_live_writes FROM public.field_provenance
   WHERE target_database='lcc_opps' AND target_table='w2_2_selftest'
     AND record_pk_value='probe_b' AND field_name='c' AND decision='write';
  IF v_live_writes <> 1 THEN
    RAISE EXCEPTION 'W2.2 verify (b): foreign-source live write must survive, got % live', v_live_writes;
  END IF;

  -- (c) cleared supersedes the prior live write.
  INSERT INTO public.field_provenance
    (target_database, target_table, record_pk_value, field_name, value, source, decision, decision_reason)
  VALUES ('lcc_opps','w2_2_selftest','probe_c','c', to_jsonb('Y'::text), 'costar_sidebar', 'write', 'seed for clear');
  v_id := public.lcc_record_field_write_outcome(
    NULL,'lcc_opps','w2_2_selftest','probe_c','c', NULL,
    'costar_sidebar','w2_2_run', 0.6, NULL, 'cleared');
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'W2.2 verify (c): cleared with a prior write must record a row';
  END IF;
  SELECT count(*) INTO v_live_writes FROM public.field_provenance
   WHERE target_database='lcc_opps' AND target_table='w2_2_selftest'
     AND record_pk_value='probe_c' AND field_name='c' AND decision='write';
  IF v_live_writes <> 0 THEN
    RAISE EXCEPTION 'W2.2 verify (c): cleared must supersede the prior live write, still % live', v_live_writes;
  END IF;

  -- (d) cleared with NO prior write records nothing (blank != clearing).
  v_id := public.lcc_record_field_write_outcome(
    NULL,'lcc_opps','w2_2_selftest','probe_d','c', NULL,
    'costar_sidebar','w2_2_run', 0.6, NULL, 'cleared');
  IF v_id IS NOT NULL THEN
    RAISE EXCEPTION 'W2.2 verify (d): cleared with no prior write must record nothing, got id %', v_id;
  END IF;

  SELECT count(*) FILTER (WHERE decision='failed_write'),
         count(*) FILTER (WHERE decision='cleared')
    INTO v_failed_rows, v_cleared_rows
  FROM public.field_provenance
  WHERE target_database='lcc_opps' AND target_table='w2_2_selftest';
  IF v_failed_rows <> 2 OR v_cleared_rows <> 1 THEN
    RAISE EXCEPTION 'W2.2 verify: expected 2 failed_write + 1 cleared, got % / %', v_failed_rows, v_cleared_rows;
  END IF;

  -- Clean up all synthetic rows.
  DELETE FROM public.field_provenance
   WHERE target_database='lcc_opps' AND target_table='w2_2_selftest';

  RAISE NOTICE 'W2.2 verify PASS: failed_write retract-own/keep-foreign, cleared supersede, cleared-no-prior no-op.';
END
$w2_2_verify$;

-- ============================================================================
-- VERIFICATION QUERIES (run post-apply; also in PR description)
-- ----------------------------------------------------------------------------
-- 1) CHECK widened:
--    SELECT pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conrelid='public.field_provenance'::regclass
--       AND conname='field_provenance_decision_check';
--
-- 2) Function present + advisory lock in body:
--    SELECT pg_get_functiondef('public.lcc_record_field_write_outcome'::regproc)
--           ILIKE '%pg_advisory_xact_lock%';
--
-- 3) Single-live-write invariant still holds (no new dup keys):
--    SELECT count(*) FROM (
--      SELECT 1 FROM public.field_provenance WHERE decision='write'
--      GROUP BY target_database, target_table, record_pk_value, field_name
--      HAVING count(*) > 1) d;   -- expect 0
--
-- REVERSAL (see header):
--    DROP FUNCTION IF EXISTS public.lcc_record_field_write_outcome(
--      uuid, text, text, text, text, jsonb, text, text, numeric, uuid, text);
--    -- Only after no failed_write/cleared rows remain:
--    ALTER TABLE public.field_provenance DROP CONSTRAINT field_provenance_decision_check;
--    ALTER TABLE public.field_provenance ADD CONSTRAINT field_provenance_decision_check
--      CHECK (decision IN ('write','skip','conflict','superseded'));
-- ============================================================================
