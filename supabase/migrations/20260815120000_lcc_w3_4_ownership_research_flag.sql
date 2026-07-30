-- ============================================================================
-- W3.4 — register the ownership_research_queue producer kill-switch  (audit 3.4
-- item 6). LCC Opps (xengecqvemvfknjvbvrq). Additive / idempotent.
-- ----------------------------------------------------------------------------
-- The gov ownership_research_queue grew to 57,130 write-only rows because 9
-- unguarded producer INSERT sites in the government-lease pipeline out-run the
-- consumer. Those producers are now gated behind ENABLE_OWNERSHIP_RESEARCH_QUEUE
-- (default OFF) in the pipeline repo. Per the inert-feature-registry doctrine,
-- every process.env capability toggle gets a feature_flags_registry row so "off"
-- is visible in the daily briefing's Dormant-capabilities section.
-- ============================================================================
INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES
  ('ENABLE_OWNERSHIP_RESEARCH_QUEUE',
   'Gates every producer that INSERTs into gov ownership_research_queue (9 sites in the government-lease lead pipeline). OFF stops the write-only growth that reached 57,130 rows (producers out-ran the ~10-lead/pass consumer).',
   'government-lease pipeline (lead_pipeline / deep_link / ingest_ownership / sync_properties_from_sources)',
   'ENABLE_OWNERSHIP_RESEARCH_QUEUE',
   'off', '2026-07-30',
   'Scott / data-pipeline',
   'W3.4 kill-switch. Default OFF. Backlog triaged 2026-07-30: 17,665 high-confidence corroborated rows auto-verified in place; 39,465 archived to gov archive.ownership_research_queue_w34 (500-row sample in public.ownership_research_triage_sample). gov_check_queue_slas() opens a queue_regrowth alert if >200 rows/24h appear (writer re-enabled). Set to "true" to revive enqueuing.')
ON CONFLICT (flag) DO UPDATE
  SET purpose=EXCLUDED.purpose, surface=EXCLUDED.surface, env_var=EXCLUDED.env_var,
      state=EXCLUDED.state, off_since=EXCLUDED.off_since, owner=EXCLUDED.owner, notes=EXCLUDED.notes;
