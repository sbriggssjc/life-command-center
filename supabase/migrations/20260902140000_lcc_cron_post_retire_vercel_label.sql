-- ============================================================================
-- 2026-09-02 — retire the 'vercel' target LABEL on lcc_cron_post.   APPLIED LIVE 2026-09-02.
--
-- The label never pointed at Vercel after the 2026-07-20 retirement: lcc_cron_post routes
-- every target except 'edge' to the Railway URL (vault 'lcc_railway_url'). But 50 of 155
-- cron jobs still said or defaulted to 'vercel', and the C1 audit (2026-08-27) read
-- cron 48 as "posts to the retired host". A dead label that reads like a live endpoint
-- misleads whoever meets it next, so it is retired at the source rather than documented.
--
-- What this does:
--   1. default target 'vercel' -> 'railway'; 'vercel' stays a silent alias (so an older
--      migration that still passes it cannot break on replay); the log records the
--      resolved target.
--   2. rewrites every scheduled command naming 'vercel' -> 'railway' (36 live).
-- Behaviour of every job is byte-identical: same URL, same headers, same body.
-- REVERSAL: none needed — the alias makes the old spelling equivalent. To restore the
-- old default, re-CREATE the function with DEFAULT 'vercel'.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_cron_post(endpoint text, body jsonb DEFAULT '{}'::jsonb, target text DEFAULT 'railway'::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  base_url text;
  api_key text;
  headers jsonb;
  result_id bigint;
  tgt text := CASE WHEN target = 'vercel' THEN 'railway' ELSE target END;  -- legacy alias
BEGIN
  IF tgt = 'edge' THEN
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

  IF tgt = 'edge' THEN
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

  SELECT net.http_post(
    url := base_url || endpoint,
    headers := headers,
    body := body,
    timeout_milliseconds := 60000
  ) INTO result_id;

  BEGIN
    INSERT INTO public.lcc_cron_post_log (request_id, endpoint, target)
    VALUES (result_id, endpoint, tgt)
    ON CONFLICT (request_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN result_id;
END $function$;

COMMENT ON FUNCTION public.lcc_cron_post(text, jsonb, text) IS
  'POST to the LCC app (Railway) or an LCC Opps edge function with the vault API key. target: ''railway'' (default) | ''edge''. ''vercel'' is accepted as a legacy alias of ''railway'' — Vercel was retired 2026-07-20 and this function has never routed there since.';

-- Rewrite every scheduled command that still names the legacy label.
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT jobid, command FROM cron.job WHERE command LIKE '%lcc_cron_post(%''vercel''%' LOOP
    PERFORM cron.alter_job(job_id := r.jobid, command := replace(r.command, '''vercel''', '''railway'''));
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'lcc_cron_post: % job commands relabelled vercel -> railway', n;
END $$;
