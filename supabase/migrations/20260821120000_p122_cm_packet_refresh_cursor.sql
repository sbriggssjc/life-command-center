-- P122 (2026-08-21) — LCC Opps (xengecqvemvfknjvbvrq)
-- Fix the chronic `cm-gov-packet-refresh` cron timeout: replace the in-transaction
-- pg_sleep loop with a CURSOR that advances one batch per invocation.
--
-- ============================ THE BREAK (measured live) ============================
-- `cm_gov_packet_refresh_chunked(p_batch 4, p_sleep 50)` looped over the gov chart
-- catalog firing `net.http_post` per batch and then `PERFORM pg_sleep(50)` -- FIFTY
-- SECONDS -- between batches, all inside ONE statement. Live numbers:
--
--   gov charts (non-synthetic, non-DataTable/kpi_block) .... 31
--   batches at p_batch=4 .................................... 8
--   cumulative in-transaction sleep ......... 8 x 50s = 400s
--   statement_timeout (db default, applies to pg_cron) ..... 120s
--
-- So the run was cancelled at 120s, every time: 7/7 failures 2026-08-15..08-21,
-- each `ERROR: canceling statement due to statement timeout / CONTEXT: SQL statement
-- "SELECT pg_sleep(p_sleep)" ... line 27`.
--
-- ⚠️ AND IT WAS WORSE THAN "ABORTS MID-WAY". `net.http_post` is ASYNC but its queue
-- insert is TRANSACTIONAL (pg_net 0.20.0: it INSERTs into net.http_request_queue and
-- the background worker only reads COMMITTED rows). The statement timeout aborts the
-- transaction, so every queued request ROLLED BACK. Not one HTTP call was ever
-- delivered -- not even the batches that "fired" before the timeout.
-- Proven two ways on 2026-08-21:
--   (a) mechanism -- a DO block that http_posts then RAISEs left 0 rows in
--       net.http_request_queue and produced 0 rows in net._http_response;
--   (b) STATE DELTA (the one that counts) -- the gov Q2-2026 packet row in gov
--       `cm_report_snapshots` has updated_at = 2026-08-14 20:00:12 and has NOT moved
--       across all 7 cron runs. A single delivered batch would have bumped it
--       (mergeRefreshPacket upserts with updated_at=now()).
-- The gov CM packet had therefore been frozen for 7 days.
--
-- ============================== THE FIX ==============================
-- The SERIALIZATION intent was right and must be kept: mergeRefreshPacket is a
-- read-modify-write on one snapshot row (fetch existing -> build subset -> merge ->
-- upsert), so two overlapping merges lose one side's fresh charts. What cannot stay
-- is doing that serialization with a multi-minute sleep inside a single statement.
--
-- Instead the work is CURSORED ACROSS INVOCATIONS -- the LCC "drain a queue per tick"
-- pattern:
--   * cm_packet_refresh_start('gov')  -- daily; snapshots the catalog, resets cursor
--   * cm_packet_refresh_tick('gov')   -- every minute; fires ONE batch, advances,
--                                        idles instantly when the cycle is covered
-- Each tick is a queue insert plus two small writes -- milliseconds, no sleep, so the
-- statement timeout is untouchable. A full 8-batch cycle drains in ~8 minutes.
--
-- Serialization is now STRONGER than the old sleep: the tick refuses to fire the next batch
-- until the previous batch's pg_net request has returned a response that is NOT timed_out
-- (a client timeout means the server is still merging -- see the inline note in the tick;
-- this was caught live on the first cycle and cost an overlapping merge). Past
-- p_max_wait_sec it fails FORWARD so a lost or purged response cannot stall a cycle.
-- That is an actual completion check rather than a timing assumption.
--
-- Synthetic (composed) charts stay excluded -- they depend on other charts' rows and
-- are not built in subset mode. That is a documented residual, NOT a failure.

BEGIN;

-- ---------------------------------------------------------------- cursor state
CREATE TABLE IF NOT EXISTS public.cm_packet_refresh_cursor (
  vertical            text PRIMARY KEY,
  chart_ids           text[]      NOT NULL DEFAULT '{}',   -- catalog frozen for the cycle
  batch_size          int         NOT NULL DEFAULT 4,
  next_idx            int         NOT NULL DEFAULT 1,      -- 1-based index into chart_ids
  cycle_started_at    timestamptz,
  cycle_completed_at  timestamptz,
  last_request_id     bigint,
  last_fired_at       timestamptz,
  last_batch_ids      text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cm_packet_refresh_cursor IS
 'P122: per-vertical cursor for the chunked CM packet refresh. One batch is fired per '
 'cm_packet_refresh_tick() invocation; next_idx advances until chart_ids is covered, then '
 'the cycle idles. Replaces the in-transaction pg_sleep loop that blew the statement timeout.';

-- ---------------------------------------------------------------- per-batch ledger
CREATE TABLE IF NOT EXISTS public.cm_packet_refresh_log (
  log_id            bigserial PRIMARY KEY,
  vertical          text        NOT NULL,
  cycle_started_at  timestamptz NOT NULL,
  batch_no          int         NOT NULL,
  batch_ids         text        NOT NULL,
  request_id        bigint,
  fired_at          timestamptz NOT NULL DEFAULT now(),
  response_status   int,
  response_error    text,
  response_seen_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_cm_packet_refresh_log_cycle
  ON public.cm_packet_refresh_log (vertical, cycle_started_at DESC, batch_no);

COMMENT ON TABLE public.cm_packet_refresh_log IS
 'P122: one row per batch fired by cm_packet_refresh_tick(), with the pg_net outcome '
 'reconciled on the following tick. This is the honest per-batch record -- judge a cycle '
 'by these rows plus the domain snapshot updated_at delta, never by a return value.';

-- ---------------------------------------------------------------- start a cycle
CREATE OR REPLACE FUNCTION public.cm_packet_refresh_start(
  p_vertical text DEFAULT 'gov',
  p_batch    int  DEFAULT 4
) RETURNS TABLE(vertical text, n_charts int, n_batches int, cycle_started_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE ids text[]; started timestamptz := now();
BEGIN
  IF p_batch < 1 THEN RAISE EXCEPTION 'p_batch must be >= 1'; END IF;

  SELECT array_agg(chart_template_id ORDER BY chart_template_id)
    INTO ids
    FROM cm_chart_catalog
   WHERE applies_to_verticals @> ARRAY[p_vertical]
     AND view_name_template NOT LIKE '\_\_synthetic\_\_%'
     AND chart_type NOT IN ('DataTable','kpi_block');

  ids := COALESCE(ids, '{}');

  INSERT INTO cm_packet_refresh_cursor AS c
    (vertical, chart_ids, batch_size, next_idx, cycle_started_at, cycle_completed_at,
     last_request_id, last_fired_at, last_batch_ids, updated_at)
  VALUES (p_vertical, ids, p_batch, 1, started, NULL, NULL, NULL, NULL, now())
  -- Infer the conflict by CONSTRAINT NAME, not `ON CONFLICT (vertical)`: the inference
  -- expression is an expression context, so the bare column collides with this function's
  -- RETURNS TABLE OUT param `vertical` (42702, caught live on first call). Same class as
  -- the CLAUDE.md `#variable_conflict use_column` footgun.
  ON CONFLICT ON CONSTRAINT cm_packet_refresh_cursor_pkey DO UPDATE
    SET chart_ids = EXCLUDED.chart_ids,
        batch_size = EXCLUDED.batch_size,
        next_idx = 1,
        cycle_started_at = EXCLUDED.cycle_started_at,
        cycle_completed_at = NULL,
        last_request_id = NULL,
        last_fired_at = NULL,
        last_batch_ids = NULL,
        updated_at = now();

  vertical := p_vertical;
  n_charts := COALESCE(array_length(ids,1),0);
  n_batches := CEIL(COALESCE(array_length(ids,1),0)::numeric / p_batch)::int;
  cycle_started_at := started;
  RETURN NEXT;
END $fn$;

COMMENT ON FUNCTION public.cm_packet_refresh_start(text,int) IS
 'P122: begin a chunked CM packet refresh cycle -- freezes the vertical''s chart catalog '
 'into the cursor and resets it to batch 1. Does not fire any HTTP; cm_packet_refresh_tick() drains.';

-- ---------------------------------------------------------------- drain one batch
CREATE OR REPLACE FUNCTION public.cm_packet_refresh_tick(
  p_vertical     text DEFAULT 'gov',
  p_max_wait_sec int  DEFAULT 300
) RETURNS TABLE(status text, batch_no int, ids text, request_id bigint, remaining int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  cur         cm_packet_refresh_cursor%ROWTYPE;
  base_url    text;
  api_key     text;
  total       int;
  hi          int;
  csv         text;
  rid         bigint;
  bn          int;
  resp_status int;
  resp_err    text;
  resp_timed  boolean;
  resp_found  boolean := false;
  prev_done   boolean := false;
BEGIN
  -- one drainer at a time; a second concurrent tick simply reports 'locked'
  SELECT * INTO cur FROM cm_packet_refresh_cursor
   WHERE cm_packet_refresh_cursor.vertical = p_vertical FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    status := 'idle_no_cursor_or_locked'; batch_no := NULL; ids := NULL; request_id := NULL; remaining := 0;
    RETURN NEXT; RETURN;
  END IF;

  total := COALESCE(array_length(cur.chart_ids,1),0);

  -- Reconcile the PREVIOUS batch's pg_net outcome into the ledger (honest per-batch record).
  IF cur.last_request_id IS NOT NULL THEN
    SELECT r.status_code, r.timed_out,
           NULLIF(concat_ws('; ', r.error_msg, CASE WHEN r.timed_out THEN 'timed_out' END), '')
      INTO resp_status, resp_timed, resp_err
      FROM net._http_response r WHERE r.id = cur.last_request_id;
    resp_found := FOUND;

    -- ⚠️ A TIMED-OUT RESPONSE IS NOT COMPLETION -- IT IS THE OPPOSITE. pg_net giving up means
    -- the server is STILL merging. Caught live on the first cycle: batch 1 fired 17:00:00.78
    -- at timeout_milliseconds=55000, pg_net timed out at 17:00:55, the tick read that as "done"
    -- and fired batch 2 at 17:01:00 -- but batch 1's merge only upserted the gov snapshot at
    -- 17:01:09.90, NINE SECONDS LATER. Batch 2 had already read the pre-batch-1 packet, so its
    -- merge would have written back stale copies of batch 1's charts: exactly the lost update
    -- this serialization exists to prevent. Completion therefore requires NOT timed_out.
    prev_done := resp_found AND NOT COALESCE(resp_timed, false);

    IF resp_found THEN
      UPDATE cm_packet_refresh_log l
         SET response_status = resp_status,
             response_error  = resp_err,
             response_seen_at = now()
       WHERE l.request_id = cur.last_request_id AND l.response_seen_at IS NULL;
    END IF;

    -- Serialize: do not overlap merges (mergeRefreshPacket is read-modify-write on one
    -- snapshot row). Wait for the previous request to complete -- but fail FORWARD after
    -- p_max_wait_sec so a purged/lost response can never stall the cycle.
    IF NOT prev_done
       AND cur.last_fired_at IS NOT NULL
       AND cur.last_fired_at > now() - make_interval(secs => p_max_wait_sec) THEN
      status := CASE WHEN COALESCE(resp_timed,false)
                     THEN 'waiting_prev_still_running_after_client_timeout'
                     ELSE 'waiting_on_prev_batch' END;
      batch_no := (cur.next_idx - 1) / cur.batch_size;
      ids := cur.last_batch_ids; request_id := cur.last_request_id;
      remaining := GREATEST(total - cur.next_idx + 1, 0);
      RETURN NEXT; RETURN;
    END IF;
  END IF;

  -- Cycle covered?
  IF cur.next_idx > total THEN
    IF cur.cycle_completed_at IS NULL THEN
      UPDATE cm_packet_refresh_cursor
         SET cycle_completed_at = now(), last_request_id = NULL, updated_at = now()
       WHERE cm_packet_refresh_cursor.vertical = p_vertical;
      status := 'cycle_complete';
    ELSE
      status := 'idle';
    END IF;
    batch_no := NULL; ids := NULL; request_id := NULL; remaining := 0;
    RETURN NEXT; RETURN;
  END IF;

  SELECT rtrim(decrypted_secret,'/') INTO base_url FROM vault.decrypted_secrets WHERE name='lcc_railway_url' LIMIT 1;
  SELECT decrypted_secret INTO api_key FROM vault.decrypted_secrets WHERE name='lcc_api_key' LIMIT 1;
  IF base_url IS NULL OR api_key IS NULL THEN RAISE EXCEPTION 'vault secrets missing'; END IF;

  hi := LEAST(cur.next_idx + cur.batch_size - 1, total);
  csv := array_to_string(cur.chart_ids[cur.next_idx:hi], ',');
  bn  := ((cur.next_idx - 1) / cur.batch_size) + 1;

  SELECT net.http_post(
    url := base_url || '/api/capital-markets?action=refresh_packet&vertical=' || p_vertical
           || '&chart_template_ids=' || csv,
    headers := jsonb_build_object('Content-Type','application/json','X-LCC-Key',api_key),
    body := '{}'::jsonb,
    -- Observed: a 4-chart gov subset merge takes ~69s end to end. 55s (inherited from the
    -- retired chunked driver) abandoned a request the server was still working on.
    timeout_milliseconds := 170000
  ) INTO rid;

  INSERT INTO cm_packet_refresh_log (vertical, cycle_started_at, batch_no, batch_ids, request_id)
  VALUES (p_vertical, cur.cycle_started_at, bn, csv, rid);

  UPDATE cm_packet_refresh_cursor
     SET next_idx = hi + 1,
         last_request_id = rid,
         last_fired_at = now(),
         last_batch_ids = csv,
         updated_at = now()
   WHERE cm_packet_refresh_cursor.vertical = p_vertical;

  status := 'fired'; batch_no := bn; ids := csv; request_id := rid;
  remaining := GREATEST(total - hi, 0);
  RETURN NEXT;
END $fn$;

COMMENT ON FUNCTION public.cm_packet_refresh_tick(text,int) IS
 'P122: fire ONE batch of the chunked CM packet refresh and advance the cursor. No pg_sleep '
 '-- runs in milliseconds, so the pg_cron statement timeout is never approached. Waits for the '
 'previous batch''s pg_net response before firing the next (serializes the read-modify-write '
 'merge), failing forward after p_max_wait_sec. Idles instantly once the cycle is covered.';

-- ---------------------------------------------------------------- health surface
CREATE OR REPLACE VIEW public.v_cm_packet_refresh_health AS
SELECT c.vertical,
       COALESCE(array_length(c.chart_ids,1),0)                     AS n_charts,
       CEIL(COALESCE(array_length(c.chart_ids,1),0)::numeric / NULLIF(c.batch_size,0))::int AS n_batches,
       c.cycle_started_at,
       c.cycle_completed_at,
       (c.cycle_completed_at IS NULL AND c.next_idx <= COALESCE(array_length(c.chart_ids,1),0)) AS cycle_in_progress,
       GREATEST(COALESCE(array_length(c.chart_ids,1),0) - c.next_idx + 1, 0) AS charts_remaining,
       l.batches_fired,
       l.batches_ok,
       l.batches_failed,
       l.batches_unreconciled
  FROM cm_packet_refresh_cursor c
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS batches_fired,
           count(*) FILTER (WHERE response_status BETWEEN 200 AND 299)::int AS batches_ok,
           count(*) FILTER (WHERE response_status IS NOT NULL
                              AND response_status NOT BETWEEN 200 AND 299)::int AS batches_failed,
           count(*) FILTER (WHERE response_seen_at IS NULL)::int AS batches_unreconciled
      FROM cm_packet_refresh_log g
     WHERE g.vertical = c.vertical AND g.cycle_started_at = c.cycle_started_at
  ) l ON TRUE;

COMMENT ON VIEW public.v_cm_packet_refresh_health IS
 'P122: current-cycle state of the chunked CM packet refresh. batches_ok counts pg_net 2xx '
 'responses -- it is NOT proof the packet changed. Confirm the refresh by the domain-DB '
 'cm_report_snapshots.updated_at delta for the vertical''s current quarter.';

-- ---------------------------------------------------------------- retire the broken driver
DROP FUNCTION IF EXISTS public.cm_gov_packet_refresh_chunked(int,int);

-- ---------------------------------------------------------------- reschedule
-- Same job name kept so the cron-health alert `source` stays stable.
SELECT cron.unschedule('cm-gov-packet-refresh');
SELECT cron.schedule('cm-gov-packet-refresh', '15 9 * * *',
                     $$SELECT public.cm_packet_refresh_start('gov')$$);
SELECT cron.schedule('cm-gov-packet-refresh-tick', '* * * * *',
                     $$SELECT public.cm_packet_refresh_tick('gov')$$);

COMMIT;

-- ============================== REVERSAL RUNBOOK ==============================
--   SELECT cron.unschedule('cm-gov-packet-refresh-tick');
--   SELECT cron.unschedule('cm-gov-packet-refresh');
--   DROP VIEW IF EXISTS public.v_cm_packet_refresh_health;
--   DROP FUNCTION IF EXISTS public.cm_packet_refresh_tick(text,int);
--   DROP FUNCTION IF EXISTS public.cm_packet_refresh_start(text,int);
--   DROP TABLE IF EXISTS public.cm_packet_refresh_log;
--   DROP TABLE IF EXISTS public.cm_packet_refresh_cursor;
--   -- then re-create cm_gov_packet_refresh_chunked from
--   -- 20260814180000_cm_gov_packet_refresh_chunked_cron.sql (NOT recommended: it cannot
--   -- complete under a 120s statement timeout and delivers zero requests).
--
-- ============================== MANUAL RUN ==============================
--   SELECT * FROM public.cm_packet_refresh_start('gov');   -- begin a cycle
--   SELECT * FROM public.cm_packet_refresh_tick('gov');    -- repeat until 'cycle_complete'
--   SELECT * FROM public.v_cm_packet_refresh_health;
