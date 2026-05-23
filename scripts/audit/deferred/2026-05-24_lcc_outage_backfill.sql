-- ============================================================================
-- Deferred LCC Opps audit_run_log backfill — 2026-05-24
--
-- LCC Opps SQL endpoint (xengecqvemvfknjvbvrq) was timing out at the
-- Supabase MCP layer during the A6b cleanup runs. The cleanup itself
-- completed successfully on dia and gov (which were reachable); only
-- the audit_run_log preamble/postamble couldn't land.
--
-- Apply this file against LCC Opps once SQL access recovers. The runs
-- touched are still recoverable from each domain's recorded_at/state-change
-- timestamps even without this audit row, but this captures them in the
-- canonical place.
-- ============================================================================

-- A6b-dia (610 rows superseded at ~14:25 UTC)
WITH opened AS (
  SELECT public.audit_run_begin(
    'A6b_dia_2026_05_24_001',
    'A6b_ownership_history_same_owner_dedup',
    'dia_db',
    FALSE,
    610,
    'Collapse same-owner duplicate open ownership rows on dia (BACKFILLED — LCC Opps SQL endpoint was timing out during the live run).',
    '{"approach":"keep_earliest_start","actual_excess_rows":610}'::jsonb
  ) AS log_id
)
SELECT public.audit_run_finish(log_id, 'succeeded', 610, NULL, NULL) FROM opened;

SELECT public.record_cleanup_provenance(
  'A6b_dia_2026_05_24_001', 'dia_db', 'ownership_history', 'BULK',
  'ownership_state',
  '{"old_state":"active","new_state":"superseded","rows":610,"reason":"duplicate (property_id, recorded_owner_id) open rows; kept earliest start"}'::jsonb,
  'A6b ownership_history dedup (dia)', 0.95
);

-- A6b-gov (249 rows superseded at ~14:27 UTC)
WITH opened AS (
  SELECT public.audit_run_begin(
    'A6b_gov_2026_05_24_001',
    'A6b_ownership_history_same_owner_dedup',
    'gov_db',
    FALSE,
    249,
    'Collapse same-owner duplicate open ownership rows on gov (BACKFILLED). Uses transfer_date for ordering.',
    '{"approach":"keep_earliest_transfer_date","actual_excess_rows":249}'::jsonb
  ) AS log_id
)
SELECT public.audit_run_finish(log_id, 'succeeded', 249, NULL, NULL) FROM opened;

SELECT public.record_cleanup_provenance(
  'A6b_gov_2026_05_24_001', 'gov_db', 'ownership_history', 'BULK',
  'ownership_state',
  '{"old_state":"active","new_state":"superseded","rows":249,"reason":"duplicate (property_id, recorded_owner_id) open rows; kept earliest transfer_date"}'::jsonb,
  'A6b ownership_history dedup (gov)', 0.95
);

-- Quick verification — should see two recent A6b_* run_ids
SELECT log_id, run_id, target_database, status, rows_affected
FROM public.audit_run_log
WHERE run_id LIKE 'A6b_%2026_05_24%'
ORDER BY log_id;
