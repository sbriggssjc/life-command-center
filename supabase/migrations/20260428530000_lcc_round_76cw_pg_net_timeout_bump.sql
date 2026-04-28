-- ============================================================================
-- Round 76cw — bump pg_net timeout in lcc_cron_post (5s -> 60s)
--
-- Health alert 11 fired today: 40 pg_net 'no_response' calls in 24h.
-- Inspecting net._http_response showed every failed call with
-- error_msg = 'Timeout of 5000 ms reached'. pg_net's default timeout
-- is 5s, but Vercel function calls (the retry cron's
-- /api/intake?_route=extract path, storage-cleanup with batch_size=200,
-- daily-briefing edge proxy) regularly take 20-60s.
--
-- The Vercel function completes and writes to the DB, but pg_net gives
-- up at 5s and records 'no_response'. From the health monitor's
-- perspective every cron call looked like a failure even though the
-- work succeeded. The retry cron's 90% recovery rate held because the
-- extractions actually completed; we just lost visibility into them.
--
-- Fix: pass timeout_milliseconds=60000 to net.http_post. Aligns with
-- Vercel Pro's 60s function cap so we don't artificially time out
-- before the function does.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_cron_post(
  endpoint text,
  body jsonb DEFAULT '{}'::jsonb,
  target text DEFAULT 'vercel'::text
)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  base_url text;
  api_key text;
  headers jsonb;
  result_id bigint;
BEGIN
  IF target = 'edge' THEN
    base_url := 'https://xengecqvemvfknjvbvrq.supabase.co/functions/v1';
  ELSE
    SELECT decrypted_secret INTO base_url
      FROM vault.decrypted_secrets
     WHERE name = 'lcc_railway_url' LIMIT 1;
    IF base_url IS NULL THEN
      base_url := 'https://tranquil-delight-production-633f.up.railway.app';
    END IF;
    base_url := rtrim(base_url, '/');
  END IF;

  SELECT decrypted_secret INTO api_key
    FROM vault.decrypted_secrets
   WHERE name = 'lcc_api_key' LIMIT 1;

  IF target = 'edge' THEN
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || api_key
    );
  ELSE
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-LCC-Key', api_key
    );
  END IF;

  -- Round 76cw: timeout_milliseconds=60000 covers Vercel Pro's 60s
  -- function cap. pg_net's 5s default was rejecting every long-running
  -- call as 'no_response' even when the function completed successfully.
  SELECT net.http_post(
    url := base_url || endpoint,
    headers := headers,
    body := body,
    timeout_milliseconds := 60000
  ) INTO result_id;

  RETURN result_id;
END $$;
