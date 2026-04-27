-- ============================================================================
-- Migration: Phase 3 — flip enforce_mode to `warn` for safe county-records rules
--
-- Target: LCC Opps Supabase (OPS_SUPABASE_URL)
--
-- Phase 3 of the data quality self-learning loop. Until now, every priority
-- entry has been enforce_mode='record_only' — provenance is logged but the
-- caller never warns or blocks. This migration flips a small starter set
-- to 'warn'.
--
-- Selection criteria for warn-mode flip:
--   - Lower-ranked source priority (costar_sidebar = 55-65)
--   - Higher-ranked source is the legal source of record (county_records = 5)
--   - Priority gap >= 50 — overwriting county data with CoStar is almost
--     certainly wrong
--   - Field is a county/recorder data point: parcel APN, tax assessment,
--     deed details (document_number, grantor, grantee, etc.)
--
-- Behavior change:
--   - lcc_merge_field() returns enforce_mode along with the decision
--   - The JS-side recordFieldProvenance() helper logs a console.warn when
--     decision='skip' or 'conflict' AND enforce_mode IN ('warn','strict').
--   - Vercel function logs will start showing
--     "[field-provenance:warn] skip on dia.deed_records.grantor record=12345"
--     for every CoStar attempt to overwrite a county-sourced field.
--   - Actual UPDATE in the writer still runs (warn mode). Only strict mode
--     would refactor writers to consult priority BEFORE writing — that's
--     a future migration once we observe a clean signal in warn mode.
--
-- Tables / fields affected:
--   - dia.deed_records.{document_number, deed_type, grantor, grantee,
--                       recording_date, consideration}
--   - gov.deed_records.{document_number, deed_type, grantor, grantee,
--                       recording_date, consideration}
--   - dia.parcel_records.{apn, county, assessed_value}
--   - gov.parcel_records.{apn, county, land_value, improvement_value,
--                         total_assessed_value}
--   - dia.tax_records.{tax_year, assessed_value}
--   - gov.tax_records.{tax_year, assessed_value}
--
-- Audit query — show what would have been blocked under strict mode:
--   SELECT target_table, field_name, count(*) AS would_have_blocked
--   FROM public.field_provenance fp
--   JOIN public.field_source_priority fsp
--     ON fsp.target_table = fp.target_table
--    AND fsp.field_name   = fp.field_name
--    AND fsp.source       = fp.source
--   WHERE fp.decision IN ('skip', 'conflict')
--     AND fsp.enforce_mode IN ('warn', 'strict')
--     AND fp.recorded_at > now() - interval '7 days'
--   GROUP BY 1, 2
--   ORDER BY 3 DESC;
--
-- Escalation path: after 7 days of clean warn-mode signal, flip these same
-- rows to 'strict' and update sidebar-pipeline.js writers to consult
-- field_source_priority BEFORE the UPDATE (refactor pending).
-- ============================================================================

UPDATE public.field_source_priority
   SET enforce_mode = 'warn'
 WHERE source = 'costar_sidebar'
   AND target_table IN (
     'dia.deed_records',
     'gov.deed_records',
     'dia.parcel_records',
     'gov.parcel_records',
     'dia.tax_records',
     'gov.tax_records'
   );
