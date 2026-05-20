-- ============================================================================
-- R4-6: resolve stale (no-longer-applicable) conflict log rows
--
-- Target: LCC Opps (xengecqvemvfknjvbvrq)
-- Companion to: 20260520200000_lcc_r4_provenance_governance_phase3.sql
--
-- Many of the 485 'decision=conflict' rows in field_provenance were logged
-- weeks ago when two sources were tied at the same priority. Subsequent
-- registry changes (including this round's CoStar/RCA/OM/Email rerankings)
-- broke the tie -- so the merge function today would either skip the
-- conflicting write outright (lower-priority loses) or accept it (higher-
-- priority wins). The historical conflict markers linger as audit-trail
-- noise.
--
-- This migration resolves ONE bucket cleanly:
--
--   * `current_source_now_wins`: the source whose value is currently in
--     v_field_provenance_current outranks the rejected conflicting source
--     under today's rules. Mark the conflict log row as 'superseded' with
--     superseded_by_id pointing to the current authoritative row. The
--     domain DB value is already correct under the new rules; this is
--     pure audit cleanup.
--
-- The other two buckets are intentionally left untouched:
--
--   * `conflicting_source_now_wins` (193 rows): the now-winning source's
--     value never made it to the domain DB because the conflict was
--     recorded under the older priorities. Resolving these requires
--     writing the conflicting_value back into the live dia/gov tables --
--     deferred for owner review. They stay visible in
--     v_field_provenance_conflicts so the backfill queue is obvious.
--
--   * `still_tied` (~19 rows): both sources are still at the same
--     priority today. These are legit conflicts pending human review.
-- ============================================================================

BEGIN;

WITH resolved AS (
  UPDATE public.field_provenance fp
     SET decision         = 'superseded',
         superseded_by_id = cur.id,
         decision_reason  = COALESCE(decision_reason,'')
                            || ' [R4-6 2026-05-20 stale-conflict cleanup: current source ('
                            || cur.source || ' prio ' || fsp_w.priority::text
                            || ') outranks logged-conflict source ('
                            || fp.source || ' prio ' || fsp_c.priority::text
                            || ') under updated registry]'
    FROM public.v_field_provenance_current cur
    JOIN public.field_source_priority fsp_c
      ON fsp_c.target_table = cur.target_table
     AND fsp_c.field_name   = cur.field_name
    JOIN public.field_source_priority fsp_w
      ON fsp_w.target_table = cur.target_table
     AND fsp_w.field_name   = cur.field_name
     AND fsp_w.source       = cur.source
   WHERE fp.decision = 'conflict'
     AND fp.target_database = cur.target_database
     AND fp.target_table    = cur.target_table
     AND fp.record_pk_value = cur.record_pk_value
     AND fp.field_name      = cur.field_name
     AND fp.source         <> cur.source
     AND fp.source          = fsp_c.source
     AND public.lcc_value_normalize_for_compare(fp.value)
         IS DISTINCT FROM
         public.lcc_value_normalize_for_compare(cur.value)
     AND fsp_c.priority > fsp_w.priority
   RETURNING fp.id
)
SELECT count(*) AS stale_conflicts_resolved FROM resolved;

COMMIT;
