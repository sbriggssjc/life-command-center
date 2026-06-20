-- R56 (2026-06-20) — feed-freshness health monitor (LCC Opps).
--
-- WHY: the recurring vulnerability across the whole build arc is a recurring
-- ingestion feed silently going stale and being found months later by accident
-- (USAJobs dead since March; SAM expired key; GSA monthly diff still stalled at
-- 2026-03-01). The system improves as new info is ingested — but nothing alerted
-- when a feed STOPPED. R56 makes the system self-report a stalled feed the day it
-- crosses its cadence SLA, REUSING the existing lcc_health_alerts +
-- v_cron_health_summary + daily-briefing machinery (not a new alert system).
--
-- ARCHITECTURE (three legs, one alert pipe):
--   * gov/dia each expose public.v_feed_freshness (a registry-driven snapshot;
--     see the domain R56 migrations). LCC has its OWN registry + v_feed_freshness
--     for LCC-local feeds (sf_sync_log, staged_intake_items).
--   * lcc_sync_feed_freshness / _finalize mirror the gov+dia snapshots into
--     lcc_domain_feed_freshness via pg_net (the proven isolated cross-DB pattern,
--     modelled on lcc_sync_owner_contact_signals). The mirror stores the raw
--     `latest` ts so the check recomputes age at check time (a lagging mirror is
--     still accurate to the day).
--   * lcc_check_feed_freshness reads the LCC-local view + the mirror and
--     opens/auto-resolves a `feed_stale` alert per over-SLA feed. Folded into the
--     EXISTING hourly lcc-cron-health-check tick (reuse, don't fork) so it shows
--     in v_cron_health_summary + the daily briefing automatically.
--
-- SAFE BY CONSTRUCTION (cache-or-live): an EMPTY or STALE (>3d) domain mirror is
-- SKIPPED — never false-alarms (sync died) and never false-resolves. The sync
-- crons are added to the R18 maintenance-cron allowlist, so a disabled sync
-- self-reports (closing the "the watcher itself was silently disabled" recursion).
-- Additive; idempotent; LCC-Opps only; auth schema untouched; reversible.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. LCC-local registry + freshness snapshot (mirrors the domain shape).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feed_freshness_registry (
  feed_name             text PRIMARY KEY,
  domain                text NOT NULL,
  src_schema            text NOT NULL DEFAULT 'public',
  src_table             text NOT NULL,
  ts_column             text NOT NULL,
  expected_max_age_days int  NOT NULL,
  description           text,
  is_active             boolean NOT NULL DEFAULT true
);

COMMENT ON TABLE public.feed_freshness_registry IS
  'R56: LCC-local monitored ingestion feeds (gov/dia feeds live in their own '
  'feed_freshness_registry and are pulled into lcc_domain_feed_freshness).';

INSERT INTO public.feed_freshness_registry
  (feed_name, domain, src_table, ts_column, expected_max_age_days, description) VALUES
  ('salesforce_sync', 'lcc','sf_sync_log',          'created_at',  7,  'Salesforce crawl/ingest log'),
  ('om_intake',       'lcc','staged_intake_items',  'created_at',  14, 'OM intake staging (email/sidebar/copilot/folder-feed)')
ON CONFLICT (feed_name) DO UPDATE SET
  domain=EXCLUDED.domain, src_schema=EXCLUDED.src_schema, src_table=EXCLUDED.src_table,
  ts_column=EXCLUDED.ts_column, expected_max_age_days=EXCLUDED.expected_max_age_days,
  description=EXCLUDED.description, is_active=true;

CREATE OR REPLACE FUNCTION public.compute_feed_freshness()
RETURNS TABLE(
  feed_name text, domain text, src_table text, ts_column text,
  latest timestamptz, age_days int, expected_max_age_days int,
  is_stale boolean, status text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE r record; v_latest timestamptz;
BEGIN
  FOR r IN SELECT * FROM public.feed_freshness_registry WHERE is_active ORDER BY feed_name LOOP
    feed_name := r.feed_name; domain := r.domain; src_table := r.src_table;
    ts_column := r.ts_column; expected_max_age_days := r.expected_max_age_days;
    latest := NULL; age_days := NULL; is_stale := NULL; status := 'ok';
    BEGIN
      EXECUTE format('SELECT max(%I)::timestamptz FROM %I.%I', r.ts_column, r.src_schema, r.src_table)
        INTO v_latest;
      latest := v_latest;
      IF v_latest IS NULL THEN
        status := 'no_data';
      ELSE
        age_days := (now()::date - v_latest::date);
        is_stale := age_days > r.expected_max_age_days;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      status := 'error:' || left(SQLERRM, 80);
    END;
    RETURN NEXT;
  END LOOP;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.compute_feed_freshness() TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.v_feed_freshness AS
  SELECT * FROM public.compute_feed_freshness();

GRANT SELECT ON public.v_feed_freshness TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Cross-DB mirror of the gov/dia snapshots + isolated pg_net sync/finalize.
--    Stores raw `latest` so the check recomputes age at check time.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_domain_feed_freshness (
  source_domain         text NOT NULL CHECK (source_domain IN ('dia','gov')),
  feed_name             text NOT NULL,
  src_table             text,
  ts_column             text,
  latest                timestamptz,
  expected_max_age_days int,
  synced_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_domain, feed_name)
);

ALTER TABLE public.lcc_domain_feed_freshness
  SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05,
       autovacuum_vacuum_threshold = 100, autovacuum_analyze_threshold = 100);

CREATE TABLE IF NOT EXISTS public.lcc_feed_freshness_sync_inflight (
  request_id    bigint PRIMARY KEY,
  source_domain text NOT NULL CHECK (source_domain IN ('dia','gov')),
  issued_at     timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.lcc_sync_feed_freshness(p_domain text DEFAULT 'both')
RETURNS TABLE(domain text, requests_fired int) AS $fn$
DECLARE
  v_url text; v_anon_key text; v_request_id bigint;
  v_fired int; v_domain text; v_domains text[];
BEGIN
  IF p_domain = 'both' THEN v_domains := ARRAY['gov','dia'];
  ELSE v_domains := ARRAY[p_domain]; END IF;

  FOREACH v_domain IN ARRAY v_domains LOOP
    SELECT decrypted_secret INTO v_url      FROM vault.decrypted_secrets WHERE name = v_domain || '_supabase_url';
    SELECT decrypted_secret INTO v_anon_key FROM vault.decrypted_secrets WHERE name = v_domain || '_supabase_anon_key';
    IF v_url IS NULL OR v_anon_key IS NULL THEN
      RAISE NOTICE 'lcc_sync_feed_freshness(%): missing vault secret, skipping', v_domain;
      CONTINUE;
    END IF;

    -- The snapshot is ~5-12 rows; one page (limit 1000) covers it.
    SELECT net.http_get(
      url := v_url || '/rest/v1/v_feed_freshness'
        || '?select=feed_name,src_table,ts_column,latest,expected_max_age_days,age_days,is_stale,status'
        || '&order=feed_name.asc&limit=1000',
      headers := jsonb_build_object('apikey', v_anon_key, 'Authorization', 'Bearer ' || v_anon_key)
    ) INTO v_request_id;

    INSERT INTO public.lcc_feed_freshness_sync_inflight (request_id, source_domain)
    VALUES (v_request_id, v_domain);

    domain := v_domain; requests_fired := 1; RETURN NEXT;
  END LOOP;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.lcc_sync_feed_freshness(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.lcc_finalize_feed_freshness()
RETURNS TABLE(finalized_requests int, rows_upserted int) AS $fn$
DECLARE v_finalized int; v_upserted int;
BEGIN
  -- Full-replace each refreshed domain (so a feed removed from the domain
  -- registry drops out of the mirror), then re-insert the fresh snapshot.
  DELETE FROM public.lcc_domain_feed_freshness m
   WHERE m.source_domain IN (
     SELECT DISTINCT i.source_domain
     FROM public.lcc_feed_freshness_sync_inflight i
     JOIN net._http_response r ON r.id = i.request_id
     WHERE r.status_code = 200
   );

  WITH consumed AS (
    SELECT i.request_id, i.source_domain, r.content
    FROM public.lcc_feed_freshness_sync_inflight i
    JOIN net._http_response r ON r.id = i.request_id
    WHERE r.status_code = 200
  ),
  rows AS (
    SELECT source_domain, jsonb_array_elements(content::jsonb) AS row FROM consumed
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
  SELECT (SELECT count(*) FROM consumed), (SELECT count(*) FROM ins)
  INTO v_finalized, v_upserted;

  DELETE FROM public.lcc_feed_freshness_sync_inflight
   WHERE request_id IN (
     SELECT i.request_id FROM public.lcc_feed_freshness_sync_inflight i
     JOIN net._http_response r ON r.id = i.request_id WHERE r.status_code = 200
   );
  DELETE FROM public.lcc_feed_freshness_sync_inflight WHERE issued_at < now() - interval '24 hours';
  ANALYZE public.lcc_domain_feed_freshness;

  finalized_requests := v_finalized; rows_upserted := v_upserted; RETURN NEXT;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.lcc_finalize_feed_freshness() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. The alert minter — opens/auto-resolves `feed_stale` in lcc_health_alerts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_check_feed_freshness()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_new int := 0; v_resolved int := 0; v_stale jsonb; v_evaluated int;
BEGIN
  -- Unified current EVALUABLE feed status. age is recomputed at check time from
  -- the raw `latest` (a lagging mirror is still accurate to the day). A domain
  -- mirror that is empty OR stale (>3 days = sync likely dead) is SKIPPED so we
  -- never false-alarm or false-resolve on it (cache-or-live).
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
      AND synced_at > now() - interval '3 days'
  )
  SELECT u.dom, u.feed_name, u.latest, u.expected_max_age_days, u.age_days,
         (u.age_days > u.expected_max_age_days) AS is_stale,
         ('feed:' || u.dom || ':' || u.feed_name) AS source_key
  FROM (SELECT * FROM lcc_local UNION ALL SELECT * FROM domain_mirror) u;

  -- Open one alert per newly-stale feed (idempotent on the source key).
  WITH ins AS (
    INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    SELECT 'feed_stale', c.source_key,
           CASE WHEN c.age_days > 2 * c.expected_max_age_days THEN 'error' ELSE 'warn' END,
           'Ingestion feed ' || c.feed_name || ' (' || c.dom || ') is STALE: last data '
             || c.latest::date || ' = ' || c.age_days || 'd old (SLA '
             || c.expected_max_age_days || 'd). The feed may have stopped — investigate.',
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

  -- Auto-resolve: a feed that is now evaluable AND fresh again.
  UPDATE public.lcc_health_alerts a
     SET resolved_at = now(),
         resolved_note = 'Auto-resolved: feed refreshed within SLA'
   WHERE a.alert_kind = 'feed_stale' AND a.resolved_at IS NULL
     AND EXISTS (SELECT 1 FROM _ff_cur c WHERE c.source_key = a.source AND NOT c.is_stale);
  GET DIAGNOSTICS v_resolved = row_count;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'domain', dom, 'feed', feed_name, 'age_days', age_days,
           'sla_days', expected_max_age_days, 'latest', latest::date) ORDER BY age_days DESC),
         '[]'::jsonb)
    INTO v_stale FROM _ff_cur WHERE is_stale;

  SELECT count(*) INTO v_evaluated FROM _ff_cur;

  RETURN jsonb_build_object('new_alerts', v_new, 'resolved', v_resolved,
                            'evaluated', v_evaluated, 'stale', v_stale);
END;
$fn$;
REVOKE ALL ON FUNCTION public.lcc_check_feed_freshness() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. R18 reuse: add the freshness sync crons to the maintenance allowlist so a
--    DISABLED sync self-reports (closes "the watcher itself was disabled").
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_check_disabled_critical_crons()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_new      int := 0;
  v_resolved int := 0;
  v_down     jsonb;
begin
  with allow(jobname) as (
    values
      ('lcc-artifact-offload-edge'),
      ('sf-sync-log-prune'),
      ('field-provenance-prune'),
      ('lcc-context-packet-prune'),
      ('lcc-staged-intake-artifacts-prune'),
      ('lcc-disk-health-check'),
      ('lcc-pg-net-response-cleanup'),
      ('lcc-feed-freshness-sync'),
      ('lcc-feed-freshness-finalize')
  ),
  state as (
    select a.jobname,
           count(j.jobid) = 0               as is_missing,
           coalesce(bool_or(j.active), false) as any_active,
           max(j.schedule)                  as schedule
      from allow a
      left join cron.job j on j.jobname = a.jobname
     group by a.jobname
  ),
  down as (
    select jobname,
           case when is_missing then 'missing' else 'inactive' end as reason,
           schedule
      from state
     where is_missing or not any_active
  ),
  ins as (
    insert into public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    select 'maintenance_cron_disabled', d.jobname, 'warn',
           'Critical maintenance cron ' || d.jobname || ' is ' ||
             case when d.reason = 'missing'
                  then 'MISSING (not scheduled)'
                  else 'DISABLED (active=false)' end ||
             '. While it is off, its table can grow unbounded — disk-full puts ' ||
             'LCC Opps read-only and locks out sign-in. Re-enable it.',
           jsonb_build_object('jobname', d.jobname, 'reason', d.reason,
                              'schedule', d.schedule)
      from down d
     where not exists (
       select 1 from public.lcc_health_alerts a
        where a.alert_kind = 'maintenance_cron_disabled'
          and a.source = d.jobname
          and a.resolved_at is null
     )
    returning 1
  )
  select count(*) into v_new from ins;

  update public.lcc_health_alerts a
     set resolved_at = now(),
         resolved_note = 'Auto-resolved: maintenance cron re-enabled (active)'
   where a.alert_kind = 'maintenance_cron_disabled'
     and a.resolved_at is null
     and exists (
       select 1 from cron.job j
        where j.jobname = a.source
          and j.active is true
     );
  get diagnostics v_resolved = row_count;

  select coalesce(jsonb_agg(a.jobname), '[]'::jsonb) into v_down
    from (
      values ('lcc-artifact-offload-edge'),('sf-sync-log-prune'),
             ('field-provenance-prune'),('lcc-context-packet-prune'),
             ('lcc-staged-intake-artifacts-prune'),('lcc-disk-health-check'),
             ('lcc-pg-net-response-cleanup'),('lcc-feed-freshness-sync'),
             ('lcc-feed-freshness-finalize')
    ) as a(jobname)
   where not exists (
     select 1 from cron.job j where j.jobname = a.jobname and j.active is true
   );

  return jsonb_build_object(
    'new_alerts', v_new,
    'resolved', v_resolved,
    'down', coalesce(v_down, '[]'::jsonb)
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Crons: daily mirror refresh + fold the check into the hourly health tick.
-- ---------------------------------------------------------------------------
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('lcc-feed-freshness-sync')     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-feed-freshness-sync');
    PERFORM cron.unschedule('lcc-feed-freshness-finalize') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-feed-freshness-finalize');
    PERFORM cron.schedule('lcc-feed-freshness-sync',     '30 5 * * *', $j$SELECT public.lcc_sync_feed_freshness('both')$j$);
    PERFORM cron.schedule('lcc-feed-freshness-finalize', '35 5 * * *', $j$SELECT public.lcc_finalize_feed_freshness()$j$);

    -- Fold the freshness check into the EXISTING hourly health monitor (reuse,
    -- don't fork). Re-register with all four checks so a replay re-establishes
    -- the combined command last (the R18 pattern).
    PERFORM cron.unschedule('lcc-cron-health-check') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-cron-health-check');
    PERFORM cron.schedule('lcc-cron-health-check', '15 * * * *',
      'SELECT public.lcc_check_cron_health(); SELECT public.lcc_check_disabled_critical_crons(); SELECT public.lcc_check_research_backlog_growth(); SELECT public.lcc_check_feed_freshness();');
  ELSE
    RAISE NOTICE 'pg_cron not installed; schedule lcc feed-freshness jobs manually.';
  END IF;
END $cron$;

COMMIT;
