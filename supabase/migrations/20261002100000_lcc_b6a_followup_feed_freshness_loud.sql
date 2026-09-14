-- B6a-follow-up (2026-08-28) — the freshness monitor must ALERT ON ITS OWN BLINDNESS.
--
-- WHY. B6a registered four gov ingestion producers dead since March-April 2026.
-- They will never reach an alert, because the chain carrying gov's verdict to LCC
-- alerting has been dead for a month AND EVERY LAYER OF IT REPORTS SUCCESS:
--
--   1. gov v_feed_freshness is correct (it says sam_lease_opportunities is stale).
--   2. crons 140/141 fire daily and record `succeeded`, but the mirror's synced_at
--      is frozen at 2026-07-26 (gov) / 2026-07-29 (dia).
--      lcc_finalize_feed_freshness consumes only status_code = 200 and SILENTLY
--      DROPS anything else, returning (0,0) -- indistinguishable from "nothing to do".
--   3. lcc_check_feed_freshness excludes mirror rows older than 3 days, so with a
--      stale mirror it evaluates ZERO gov/dia feeds and returns
--      {"new_alerts":0,"stale":[]}.
--
-- THE STALENESS GUARD ON THE MIRROR IS ITSELF THE SILENT FAILURE: when the sync
-- stops, the check stops checking, and reports nothing wrong. Live proof: gov reads
-- 5 stale feeds today and NO feed_stale alert is open (8 ever, 0 open, last detected
-- 2026-07-24 -- two days before the gov mirror froze).
--
-- "I cannot see this feed" and "this feed is fine" must never render identically.
--
-- ---------------------------------------------------------------------------
-- TRANSPORT CAUSE, MEASURED 2026-08-28 -- TWO DIFFERENT CAUSES, ONE PER DOMAIN.
-- The frozen synced_at looked like one bug because it froze both domains within
-- three days. It is two:
--
--   * gov  -> HTTP 500, PostgREST body {"code":"57014","message":"canceling
--            statement due to statement timeout"}. anon's statement_timeout on gov
--            is 3s. compute_feed_freshness() runs max(<ts>) over 18 registered
--            tables; WARM that is 231 ms total (310 ms as anon through the view),
--            but the 05:30 cron run is the first touch of the day and reads cold.
--            The cold per-feed sweep measured 2,601 ms across just its top 8 feeds
--            (prospect_leads_ownership_change alone 1,578 ms) with 10 more to go.
--            POSITIVE CONTROL, same URL and same anon key three minutes apart:
--            cold 17:41 -> 500/57014; warm 17:44 -> 200 with all 18 feeds (3,786 B).
--            So gov is a MARGINAL COLD-CACHE TIMEOUT, not a hard break -- which is
--            why it worked until the tables grew past the 3s boundary in July.
--
--   * dia  -> HTTP 401, {"code":"42501","message":"permission denied for function
--            compute_feed_freshness"}. dia's ACL is {postgres=X, service_role=X};
--            anon LOST the EXECUTE grant R56 gave it. A hard break, not marginal.
--            Restored in supabase/migrations/dialysis/20261002100100_*.
--
-- gov is NOT touched here (B6a-follow-up brief 2c): its view is correct, and its
-- failure is mitigated LCC-side by the retry cycle below. THE RETRY IS A
-- MITIGATION, NOT A CURE -- the durable fix is domain-side (index the ts columns
-- or raise anon's timeout) and is filed, sized, as B6a-follow-up-b.
--
-- ---------------------------------------------------------------------------
-- WHAT SHIPS (all LCC-Opps-local; additive; reversible; auth schema untouched):
--
--   1a. lcc_finalize_feed_freshness COUNTS and SURFACES non-200 outcomes, records
--       them per domain, and RETRIES (bounded). A fail-soft that swallows the
--       failure and returns (0,0) makes "everything failed" indistinguishable from
--       "nothing to do".
--   1b. lcc_check_feed_freshness keeps the 3-day exclusion -- evaluating an
--       untrustworthy mirror would emit false alerts -- but THE EXCLUDED SET IS NOW
--       ITS OWN ALERTABLE CONDITION (feed_mirror_stale), deduped and auto-resolving.
--       feeds_evaluated and feeds_excluded_stale_mirror are reported separately.
--
-- REUSE, DON'T FORK. lcc_check_bd_sync_freshness already does exactly this for the
-- BD mirror (bd_sync_stale / bd_sync_leg_stale / bd_sync_secret_missing off
-- lcc_mirror_sync_watermark). This follows that shape rather than inventing one.
-- A sweep of all ten lcc_check_* functions found this one is the ONLY other with
-- the silent-exclusion shape; see the audit doc.
--
-- READ new_alerts / feeds_evaluated / rows_upserted -- NEVER the cron's `succeeded`.
-- Crons 140/141 recorded `succeeded` daily throughout a month-long outage.
--
-- REVERSAL RUNBOOK is at the foot of this file.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Per-domain sync-leg watermark (the lcc_mirror_sync_watermark precedent).
--    Without this, a failed leg has NOWHERE to be recorded -- which is exactly
--    how a month of failures left no trace anywhere.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_feed_freshness_sync_status (
  source_domain         text PRIMARY KEY CHECK (source_domain IN ('dia','gov')),
  last_attempt_at       timestamptz,
  last_success_at       timestamptz,
  last_status_code      int,
  last_outcome          text,
  last_error            text,
  consecutive_failures  int NOT NULL DEFAULT 0,
  last_attempt_no       int NOT NULL DEFAULT 0,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lcc_feed_freshness_sync_status IS
  'B6a-follow-up: per-domain outcome of the feed-freshness cross-DB pull. '
  'last_outcome is one of ok | http_error | no_response | no_secret | empty_payload. '
  'A non-ok leg is what lcc_check_feed_freshness turns into a feed_mirror_stale alert.';

ALTER TABLE public.lcc_feed_freshness_sync_inflight
  ADD COLUMN IF NOT EXISTS attempt int NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------------------
-- 2. The sync. Signature gains p_attempt and a real return shape.
--
--    (!) OVERLOAD TRAP (N15d / B1 / C2e): adding a DEFAULTed parameter creates an
--    OVERLOAD, and with defaults on both every 1-arg call -- including cron 140's
--    SELECT public.lcc_sync_feed_freshness('both') -- fails 42725 "function is not
--    unique". The old signature is DROPPED FIRST, not replaced.
--
--    The missing-vault-secret branch used to RAISE NOTICE and CONTINUE: a THIRD
--    silent path, into a log nobody reads. It now records no_secret.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.lcc_sync_feed_freshness(text);

CREATE OR REPLACE FUNCTION public.lcc_sync_feed_freshness(
  p_domain  text DEFAULT 'both',
  p_attempt int  DEFAULT 1
)
RETURNS TABLE(domain text, requests_fired int, attempt int, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_url text; v_anon_key text; v_request_id bigint;
  v_domain text; v_domains text[];
BEGIN
  IF p_domain = 'both' THEN v_domains := ARRAY['gov','dia'];
  ELSE v_domains := ARRAY[p_domain]; END IF;

  FOREACH v_domain IN ARRAY v_domains LOOP
    SELECT decrypted_secret INTO v_url      FROM vault.decrypted_secrets WHERE name = v_domain || '_supabase_url';
    SELECT decrypted_secret INTO v_anon_key FROM vault.decrypted_secrets WHERE name = v_domain || '_supabase_anon_key';

    IF v_url IS NULL OR v_anon_key IS NULL THEN
      -- Recorded, not merely NOTICEd: a no-op the operator can never see is the
      -- failure this whole migration exists to remove.
      INSERT INTO public.lcc_feed_freshness_sync_status
        (source_domain, last_attempt_at, last_outcome, last_error, consecutive_failures, last_attempt_no, updated_at)
      VALUES (v_domain, now(), 'no_secret', 'missing vault secret ' || v_domain || '_supabase_url/_anon_key', 1, p_attempt, now())
      ON CONFLICT (source_domain) DO UPDATE SET
        last_attempt_at = now(), last_outcome = 'no_secret',
        last_error = excluded.last_error,
        consecutive_failures = public.lcc_feed_freshness_sync_status.consecutive_failures + 1,
        last_attempt_no = p_attempt, updated_at = now();

      domain := v_domain; requests_fired := 0; attempt := p_attempt; outcome := 'no_secret';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- The snapshot is ~5-20 rows; one page (limit 1000) covers it.
    SELECT net.http_get(
      url := v_url || '/rest/v1/v_feed_freshness'
        || '?select=feed_name,src_table,ts_column,latest,expected_max_age_days,age_days,is_stale,status'
        || '&order=feed_name.asc&limit=1000',
      headers := jsonb_build_object('apikey', v_anon_key, 'Authorization', 'Bearer ' || v_anon_key)
    ) INTO v_request_id;

    INSERT INTO public.lcc_feed_freshness_sync_inflight (request_id, source_domain, attempt)
    VALUES (v_request_id, v_domain, p_attempt);

    INSERT INTO public.lcc_feed_freshness_sync_status
      (source_domain, last_attempt_at, last_outcome, last_attempt_no, updated_at)
    VALUES (v_domain, now(), 'in_flight', p_attempt, now())
    ON CONFLICT (source_domain) DO UPDATE SET
      last_attempt_at = now(), last_outcome = 'in_flight',
      last_attempt_no = p_attempt, updated_at = now();

    domain := v_domain; requests_fired := 1; attempt := p_attempt; outcome := 'fired';
    RETURN NEXT;
  END LOOP;
END;
$fn$;
REVOKE ALL ON FUNCTION public.lcc_sync_feed_freshness(text, int) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. (1a) The finalize. Counts and surfaces non-200; retries, bounded.
--
--    Return type changes, so the old signature is DROPPED. No JS reads it --
--    only cron 141 and humans -- so the shape is free to become honest.
--
--    FOUR outcome classes, not two. The old code knew only "status 200" and
--    "everything else", and left everything else in the inflight table for 24h:
--
--      responded_ok   status 200            -> consume
--      responded_bad  status <> 200         -> RECORD (this was the silent drop)
--      lost           no response row, and issued longer ago than the pg_net
--                     retention window can still be waited out
--                     -> RECORD. (!) net._http_response is pruned to ~6h while
--                     the inflight row lingered 24h, so a response that arrived
--                     after finalize ran could NEVER be consumed by the next
--                     day's pass -- it was already pruned. That is a permanent
--                     silent loss and it needed its own class.
--      pending        no response row yet, still inside the grace window
--                     -> LEAVE ALONE. Not a failure.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.lcc_finalize_feed_freshness();

CREATE OR REPLACE FUNCTION public.lcc_finalize_feed_freshness(
  p_max_attempts  int      DEFAULT 3,
  p_grace         interval DEFAULT interval '2 minutes'
)
RETURNS TABLE(
  finalized_requests int, rows_upserted int,
  failed_requests int, lost_requests int, pending_requests int,
  domains_ok text[], domains_failed text[], retried_domains text[],
  status_codes jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_finalized int := 0; v_upserted int := 0;
  v_failed int := 0; v_lost int := 0; v_pending int := 0;
  v_ok text[]; v_bad text[]; v_retried text[] := ARRAY[]::text[];
  v_codes jsonb; r record;
BEGIN
  -- Classify every inflight request exactly once.
  -- (!) The response table is aliased `resp`, NOT `r`. `r` is the DECLAREd record
  -- variable below, and plpgsql resolves an identifier to a declared variable
  -- BEFORE a SQL alias -- so `r.status_code` here bound to the unassigned record
  -- and raised 55000 "record r is not assigned yet" at runtime. It plans fine and
  -- fails only when executed, which is why it took running the function to find.
  CREATE TEMP TABLE _ffin ON COMMIT DROP AS
  SELECT i.request_id, i.source_domain, i.issued_at, i.attempt,
         resp.status_code, resp.content, resp.timed_out, resp.error_msg,
         CASE
           WHEN resp.id IS NOT NULL AND resp.status_code = 200 THEN 'responded_ok'
           WHEN resp.id IS NOT NULL                            THEN 'responded_bad'
           WHEN i.issued_at > now() - p_grace                  THEN 'pending'
           ELSE 'lost'
         END AS class
    FROM public.lcc_feed_freshness_sync_inflight i
    LEFT JOIN net._http_response resp ON resp.id = i.request_id;

  SELECT count(*) FILTER (WHERE class = 'responded_bad'),
         count(*) FILTER (WHERE class = 'lost'),
         count(*) FILTER (WHERE class = 'pending')
    INTO v_failed, v_lost, v_pending
    FROM _ffin;

  -- Full-replace each SUCCESSFULLY refreshed domain (so a feed removed from the
  -- domain registry drops out of the mirror), then re-insert the fresh snapshot.
  -- Unchanged semantics -- a failed domain's mirror rows are NOT deleted, so the
  -- last good snapshot survives and the check can say how old it is.
  DELETE FROM public.lcc_domain_feed_freshness m
   WHERE m.source_domain IN (SELECT DISTINCT source_domain FROM _ffin WHERE class = 'responded_ok');

  WITH rows AS (
    SELECT source_domain, jsonb_array_elements(content::jsonb) AS row
      FROM _ffin WHERE class = 'responded_ok'
  ),
  ins AS (
    INSERT INTO public.lcc_domain_feed_freshness
      (source_domain, feed_name, src_table, ts_column, latest, expected_max_age_days, synced_at)
    SELECT source_domain, row->>'feed_name', row->>'src_table', row->>'ts_column',
           NULLIF(row->>'latest','')::timestamptz,
           NULLIF(row->>'expected_max_age_days','')::int, now()
      FROM rows
     WHERE row->>'feed_name' IS NOT NULL
    ON CONFLICT (source_domain, feed_name) DO UPDATE SET
      src_table = EXCLUDED.src_table, ts_column = EXCLUDED.ts_column,
      latest = EXCLUDED.latest, expected_max_age_days = EXCLUDED.expected_max_age_days,
      synced_at = now()
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM _ffin WHERE class = 'responded_ok'), (SELECT count(*) FROM ins)
    INTO v_finalized, v_upserted;

  -- (!) A 200 carrying an EMPTY array is not a success. PostgREST answers 200 []
  -- for a view anon cannot read under RLS (the P157 class) -- a status-code check
  -- passes while nothing arrives. Read the body, not just the code.
  UPDATE public.lcc_feed_freshness_sync_status s
     SET last_outcome = 'empty_payload',
         last_error = '200 with an empty payload -- the domain view returned no rows to anon',
         consecutive_failures = s.consecutive_failures + 1, updated_at = now()
   WHERE s.source_domain IN (
     SELECT f.source_domain FROM _ffin f
      WHERE f.class = 'responded_ok'
        AND coalesce(jsonb_array_length(nullif(f.content,'')::jsonb), 0) = 0);

  -- Record every leg outcome. This is the whole of (1a): a failure now has a
  -- place to be, instead of being dropped on the floor by a WHERE clause.
  FOR r IN SELECT * FROM _ffin WHERE class IN ('responded_ok','responded_bad','lost') LOOP
    IF r.class = 'responded_ok'
       AND coalesce(jsonb_array_length(nullif(r.content,'')::jsonb), 0) > 0 THEN
      INSERT INTO public.lcc_feed_freshness_sync_status
        (source_domain, last_attempt_at, last_success_at, last_status_code, last_outcome,
         last_error, consecutive_failures, last_attempt_no, updated_at)
      VALUES (r.source_domain, r.issued_at, now(), 200, 'ok', NULL, 0, r.attempt, now())
      ON CONFLICT (source_domain) DO UPDATE SET
        last_attempt_at = r.issued_at, last_success_at = now(), last_status_code = 200,
        last_outcome = 'ok', last_error = NULL, consecutive_failures = 0,
        last_attempt_no = r.attempt, updated_at = now();
    ELSIF r.class = 'responded_bad' THEN
      INSERT INTO public.lcc_feed_freshness_sync_status
        (source_domain, last_attempt_at, last_status_code, last_outcome, last_error,
         consecutive_failures, last_attempt_no, updated_at)
      VALUES (r.source_domain, r.issued_at, r.status_code, 'http_error',
              left(coalesce(nullif(r.error_msg,''), r.content, ''), 400), 1, r.attempt, now())
      ON CONFLICT (source_domain) DO UPDATE SET
        last_attempt_at = r.issued_at, last_status_code = r.status_code,
        last_outcome = 'http_error', last_error = excluded.last_error,
        consecutive_failures = public.lcc_feed_freshness_sync_status.consecutive_failures + 1,
        last_attempt_no = r.attempt, updated_at = now();
    ELSE
      INSERT INTO public.lcc_feed_freshness_sync_status
        (source_domain, last_attempt_at, last_outcome, last_error,
         consecutive_failures, last_attempt_no, updated_at)
      VALUES (r.source_domain, r.issued_at, 'no_response',
              'no net._http_response row -- the response never arrived, or was pruned before finalize ran',
              1, r.attempt, now())
      ON CONFLICT (source_domain) DO UPDATE SET
        last_attempt_at = r.issued_at, last_outcome = 'no_response',
        last_error = excluded.last_error,
        consecutive_failures = public.lcc_feed_freshness_sync_status.consecutive_failures + 1,
        last_attempt_no = r.attempt, updated_at = now();
    END IF;
  END LOOP;

  SELECT array_agg(DISTINCT source_domain) INTO v_ok
    FROM _ffin WHERE class = 'responded_ok';
  SELECT array_agg(DISTINCT source_domain) INTO v_bad
    FROM _ffin f WHERE f.class IN ('responded_bad','lost')
      AND NOT EXISTS (SELECT 1 FROM _ffin g WHERE g.source_domain = f.source_domain AND g.class = 'responded_ok');

  SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) INTO v_codes FROM (
    SELECT coalesce(source_domain || ':' || coalesce(status_code::text, class), 'unknown') AS k, count(*) AS n
      FROM _ffin WHERE class <> 'pending' GROUP BY 1) z;

  -- Clear everything we have accounted for. `pending` rows are deliberately left.
  DELETE FROM public.lcc_feed_freshness_sync_inflight i
   WHERE i.request_id IN (SELECT request_id FROM _ffin WHERE class <> 'pending');

  -- RETRY, bounded. gov's failure is a marginal cold-cache timeout, so a second
  -- attempt against a now-warm cache is the LCC-side mitigation (proven: cold 500,
  -- warm 200, same URL and key three minutes apart). A hard failure such as dia's
  -- 401 simply exhausts its attempts and is then reported by (1b), which is the
  -- point -- the retry must not be able to hide a real break.
  IF v_bad IS NOT NULL THEN
    FOR r IN
      SELECT f.source_domain, max(f.attempt) AS att
        FROM _ffin f WHERE f.source_domain = ANY(v_bad) GROUP BY f.source_domain
    LOOP
      IF r.att < p_max_attempts THEN
        PERFORM public.lcc_sync_feed_freshness(r.source_domain, r.att + 1);
        v_retried := v_retried || r.source_domain;
      END IF;
    END LOOP;
  END IF;

  DELETE FROM public.lcc_feed_freshness_sync_inflight WHERE issued_at < now() - interval '24 hours';
  ANALYZE public.lcc_domain_feed_freshness;

  finalized_requests := v_finalized; rows_upserted := v_upserted;
  failed_requests := v_failed; lost_requests := v_lost; pending_requests := v_pending;
  domains_ok := coalesce(v_ok, ARRAY[]::text[]);
  domains_failed := coalesce(v_bad, ARRAY[]::text[]);
  retried_domains := v_retried;
  status_codes := v_codes;
  RETURN NEXT;
END;
$fn$;
REVOKE ALL ON FUNCTION public.lcc_finalize_feed_freshness(int, interval) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. (1b) The check. The exclusion STAYS -- evaluating an untrustworthy mirror
--    emits false alerts -- but the EXCLUDED SET becomes its own alertable
--    condition. feeds_evaluated and feeds_excluded_stale_mirror are separate
--    honest counts, because "I evaluated nothing" and "nothing is wrong" were
--    rendering identically for a month.
-- ---------------------------------------------------------------------------
-- (!) OVERLOAD TRAP AGAIN, and it bites hardest here: CREATE OR REPLACE does NOT
--     replace a function of different arity, so adding p_mirror_max_age beside the
--     existing 0-arg lcc_check_feed_freshness() would leave BOTH -- and cron 193's
--     `SELECT public.lcc_check_feed_freshness();` would fail 42725 "function is not
--     unique", silencing the hourly health tick's other three checks with it.
DROP FUNCTION IF EXISTS public.lcc_check_feed_freshness();

CREATE OR REPLACE FUNCTION public.lcc_check_feed_freshness(p_mirror_max_age interval DEFAULT interval '3 days')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_new int := 0; v_resolved int := 0; v_mirror_new int := 0; v_mirror_resolved int := 0;
  v_stale jsonb; v_evaluated int; v_excluded int; v_mirror jsonb; v_stale_n int;
  c_cap constant int := 25;
BEGIN
  -- Unified current EVALUABLE feed status. age is recomputed at check time from
  -- the raw `latest` (a lagging mirror is still accurate to the day).
  CREATE TEMP TABLE _ff_cur ON COMMIT DROP AS
  WITH lcc_local AS (
    SELECT 'lcc'::text AS dom, feed_name, latest, expected_max_age_days,
           (now()::date - latest::date) AS age_days
      FROM public.v_feed_freshness
     WHERE status = 'ok' AND latest IS NOT NULL
  ),
  domain_mirror AS (
    SELECT source_domain AS dom, feed_name, latest, expected_max_age_days,
           (now()::date - latest::date) AS age_days
      FROM public.lcc_domain_feed_freshness
     WHERE latest IS NOT NULL
       AND expected_max_age_days IS NOT NULL
       AND synced_at > now() - p_mirror_max_age
  )
  SELECT u.dom, u.feed_name, u.latest, u.expected_max_age_days, u.age_days,
         (u.age_days > u.expected_max_age_days) AS is_stale,
         ('feed:' || u.dom || ':' || u.feed_name) AS source_key
    FROM (SELECT * FROM lcc_local UNION ALL SELECT * FROM domain_mirror) u;

  -- The blind spot, made visible. One row per domain whose mirror we refused to
  -- trust, or which has no mirror rows at all.
  CREATE TEMP TABLE _ff_blind ON COMMIT DROP AS
  SELECT d.dom,
         (SELECT count(*) FROM public.lcc_domain_feed_freshness m WHERE m.source_domain = d.dom) AS mirror_rows,
         (SELECT max(m.synced_at) FROM public.lcc_domain_feed_freshness m WHERE m.source_domain = d.dom) AS synced_at,
         s.last_outcome, s.last_status_code, s.last_error, s.last_success_at, s.consecutive_failures
    FROM (VALUES ('gov'),('dia')) d(dom)
    LEFT JOIN public.lcc_feed_freshness_sync_status s ON s.source_domain = d.dom
   WHERE (SELECT count(*) FROM public.lcc_domain_feed_freshness m
           WHERE m.source_domain = d.dom AND m.synced_at > now() - p_mirror_max_age) = 0;

  SELECT count(*) INTO v_evaluated FROM _ff_cur;
  SELECT coalesce(sum(mirror_rows), 0) INTO v_excluded FROM _ff_blind;

  -- Open one alert per newly-stale feed (idempotent on the source key).
  WITH ins AS (
    INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    SELECT 'feed_stale', c.source_key,
           CASE WHEN c.age_days > 2 * c.expected_max_age_days THEN 'error' ELSE 'warn' END,
           'Ingestion feed ' || c.feed_name || ' (' || c.dom || ') is STALE: last data '
             || c.latest::date || ' = ' || c.age_days || 'd old (SLA '
             || c.expected_max_age_days || 'd). The feed may have stopped -- investigate.',
           jsonb_build_object('domain', c.dom, 'feed', c.feed_name, 'latest', c.latest,
                              'age_days', c.age_days, 'sla_days', c.expected_max_age_days)
      FROM _ff_cur c
     WHERE c.is_stale
       AND NOT EXISTS (
         SELECT 1 FROM public.lcc_health_alerts a
          WHERE a.alert_kind = 'feed_stale' AND a.source = c.source_key AND a.resolved_at IS NULL)
    RETURNING 1
  )
  SELECT count(*) INTO v_new FROM ins;

  -- (1b) The monitor alerting on its OWN BLINDNESS. Deduped per domain,
  -- auto-resolving the moment a fresh snapshot lands.
  WITH ins AS (
    INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    SELECT 'feed_mirror_stale', 'feed_mirror:' || b.dom,
           CASE WHEN b.synced_at IS NULL OR b.synced_at < now() - interval '7 days' THEN 'error' ELSE 'warn' END,
           'Feed-freshness mirror for ' || b.dom || ' is UNEVALUABLE'
             || CASE WHEN b.synced_at IS NULL THEN ' (no snapshot has ever landed)'
                     ELSE ' (last synced ' || b.synced_at::date || ' = '
                          || (now()::date - b.synced_at::date) || 'd ago)' END
             || '. ' || b.mirror_rows || ' feed(s) are NOT BEING CHECKED, so a stalled '
             || b.dom || ' feed cannot raise feed_stale. Last leg outcome: '
             || coalesce(b.last_outcome, '(never recorded)')
             || coalesce(' HTTP ' || b.last_status_code::text, '')
             || coalesce(' -- ' || left(b.last_error, 200), '') || '.',
           jsonb_build_object('domain', b.dom, 'mirror_rows', b.mirror_rows,
                              'synced_at', b.synced_at, 'last_outcome', b.last_outcome,
                              'last_status_code', b.last_status_code,
                              'last_error', left(b.last_error, 400),
                              'last_success_at', b.last_success_at,
                              'consecutive_failures', b.consecutive_failures)
      FROM _ff_blind b
     WHERE NOT EXISTS (
       SELECT 1 FROM public.lcc_health_alerts a
        WHERE a.alert_kind = 'feed_mirror_stale' AND a.source = 'feed_mirror:' || b.dom
          AND a.resolved_at IS NULL)
    RETURNING 1
  )
  SELECT count(*) INTO v_mirror_new FROM ins;

  UPDATE public.lcc_health_alerts a
     SET resolved_at = now(),
         resolved_note = 'Auto-resolved: feed-freshness mirror refreshed within SLA'
   WHERE a.alert_kind = 'feed_mirror_stale' AND a.resolved_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM _ff_blind b WHERE 'feed_mirror:' || b.dom = a.source);
  GET DIAGNOSTICS v_mirror_resolved = row_count;

  -- Auto-resolve: a feed that is now evaluable AND fresh again.
  UPDATE public.lcc_health_alerts a
     SET resolved_at = now(),
         resolved_note = 'Auto-resolved: feed refreshed within SLA'
   WHERE a.alert_kind = 'feed_stale' AND a.resolved_at IS NULL
     AND EXISTS (SELECT 1 FROM _ff_cur c WHERE c.source_key = a.source AND NOT c.is_stale);
  GET DIAGNOSTICS v_resolved = row_count;

  -- Ranked and CAPPED. Alerts are deduped per feed so there is no wall of rows,
  -- but a payload that can grow without bound is the badge-that-is-noise failure.
  SELECT count(*) INTO v_stale_n FROM _ff_cur WHERE is_stale;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'domain', dom, 'feed', feed_name, 'age_days', age_days,
           'sla_days', expected_max_age_days, 'latest', latest::date) ORDER BY age_days DESC),
         '[]'::jsonb)
    INTO v_stale
    FROM (SELECT * FROM _ff_cur WHERE is_stale ORDER BY age_days DESC LIMIT c_cap) z;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'domain', dom, 'unevaluated_feeds', mirror_rows, 'synced_at', synced_at,
           'last_outcome', last_outcome, 'last_status_code', last_status_code)
         ORDER BY dom), '[]'::jsonb)
    INTO v_mirror FROM _ff_blind;

  RETURN jsonb_build_object(
    'new_alerts', v_new, 'resolved', v_resolved,
    'feeds_evaluated', v_evaluated,
    'feeds_excluded_stale_mirror', v_excluded,
    'mirror_alerts_new', v_mirror_new, 'mirror_alerts_resolved', v_mirror_resolved,
    'mirror_unevaluable', v_mirror,
    'stale_total', v_stale_n,
    'stale_omitted', greatest(v_stale_n - c_cap, 0),
    'stale', v_stale,
    -- Retained for continuity with the R56 payload. Read feeds_evaluated.
    'evaluated', v_evaluated);
END;
$fn$;
REVOKE ALL ON FUNCTION public.lcc_check_feed_freshness(interval) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 5. Crons.
--
--    The finalize runs THREE times, five minutes apart. That is the retry cycle:
--    each pass consumes whatever is ready and re-fires a failed domain, and the
--    NEXT pass consumes the retry. A retry re-fired from inside a single finalize
--    could never be consumed by that same call, and by the next day's 05:35 run
--    its response is long since pruned from net._http_response (~6h retention) --
--    which is exactly the permanent silent loss the `lost` class above records.
--
--    (!) The 0-arg call sites still work: both functions default every parameter,
--    and no OTHER overload survives (the old signatures were dropped in 2 and 3).
-- ---------------------------------------------------------------------------
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('lcc-feed-freshness-sync')     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-feed-freshness-sync');
    PERFORM cron.unschedule('lcc-feed-freshness-finalize') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-feed-freshness-finalize');
    PERFORM cron.schedule('lcc-feed-freshness-sync',     '30 5 * * *',       $j$SELECT public.lcc_sync_feed_freshness('both')$j$);
    PERFORM cron.schedule('lcc-feed-freshness-finalize', '35,40,45 5 * * *', $j$SELECT public.lcc_finalize_feed_freshness()$j$);
  ELSE
    RAISE NOTICE 'pg_cron not installed; schedule lcc feed-freshness jobs manually.';
  END IF;
END $cron$;

COMMIT;

-- ---------------------------------------------------------------------------
-- REVERSAL RUNBOOK
--   1. Re-apply the R56 bodies of lcc_sync_feed_freshness / lcc_finalize_feed_freshness
--      / lcc_check_feed_freshness from
--      supabase/migrations/20260721120000_lcc_r56_feed_freshness_monitor.sql,
--      DROPPING this migration's signatures first (they differ in arity):
--        DROP FUNCTION IF EXISTS public.lcc_sync_feed_freshness(text, int);
--        DROP FUNCTION IF EXISTS public.lcc_finalize_feed_freshness(int, interval);
--        DROP FUNCTION IF EXISTS public.lcc_check_feed_freshness(interval);
--   2. Restore the single finalize schedule:
--        SELECT cron.unschedule('lcc-feed-freshness-finalize');
--        SELECT cron.schedule('lcc-feed-freshness-finalize','35 5 * * *',
--               'SELECT public.lcc_finalize_feed_freshness()');
--   3. Optional (the tables are additive and harmless to keep):
--        DROP TABLE public.lcc_feed_freshness_sync_status;
--        ALTER TABLE public.lcc_feed_freshness_sync_inflight DROP COLUMN attempt;
--   4. Resolve any alerts this raised:
--        UPDATE public.lcc_health_alerts SET resolved_at = now(),
--               resolved_note = 'reverted B6a-follow-up'
--         WHERE alert_kind = 'feed_mirror_stale' AND resolved_at IS NULL;
