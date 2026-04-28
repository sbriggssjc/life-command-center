-- ============================================================================
-- Round 76ar — fix lcc_cron_post URL + document API key vault gap
--
-- CRITICAL bug discovered via pg_net._http_response audit: every nightly
-- cron HTTP call has been silently failing with 404 (HTML 'page not found')
-- because lcc_cron_post() was hardcoded to call
-- 'https://life-command-center.vercel.app' — but the LCC API actually runs
-- on Railway (server.js with Express, not Vercel rewrites). The vercel.app
-- subdomain serves a different app entirely.
--
-- pg_cron reported "succeeded" because pg_net.http_post returns a row id
-- whether the response is 2xx or not. The crons enqueued requests, the
-- requests went out, every one was rejected.
--
-- Affected crons (silent failure):
--   nightly-preassemble (07:00 daily)
--   nightly-cross-domain-match (08:00 daily)
--   daily-briefing-snapshot (10:00 daily)
--   weekly-intelligence-report (Sun 11:00)
--   refresh-work-counts (every 5min) — was OK, fired internal SQL
--
-- Fix:
--   1. Add 'lcc_railway_url' to vault as the single source of truth
--   2. Rewrite lcc_cron_post to read from vault.lcc_railway_url
--      (kept 'target=edge' branch unchanged — it hits Supabase Edge)
--
-- Companion fix in server.js: added /api/storage-cleanup and
-- /api/sf-sync-queue Express routes (these were declared in vercel.json
-- rewrites but never wired into the Railway server).
--
-- ── ADDITIONAL FOLLOW-UP REQUIRED ──
-- vault.lcc_api_key was set to literal 'REPLACE_WITH_ACTUAL_KEY' — a
-- placeholder that was never updated. Every cron call has been sending
-- this invalid key as X-LCC-Key. To fix:
--
--   UPDATE vault.secrets SET secret = '<your real LCC_API_KEY>'
--    WHERE name = 'lcc_api_key';
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

-- Store Railway base URL
DO $$
BEGIN
  PERFORM vault.create_secret(
    'https://tranquil-delight-production-633f.up.railway.app',
    'lcc_railway_url',
    'LCC API Railway production URL — single source of truth for cron HTTP calls'
  );
EXCEPTION WHEN unique_violation THEN
  UPDATE vault.secrets
     SET secret = 'https://tranquil-delight-production-633f.up.railway.app'
   WHERE name = 'lcc_railway_url';
END $$;

-- Rewrite lcc_cron_post to read base URL from vault
CREATE OR REPLACE FUNCTION public.lcc_cron_post(
  endpoint text,
  body jsonb DEFAULT '{}'::jsonb,
  target text DEFAULT 'vercel'::text   -- legacy param name; kept for compat
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER AS $$
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
    FROM vault.decrypted_secrets WHERE name = 'lcc_api_key' LIMIT 1;

  IF target = 'edge' THEN
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || api_key);
  ELSE
    headers := jsonb_build_object('Content-Type','application/json','X-LCC-Key', api_key);
  END IF;

  SELECT net.http_post(
    url := base_url || endpoint,
    headers := headers,
    body := body
  ) INTO result_id;

  RETURN result_id;
END $$;
