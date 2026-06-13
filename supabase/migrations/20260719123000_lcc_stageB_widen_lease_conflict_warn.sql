-- ============================================================================
-- Stage B widen — surface lease fill-blanks conflicts in the Decision Center
-- 2026-06-13 (blocker fix)
--
-- The lease extractor is now a TRUE fill-blanks writer: it only writes a lease
-- column that is currently NULL, and routes a populated-field DISAGREEMENT to
-- the Decision Center as a field_provenance row with decision='conflict'
-- (recordConflict, never an overwrite). The provenance_conflict lane
-- (v_field_provenance_actionable) only surfaces skip/conflict rows whose
-- field_source_priority rule is enforce_mode IN ('warn','strict'). The
-- folder_feed_lease leases rules were 'record_only', so the conflicts would not
-- have surfaced — flip them to 'warn'.
--
-- Scope: ONLY the gov.leases / dia.leases factual columns (the fill-blanks-vs-
-- conflict surface). The TI / property_financials / property_documents
-- folder_feed_lease rows are NULL-only / append writes (no conflicts) and stay
-- 'record_only'. Idempotent.
-- ============================================================================

UPDATE public.field_source_priority
   SET enforce_mode = 'warn', updated_at = now()
 WHERE source = 'folder_feed_lease'
   AND target_table IN ('gov.leases', 'dia.leases')
   AND enforce_mode <> 'warn';
