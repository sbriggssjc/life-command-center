-- ============================================================================
-- Stage B Widen — folder_feed_lease property_financials priority (LCC Opps)
-- 2026-06-13
--
-- The lease extractor's expense_schedule → property_financials leg (#64 NOI
-- input) writes per-FY expense rows tagged source='folder_feed_lease'. Register
-- those columns so the writes (a) rank correctly and (b) don't show as drift in
-- v_field_provenance_unranked.
--
-- BOUNDARY (cap_rate_history doctrine): these rows are lease-abstract pass-through
-- estimates, NOT audited financials — the JS writer stamps is_actual=false +
-- noi=null + source='folder_feed_lease', and resolveCapRateProvenance Tier 2
-- additionally guards source<>folder_feed_lease, so they are structurally
-- excluded from the reported cap-rate cohort. Priority 45 mirrors the sibling
-- lease-factual registration. record_only mode.
--
-- Columns mirror api/_handlers/lease-extractor.js buildRealLeaseDeps
-- insertPropertyFinancials (taxes/insurance/cam/operating_expenses) — the common
-- subset present on BOTH gov.property_financials (PK financial_id) and
-- dia.property_financials (PK id). Idempotent upsert on
-- (target_table, field_name, source).
-- ============================================================================

INSERT INTO public.field_source_priority (target_table, field_name, source, priority, enforce_mode, notes)
SELECT v.target_table, v.field_name, 'folder_feed_lease', 45, 'record_only',
       'Stage B widen — lease expense_schedule (boundary: is_actual=false, off the reported cap-rate cohort).'
FROM (VALUES
  ('gov.property_financials','taxes'), ('gov.property_financials','insurance'),
  ('gov.property_financials','cam'),   ('gov.property_financials','operating_expenses'),
  ('dia.property_financials','taxes'), ('dia.property_financials','insurance'),
  ('dia.property_financials','cam'),   ('dia.property_financials','operating_expenses')
) AS v(target_table, field_name)
ON CONFLICT (target_table, field_name, source) DO UPDATE
  SET priority = EXCLUDED.priority, enforce_mode = EXCLUDED.enforce_mode,
      notes = EXCLUDED.notes, updated_at = now();
