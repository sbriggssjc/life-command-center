-- ============================================================================
-- Deferred LCC Opps audit_run_log backfill — C4 owner-entity write-time dedup
--
-- LCC Opps SQL endpoint (xengecqvemvfknjvbvrq) was timing out at the
-- Supabase MCP layer during the C4 cleanup runs (same outage pattern as the
-- 2026-05-24 A6b run — see 2026-05-24_lcc_outage_backfill.sql).
--
-- The cleanup itself completed successfully on dia + gov. This file captures
-- the audit_run_log + record_cleanup_provenance writes once LCC Opps SQL
-- access recovers, so the runs are queryable in the canonical place.
--
-- All counts verified via direct queries against dia/gov after each step.
-- ============================================================================

-- C4 (1) dia.recorded_owners
--   - Pre-step: backfilled 363 NULL normalized_name via dia_canonicalize_owner_name(name)
--   - A1c merges: 195 collision groups; ~50 distinct loser merges via apply_owner_merge
--     (the post-backfill collision count collapsed further because the same canonical
--      string already existed on a populated peer)
--   - Schema: new partial UNIQUE uq_recorded_owners_normalized_name_active
--     ON recorded_owners(normalized_name)
--     WHERE normalized_name IS NOT NULL AND != '' AND merged_into IS NULL
--   - Trigger: recorded_owners_canonicalize_biu BEFORE INSERT OR UPDATE OF name,normalized_name
--     populating normalized_name from dia_canonicalize_owner_name(name) when missing
WITH opened AS (
  SELECT public.audit_run_begin(
    'C4_dia_recorded_owners_2026_05_24_001',
    'C4_recorded_owners_dedup',
    'dia_db',
    FALSE,
    245,
    'C4 entity dedup write-time enforcement on dia.recorded_owners (BACKFILLED — LCC Opps SQL was timing out during the live run). Backfilled 363 NULL normalized_name + merged 195 collision groups via apply_owner_merge + added partial UNIQUE on normalized_name (active rows) + BEFORE INSERT/UPDATE trigger to auto-populate normalized_name.',
    '{"backfilled_null_normalized_name":363,"merged_groups":195,"trigger":"recorded_owners_canonicalize_biu","unique_index":"uq_recorded_owners_normalized_name_active"}'::jsonb
  ) AS log_id
)
SELECT public.audit_run_finish(log_id, 'succeeded', 245, NULL, NULL) FROM opened;
SELECT public.record_cleanup_provenance(
  'C4_dia_recorded_owners_2026_05_24_001', 'dia_db', 'recorded_owners', 'BULK',
  'normalized_name + UNIQUE + trigger',
  '{"backfilled":363,"merge_groups":195,"unique_idx":"uq_recorded_owners_normalized_name_active","trigger":"recorded_owners_canonicalize_biu"}'::jsonb,
  'C4 dia.recorded_owners write-time dedup', 0.95
);

-- C4 (2) dia.true_owners
--   - A1c merge: 1 collision group (Aei Capital Corp → AEI Capital) via apply_true_owner_merge
--   - Backfill: 535 NULL normalized_name populated via dia_canonicalize_owner_name(name)
--   - Schema: existing UNIQUE true_owners_normalized_name_uidx already partial WHERE NOT NULL/empty
--   - Trigger: true_owners_canonicalize_biu BEFORE INSERT/UPDATE OF name,normalized_name
WITH opened AS (
  SELECT public.audit_run_begin(
    'C4_dia_true_owners_2026_05_24_001',
    'C4_true_owners_dedup',
    'dia_db',
    FALSE,
    536,
    'C4 entity dedup write-time enforcement on dia.true_owners (BACKFILLED). Merged 1 collision via apply_true_owner_merge + backfilled 535 NULL normalized_name + BEFORE INSERT/UPDATE trigger to auto-populate normalized_name. Also created public.apply_true_owner_merge() primitive (mirror of apply_owner_merge for true_owners across 12 FK-dependent tables).',
    '{"merged":1,"backfilled_norm_name":535,"new_function":"apply_true_owner_merge","trigger":"true_owners_canonicalize_biu"}'::jsonb
  ) AS log_id
)
SELECT public.audit_run_finish(log_id, 'succeeded', 536, NULL, NULL) FROM opened;
SELECT public.record_cleanup_provenance(
  'C4_dia_true_owners_2026_05_24_001', 'dia_db', 'true_owners', 'BULK',
  'normalized_name + apply_true_owner_merge + trigger',
  '{"merged":1,"backfilled":535,"trigger":"true_owners_canonicalize_biu"}'::jsonb,
  'C4 dia.true_owners write-time dedup', 0.95
);

-- C4 (3) gov.recorded_owners
--   - Already 0 collisions across 15,356 active rows (100% canonical_name populated by prior pipeline)
--   - Existing UNIQUE uq_recorded_owners_canonical was missing the merged_into filter; tightened to
--     `(canonical_name, COALESCE(state,'')) WHERE canonical_name IS NOT NULL AND merged_into IS NULL`
--   - Trigger: recorded_owners_canonicalize_biu BEFORE INSERT/UPDATE OF name,canonical_name
WITH opened AS (
  SELECT public.audit_run_begin(
    'C4_gov_recorded_owners_2026_05_24_001',
    'C4_recorded_owners_dedup',
    'gov_db',
    FALSE,
    0,
    'C4 entity dedup write-time enforcement on gov.recorded_owners (BACKFILLED). No row changes — already clean. Tightened existing uq_recorded_owners_canonical to include merged_into filter + BEFORE INSERT/UPDATE trigger to auto-populate canonical_name from compute_canonical_name(name).',
    '{"row_changes":0,"unique_tightened":true,"trigger":"recorded_owners_canonicalize_biu"}'::jsonb
  ) AS log_id
)
SELECT public.audit_run_finish(log_id, 'succeeded', 0, NULL, NULL) FROM opened;

-- C4 (4) gov.true_owners
--   - A1c merges: 326 losers across ~317 collision groups via apply_true_owner_merge
--     (after adding missing FK indexes on ownership_history.true_owner_id +
--      properties.true_owner_id — the original merge timed out without them)
--   - Backfill: 10,412 NULL canonical_name populated via compute_canonical_name(name)
--   - Schema: tightened uq_true_owners_canonical to include merged_into filter
--   - Trigger: true_owners_canonicalize_biu BEFORE INSERT/UPDATE OF name,canonical_name
WITH opened AS (
  SELECT public.audit_run_begin(
    'C4_gov_true_owners_2026_05_24_001',
    'C4_true_owners_dedup',
    'gov_db',
    FALSE,
    10738,
    'C4 entity dedup write-time enforcement on gov.true_owners (BACKFILLED). Merged 326 losers across ~317 collision groups via apply_true_owner_merge + backfilled 10,412 NULL canonical_name + BEFORE INSERT/UPDATE trigger to auto-populate canonical_name. Also: added missing FK indexes on ownership_history.true_owner_id + properties.true_owner_id (required for merge perf), tightened uq_true_owners_canonical to include merged_into filter, created public.apply_true_owner_merge() primitive.',
    '{"merged":326,"backfilled_canon":10412,"new_indexes":["idx_ownership_history_true_owner_id","idx_properties_true_owner_id"],"new_function":"apply_true_owner_merge","trigger":"true_owners_canonicalize_biu"}'::jsonb
  ) AS log_id
)
SELECT public.audit_run_finish(log_id, 'succeeded', 10738, NULL, NULL) FROM opened;
SELECT public.record_cleanup_provenance(
  'C4_gov_true_owners_2026_05_24_001', 'gov_db', 'true_owners', 'BULK',
  'canonical_name + apply_true_owner_merge + trigger',
  '{"merged":326,"backfilled":10412,"trigger":"true_owners_canonicalize_biu"}'::jsonb,
  'C4 gov.true_owners write-time dedup', 0.95
);

-- Verification — should see four C4_* run_ids
SELECT log_id, run_id, target_database, status, rows_affected
FROM public.audit_run_log
WHERE run_id LIKE 'C4_%2026_05_24%'
ORDER BY log_id;
