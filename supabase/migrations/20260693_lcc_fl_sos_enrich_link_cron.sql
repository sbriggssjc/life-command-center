-- ============================================================================
-- FL SOS enrich-compare-link cron (2026-05-31)
-- ----------------------------------------------------------------------------
-- Daily tick that POSTs the fl-sos-enrich-link endpoint so newly-added
-- confirmed-FL recorded owners get enriched from the Sunbiz mirror and
-- compared/linked to unified_contacts automatically. Enrichment is naturally
-- incremental — the handler only selects owners with sos_enriched_at IS NULL,
-- so each run picks up just the new ones. Strong (entity-identity / 2-signal)
-- links auto-apply; weak links land in v_recorded_owner_link_review for the
-- Review Console lane.
--
-- Runs on LCC Opps via the standard lcc_cron_post helper (vercel target),
-- matching generate-research-tasks et al. Registered as jobid 89.
-- ============================================================================
SELECT cron.schedule(
  'lcc-fl-sos-enrich-link',
  '40 6 * * *',  -- daily 06:40 UTC
  $$SELECT public.lcc_cron_post('/api/fl-sos-enrich-link?stage=both&limit=500','{}'::jsonb,'vercel')$$
);
