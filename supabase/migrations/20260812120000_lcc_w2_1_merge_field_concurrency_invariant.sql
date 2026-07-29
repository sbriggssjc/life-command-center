-- ============================================================================
-- W2.1 — lcc_merge_field: concurrency safety + single-live-write invariant
--
-- Target: LCC Opps (OPS_SUPABASE_URL, ref xengecqvemvfknjvbvrq)
-- Audit finding 3.3.2: lcc_merge_field does an UNLOCKED read-decide-write, and
-- field_provenance has NO uniqueness invariant on the "current authoritative"
-- row. A single sidebar sale PATCH fans ~20 concurrent RPCs (one per column,
-- field-priority-guard.js:230-240 -> shouldWriteField -> lcc_merge_field) and
-- the daily Salesforce sync writes the same deal_provenance fields repeatedly.
-- Two calls for the SAME (target_database, target_table, record_pk_value,
-- field_name) can both read the same current 'write' row, both decide 'write',
-- both INSERT a new 'write' row and both supersede the same old row -> TWO live
-- 'write' rows survive. Live baseline: 1,798 keys carry >1 live 'write' row
-- (2,964 rows to demote). The consumer views (v_field_provenance_current,
-- v_field_provenance_conflicts, the Decision Center lanes) all assume exactly
-- one live write per key, so a duplicate silently double-counts / mis-arbitrates.
--
-- This migration:
--   1. Dedupes existing duplicate live 'write' rows: per key, keep the newest
--      (recorded_at DESC, id DESC), demote the losers to decision='superseded'
--      (pointing superseded_by_id at the survivor), logging every demotion to a
--      reversible ledger (field_provenance_dedup_w2_1_log).
--   2. Adds a PARTIAL UNIQUE INDEX on (target_database, target_table,
--      record_pk_value, field_name) WHERE decision='write' — the invariant.
--   3. Rewrites lcc_merge_field to take a per-key advisory xact lock
--      (pg_advisory_xact_lock over hashtextextended of the 4 key parts) around
--      the read-decide-write, orders the current-row read by
--      recorded_at DESC, id DESC, and supersedes-before-insert so the new
--      partial unique index never transiently sees two live writes.
--   4. Applies the SAME supersede-before-insert reordering to the other two
--      functions that emit decision='write' rows (lcc_record_field_resolution,
--      record_cleanup_provenance) so the invariant holds for EVERY writer, not
--      just the hot path. (lcc_autoresolve_same_source_provenance already
--      supersedes losers before promoting the winner — unchanged.)
--
-- Discipline: additive index + reversible dedup ledger (never hard-delete);
-- idempotent (CREATE OR REPLACE / IF NOT EXISTS / NOT-EXISTS-guarded dedup);
-- the whole migration runs in one transaction under an explicit table lock so
-- the still-deployed old function cannot race a duplicate into the index build.
--
-- Deploy ordering note: the "writer" here is the SQL function itself, replaced
-- atomically in the same transaction as the index — so the invariant and the
-- writers that honor it commit together (no window where the old inserts-first
-- resolution path meets the new index).
--
-- REVERSAL RUNBOOK (see footer for exact SQL):
--   * DROP INDEX public.uq_field_provenance_live_write;
--   * restore prior function bodies (re-deploy 20260616122000 + 20260520220000
--     + 20260523120000);
--   * un-demote the dedup losers from the ledger:
--       UPDATE public.field_provenance fp
--          SET decision='write', superseded_by_id = l.prev_superseded_by_id
--         FROM public.field_provenance_dedup_w2_1_log l
--        WHERE fp.id = l.provenance_id;
-- ============================================================================

-- Serialize the whole migration against concurrent lcc_merge_field writers so
-- the dedup -> index-build sequence is atomic w.r.t. the still-old function.
-- SHARE ROW EXCLUSIVE conflicts with the ROW EXCLUSIVE that INSERT/UPDATE take,
-- so no new provenance write can slip a duplicate in between dedup and index.
LOCK TABLE public.field_provenance IN SHARE ROW EXCLUSIVE MODE;

-- ----------------------------------------------------------------------------
-- 1. Reversible dedup ledger + demotion of duplicate live 'write' rows
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_provenance_dedup_w2_1_log (
  id                     BIGSERIAL PRIMARY KEY,
  provenance_id          BIGINT NOT NULL,   -- the demoted (loser) field_provenance.id
  kept_id                BIGINT NOT NULL,   -- the surviving authoritative 'write' row
  prev_decision          TEXT   NOT NULL,   -- decision before demotion (always 'write')
  prev_superseded_by_id  BIGINT,            -- superseded_by_id before demotion (for exact reversal)
  target_database        TEXT   NOT NULL,
  target_table           TEXT   NOT NULL,
  record_pk_value        TEXT   NOT NULL,
  field_name             TEXT   NOT NULL,
  batch_tag              TEXT   NOT NULL DEFAULT 'w2_1_dedup',
  demoted_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.field_provenance_dedup_w2_1_log IS
  'W2.1 reversible ledger: one row per duplicate live field_provenance write demoted
   to superseded during the single-live-write dedup. Reverse by restoring
   decision=''write'' + superseded_by_id=prev_superseded_by_id for each provenance_id.';

-- Rank the live writes per key; keep the newest, demote the rest.
DO $w2_1_dedup$
DECLARE
  v_dup_keys   integer;
  v_demoted    integer;
BEGIN
  CREATE TEMP TABLE _w2_1_losers ON COMMIT DROP AS
  WITH ranked AS (
    SELECT fp.id,
           fp.target_database, fp.target_table, fp.record_pk_value, fp.field_name,
           fp.decision, fp.superseded_by_id,
           row_number() OVER w  AS rn,
           first_value(fp.id) OVER w AS keep_id
    FROM public.field_provenance fp
    WHERE fp.decision = 'write'
    WINDOW w AS (
      PARTITION BY fp.target_database, fp.target_table, fp.record_pk_value, fp.field_name
      ORDER BY fp.recorded_at DESC, fp.id DESC
    )
  )
  SELECT id, target_database, target_table, record_pk_value, field_name,
         decision, superseded_by_id, keep_id
  FROM ranked
  WHERE rn > 1;

  SELECT count(DISTINCT (target_database, target_table, record_pk_value, field_name)),
         count(*)
    INTO v_dup_keys, v_demoted
  FROM _w2_1_losers;

  -- Log every demotion (idempotent: skip losers already ledgered by a prior run).
  INSERT INTO public.field_provenance_dedup_w2_1_log
    (provenance_id, kept_id, prev_decision, prev_superseded_by_id,
     target_database, target_table, record_pk_value, field_name)
  SELECT l.id, l.keep_id, l.decision, l.superseded_by_id,
         l.target_database, l.target_table, l.record_pk_value, l.field_name
  FROM _w2_1_losers l
  WHERE NOT EXISTS (
    SELECT 1 FROM public.field_provenance_dedup_w2_1_log g WHERE g.provenance_id = l.id
  );

  -- Demote the losers to superseded, pointing at the surviving authoritative row.
  UPDATE public.field_provenance fp
     SET decision = 'superseded',
         superseded_by_id = l.keep_id,
         decision_reason  = COALESCE(fp.decision_reason,'')
             || ' [W2.1 dedup: demoted duplicate live write, kept #' || l.keep_id::text || ']'
  FROM _w2_1_losers l
  WHERE fp.id = l.id
    AND fp.decision = 'write';

  RAISE NOTICE 'W2.1 dedup: % duplicate keys, % loser rows demoted to superseded.',
    v_dup_keys, v_demoted;
END
$w2_1_dedup$;

-- ----------------------------------------------------------------------------
-- 2. The invariant: exactly one live 'write' per key
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_field_provenance_live_write
  ON public.field_provenance (target_database, target_table, record_pk_value, field_name)
  WHERE decision = 'write';

COMMENT ON INDEX public.uq_field_provenance_live_write IS
  'W2.1 single-live-write invariant: at most one decision=''write'' row per
   (target_database, target_table, record_pk_value, field_name). Enforced across
   ALL writers (lcc_merge_field, lcc_record_field_resolution,
   record_cleanup_provenance). Every write path supersedes the current live row
   BEFORE inserting the new one so this index never transiently sees two writes.';

-- ----------------------------------------------------------------------------
-- 3. lcc_merge_field — advisory lock + ordered read + supersede-before-insert
--    Body reproduces the live 20260616122000 function VERBATIM except:
--      (a) a per-key pg_advisory_xact_lock at the top;
--      (b) the current-row read is ordered by recorded_at DESC, id DESC;
--      (c) the current row is superseded BEFORE the new write row is inserted.
--    Decision logic is byte-identical.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_merge_field(
  p_workspace_id uuid, p_target_database text, p_target_table text, p_record_pk text,
  p_field_name text, p_value jsonb, p_source text, p_source_run_id text,
  p_confidence numeric, p_recorded_by uuid DEFAULT NULL::uuid)
RETURNS TABLE(provenance_id bigint, decision text, decision_reason text,
              current_value jsonb, current_source text, current_priority integer,
              new_priority integer, enforce_mode text)
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
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
  -- W2.1: serialize concurrent callers on the SAME key so the read-decide-write
  -- is atomic. Held to end of transaction (PostgREST runs each RPC in its own
  -- transaction). Different keys hash to different locks -> no cross-key blocking.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      COALESCE(p_target_database,'') || '|' || COALESCE(p_target_table,'') || '|' ||
      COALESCE(p_record_pk,'')       || '|' || COALESCE(p_field_name,''),
      0)
  );

  SELECT fp.id, fp.value, fp.source
    INTO v_current_id, v_current_value, v_current_source
  FROM public.field_provenance fp
  WHERE fp.target_database = p_target_database
    AND fp.target_table    = p_target_table
    AND fp.record_pk_value = p_record_pk
    AND fp.field_name      = p_field_name
    AND fp.decision        = 'write'
  ORDER BY fp.recorded_at DESC, fp.id DESC
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
      -- SAME source disagreeing with its own earlier capture = refresh, newest wins.
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

  -- W2.1: supersede the current live write FIRST (so the partial unique index
  -- never sees two 'write' rows for this key), THEN insert the new row, THEN
  -- backfill the forward pointer. Semantics of superseded_by_id unchanged
  -- (old row -> new row).
  IF v_decision = 'write' AND v_current_id IS NOT NULL THEN
    UPDATE public.field_provenance fp_up
    SET decision = 'superseded'
    WHERE fp_up.id = v_current_id;
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
    SET superseded_by_id = v_inserted_id
    WHERE fp_up.id = v_current_id;
  END IF;

  RETURN QUERY SELECT
    v_inserted_id, v_decision, v_reason, v_current_value, v_current_source,
    v_current_priority, v_new_priority, v_enforce;
END $function$;

-- ----------------------------------------------------------------------------
-- 4a. lcc_record_field_resolution — supersede-before-insert
--     The 'attempted'/'custom' branch used to INSERT the new 'write' row BEFORE
--     superseding the current write, which transiently leaves two live writes
--     and would now violate uq_field_provenance_live_write. Reorder: supersede
--     current -> insert new -> backfill forward pointer. All other logic verbatim.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_record_field_resolution(
  p_attempted_provenance_id bigint, p_chosen text, p_chosen_value jsonb,
  p_workspace_id uuid, p_resolved_by uuid, p_decision_notes text,
  p_domain_write_ok boolean, p_domain_write_response jsonb,
  p_defer_interval interval DEFAULT NULL::interval)
RETURNS bigint
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_attempted          public.field_provenance%ROWTYPE;
  v_current_id         BIGINT;
  v_current_source     TEXT;
  v_resolution_id      BIGINT;
  v_new_prov_id        BIGINT;
  v_defer_until        TIMESTAMPTZ;
  v_chosen_source      TEXT;
BEGIN
  IF p_chosen NOT IN ('current','attempted','custom','junk','defer') THEN
    RAISE EXCEPTION 'lcc_record_field_resolution: invalid chosen %', p_chosen;
  END IF;

  SELECT * INTO v_attempted FROM public.field_provenance
   WHERE id = p_attempted_provenance_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lcc_record_field_resolution: attempted_provenance_id % not found', p_attempted_provenance_id;
  END IF;

  IF v_attempted.decision NOT IN ('conflict','skip') THEN
    RAISE EXCEPTION 'lcc_record_field_resolution: attempted row % no longer resolvable (decision=%)',
      p_attempted_provenance_id, v_attempted.decision;
  END IF;

  -- W2.1: serialize with lcc_merge_field on the SAME key (same lock domain).
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      COALESCE(v_attempted.target_database,'') || '|' || COALESCE(v_attempted.target_table,'') || '|' ||
      COALESCE(v_attempted.record_pk_value,'') || '|' || COALESCE(v_attempted.field_name,''),
      0)
  );

  SELECT id, source INTO v_current_id, v_current_source
  FROM public.field_provenance
  WHERE target_database = v_attempted.target_database
    AND target_table    = v_attempted.target_table
    AND record_pk_value = v_attempted.record_pk_value
    AND field_name      = v_attempted.field_name
    AND decision        = 'write'
  ORDER BY recorded_at DESC, id DESC LIMIT 1;

  IF p_chosen = 'defer' THEN
    v_defer_until := now() + COALESCE(p_defer_interval, interval '7 days');
  END IF;
  IF p_chosen IN ('attempted','custom') THEN
    v_chosen_source := 'manual_resolution';
  END IF;

  INSERT INTO public.field_provenance_resolutions (
    resolved_by, workspace_id,
    target_database, target_table, record_pk_value, field_name,
    current_provenance_id, attempted_provenance_id,
    chosen, chosen_source, chosen_value, decision_notes,
    domain_write_ok, domain_write_response, defer_until
  ) VALUES (
    p_resolved_by, p_workspace_id,
    v_attempted.target_database, v_attempted.target_table,
    v_attempted.record_pk_value, v_attempted.field_name,
    v_current_id, p_attempted_provenance_id,
    p_chosen, v_chosen_source, p_chosen_value, p_decision_notes,
    p_domain_write_ok, p_domain_write_response, v_defer_until
  ) RETURNING id INTO v_resolution_id;

  IF p_chosen = 'current' THEN
    IF v_current_id IS NOT NULL THEN
      UPDATE public.field_provenance
         SET decision = 'superseded', superseded_by_id = v_current_id,
             decision_reason = COALESCE(decision_reason,'') ||
               ' [R4 Phase-4 resolution #' || v_resolution_id::text ||
               ': reviewer kept current source ' || COALESCE(v_current_source,'(none)') || ']'
       WHERE id = p_attempted_provenance_id;
    ELSE
      UPDATE public.field_provenance
         SET decision = 'superseded',
             decision_reason = COALESCE(decision_reason,'') ||
               ' [R4 Phase-4 resolution #' || v_resolution_id::text || ': reviewer kept current (no prior write)]'
       WHERE id = p_attempted_provenance_id;
    END IF;

  ELSIF p_chosen IN ('attempted','custom') THEN
    -- W2.1: supersede the current live write BEFORE inserting the new write so
    -- uq_field_provenance_live_write never sees two live writes for the key.
    IF v_current_id IS NOT NULL THEN
      UPDATE public.field_provenance
         SET decision = 'superseded'
       WHERE id = v_current_id;
    END IF;

    INSERT INTO public.field_provenance (
      workspace_id, target_database, target_table, record_pk_value,
      field_name, value, source, source_run_id, confidence,
      recorded_by, decision, decision_reason
    ) VALUES (
      p_workspace_id, v_attempted.target_database, v_attempted.target_table,
      v_attempted.record_pk_value, v_attempted.field_name,
      p_chosen_value, 'manual_resolution',
      'resolution:' || v_resolution_id::text, 1.0,
      p_resolved_by, 'write',
      'R4 Phase-4 resolution #' || v_resolution_id::text ||
      ': reviewer ' ||
      CASE WHEN p_chosen = 'attempted' THEN 'accepted attempted value' ELSE 'entered custom value' END
    ) RETURNING id INTO v_new_prov_id;

    -- Backfill the forward pointer on the now-superseded current row.
    IF v_current_id IS NOT NULL THEN
      UPDATE public.field_provenance
         SET superseded_by_id = v_new_prov_id
       WHERE id = v_current_id;
    END IF;

    UPDATE public.field_provenance
       SET decision = 'superseded', superseded_by_id = v_new_prov_id
     WHERE id = p_attempted_provenance_id;

  ELSIF p_chosen = 'junk' THEN
    UPDATE public.field_provenance
       SET decision = 'superseded',
           decision_reason = COALESCE(decision_reason,'') ||
             ' [R4 Phase-4 resolution #' || v_resolution_id::text || ': marked_as_junk]'
     WHERE id = p_attempted_provenance_id;
  END IF;

  RETURN v_resolution_id;
END
$function$;

-- ----------------------------------------------------------------------------
-- 4b. record_cleanup_provenance — supersede-before-insert
--     Currently unused (0 callers), but it INSERTs decision='write' directly
--     with NO supersession, which would violate the new unique index if a live
--     write already exists for the key. Harden it to honor the invariant.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_cleanup_provenance(
  p_run_id text, p_target_database text, p_target_table text, p_record_pk text,
  p_field_name text, p_new_value jsonb, p_decision_reason text DEFAULT 'cleanup_run'::text,
  p_confidence numeric DEFAULT 0.95)
RETURNS bigint
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_id BIGINT;
BEGIN
  -- W2.1: serialize on the key, supersede any existing live write FIRST, then
  -- insert the new write, then backfill the forward pointer — so the partial
  -- unique index never transiently sees two live writes for the key.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      COALESCE(p_target_database,'') || '|' || COALESCE(p_target_table,'') || '|' ||
      COALESCE(p_record_pk,'')       || '|' || COALESCE(p_field_name,''),
      0)
  );

  UPDATE public.field_provenance
     SET decision = 'superseded'
   WHERE target_database = p_target_database
     AND target_table    = p_target_table
     AND record_pk_value = p_record_pk
     AND field_name      = p_field_name
     AND decision        = 'write';

  INSERT INTO public.field_provenance (
    target_database, target_table, record_pk_value, field_name,
    value, source, source_run_id, confidence, decision, decision_reason
  )
  VALUES (
    p_target_database, p_target_table, p_record_pk, p_field_name,
    p_new_value, 'cleanup_run_' || p_run_id, p_run_id,
    p_confidence, 'write', p_decision_reason
  )
  RETURNING id INTO v_id;

  UPDATE public.field_provenance
     SET superseded_by_id = v_id
   WHERE target_database = p_target_database
     AND target_table    = p_target_table
     AND record_pk_value = p_record_pk
     AND field_name      = p_field_name
     AND decision        = 'superseded'
     AND superseded_by_id IS NULL
     AND id <> v_id;

  RETURN v_id;
END;
$function$;

-- ============================================================================
-- VERIFICATION (in-transaction, self-cleaning). Fails the migration on any
-- assertion miss. True 20-way PARALLELISM cannot be self-generated inside one
-- SQL transaction; the DO block below proves (a) the invariant is enforced
-- (a second live write raises unique_violation) and (b) precedence + the
-- single-live-write outcome hold across 20 sequential mixed-source calls. The
-- genuine concurrent 20-caller test is run live via parallel sessions and its
-- result is recorded in the PR description.
--
-- LIVE RESULTS (applied 2026-07-29, LCC Opps xengecqvemvfknjvbvrq):
--   * Dedup: 1,798 duplicate keys / 2,964 loser rows demoted -> ledger holds
--     2,964 rows / 1,798 keys; dup_live_keys global = 0.
--   * In-migration DO block PASSED (20 sequential calls -> 1 live write, manual
--     precedence; unique index blocked a second live write).
--   * GENUINE 20-way concurrent test (20 parallel sessions, all same-source
--     refresh on one key — the exact race case): 20 rows written, exactly
--     1 decision='write' survivor (newest value), 19 superseded, 0 duplicates,
--     0 unique_violations. The advisory lock serialized them (each read the
--     immediately-prior value: v1->v2->...->v20, no repeats).
-- ============================================================================
DO $w2_1_verify$
DECLARE
  v_dup_live       integer;
  v_write_rows     integer;
  v_final_source   text;
  v_final_value    jsonb;
  v_unique_blocked boolean := false;
  i                integer;
BEGIN
  -- (0) No duplicate live writes remain after dedup.
  SELECT count(*) INTO v_dup_live FROM (
    SELECT 1 FROM public.field_provenance WHERE decision='write'
    GROUP BY target_database, target_table, record_pk_value, field_name
    HAVING count(*) > 1
  ) d;
  IF v_dup_live <> 0 THEN
    RAISE EXCEPTION 'W2.1 verify: % duplicate live-write keys remain after dedup (expected 0)', v_dup_live;
  END IF;

  -- Synthetic registry for a clearly-fake target so precedence is exercised.
  INSERT INTO public.field_source_priority (target_table, field_name, source, priority, min_confidence, notes)
  VALUES ('w2_1_selftest','c','manual', 1,  null, 'W2.1 self-test'),
         ('w2_1_selftest','c','p_hi',  10, null, 'W2.1 self-test'),
         ('w2_1_selftest','c','p_lo',  60, null, 'W2.1 self-test')
  ON CONFLICT (target_table, field_name, source) DO NOTHING;

  -- (1) 20 sequential mixed-source calls on ONE key. First 10 alternate
  -- p_lo/p_hi (write per outranking rules), call 11 is manual@1 (writes, wins),
  -- calls 12-20 are lower-priority attempts that MUST skip (cannot clobber manual).
  FOR i IN 1..10 LOOP
    PERFORM public.lcc_merge_field(
      NULL,'lcc_opps','w2_1_selftest','w2_1_probe','c',
      to_jsonb('v'||i::text),
      CASE WHEN i % 2 = 0 THEN 'p_hi' ELSE 'p_lo' END,
      'w2_1_run', 0.9, NULL);
  END LOOP;

  PERFORM public.lcc_merge_field(
    NULL,'lcc_opps','w2_1_selftest','w2_1_probe','c',
    to_jsonb('MANUAL'::text), 'manual', 'w2_1_run', 1.0, NULL);

  FOR i IN 12..20 LOOP
    PERFORM public.lcc_merge_field(
      NULL,'lcc_opps','w2_1_selftest','w2_1_probe','c',
      to_jsonb('late'||i::text),
      CASE WHEN i % 2 = 0 THEN 'p_hi' ELSE 'p_lo' END,
      'w2_1_run', 0.9, NULL);
  END LOOP;

  SELECT count(*) INTO v_write_rows
  FROM public.field_provenance
  WHERE target_database='lcc_opps' AND target_table='w2_1_selftest'
    AND record_pk_value='w2_1_probe' AND field_name='c' AND decision='write';

  SELECT source, value INTO v_final_source, v_final_value
  FROM public.field_provenance
  WHERE target_database='lcc_opps' AND target_table='w2_1_selftest'
    AND record_pk_value='w2_1_probe' AND field_name='c' AND decision='write';

  IF v_write_rows <> 1 THEN
    RAISE EXCEPTION 'W2.1 verify: expected exactly 1 live write after 20 calls, got %', v_write_rows;
  END IF;
  IF v_final_source <> 'manual' OR v_final_value <> to_jsonb('MANUAL'::text) THEN
    RAISE EXCEPTION 'W2.1 verify: precedence wrong — live write is % = % (expected manual = "MANUAL")',
      v_final_source, v_final_value::text;
  END IF;

  -- (2) The unique index actually blocks a second live write for the same key.
  BEGIN
    INSERT INTO public.field_provenance
      (target_database, target_table, record_pk_value, field_name, value, source, decision, decision_reason)
    VALUES ('lcc_opps','w2_1_selftest','w2_1_probe','c', to_jsonb('DUP'::text),'p_hi','write','w2_1 unique probe');
    -- If we reach here the index did NOT enforce.
  EXCEPTION WHEN unique_violation THEN
    v_unique_blocked := true;
  END;
  IF NOT v_unique_blocked THEN
    RAISE EXCEPTION 'W2.1 verify: partial unique index did NOT block a second live write';
  END IF;

  -- Clean up synthetic rows.
  DELETE FROM public.field_provenance
   WHERE target_database='lcc_opps' AND target_table='w2_1_selftest';
  DELETE FROM public.field_source_priority WHERE target_table='w2_1_selftest';

  RAISE NOTICE 'W2.1 verify PASS: 0 dup live keys; 20 mixed calls -> 1 live write (manual precedence); unique index enforced.';
END
$w2_1_verify$;

-- ============================================================================
-- VERIFICATION QUERIES (run post-apply; also in PR description)
-- ----------------------------------------------------------------------------
-- 1) Zero duplicate live-write keys (the invariant's predicate):
--    SELECT count(*) FROM (
--      SELECT 1 FROM public.field_provenance WHERE decision='write'
--      GROUP BY target_database, target_table, record_pk_value, field_name
--      HAVING count(*) > 1) d;   -- expect 0
--
-- 2) Dedup ledger size (how many duplicates were demoted):
--    SELECT count(*) AS demoted,
--           count(DISTINCT (target_database,target_table,record_pk_value,field_name)) AS keys
--    FROM public.field_provenance_dedup_w2_1_log;   -- expect ~2964 rows / ~1798 keys
--
-- 3) Index present + partial predicate:
--    SELECT indexdef FROM pg_indexes
--    WHERE schemaname='public' AND indexname='uq_field_provenance_live_write';
--
-- 4) Advisory lock present in the function body:
--    SELECT pg_get_functiondef('public.lcc_merge_field'::regproc) ILIKE '%pg_advisory_xact_lock%';
--
-- REVERSAL (see header):
--    DROP INDEX IF EXISTS public.uq_field_provenance_live_write;
--    UPDATE public.field_provenance fp
--       SET decision='write', superseded_by_id = l.prev_superseded_by_id
--      FROM public.field_provenance_dedup_w2_1_log l
--     WHERE fp.id = l.provenance_id AND fp.decision='superseded';
--    -- then re-deploy the prior bodies of lcc_merge_field (20260616122000),
--    --      lcc_record_field_resolution (20260520220000),
--    --      record_cleanup_provenance (20260523120000).
-- ============================================================================
