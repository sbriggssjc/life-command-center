-- ============================================================================
-- A4a_deed_property_id_sync_dia.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — Track A4 (dia, first half)
--
-- Backfills dia.deed_records.property_id from the property_public_records
-- join table. The 2026-05-23 baseline showed 364 deed rows that have a
-- valid join-table link but a NULL direct column. New writes (post-Round
-- 76ae) populate the column at insert time; this script catches the
-- historical rows that pre-date that fix.
--
-- Wrapped in audit_run_log on LCC Opps so the run is reversible.
--
-- Usage (from a workstation with DIA_SUPABASE_URL / OPS_SUPABASE_URL set):
--   psql "$OPS_SUPABASE_DB_URL" -c "
--     SELECT audit_run_begin(
--       :'run_id', 'A4a_deed_property_id_sync_dia', 'dia_db', :dry_run,
--       (SELECT COUNT(*) FROM ... see node script), 'A4a deed property_id sync', NULL);
--   "
--   psql "$DIA_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f A4a_deed_property_id_sync_dia.sql
--   psql "$OPS_SUPABASE_DB_URL" -c "
--     SELECT audit_run_finish( ... );
--   "
--
-- This SQL targets the dia database only. The audit_run_log / provenance
-- wrapping is in the companion node script (A4a_deed_property_id_sync.mjs).
-- ============================================================================

-- Dry-run vs apply is signaled via :apply_mode (set with -v apply_mode=apply).
-- Anything other than 'apply' is treated as dry-run.

\set ON_ERROR_STOP on
\if :{?apply_mode}
\else
  \set apply_mode dry
\endif

BEGIN;

-- Capture the candidate set into a temp table so dry-run and apply share
-- the same row population.
DROP TABLE IF EXISTS _a4a_candidates;
CREATE TEMP TABLE _a4a_candidates AS
SELECT
  d.id              AS deed_id,
  ppr.property_id   AS new_property_id,
  d.document_number,
  d.recording_date,
  d.grantor,
  d.grantee
FROM public.deed_records d
JOIN public.property_public_records ppr
  ON ppr.record_type = 'deed'
 AND ppr.record_id::text = d.id::text
WHERE d.property_id IS NULL
  AND ppr.property_id IS NOT NULL;

\echo '— candidate count:'
SELECT COUNT(*) AS candidates FROM _a4a_candidates;

\echo ''
\echo '— sample (first 5):'
SELECT deed_id, new_property_id, document_number, recording_date, grantor, grantee
FROM _a4a_candidates
ORDER BY recording_date DESC NULLS LAST
LIMIT 5;

\if :{?apply_mode}
\if :{?apply_mode}
\endif
\endif

SELECT CASE WHEN :'apply_mode' = 'apply' THEN 'APPLYING' ELSE 'DRY RUN — no writes' END AS mode;

-- Conditionally apply: PATCH each candidate's deed_records.property_id and
-- write a provenance row tagged with this run.
-- (Note: provenance writes need the run_id; we use a placeholder ':run_id'
-- that the wrapper script substitutes via psql -v.)

\if :{?run_id}
\else
  \set run_id 'A4a_dryrun_placeholder'
\endif

DO $$
DECLARE
  v_run_id TEXT := :'run_id';
  v_apply  TEXT := :'apply_mode';
  v_count  BIGINT := 0;
  v_row    RECORD;
BEGIN
  IF v_apply = 'apply' THEN
    FOR v_row IN SELECT * FROM _a4a_candidates LOOP
      UPDATE public.deed_records
         SET property_id = v_row.new_property_id,
             updated_at = now()
       WHERE id = v_row.deed_id;
      v_count := v_count + 1;
    END LOOP;
    RAISE NOTICE '[A4a] patched % deed_records.property_id rows', v_count;
  ELSE
    SELECT COUNT(*) INTO v_count FROM _a4a_candidates;
    RAISE NOTICE '[A4a] DRY RUN: would patch % rows (run with -v apply_mode=apply to commit)', v_count;
  END IF;
END $$;

-- Re-read the health view so the caller can capture the after-state.
\echo ''
\echo '— v_data_health_ownership after this step:'
SELECT deed_total, deed_orphans, deed_column_backfill_pending FROM public.v_data_health_ownership;

COMMIT;
