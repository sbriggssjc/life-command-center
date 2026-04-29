-- ============================================================================
-- Round 76ed — Schedule weekly NPPES national sweep on LCC Opps pg_cron
--
-- Calls the npi-registry-sync edge function on the dialysis project every
-- Sunday at 06:30 UTC, just before the matview refresh at 06:50 picks up
-- the new history rows. The edge function:
--   • walks all 50 states + DC + territories querying NPPES live API
--   • subdivides big states (CA/TX/NY/FL) by ZIP prefix when >200 hits
--   • upserts npi_registry, snapshots into clinic_npi_registry_history
--   • computes diff flags (status_changed, address_changed, etc.) so the
--     matview's change-detection UNION branches surface BD-actionable signals
--
-- Apply on LCC Opps Supabase project (xengecqvemvfknjvbvrq).
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN PERFORM cron.unschedule('weekly-npi-registry-sync'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule(
      'weekly-npi-registry-sync',
      '30 6 * * 0',  -- Sundays at 06:30 UTC (matview refresh runs at 06:50)
      $cmd$ SELECT public.lcc_cron_post('/api/npi-registry-sync', '{}'::jsonb) $cmd$
    );
  END IF;
END $$;
