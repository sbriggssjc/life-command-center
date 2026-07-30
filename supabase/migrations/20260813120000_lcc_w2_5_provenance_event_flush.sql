-- ============================================================================
-- W2.5 (2026-08-13): drain the domain provenance_event_log tables into the
-- LCC Opps field_provenance ledger — the "future" flush crons the R2-W-1b /
-- R2-W-2b comments in the 20260519110000 migrations promised but never built.
--
-- Audit finding 3.3.1: dia.provenance_event_log (~94 rows) and
-- gov.provenance_event_log (~16,860 rows) capture SQL-trigger / function-driven
-- field writes (davita brand canonicalizer, agency classifier, QA agency
-- canonicalizers) that CANNOT reach LCC Opps lcc_merge_field() from trigger
-- context (different Postgres instance). Because they never reached the ledger,
-- field_source_priority has been arbitrating against PHANTOM STATE for every
-- trigger-driven field — the ledger believes no one wrote government_type /
-- tenant / agency_canonical when in fact the domain triggers did.
--
-- This migration builds the LCC-Opps half of the flush mechanism:
--   1. lcc_provenance_flush_state — per-domain cursor/observability (watermark
--      on the domain event id + observed undrained count for the health check).
--   2. field_source_priority rows registering source='domain_trigger' as
--      record_only for every (target_table, field_name) the event logs touch,
--      so the flushed rows do NOT trip v_field_provenance_unranked and so the
--      new source is priced (record_only = observe, never block, during rollout).
--   3. lcc_flush_provenance_events(domain, events, default_conf) — the single
--      transform: normalize target_table, skip historical bulk markers, and
--      call lcc_merge_field() per event with source='domain_trigger'. This is
--      the SOLE source of transform truth; the Railway handler is a thin
--      cross-DB shuttle around it (pull page -> this RPC -> mark drained).
--   4. v_lcc_provenance_flush_conflicts / _conflict_summary — the phantom-state
--      exposure report: how many drained trigger events DISAGREE with the
--      current live field_provenance value per field.
--   5. lcc_check_provenance_flush_health() — a queue-depth alarm (undrained
--      backlog present but not draining), folded into the hourly cron-health
--      tick; plus both flush crons added to the disabled-cron watchdog.
--   6. Two crons that POST the Railway flush endpoint per domain.
--
-- ⚠️ lcc_merge_field takes a per-key pg_advisory_xact_lock (W2.1). The RPC loops
-- it inside ONE transaction, so it holds every processed key's lock until the
-- RPC commits. The caller therefore sends MODEST chunks (<=500) so the flush
-- never serializes live sidebar traffic behind a large batch. government_type /
-- tenant / agency_canonical are not hot sidebar-write fields, so contention is
-- near-nil in practice, but the modest-chunk discipline is enforced by the
-- caller regardless.
--
-- Additive / idempotent / reversible. Applies FIRST (schema before writer,
-- constant deploy rule); the Railway handler ships on the next redeploy. Until
-- then the two crons POST a route that 404s harmlessly (logged in
-- lcc_cron_post_log; nothing drains, nothing breaks).
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
--
-- REVERSAL: unschedule the two crons; DROP the two views, the RPC and the
-- health fn; DELETE FROM field_source_priority WHERE source='domain_trigger';
-- DROP TABLE lcc_provenance_flush_state; restore lcc_check_disabled_critical_crons
-- to the prior allowlist and lcc-cron-health-check to its prior command. The
-- flushed field_provenance rows (source='domain_trigger') age out via the 90-day
-- field-provenance-prune, or delete them by source.
-- ============================================================================

BEGIN;

-- ── 1. Per-domain flush cursor + observability ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.lcc_provenance_flush_state (
  domain                 text PRIMARY KEY CHECK (domain IN ('dia','gov')),
  target_database        text NOT NULL,             -- dia_db / gov_db (field_provenance convention)
  last_flushed_event_id  bigint NOT NULL DEFAULT 0, -- watermark on the domain event id
  undrained_remaining    bigint,                    -- observed at the last run (drives health)
  rows_merged_last_run    integer NOT NULL DEFAULT 0,
  rows_merged_total       bigint  NOT NULL DEFAULT 0,
  markers_skipped_total   bigint  NOT NULL DEFAULT 0,
  errors_last_run         integer NOT NULL DEFAULT 0,
  last_run_at            timestamptz,
  last_success_at        timestamptz,
  last_error             text,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lcc_provenance_flush_state IS
  'W2.5 (2026-08-13): per-domain cursor + observability for the provenance_event_log
   flush. last_flushed_event_id is the watermark on the domain event id;
   undrained_remaining is the count observed at the last run and is what
   lcc_check_provenance_flush_health() alarms on. Authoritative drained-ness lives
   on the domain row (provenance_event_log.flushed_to_lcc_opps_at); this table is
   the cursor + health input.';

INSERT INTO public.lcc_provenance_flush_state (domain, target_database)
VALUES ('dia','dia_db'), ('gov','gov_db')
ON CONFLICT (domain) DO NOTHING;

-- ── 2. Register source='domain_trigger' (record_only) for every combo the ────
--       event logs currently touch, so flushed rows are priced and do not trip
--       v_field_provenance_unranked. Priority 90 = the derived/canonicalization
--       tier (sits with the existing qa22/qa24/qa30 canonicalizers) — a trigger
--       fills blanks but never clobbers a curated/aggregator source. record_only
--       so it observes only during rollout; tunable to warn/strict later.
INSERT INTO public.field_source_priority (target_table, field_name, source, priority, min_confidence, enforce_mode, notes)
VALUES
  ('dia.properties',        'tenant',           'domain_trigger', 90, 0, 'record_only',
     'W2.5: async flush of dia.provenance_event_log (davita brand canonicalizer trigger).'),
  ('gov.properties',        'government_type',  'domain_trigger', 90, 0, 'record_only',
     'W2.5: async flush of gov.provenance_event_log (agency_classifier).'),
  ('gov.sales_transactions','government_type',  'domain_trigger', 90, 0, 'record_only',
     'W2.5: async flush of gov.provenance_event_log (agency_classifier).'),
  ('gov.leases',            'government_type',  'domain_trigger', 90, 0, 'record_only',
     'W2.5: async flush of gov.provenance_event_log (agency_classifier).'),
  ('gov.property_agencies', 'government_type',  'domain_trigger', 90, 0, 'record_only',
     'W2.5: async flush of gov.provenance_event_log (agency_classifier).'),
  ('gov.properties',        'agency_canonical', 'domain_trigger', 90, 0, 'record_only',
     'W2.5: async flush of gov.provenance_event_log (agency canonicalizers).')
ON CONFLICT (target_table, field_name, source) DO UPDATE
  SET priority = EXCLUDED.priority,
      min_confidence = EXCLUDED.min_confidence,
      enforce_mode = EXCLUDED.enforce_mode,
      notes = EXCLUDED.notes,
      updated_at = now();

-- ── 3. The transform RPC — the single source of transform truth ─────────────
-- Takes a MODEST chunk of raw domain event rows (as jsonb), normalizes each and
-- funnels it through lcc_merge_field() with source='domain_trigger'. Returns the
-- per-event outcome so the caller knows which domain rows to mark drained.
--
-- Marker rows (historical bulk-UPDATE acknowledgements: record_pk_value like
-- '<...>' / metadata.kind='historical_bulk_update_marker' / new_value null) are
-- NOT merged — they are not real per-record field writes — but ARE reported as
-- skipped so the caller marks them drained (they must leave the undrained set).
CREATE OR REPLACE FUNCTION public.lcc_flush_provenance_events(
  p_domain              text,
  p_events              jsonb,
  p_default_confidence  numeric DEFAULT 0.9
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_target_db   text;
  v_e           jsonb;
  v_id          bigint;
  v_raw_table   text;
  v_table       text;
  v_pk          text;
  v_field       text;
  v_newval      jsonb;
  v_src         text;
  v_conf        numeric;
  v_kind        text;
  v_runid       text;
  v_decision    text;
  v_is_marker   boolean;
  v_merged      bigint[] := ARRAY[]::bigint[];
  v_skipped     bigint[] := ARRAY[]::bigint[];
  v_errors      jsonb    := '[]'::jsonb;
  v_decisions   jsonb    := '{}'::jsonb;
  v_max_id      bigint   := 0;
BEGIN
  IF p_domain NOT IN ('dia','gov') THEN
    RAISE EXCEPTION 'p_domain must be dia or gov, got %', p_domain;
  END IF;
  v_target_db := CASE p_domain WHEN 'dia' THEN 'dia_db' ELSE 'gov_db' END;

  FOR v_e IN SELECT * FROM jsonb_array_elements(COALESCE(p_events, '[]'::jsonb))
  LOOP
    v_id        := NULLIF(v_e->>'id','')::bigint;
    IF v_id IS NULL THEN CONTINUE; END IF;
    IF v_id > v_max_id THEN v_max_id := v_id; END IF;

    v_raw_table := v_e->>'target_table';
    v_pk        := v_e->>'record_pk_value';
    v_field     := v_e->>'field_name';
    v_newval    := v_e->'new_value';
    v_src       := COALESCE(v_e->>'source','domain_trigger');
    v_conf      := COALESCE(NULLIF(v_e->>'confidence','')::numeric, p_default_confidence);
    v_kind      := v_e->'metadata'->>'kind';

    -- Marker / non-write rows: acknowledge (drain) but never merge.
    v_is_marker := (v_pk IS NULL)
                OR (v_pk LIKE '<%>')
                OR (v_kind = 'historical_bulk_update_marker')
                OR (v_newval IS NULL)
                OR (v_newval = 'null'::jsonb);
    IF v_is_marker THEN
      v_skipped := v_skipped || v_id;
      CONTINUE;
    END IF;

    -- Normalize target_table to the field_provenance domain-prefixed convention.
    -- Bare table names (agency_classifier writes 'sales_transactions') get the
    -- domain prefix; already-prefixed rows ('dia.properties') pass through.
    v_table := CASE WHEN position('.' IN COALESCE(v_raw_table,'')) > 0
                    THEN v_raw_table
                    ELSE p_domain || '.' || v_raw_table END;

    -- Preserve the originating source lineage in the run id.
    v_runid := v_src || ':evt' || v_id;

    BEGIN
      SELECT lmf.decision INTO v_decision
      FROM public.lcc_merge_field(
        NULL,                 -- p_workspace_id (trigger-origin write, like the replay path)
        v_target_db,          -- p_target_database
        v_table,              -- p_target_table
        v_pk,                 -- p_record_pk
        v_field,              -- p_field_name
        v_newval,             -- p_value (jsonb)
        'domain_trigger',     -- p_source
        v_runid,              -- p_source_run_id (original source + event id)
        v_conf,               -- p_confidence
        NULL                  -- p_recorded_by
      ) lmf;

      v_merged    := v_merged || v_id;
      v_decisions := jsonb_set(
                       v_decisions,
                       ARRAY[COALESCE(v_decision,'unknown')],
                       to_jsonb(COALESCE((v_decisions->>COALESCE(v_decision,'unknown'))::int,0) + 1),
                       true);
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('id', v_id, 'error', left(SQLERRM, 400));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'merged_ids',   to_jsonb(v_merged),
    'skipped_ids',  to_jsonb(v_skipped),
    'errors',       v_errors,
    'decisions',    v_decisions,
    'max_event_id', v_max_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lcc_flush_provenance_events(text, jsonb, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.lcc_flush_provenance_events(text, jsonb, numeric) TO service_role;

COMMENT ON FUNCTION public.lcc_flush_provenance_events(text, jsonb, numeric) IS
  'W2.5: transform a chunk of domain provenance_event_log rows into
   lcc_merge_field(source=domain_trigger) calls. Normalizes bare table names to
   the domain-prefixed ledger convention, skips historical bulk markers, and
   preserves the originating source in source_run_id (src:evt<id>). Returns
   {merged_ids, skipped_ids, errors, decisions, max_event_id}. The caller marks
   merged_ids ∪ skipped_ids drained on the domain. Keep chunks modest (<=500):
   each lcc_merge_field takes a per-key advisory xact lock held until this RPC
   commits.';

-- ── 4. Phantom-state exposure report ────────────────────────────────────────
-- For each key that carries a flushed domain_trigger event, compare that event's
-- value to the CURRENT live field_provenance write. A disagreement is a field
-- where field_source_priority has been arbitrating against a value the domain
-- trigger actually set — the exposure the flush closes.
CREATE OR REPLACE VIEW public.v_lcc_provenance_flush_conflicts AS
WITH dt AS (
  SELECT DISTINCT ON (fp.target_database, fp.target_table, fp.record_pk_value, fp.field_name)
    fp.target_database, fp.target_table, fp.record_pk_value, fp.field_name,
    fp.value        AS trigger_value,
    fp.source_run_id AS trigger_run_id,
    fp.decision     AS trigger_decision,
    fp.recorded_at  AS trigger_recorded_at
  FROM public.field_provenance fp
  WHERE fp.source = 'domain_trigger'
  ORDER BY fp.target_database, fp.target_table, fp.record_pk_value, fp.field_name,
           fp.recorded_at DESC, fp.id DESC
),
live AS (
  SELECT fp.target_database, fp.target_table, fp.record_pk_value, fp.field_name,
         fp.value  AS live_value,
         fp.source AS live_source
  FROM public.field_provenance fp
  WHERE fp.decision = 'write'
)
SELECT
  dt.target_database,
  dt.target_table,
  dt.record_pk_value,
  dt.field_name,
  dt.trigger_value,
  dt.trigger_run_id,
  dt.trigger_decision,
  dt.trigger_recorded_at,
  live.live_value,
  live.live_source,
  (live.live_source IS DISTINCT FROM 'domain_trigger'
    AND public.lcc_value_normalize_for_compare(dt.trigger_value)
        IS DISTINCT FROM public.lcc_value_normalize_for_compare(live.live_value)
  ) AS disagrees
FROM dt
LEFT JOIN live USING (target_database, target_table, record_pk_value, field_name);

COMMENT ON VIEW public.v_lcc_provenance_flush_conflicts IS
  'W2.5: per-key comparison of the flushed domain_trigger value vs the current
   live field_provenance write. disagrees=true means a higher-trust source holds
   a DIFFERENT live value than the domain trigger set — the phantom-state exposure
   the flush surfaces. Feeds the strict-mode cohort decision.';

CREATE OR REPLACE VIEW public.v_lcc_provenance_flush_conflict_summary AS
SELECT
  target_database,
  target_table,
  field_name,
  count(*)                              AS flushed_keys,
  count(*) FILTER (WHERE disagrees)     AS disagreements,
  count(*) FILTER (WHERE live_source = 'domain_trigger') AS trigger_is_live,
  count(*) FILTER (WHERE live_value IS NULL)             AS no_live_write,
  round(100.0 * count(*) FILTER (WHERE disagrees) / NULLIF(count(*),0), 2) AS disagreement_pct
FROM public.v_lcc_provenance_flush_conflicts
GROUP BY target_database, target_table, field_name
ORDER BY disagreements DESC, flushed_keys DESC;

COMMENT ON VIEW public.v_lcc_provenance_flush_conflict_summary IS
  'W2.5: per-field rollup of v_lcc_provenance_flush_conflicts — flushed key count,
   how many disagree with the live ledger value, how many the trigger now owns,
   and how many had no prior live write. The warn-mode conflict rate that feeds
   the next strict-mode cohort proposal.';

GRANT SELECT ON public.v_lcc_provenance_flush_conflicts        TO authenticated, service_role;
GRANT SELECT ON public.v_lcc_provenance_flush_conflict_summary TO authenticated, service_role;

-- ── 5. Queue-depth health: alarm when a backlog is present but not draining ──
CREATE OR REPLACE FUNCTION public.lcc_check_provenance_flush_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_new      int := 0;
  v_resolved int := 0;
BEGIN
  -- OPEN a warn alert per domain whose backlog exists but has not drained
  -- recently (cron off / endpoint down / erroring). "Not draining" = a positive
  -- undrained_remaining with no successful run in the last 3 hours.
  WITH stalled AS (
    SELECT s.domain, s.undrained_remaining, s.last_success_at, s.last_error
    FROM public.lcc_provenance_flush_state s
    WHERE COALESCE(s.undrained_remaining, 0) > 0
      AND (s.last_success_at IS NULL OR s.last_success_at < now() - interval '3 hours')
  ),
  ins AS (
    INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    SELECT 'provenance_flush_backlog',
           'provenance-flush-' || st.domain,
           'warn',
           'Provenance event flush for ' || st.domain || ' has ' ||
             st.undrained_remaining || ' undrained event(s) and no successful drain in >3h. '
             || 'field_source_priority is arbitrating against phantom trigger state until it drains.',
           jsonb_build_object('domain', st.domain,
                              'undrained_remaining', st.undrained_remaining,
                              'last_success_at', st.last_success_at,
                              'last_error', st.last_error)
    FROM stalled st
    WHERE NOT EXISTS (
      SELECT 1 FROM public.lcc_health_alerts a
       WHERE a.alert_kind = 'provenance_flush_backlog'
         AND a.source = 'provenance-flush-' || st.domain
         AND a.resolved_at IS NULL
    )
    RETURNING 1
  )
  SELECT count(*) INTO v_new FROM ins;

  -- Auto-resolve: backlog fully drained OR draining again in the last 3h.
  UPDATE public.lcc_health_alerts a
     SET resolved_at = now(),
         resolved_note = 'Auto-resolved: provenance flush backlog drained / draining again'
   WHERE a.alert_kind = 'provenance_flush_backlog'
     AND a.resolved_at IS NULL
     AND EXISTS (
       SELECT 1 FROM public.lcc_provenance_flush_state s
        WHERE 'provenance-flush-' || s.domain = a.source
          AND (COALESCE(s.undrained_remaining,0) = 0
               OR (s.last_success_at IS NOT NULL AND s.last_success_at >= now() - interval '3 hours'))
     );
  GET DIAGNOSTICS v_resolved = row_count;

  RETURN jsonb_build_object('new_alerts', v_new, 'resolved', v_resolved);
END;
$$;

REVOKE ALL ON FUNCTION public.lcc_check_provenance_flush_health() FROM public;
GRANT EXECUTE ON FUNCTION public.lcc_check_provenance_flush_health() TO service_role;

COMMENT ON FUNCTION public.lcc_check_provenance_flush_health() IS
  'W2.5: opens a provenance_flush_backlog warn alert (one open per domain) when a
   domain provenance_event_log backlog exists but has not drained successfully in
   >3h; auto-resolves when undrained_remaining hits 0 or a successful drain runs
   again. Folded into the hourly lcc-cron-health-check tick.';

-- ── 6. Add both flush crons to the disabled-cron watchdog ───────────────────
-- Their absence means the ledger silently drifts back into phantom state, so the
-- watchdog treats them like the other maintenance crons whose being-off is a
-- silent data-integrity risk.
CREATE OR REPLACE FUNCTION public.lcc_check_disabled_critical_crons()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_new      int := 0;
  v_resolved int := 0;
  v_down     jsonb;
begin
  with allow(jobname) as (
    values
      ('lcc-artifact-offload-edge'),          -- drains staged_intake_artifacts inline_data → Storage
      ('sf-sync-log-prune'),                  -- bounds sf_sync_log row count
      ('field-provenance-prune'),             -- bounds field_provenance
      ('lcc-context-packet-prune'),           -- bounds context_packets
      ('lcc-staged-intake-artifacts-prune'),  -- bounds staged_intake_artifacts
      ('lcc-disk-health-check'),              -- the disk-pressure early warning itself
      ('lcc-pg-net-response-cleanup'),        -- bounds net._http_response
      ('lcc-provenance-flush-dia'),           -- W2.5: drains dia.provenance_event_log into the ledger
      ('lcc-provenance-flush-gov')            -- W2.5: drains gov.provenance_event_log into the ledger
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
             ('lcc-pg-net-response-cleanup'),
             ('lcc-provenance-flush-dia'),('lcc-provenance-flush-gov')
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
$$;

-- ── 7. Wire the health check into the hourly tick + schedule the flush crons ─
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Fold the queue-depth check into the proven hourly health tick (no new
    -- watcher cron — a new watcher could itself be silently disabled).
    BEGIN PERFORM cron.unschedule('lcc-cron-health-check'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule(
      'lcc-cron-health-check',
      '15 * * * *',
      'SELECT public.lcc_check_cron_health(); SELECT public.lcc_check_disabled_critical_crons(); SELECT public.lcc_check_research_backlog_growth(); SELECT public.lcc_check_feed_freshness(); SELECT public.lcc_check_provenance_flush_health();'
    );

    -- dia backlog is tiny (~94) — a periodic drain keeps the davita-canonicalizer
    -- trigger events fresh in the ledger. Every 30 min, offset off the hour.
    BEGIN PERFORM cron.unschedule('lcc-provenance-flush-dia'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule(
      'lcc-provenance-flush-dia',
      '4,34 * * * *',
      $cron$select public.lcc_cron_post('/api/admin?_route=provenance-event-flush&domain=dia', '{}'::jsonb, 'vercel')$cron$
    );

    -- gov backlog is ~16,860 — drain every 10 min (offset) until it reaches 0,
    -- then it maintains. Each run is capped + time-budgeted in the handler.
    BEGIN PERFORM cron.unschedule('lcc-provenance-flush-gov'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule(
      'lcc-provenance-flush-gov',
      '9-59/10 * * * *',
      $cron$select public.lcc_cron_post('/api/admin?_route=provenance-event-flush&domain=gov', '{}'::jsonb, 'vercel')$cron$
    );
  END IF;
END $$;

COMMIT;
