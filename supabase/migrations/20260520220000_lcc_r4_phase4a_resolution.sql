-- ============================================================================
-- R4 Phase-4 Tier A: provenance conflict resolution surface
--
-- Target: LCC Opps (xengecqvemvfknjvbvrq)
-- Tracks: docs/architecture/provenance_resolution_ui_scope.md
--
-- Adds the data plane the LCC UI needs to drain the 212 open
-- v_field_provenance_conflicts items (and any future skip/conflict
-- rows under warn/strict enforce_mode):
--
--   * field_provenance_resolutions      append-only audit of every
--                                       human resolve decision; seeds
--                                       Phase-4 source-accuracy learning
--   * v_field_provenance_review_queue   unified read surface, hides
--                                       resolved and currently-deferred
--                                       rows, tags each row with a bucket
--                                       so the UI can sort by actionability
--   * lcc_record_field_resolution()     SQL fn the API endpoint calls
--                                       after a domain DB write succeeds;
--                                       atomically inserts the resolution
--                                       row, the new manual_resolution
--                                       provenance row, and supersedes
--                                       the prior conflict + current rows
--
-- Decisions locked (per provenance_resolution_ui_scope.md):
--   * Role gate: API-level only (requireRole(user,'manager')). No new
--     Postgres enum value; the 4-level user_role hierarchy stays as-is.
--   * manual_resolution source: priority 1, confidence 1.0 (equal to
--     manual_edit). Registered for every (target_table, field_name)
--     that already has any rule, so future lcc_merge_field calls can
--     compare incoming writes against a manual_resolution current row.
--   * Defer window: fixed 7 days, tracked via defer_until on the
--     resolutions row; re-deferring resets the clock and logs another
--     row (visible defer history).
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1. field_provenance_resolutions
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.field_provenance_resolutions (
  id                       BIGSERIAL PRIMARY KEY,
  resolved_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_by              UUID,                            -- workspace member id (users.id)
  workspace_id             UUID,
  -- Coordinates of the field that was resolved
  target_database          TEXT NOT NULL CHECK (target_database IN ('lcc_opps','dia_db','gov_db')),
  target_table             TEXT NOT NULL,
  record_pk_value          TEXT NOT NULL,
  field_name               TEXT NOT NULL,
  -- The two field_provenance rows the human compared
  current_provenance_id    BIGINT REFERENCES public.field_provenance(id),
  attempted_provenance_id  BIGINT REFERENCES public.field_provenance(id),
  -- The decision
  chosen                   TEXT NOT NULL CHECK (chosen IN ('current','attempted','custom','junk','defer')),
  chosen_source            TEXT,                            -- usually 'manual_resolution' (custom/attempted) or NULL (current/defer/junk)
  chosen_value             JSONB,                           -- what was written to the domain DB (NULL for defer/junk/current)
  decision_notes           TEXT,
  -- Domain DB write outcome
  domain_write_ok          BOOLEAN,                         -- NULL when no domain write was attempted (current/defer/junk)
  domain_write_response    JSONB,                           -- { before_value, after_value, schema_ok, error? }
  -- Defer mechanics — non-null only for chosen='defer'
  defer_until              TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS field_provenance_resolutions_coords_idx
  ON public.field_provenance_resolutions (target_database, target_table, record_pk_value, field_name, resolved_at DESC);

CREATE INDEX IF NOT EXISTS field_provenance_resolutions_attempted_idx
  ON public.field_provenance_resolutions (attempted_provenance_id);

CREATE INDEX IF NOT EXISTS field_provenance_resolutions_current_idx
  ON public.field_provenance_resolutions (current_provenance_id);

COMMENT ON TABLE public.field_provenance_resolutions IS
  'R4 Phase-4 Tier A: append-only audit of human resolve decisions on '
  'field_provenance conflicts / skips. Each row is a labeled training '
  'sample for compute_field_source_accuracy() (Tier B).';

-- --------------------------------------------------------------------------
-- 2. Register manual_resolution as a priority-1 source
--
-- Mirrors every existing manual_edit rule. After this, lcc_merge_field
-- can correctly arbitrate future writes that compete with a
-- manual_resolution current row (they all lose, except another
-- manual_edit / manual_resolution, which produces a same-priority
-- conflict and resurfaces in the review queue).
-- --------------------------------------------------------------------------

INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, enforce_mode, notes)
SELECT
  target_table,
  field_name,
  'manual_resolution',
  1,
  'record_only',
  'R4 Phase-4 Tier A: human-resolved value. Equal priority to manual_edit; later writes must outrank to overwrite.'
FROM public.field_source_priority
WHERE source = 'manual_edit'
ON CONFLICT (target_table, field_name, source) DO NOTHING;

-- --------------------------------------------------------------------------
-- 3. v_field_provenance_review_queue
--
-- Surfaces:
--   * Every open v_field_provenance_conflicts row (regardless of enforce_mode)
--   * Every skip row from v_field_provenance_actionable (warn/strict only)
--
-- Each row is tagged with a `bucket` for UI sort order:
--   * 'still_tied'                  — both sides have same priority today
--   * 'conflicting_source_now_wins' — the rejected value is from the
--                                     higher-trust source today; needs
--                                     domain backfill
--   * 'current_source_now_wins'     — the current value is from the
--                                     higher-trust source today; one-click
--                                     "keep current" resolves the log row
--   * 'warn_skip' / 'strict_skip'   — surfaced by enforce_mode; skip rows
--                                     that the JS guard already blocked
--   * 'unranked_either_side'        — one side is not in the registry
--
-- Rows already resolved (any chosen != 'defer' resolution exists more
-- recent than the provenance row) or currently deferred (chosen='defer'
-- with defer_until > now()) are excluded.
-- --------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_field_provenance_review_queue AS
WITH conflicts AS (
  -- Open conflicts (any enforce_mode)
  SELECT
    fp.id                   AS provenance_id,
    fp.recorded_at,
    fp.target_database,
    fp.target_table,
    fp.record_pk_value,
    fp.field_name,
    fp.value                AS attempted_value,
    fp.source               AS attempted_source,
    fp.confidence           AS attempted_confidence,
    fp.source_run_id,
    fp.decision,
    fp.decision_reason,
    fsp_a.priority          AS attempted_priority,
    fsp_a.enforce_mode      AS attempted_enforce_mode,
    cur.source              AS current_source,
    cur.value               AS current_value,
    cur.recorded_at         AS current_recorded_at,
    cur.id                  AS current_provenance_id,
    fsp_c.priority          AS current_priority
  FROM public.field_provenance fp
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
  LEFT JOIN public.field_source_priority fsp_a
    ON fsp_a.target_table = fp.target_table
   AND fsp_a.field_name   = fp.field_name
   AND fsp_a.source       = fp.source
  LEFT JOIN public.field_source_priority fsp_c
    ON fsp_c.target_table = fp.target_table
   AND fsp_c.field_name   = fp.field_name
   AND fsp_c.source       = cur.source
  WHERE fp.decision = 'conflict'
    AND (cur.source IS NULL OR fp.source <> cur.source)
    AND (
      cur.value IS NULL
      OR public.lcc_value_normalize_for_compare(fp.value)
         IS DISTINCT FROM
         public.lcc_value_normalize_for_compare(cur.value)
    )
),
-- Dedup skip rows per (db, table, record, field, source) — repeated
-- CoStar refreshes produce one queue entry per record-field-source pair,
-- not one per attempt. Without this the warn/strict buckets dwarfed the
-- 212 actionable items (7,500 rows on first apply).
latest_skips AS (
  SELECT DISTINCT ON (
    fp.target_database, fp.target_table, fp.record_pk_value, fp.field_name, fp.source
  )
    fp.id AS provenance_id, fp.recorded_at, fp.target_database, fp.target_table,
    fp.record_pk_value, fp.field_name, fp.value AS attempted_value,
    fp.source AS attempted_source, fp.confidence AS attempted_confidence,
    fp.source_run_id, fp.decision, fp.decision_reason,
    fsp_a.priority AS attempted_priority, fsp_a.enforce_mode AS attempted_enforce_mode
  FROM public.field_provenance fp
  JOIN public.field_source_priority fsp_a
    ON fsp_a.target_table = fp.target_table
   AND fsp_a.field_name   = fp.field_name
   AND fsp_a.source       = fp.source
  WHERE fp.decision = 'skip'
    AND fsp_a.enforce_mode IN ('warn','strict')
    AND fp.recorded_at > now() - interval '30 days'
  ORDER BY fp.target_database, fp.target_table, fp.record_pk_value, fp.field_name, fp.source, fp.recorded_at DESC
),
warn_strict_skips AS (
  SELECT
    s.provenance_id, s.recorded_at, s.target_database, s.target_table,
    s.record_pk_value, s.field_name, s.attempted_value, s.attempted_source,
    s.attempted_confidence, s.source_run_id, s.decision, s.decision_reason,
    s.attempted_priority, s.attempted_enforce_mode,
    cur.source AS current_source, cur.value AS current_value,
    cur.recorded_at AS current_recorded_at, cur.id AS current_provenance_id,
    fsp_c.priority AS current_priority
  FROM latest_skips s
  LEFT JOIN LATERAL (
    SELECT cu.id, cu.source, cu.value, cu.recorded_at
    FROM public.field_provenance cu
    WHERE cu.target_database = s.target_database
      AND cu.target_table    = s.target_table
      AND cu.record_pk_value = s.record_pk_value
      AND cu.field_name      = s.field_name
      AND cu.decision        = 'write'
    ORDER BY cu.recorded_at DESC
    LIMIT 1
  ) cur ON true
  LEFT JOIN public.field_source_priority fsp_c
    ON fsp_c.target_table = s.target_table
   AND fsp_c.field_name   = s.field_name
   AND fsp_c.source       = cur.source
),
all_rows AS (
  SELECT *, 'conflict'::text AS row_kind FROM conflicts
  UNION ALL
  SELECT *, 'skip'::text     AS row_kind FROM warn_strict_skips
),
buckets AS (
  SELECT
    *,
    CASE
      WHEN row_kind = 'skip' AND attempted_enforce_mode = 'strict' THEN 'strict_skip'
      WHEN row_kind = 'skip' AND attempted_enforce_mode = 'warn'   THEN 'warn_skip'
      WHEN attempted_priority IS NULL OR current_priority IS NULL  THEN 'unranked_either_side'
      WHEN attempted_priority = current_priority                   THEN 'still_tied'
      WHEN attempted_priority < current_priority                   THEN 'conflicting_source_now_wins'
      ELSE                                                              'current_source_now_wins'
    END AS bucket
  FROM all_rows
)
SELECT
  b.*
FROM buckets b
-- Drop rows that already have a non-defer resolution more recent than the provenance row
WHERE NOT EXISTS (
  SELECT 1 FROM public.field_provenance_resolutions r
  WHERE r.target_database = b.target_database
    AND r.target_table    = b.target_table
    AND r.record_pk_value = b.record_pk_value
    AND r.field_name      = b.field_name
    AND r.chosen         <> 'defer'
    AND r.resolved_at     > b.recorded_at
)
-- Drop rows currently inside a defer window
AND NOT EXISTS (
  SELECT 1 FROM public.field_provenance_resolutions r
  WHERE r.target_database = b.target_database
    AND r.target_table    = b.target_table
    AND r.record_pk_value = b.record_pk_value
    AND r.field_name      = b.field_name
    AND r.chosen          = 'defer'
    AND r.defer_until     > now()
);

COMMENT ON VIEW public.v_field_provenance_review_queue IS
  'R4 Phase-4 Tier A: unified surface for the LCC Ops "Provenance Review '
  'Queue" widget. Combines open conflicts with warn/strict skips, hides '
  'rows already resolved or currently deferred, and tags each row with a '
  'bucket (still_tied / conflicting_source_now_wins / current_source_now_wins '
  '/ warn_skip / strict_skip / unranked_either_side).';

-- --------------------------------------------------------------------------
-- 4. lcc_record_field_resolution()
--
-- Atomic LCC Opps write-side of a resolution. The API endpoint calls
-- this AFTER the domain DB write (if any) returned successfully.
--
-- Behavior by p_chosen:
--   'current'    : write resolution row only; mark attempted row
--                  superseded by current row.
--   'attempted'  : write resolution row + new manual_resolution
--                  field_provenance row (becomes current); supersede
--                  the old current row and the attempted row.
--   'custom'     : same as 'attempted' but the value came from a
--                  reviewer-typed input.
--   'junk'       : mark attempted row superseded with reason='marked_as_junk';
--                  no new write row.
--   'defer'      : write resolution row with defer_until = now() + interval;
--                  leave both provenance rows untouched.
--
-- Returns the new resolution_id.
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.lcc_record_field_resolution(
  p_attempted_provenance_id  BIGINT,
  p_chosen                   TEXT,
  p_chosen_value             JSONB,
  p_workspace_id             UUID,
  p_resolved_by              UUID,
  p_decision_notes           TEXT,
  p_domain_write_ok          BOOLEAN,
  p_domain_write_response    JSONB,
  p_defer_interval           INTERVAL DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql
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

  SELECT * INTO v_attempted
  FROM public.field_provenance
  WHERE id = p_attempted_provenance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lcc_record_field_resolution: attempted_provenance_id % not found', p_attempted_provenance_id;
  END IF;

  -- Optimistic lock — if the attempted row is no longer in a resolvable state, refuse.
  IF v_attempted.decision NOT IN ('conflict','skip') THEN
    RAISE EXCEPTION 'lcc_record_field_resolution: attempted row % no longer resolvable (decision=%)',
      p_attempted_provenance_id, v_attempted.decision;
  END IF;

  -- Find current authoritative row (most recent decision='write' for this field)
  SELECT id, source INTO v_current_id, v_current_source
  FROM public.field_provenance
  WHERE target_database = v_attempted.target_database
    AND target_table    = v_attempted.target_table
    AND record_pk_value = v_attempted.record_pk_value
    AND field_name      = v_attempted.field_name
    AND decision        = 'write'
  ORDER BY recorded_at DESC
  LIMIT 1;

  IF p_chosen = 'defer' THEN
    v_defer_until := now() + COALESCE(p_defer_interval, interval '7 days');
  END IF;

  -- chosen_source: only meaningful for actual writes
  IF p_chosen IN ('attempted','custom') THEN
    v_chosen_source := 'manual_resolution';
  END IF;

  -- 1. Insert the resolution audit row
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

  -- 2. Provenance bookkeeping by branch
  IF p_chosen = 'current' THEN
    -- Supersede the attempted row pointing at the current row
    IF v_current_id IS NOT NULL THEN
      UPDATE public.field_provenance
         SET decision = 'superseded',
             superseded_by_id = v_current_id,
             decision_reason = COALESCE(decision_reason,'') ||
               ' [R4 Phase-4 resolution #' || v_resolution_id::text ||
               ': reviewer kept current source ' || COALESCE(v_current_source,'(none)') || ']'
       WHERE id = p_attempted_provenance_id;
    ELSE
      -- No current row exists; just mark resolved
      UPDATE public.field_provenance
         SET decision = 'superseded',
             decision_reason = COALESCE(decision_reason,'') ||
               ' [R4 Phase-4 resolution #' || v_resolution_id::text || ': reviewer kept current (no prior write)]'
       WHERE id = p_attempted_provenance_id;
    END IF;

  ELSIF p_chosen IN ('attempted','custom') THEN
    -- Insert the new manual_resolution write row
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
      CASE WHEN p_chosen = 'attempted' THEN 'accepted attempted value'
           ELSE 'entered custom value' END
    ) RETURNING id INTO v_new_prov_id;

    -- Supersede the prior current row (if any)
    IF v_current_id IS NOT NULL THEN
      UPDATE public.field_provenance
         SET decision = 'superseded',
             superseded_by_id = v_new_prov_id
       WHERE id = v_current_id;
    END IF;

    -- Supersede the attempted row
    UPDATE public.field_provenance
       SET decision = 'superseded',
           superseded_by_id = v_new_prov_id
     WHERE id = p_attempted_provenance_id;

  ELSIF p_chosen = 'junk' THEN
    UPDATE public.field_provenance
       SET decision = 'superseded',
           decision_reason = COALESCE(decision_reason,'') ||
             ' [R4 Phase-4 resolution #' || v_resolution_id::text || ': marked_as_junk]'
     WHERE id = p_attempted_provenance_id;

  -- 'defer' leaves both rows untouched
  END IF;

  RETURN v_resolution_id;
END
$function$;

COMMENT ON FUNCTION public.lcc_record_field_resolution IS
  'R4 Phase-4 Tier A: atomic LCC Opps write-side of a provenance '
  'conflict resolution. Always inserts a field_provenance_resolutions '
  'row; depending on `chosen`, inserts a new manual_resolution '
  'field_provenance write and supersedes the prior rows. Domain DB '
  'write is the caller''s responsibility (api/_handlers/entities-handler.js).';

COMMIT;
