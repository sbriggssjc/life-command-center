-- ============================================================================
-- TIER 1 · Unit 2 — auto-resolve the provenance review queue (LCC Opps)
--
-- Target: LCC Opps (OPS_SUPABASE_URL, ref xengecqvemvfknjvbvrq)
--
-- The provenance "review queue" was ~98% non-human work. Measured live
-- 2026-06-16 over v_field_provenance_actionable (warn/strict rules):
--   skip                        12,707   registry TELEMETRY — never a decision
--   conflict · same-source       3,125   a source disagreeing with its OWN
--                                        earlier capture (a refresh, newest wins)
--   conflict · cross-source        367   the genuine human-judgment set
--   conflict · no-current-auth     249   folder_feed_lease vs un-instrumented
--                                        legacy domain values (a distinct class)
--
-- This migration:
--   1) v_field_provenance_conflict_classified — classifies every surfaced
--      conflict as same_source / cross_source / no_current_authority. The human
--      lane reads conflict_class='cross_source' (367); nothing is buried — the
--      same_source + no_current_authority sets stay queryable via this view.
--   2) lcc_autoresolve_same_source_provenance(limit, dry_run, batch) — drains the
--      same-source class without human clicks: per field whose EVERY surfaced
--      conflict is same_source, promote the newest contender to authoritative
--      ('write') and supersede the older ones (newest-same-source wins). Bounded
--      by p_limit, dry-run safe, effect-first, and fully reversible (each touched
--      row stamps its prior decision in metadata.tier1_ss_autoresolve).
--   3) lcc_undo_same_source_autoresolve(batch) — restores a batch verbatim.
--   4) lcc_refresh_review_lane_counts() — the data_conflicts headline now counts
--      cross-source conflicts (~367), not the 16k skip+conflict telemetry.
--
-- NOTE (provenance is observational here): the warn/record_only rules mean the
-- domain UPDATE already happened at capture time; the 'conflict' decision is a
-- telemetry log entry, not a block. So resolving a same-source conflict is a
-- provenance-LOG cleanup (promote newest / supersede older) — it does NOT write
-- any dia/gov domain table. cross-source conflicts are NEVER auto-resolved.
--
-- All objects idempotent (CREATE OR REPLACE). Read-only surfaces apply live;
-- the actual same-source drain is run capped + gated (receipts first).
-- ============================================================================

-- 1) Conflict classifier --------------------------------------------------
CREATE OR REPLACE VIEW public.v_field_provenance_conflict_classified AS
SELECT
  fp.id                AS provenance_id,
  fp.recorded_at,
  fp.target_database,
  fp.target_table,
  fp.record_pk_value,
  fp.field_name,
  fp.value             AS attempted_value,
  fp.source            AS attempted_source,
  fp.confidence        AS attempted_confidence,
  fp.source_run_id,
  fp.decision,
  fp.decision_reason,
  fsp.priority         AS attempted_priority,
  fsp.enforce_mode,
  cur.id               AS current_provenance_id,
  cur.source           AS current_source,
  cur.value            AS current_value,
  cur.recorded_at      AS current_recorded_at,
  CASE
    WHEN cur.source IS NULL          THEN 'no_current_authority'
    WHEN fp.source = cur.source      THEN 'same_source'
    ELSE 'cross_source'
  END                  AS conflict_class
FROM public.field_provenance fp
JOIN public.field_source_priority fsp
  ON fsp.target_table = fp.target_table
 AND fsp.field_name   = fp.field_name
 AND fsp.source       = fp.source
LEFT JOIN LATERAL (
  SELECT cu.id, cu.source, cu.value, cu.recorded_at
  FROM public.field_provenance cu
  WHERE cu.target_database = fp.target_database
    AND cu.target_table    = fp.target_table
    AND cu.record_pk_value = fp.record_pk_value
    AND cu.field_name      = fp.field_name
    AND cu.decision        = 'write'
  ORDER BY cu.recorded_at DESC
  LIMIT 1
) cur ON true
WHERE fp.decision = 'conflict'
  AND fsp.enforce_mode = ANY (ARRAY['warn','strict']);

COMMENT ON VIEW public.v_field_provenance_conflict_classified IS
  'TIER 1 Unit 2: every warn/strict field-provenance CONFLICT, classified '
  'same_source / cross_source / no_current_authority. The Decision Center + the '
  'data_conflicts headline read conflict_class=cross_source (the human set); '
  'same_source is drained by lcc_autoresolve_same_source_provenance().';

GRANT SELECT ON public.v_field_provenance_conflict_classified TO anon, authenticated, service_role;

-- 2) Same-source auto-resolver (bounded, dry-run-safe, reversible) ---------
CREATE OR REPLACE FUNCTION public.lcc_autoresolve_same_source_provenance(
  p_limit   integer DEFAULT 100,
  p_dry_run boolean DEFAULT true,
  p_batch   text    DEFAULT NULL
)
RETURNS TABLE(eligible_fields integer, resolved_fields integer,
              superseded_rows integer, promoted_rows integer, batch text)
LANGUAGE plpgsql
AS $$
DECLARE
  v_batch      text := COALESCE(p_batch, 'ss-' || to_char(now(), 'YYYYMMDDHH24MISS'));
  v_eligible   integer := 0;
  v_resolved   integer := 0;
  v_superseded integer := 0;
  v_promoted   integer := 0;
  v_iter_sup   integer := 0;
  v_winner_id  bigint;
  r record;
BEGIN
  -- Eligible field = one where EVERY surfaced conflict row is same_source, i.e.
  -- the field's contenders are a single source (a refresh, not a cross-source
  -- dispute). Excludes any field carrying a cross_source / no_current row.
  CREATE TEMP TABLE _ss_fields ON COMMIT DROP AS
  SELECT target_database, target_table, record_pk_value, field_name
  FROM public.v_field_provenance_conflict_classified
  GROUP BY 1, 2, 3, 4
  HAVING bool_and(conflict_class = 'same_source');

  SELECT count(*) INTO v_eligible FROM _ss_fields;

  IF p_dry_run THEN
    RETURN QUERY SELECT v_eligible, 0, 0, 0, v_batch;
    RETURN;
  END IF;

  FOR r IN SELECT * FROM _ss_fields LIMIT GREATEST(p_limit, 0) LOOP
    -- Newest non-superseded contender (write or conflict) wins.
    SELECT fp.id INTO v_winner_id
    FROM public.field_provenance fp
    WHERE fp.target_database = r.target_database
      AND fp.target_table    = r.target_table
      AND fp.record_pk_value = r.record_pk_value
      AND fp.field_name      = r.field_name
      AND fp.decision IN ('write', 'conflict')
    ORDER BY fp.recorded_at DESC, fp.id DESC
    LIMIT 1;

    IF v_winner_id IS NULL THEN CONTINUE; END IF;

    -- Supersede the older contenders (reversible: prior state stamped).
    WITH upd AS (
      UPDATE public.field_provenance fp
      SET decision = 'superseded',
          superseded_by_id = v_winner_id,
          metadata = COALESCE(fp.metadata, '{}'::jsonb) || jsonb_build_object(
            'tier1_ss_autoresolve', jsonb_build_object(
              'prev_decision', fp.decision,
              'prev_superseded_by_id', fp.superseded_by_id,
              'batch', v_batch, 'role', 'superseded', 'at', now()))
      WHERE fp.target_database = r.target_database
        AND fp.target_table    = r.target_table
        AND fp.record_pk_value = r.record_pk_value
        AND fp.field_name      = r.field_name
        AND fp.decision IN ('write', 'conflict')
        AND fp.id <> v_winner_id
      RETURNING 1
    )
    SELECT count(*) INTO v_iter_sup FROM upd;
    v_superseded := v_superseded + v_iter_sup;

    -- Promote the winner to authoritative (no-op decision if already 'write').
    UPDATE public.field_provenance fp
    SET decision = 'write',
        decision_reason = 'tier1: auto-resolved same-source (newest wins)',
        metadata = COALESCE(fp.metadata, '{}'::jsonb) || jsonb_build_object(
          'tier1_ss_autoresolve', jsonb_build_object(
            'prev_decision', fp.decision,
            'prev_superseded_by_id', fp.superseded_by_id,
            'batch', v_batch, 'role', 'winner', 'at', now()))
    WHERE fp.id = v_winner_id;

    v_promoted := v_promoted + 1;
    v_resolved := v_resolved + 1;
  END LOOP;

  RETURN QUERY SELECT v_eligible, v_resolved, v_superseded, v_promoted, v_batch;
END;
$$;

COMMENT ON FUNCTION public.lcc_autoresolve_same_source_provenance(integer, boolean, text) IS
  'TIER 1 Unit 2: drain same-source field-provenance conflicts (newest wins). '
  'p_dry_run=true (default) only counts. Reversible via '
  'lcc_undo_same_source_autoresolve(batch). NEVER touches cross-source conflicts '
  'or any dia/gov domain table.';

-- 3) Reverse a batch verbatim ---------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_undo_same_source_autoresolve(p_batch text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE n integer;
BEGIN
  WITH upd AS (
    UPDATE public.field_provenance fp
    SET decision = (fp.metadata->'tier1_ss_autoresolve'->>'prev_decision'),
        superseded_by_id = NULLIF(fp.metadata->'tier1_ss_autoresolve'->>'prev_superseded_by_id', '')::bigint,
        metadata = fp.metadata - 'tier1_ss_autoresolve'
    WHERE fp.metadata->'tier1_ss_autoresolve'->>'batch' = p_batch
    RETURNING 1
  )
  SELECT count(*) INTO n FROM upd;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lcc_autoresolve_same_source_provenance(integer, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lcc_undo_same_source_autoresolve(text) TO service_role;

-- 4) data_conflicts headline → cross-source conflicts only -----------------
CREATE OR REPLACE FUNCTION public.lcc_refresh_review_lane_counts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_actionable bigint;
  v_stale      bigint;
  v_unlinked   bigint;
BEGIN
  -- TIER 1 Unit 2: the human review lane is cross-source conflicts only. skip
  -- telemetry + same-source refreshes + no-current-authority rows are excluded.
  SELECT count(*) INTO v_actionable
    FROM public.v_field_provenance_conflict_classified
    WHERE conflict_class = 'cross_source';
  SELECT count(*) INTO v_stale      FROM public.v_stale_identities;
  SELECT count(*) INTO v_unlinked   FROM public.v_unlinked_entities;

  INSERT INTO public.lcc_review_lane_counts (lane_key, lane_count, computed_at) VALUES
    ('data_conflicts',    v_actionable, now()),
    ('stale_identities',  v_stale,      now()),
    ('unlinked_entities', v_unlinked,   now())
  ON CONFLICT (lane_key) DO UPDATE
    SET lane_count  = EXCLUDED.lane_count,
        computed_at = EXCLUDED.computed_at;

  RETURN jsonb_build_object(
    'data_conflicts',    v_actionable,
    'stale_identities',  v_stale,
    'unlinked_entities', v_unlinked,
    'ran_at',            now()
  );
END;
$$;
