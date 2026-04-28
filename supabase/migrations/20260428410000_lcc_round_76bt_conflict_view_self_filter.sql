-- ============================================================================
-- Round 76bt — LCC: filter out same-source self-conflicts in
--              v_field_provenance_conflicts
--
-- Audit observation: of 1,225 conflicts surfaced by the view, 100% are
-- `costar_sidebar` vs `costar_sidebar` self-conflicts — i.e. two CoStar
-- captures of the same property at different dates produced different
-- values. That's not an authority dispute (the source is the same), it's
-- just stale data being refreshed. The conflict tracking is mostly noise
-- for triage UIs.
--
-- Real authority conflicts (different source A vs source B at the same
-- priority level) are the signal worth surfacing. Tighten the view:
-- exclude rows where conflicting_source = current_source.
--
-- Self-conflicts remain in the underlying field_provenance log for
-- forensics, just not in the triage view.
-- ============================================================================

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
  ORDER BY fp.recorded_at DESC;
