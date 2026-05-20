-- ============================================================================
-- R4 Phase-4 Tier A perf fix: split heavy review-queue view
--
-- Target: LCC Opps (xengecqvemvfknjvbvrq)
-- Companion to: 20260520220000_lcc_r4_phase4a_resolution.sql
--
-- The original v_field_provenance_review_queue UNIONed the actionable
-- 212 conflict rows with ~520k warn/strict skip events (deduped via
-- DISTINCT ON to ~1.7k visible rows). The skip-side CTE Sort dominated
-- query time at ~6.5s, which tripped the API handler's 8s
-- fetchWithTimeout ceiling and surfaced as "Internal server error"
-- on the Ops page widget.
--
-- Fix in three parts:
--   1. Partial index covering the DISTINCT ON over decision='skip'
--      (idx_field_prov_skip_recent)
--   2. Drop skip rows from v_field_provenance_review_queue entirely;
--      the view now carries ONLY actionable conflicts (still_tied /
--      conflicting_source_now_wins / current_source_now_wins /
--      unranked_either_side). Query time: 6.5s -> 67ms.
--   3. Move the skip set to a separate view
--      v_field_provenance_warn_strict_skips for an opt-in observation
--      surface (not loaded by the default Ops widget).
--   4. Add lcc_provenance_review_queue_counts() RPC so the API can get
--      bucket counts in one round-trip without a 10k-row scan.
-- ============================================================================

BEGIN;

-- Partial index for the dedup sort
CREATE INDEX IF NOT EXISTS idx_field_prov_skip_recent
ON public.field_provenance
  (target_database, target_table, record_pk_value, field_name, source, recorded_at DESC)
WHERE decision = 'skip';

-- Replace the main review-queue view (must DROP + CREATE because we're
-- changing column order)
DROP VIEW IF EXISTS public.v_field_provenance_review_queue;

CREATE VIEW public.v_field_provenance_review_queue AS
WITH conflicts AS (
  SELECT
    fp.id AS provenance_id, fp.recorded_at, fp.target_database, fp.target_table,
    fp.record_pk_value, fp.field_name,
    fp.value AS attempted_value, fp.source AS attempted_source,
    fp.confidence AS attempted_confidence,
    fp.source_run_id, fp.decision, fp.decision_reason,
    fsp_a.priority AS attempted_priority, fsp_a.enforce_mode AS attempted_enforce_mode,
    cur.source AS current_source, cur.value AS current_value, cur.recorded_at AS current_recorded_at,
    cur.id AS current_provenance_id, fsp_c.priority AS current_priority
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
    AND (cur.value IS NULL
         OR public.lcc_value_normalize_for_compare(fp.value)
            IS DISTINCT FROM
            public.lcc_value_normalize_for_compare(cur.value))
),
buckets AS (
  SELECT *,
    CASE
      WHEN attempted_priority IS NULL OR current_priority IS NULL THEN 'unranked_either_side'
      WHEN attempted_priority = current_priority                  THEN 'still_tied'
      WHEN attempted_priority < current_priority                  THEN 'conflicting_source_now_wins'
      ELSE                                                             'current_source_now_wins'
    END AS bucket,
    'conflict'::text AS row_kind
  FROM conflicts
)
SELECT b.* FROM buckets b
WHERE NOT EXISTS (
  SELECT 1 FROM public.field_provenance_resolutions r
  WHERE r.target_database = b.target_database
    AND r.target_table    = b.target_table
    AND r.record_pk_value = b.record_pk_value
    AND r.field_name      = b.field_name
    AND r.chosen         <> 'defer'
    AND r.resolved_at     > b.recorded_at
)
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
  'R4 Phase-4 Tier A: actionable conflict surface for the LCC Ops '
  '"Provenance Review Queue" widget. Buckets: still_tied / '
  'conflicting_source_now_wins / current_source_now_wins / '
  'unranked_either_side. Skip rows live in '
  'v_field_provenance_warn_strict_skips (separate view, opt-in).';

-- Opt-in observation surface for warn/strict skip events. Same shape as
-- the conflict view but sourced from skip events; deduped per
-- (db, table, record, field, source) to the most recent attempt.
CREATE OR REPLACE VIEW public.v_field_provenance_warn_strict_skips AS
WITH latest_skips AS (
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
)
SELECT
  s.*,
  cur.source AS current_source, cur.value AS current_value,
  cur.recorded_at AS current_recorded_at, cur.id AS current_provenance_id,
  fsp_c.priority AS current_priority,
  CASE s.attempted_enforce_mode WHEN 'strict' THEN 'strict_skip' ELSE 'warn_skip' END AS bucket,
  'skip'::text AS row_kind
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
WHERE NOT EXISTS (
  SELECT 1 FROM public.field_provenance_resolutions r
  WHERE r.target_database = s.target_database
    AND r.target_table    = s.target_table
    AND r.record_pk_value = s.record_pk_value
    AND r.field_name      = s.field_name
    AND r.chosen         <> 'defer'
    AND r.resolved_at     > s.recorded_at
)
AND NOT EXISTS (
  SELECT 1 FROM public.field_provenance_resolutions r
  WHERE r.target_database = s.target_database
    AND r.target_table    = s.target_table
    AND r.record_pk_value = s.record_pk_value
    AND r.field_name      = s.field_name
    AND r.chosen          = 'defer'
    AND r.defer_until     > now()
);

-- One-roundtrip bucket counts for the queue widget
CREATE OR REPLACE FUNCTION public.lcc_provenance_review_queue_counts()
RETURNS TABLE (bucket text, n bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT bucket::text, count(*)::bigint
  FROM public.v_field_provenance_review_queue
  GROUP BY bucket;
$$;

COMMENT ON FUNCTION public.lcc_provenance_review_queue_counts IS
  'R4 Phase-4 Tier A: one-roundtrip bucket counts for the LCC Ops review-queue widget. '
  'Replaces a 10k-row PostgREST scan that was tripping the 8s fetchWithTimeout ceiling.';

COMMIT;
