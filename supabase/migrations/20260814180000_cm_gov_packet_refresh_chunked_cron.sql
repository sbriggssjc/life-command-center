-- Recurring CM gov packet refresh (2026-08-14) — LCC Opps (xengecqvemvfknjvbvrq)
-- Applied live.
--
-- WHY: the gov CM frozen packet (cm_report_snapshots) is the serving layer for the
-- in-app Capital Markets display AND the workbook export. A full live rebuild of it
-- (~45 parallel view fetches in one HTTP request) exceeds Railway's response window
-- and 502s, so fresh data (e.g. a new quarter) never lands via the request path.
--
-- The api/capital-markets.js `refresh_packet&chart_template_ids=...` endpoint rebuilds
-- a SMALL subset of charts per request and MERGES the fresh rows into the existing
-- snapshot (a chart is replaced only when the fresh build populated it — a merge can
-- never regress the packet). This function drives that endpoint a few charts at a time,
-- serialized with pg_sleep, so the whole gov packet refreshes without any single slow
-- request. Reads the app URL + key from Vault (same as lcc_cron_post).
--
-- Synthetic (composed) charts are excluded here (they depend on other charts' rows and
-- are not built in subset mode) — a known residual until a full-build path is added.

CREATE OR REPLACE FUNCTION public.cm_gov_packet_refresh_chunked(p_batch int DEFAULT 4, p_sleep int DEFAULT 50)
RETURNS TABLE(batch_no int, ids text, request_id bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  base_url text; api_key text; chart_ids text[]; i int; bn int := 0; csv text; rid bigint;
BEGIN
  SELECT rtrim(decrypted_secret,'/') INTO base_url FROM vault.decrypted_secrets WHERE name='lcc_railway_url' LIMIT 1;
  SELECT decrypted_secret INTO api_key FROM vault.decrypted_secrets WHERE name='lcc_api_key' LIMIT 1;
  IF base_url IS NULL OR api_key IS NULL THEN RAISE EXCEPTION 'vault secrets missing'; END IF;

  SELECT array_agg(chart_template_id ORDER BY chart_template_id)
    INTO chart_ids
    FROM cm_chart_catalog
   WHERE applies_to_verticals @> ARRAY['gov']
     AND view_name_template NOT LIKE '\_\_synthetic\_\_%'
     AND chart_type NOT IN ('DataTable','kpi_block');

  i := 1;
  WHILE i <= COALESCE(array_length(chart_ids,1),0) LOOP
    bn := bn + 1;
    csv := array_to_string(chart_ids[i:i+p_batch-1], ',');
    SELECT net.http_post(
      url := base_url || '/api/capital-markets?action=refresh_packet&vertical=gov&chart_template_ids=' || csv,
      headers := jsonb_build_object('Content-Type','application/json','X-LCC-Key',api_key),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    ) INTO rid;
    batch_no := bn; ids := csv; request_id := rid; RETURN NEXT;
    PERFORM pg_sleep(p_sleep);  -- serialize: let this batch's merge finish before the next fires
    i := i + p_batch;
  END LOOP;
END $fn$;

COMMENT ON FUNCTION public.cm_gov_packet_refresh_chunked IS
 'Serialized chunked refresh of the gov CM frozen packet: rebuilds real (view-backed) gov charts a few at a time via refresh_packet (merge-safe), pg_sleep between batches. Recurring driver for CM freshness.';

-- Daily at 09:15 UTC (after the 08:40 gov master_m mat refresh).
SELECT cron.schedule('cm-gov-packet-refresh', '15 9 * * *', 'SELECT public.cm_gov_packet_refresh_chunked()');

-- REVERSAL:
--   SELECT cron.unschedule('cm-gov-packet-refresh');
--   DROP FUNCTION public.cm_gov_packet_refresh_chunked(int,int);
