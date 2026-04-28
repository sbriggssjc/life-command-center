-- ============================================================================
-- Round 76bu — lcc_merge_field value normalization + spurious conflict cleanup
--
-- Round 76bt's conflict-view self-filter dropped 1,225 raw conflicts down to
-- 7 cross-source ones. Inspecting those 7 revealed two new bug classes in
-- lcc_merge_field's value comparison:
--
-- 1. JSONB type mismatch:
--      stored value: 1998 (number)
--      new attempt:  "1998" (string)
--    IS DISTINCT FROM treats these as different. Results in false 'conflict'.
--    Affected: dia.properties year_built (24526, 23283), and any field that
--    flips between numeric and string-numeric across writers.
--
-- 2. CoStar-internal Road/Rd abbreviation drift:
--      stored value: "15002 Amargosa Road" (CoStar pre-Round-76)
--      new attempt:  "15002 Amargosa Rd"   (CoStar post-Round-76)
--    Filter Round 76bt skipped same-source self-conflicts, but RCA later
--    won and the historical conflict still surfaces against the new
--    current source. Same logical address.
--
-- This round adds public.lcc_value_normalize_for_compare(jsonb) which:
--   - jsonb null → null
--   - numeric → ::text trimmed of trailing zeroes
--   - string  → trimmed, lowercased, with common street suffix abbrevs
--                normalized ("road"→"rd", "street"→"st", "avenue"→"ave",
--                "boulevard"→"blvd", "drive"→"dr", etc.)
--   - everything else → ::text trimmed
--
-- lcc_merge_field uses this normalized form for its same-priority equality
-- check. The actual stored value is unchanged (we keep the canonical form
-- as written by each source for forensics).
--
-- Also: update v_field_provenance_conflicts to apply the same
-- normalization, so any historical conflict rows that resolve under
-- normalization disappear from the triage view.
-- ============================================================================

-- 1. Normalization helper
CREATE OR REPLACE FUNCTION public.lcc_value_normalize_for_compare(p_value jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_value IS NULL OR p_value = 'null'::jsonb THEN NULL
    WHEN jsonb_typeof(p_value) = 'number' THEN
      regexp_replace(regexp_replace((p_value #>> '{}'), '\.0+$', ''), '0+$', '')
    WHEN jsonb_typeof(p_value) = 'string' THEN
      lower(
        regexp_replace(
        regexp_replace(
        regexp_replace(
        regexp_replace(
        regexp_replace(
        regexp_replace(
        regexp_replace(
        regexp_replace(
          trim(p_value #>> '{}')
        , '\s+', ' ', 'g')                                        -- collapse internal whitespace
        , '\s+(road|rd\.?)$', ' rd', 'i')
        , '\s+(street|st\.?)$', ' st', 'i')
        , '\s+(avenue|ave\.?)$', ' ave', 'i')
        , '\s+(boulevard|blvd\.?)$', ' blvd', 'i')
        , '\s+(drive|dr\.?)$', ' dr', 'i')
        , '\s+(highway|hwy\.?)$', ' hwy', 'i')
        , '\s+(parkway|pkwy\.?)$', ' pkwy', 'i')
      )
    ELSE trim(p_value::text)
  END;
$$;

-- 2. lcc_merge_field — use normalized comparison for same-priority equality
CREATE OR REPLACE FUNCTION public.lcc_merge_field(
    p_workspace_id uuid,
    p_target_database text,
    p_target_table text,
    p_record_pk text,
    p_field_name text,
    p_value jsonb,
    p_source text,
    p_source_run_id text,
    p_confidence numeric,
    p_recorded_by uuid DEFAULT NULL::uuid
)
RETURNS TABLE(provenance_id bigint, decision text, decision_reason text,
              current_value jsonb, current_source text,
              current_priority integer, new_priority integer,
              enforce_mode text)
LANGUAGE plpgsql AS $$
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
    IF v_norm_current IS DISTINCT FROM v_norm_new THEN
      v_decision := 'conflict';
      v_reason   := format('same-priority disagreement: was %s, now %s',
                           v_current_value::text, p_value::text);
    ELSE
      v_decision := 'write';
      v_reason   := 'same_priority_same_value_refresh';
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
END $$;

-- 3. v_field_provenance_conflicts — apply normalization to filter out
--    historical conflicts where the conflicting value matches the current
--    value under normalization.
CREATE OR REPLACE VIEW public.v_field_provenance_conflicts AS
 SELECT fp.target_database,
        fp.target_table,
        fp.record_pk_value,
        fp.field_name,
        fp.value      AS conflicting_value,
        fp.source     AS conflicting_source,
        fp.confidence AS conflicting_confidence,
        fp.recorded_at AS conflict_recorded_at,
        fp.decision_reason,
        cur.value     AS current_value,
        cur.source    AS current_source
   FROM public.field_provenance fp
   LEFT JOIN public.v_field_provenance_current cur
     ON cur.target_database = fp.target_database
    AND cur.target_table    = fp.target_table
    AND cur.record_pk_value = fp.record_pk_value
    AND cur.field_name      = fp.field_name
  WHERE fp.decision = 'conflict'
    AND (cur.source IS NULL OR fp.source <> cur.source)
    AND (cur.value IS NULL
         OR public.lcc_value_normalize_for_compare(fp.value)
            IS DISTINCT FROM public.lcc_value_normalize_for_compare(cur.value));
