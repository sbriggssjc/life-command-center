-- ============================================================================
-- 20260523120000_lcc_audit_run_log_and_cleanup_helpers.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — Track Foundation F1 + F3
--
-- Creates the audit_run_log on LCC Opps so cross-domain cleanup runs have a
-- single source of truth, plus a helper function that wraps field_provenance
-- writes during cleanup so every row touched by a cleanup run is traceable
-- and reversible by run_id.
--
-- audit_run_log captures: which cleanup step ran, which domain it ran
-- against, how many rows before/after, dry-run flag, started/finished
-- timestamps, notes. One row per (run_id, step) combination.
--
-- record_cleanup_provenance() writes a field_provenance row tagged with the
-- cleanup run so every column change is attributable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.audit_run_log (
  log_id          BIGSERIAL PRIMARY KEY,
  run_id          TEXT NOT NULL,
  step            TEXT NOT NULL,
  target_database TEXT NOT NULL CHECK (target_database IN ('lcc_opps','dia_db','gov_db','all')),
  rows_before     BIGINT,
  rows_affected   BIGINT,
  rows_after      BIGINT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  dry_run         BOOLEAN NOT NULL DEFAULT TRUE,
  status          TEXT NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress','succeeded','failed','rolled_back')),
  error_message   TEXT,
  notes           TEXT,
  metadata        JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_run_log_run
  ON public.audit_run_log (run_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_run_log_step_recent
  ON public.audit_run_log (step, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_run_log_domain
  ON public.audit_run_log (target_database, started_at DESC);

ALTER TABLE public.audit_run_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_run_log_service_role_all ON public.audit_run_log;
CREATE POLICY audit_run_log_service_role_all ON public.audit_run_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS audit_run_log_authenticated_read ON public.audit_run_log;
CREATE POLICY audit_run_log_authenticated_read ON public.audit_run_log
  FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE public.audit_run_log IS
  'Append-only log of data-cleanup runs (Track A of OWNERSHIP_AND_SALES_REMEDIATION_PLAN). One row per (run_id, step). Cross-domain.';

-- Helper: record a field-level cleanup write to field_provenance with the run
-- already tagged. Lets cleanup SQL stay terse without losing reversibility.
CREATE OR REPLACE FUNCTION public.record_cleanup_provenance(
  p_run_id          TEXT,
  p_target_database TEXT,
  p_target_table    TEXT,
  p_record_pk       TEXT,
  p_field_name      TEXT,
  p_new_value       JSONB,
  p_decision_reason TEXT DEFAULT 'cleanup_run',
  p_confidence      NUMERIC DEFAULT 0.95
) RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_id BIGINT;
BEGIN
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
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.record_cleanup_provenance IS
  'Helper for Track A cleanup scripts. Writes a field_provenance row with source=cleanup_run_<run_id>. Reversibility: SELECT * FROM field_provenance WHERE source_run_id = <run_id> gives every column touched.';

-- Helper: open a new audit_run_log row and return the log_id for status updates.
CREATE OR REPLACE FUNCTION public.audit_run_begin(
  p_run_id          TEXT,
  p_step            TEXT,
  p_target_database TEXT,
  p_dry_run         BOOLEAN DEFAULT TRUE,
  p_rows_before     BIGINT DEFAULT NULL,
  p_notes           TEXT DEFAULT NULL,
  p_metadata        JSONB DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO public.audit_run_log (
    run_id, step, target_database, rows_before, dry_run, notes, metadata
  )
  VALUES (
    p_run_id, p_step, p_target_database, p_rows_before, p_dry_run, p_notes, p_metadata
  )
  RETURNING log_id INTO v_id;
  RETURN v_id;
END;
$$;

-- Helper: close out an audit_run_log row with results.
CREATE OR REPLACE FUNCTION public.audit_run_finish(
  p_log_id        BIGINT,
  p_status        TEXT,
  p_rows_affected BIGINT DEFAULT NULL,
  p_rows_after    BIGINT DEFAULT NULL,
  p_error         TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.audit_run_log
     SET status        = p_status,
         rows_affected = COALESCE(p_rows_affected, rows_affected),
         rows_after    = COALESCE(p_rows_after, rows_after),
         error_message = p_error,
         finished_at   = now()
   WHERE log_id = p_log_id;
END;
$$;

COMMENT ON FUNCTION public.audit_run_begin IS 'Opens an audit_run_log row; returns log_id for status updates.';
COMMENT ON FUNCTION public.audit_run_finish IS 'Closes an audit_run_log row with final status and counts.';
