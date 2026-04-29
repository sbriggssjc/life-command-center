-- ============================================================================
-- Round 76ec — Schedule weekly NPPES auto-fill on LCC Opps pg_cron
--
-- Calls the npi-lookup edge function on the dialysis project every Monday at
-- 07:00 UTC. The edge function:
--   • fetches active medicare_clinics rows where npi='' (max 700 per run)
--   • queries NPPES live API by city+state+ESRD taxonomy
--   • scores each candidate by address+name fuzzy match
--   • auto-writes npi when score >= 0.9 (and no near-tie)
--   • logs every attempt to dia.npi_registry_lookups
--
-- Apply on LCC Opps Supabase project (xengecqvemvfknjvbvrq).
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN PERFORM cron.unschedule('weekly-npi-lookup'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule(
      'weekly-npi-lookup',
      '0 7 * * 1',  -- Mondays at 07:00 UTC
      -- target='vercel' (default) routes through /api/npi-lookup on Vercel,
      -- which proxies to the npi-lookup edge function on the dialysis
      -- Supabase project. Going through Vercel keeps LCC_API_KEY auth in
      -- the same hop chain as the UI button.
      $cmd$ SELECT public.lcc_cron_post('/api/npi-lookup', '{"all":true,"max":700}'::jsonb) $cmd$
    );
  END IF;
END $$;
