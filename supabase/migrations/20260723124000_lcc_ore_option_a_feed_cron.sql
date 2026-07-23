-- ============================================================================
-- ORE Option A — daily feed cron. After the owner-contact-signals sync/finalize
-- (05:00/05:05) lands the domain reg_address STRING into the mirror, this feeds
-- it into the observations store + resolves owner entities. The existing hourly
-- lcc-owner-evidence-cache-refresh + the Build 2 reconcile sweep then pick it up.
-- Gentle, idempotent (the observation dedupe key). REVERSAL: unschedule the job +
-- drop the wrapper.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.lcc_owner_address_feed_tick()
RETURNS TABLE(observations_fed int, entities_resolved int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS
$$
BEGIN
  observations_fed  := public.lcc_feed_owner_signal_addresses();
  entities_resolved := public.lcc_resolve_owner_address_observation_entities();
  RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.lcc_owner_address_feed_tick() TO service_role;

SELECT cron.unschedule('lcc-owner-address-feed') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'lcc-owner-address-feed');
SELECT cron.schedule('lcc-owner-address-feed', '7 5 * * *',
  $$SELECT public.lcc_owner_address_feed_tick()$$);
