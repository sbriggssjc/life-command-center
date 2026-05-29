-- ============================================================================
-- sf_sync_log retention + disk-pressure health alert (LCC Opps)
--
-- 2026-05-29 incident: sign-in to LCC was failing with HTTP 500
-- "Database error granting user". Root cause: the LCC Opps database
-- (xengecqvemvfknjvbvrq) filled its disk and Supabase switched it to
-- read-only mode. GoTrue (auth) could no longer INSERT session /
-- refresh-token rows, so every login 500'd ("cannot execute INSERT in a
-- read-only transaction", SQLSTATE 25006). Reads kept working, so only
-- sign-in appeared broken.
--
-- What filled the disk: a one-time Salesforce backfill (May 15-27) wrote
-- 126k object_intake rows to public.sf_sync_log, each carrying the raw SF
-- record in `payload`. The LIVE payload is only ~292 MB, but the table
-- grew to 5.5 GB (4 GB TOAST + 1.3 GB heap) because autovacuum never ran
-- on it (last_autovacuum = null) — the backfill's churn was never
-- reclaimed and there was no retention policy, unlike field_provenance,
-- net._http_response, and cron.job_run_details which all self-prune.
--
-- So the bulk of the 5.5 GB is reclaimable BLOAT, not live data. The
-- immediate fix is a one-time `VACUUM FULL public.sf_sync_log` (run
-- manually — VACUUM FULL cannot run inside a migration transaction;
-- non-destructive, keeps every row, reclaims ~5 GB). This migration makes
-- the cause non-recurring: trims the never-read payload on success rows
-- (companion edge-function change), bounds row count via retention,
-- tightens autovacuum so churn is reclaimed, and adds a disk-pressure
-- early warning.
--
-- sf_sync_log is not just a log — the intake-salesforce edge function
-- reads it for three live purposes:
--   * watermark  : newest crawl_run/ok row's created_at (incremental sync)
--   * retry queue: status='error' rows with retry_count < MAX_RETRY
--   * dead-letter: status='dead' rows pending manual attention
-- The disposable bulk is object_intake rows in terminal states
-- ('ok','skipped') — nothing reads those back. (A companion edge-function
-- change stops persisting `payload` on new success rows; this migration
-- reclaims the historical accumulation and keeps it bounded.)
--
-- This migration adds:
--   1. public.sf_sync_log_prune(interval, boolean) — deletes old
--      object_intake ok/skipped rows. NEVER touches crawl_run (watermark),
--      error (retry queue), dead (manual queue), or link_all. Returns a
--      jsonb summary; p_dry_run=true counts without deleting.
--   2. pg_cron 'sf-sync-log-prune' — daily 04:50 UTC (after
--      cleanup-cron-history 04:00 and field-provenance-prune 04:30).
--   3. public.lcc_check_disk_health(numeric, numeric) — opens a
--      'disk_pressure' alert in lcc_health_alerts when the database size
--      crosses a configurable threshold, and auto-resolves it when size
--      falls back under the warn level. Gives a proactive warning BEFORE
--      the ~read-only threshold instead of finding out via failed logins.
--   4. pg_cron 'lcc-disk-health-check' — hourly at :50.
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

-- ── 0. Autovacuum hardening ────────────────────────────────────────────────
-- The table reached 5.5 GB / ~5 GB bloat because autovacuum never ran on
-- it during the backfill. Tighten the thresholds so dead tuples (from the
-- retention deletes below, and any future churn) are reclaimed promptly
-- instead of bloating heap + TOAST again.
alter table public.sf_sync_log set (
  autovacuum_vacuum_scale_factor  = 0.05,
  autovacuum_vacuum_threshold     = 1000,
  autovacuum_vacuum_cost_limit    = 2000,
  toast.autovacuum_vacuum_scale_factor = 0.05,
  toast.autovacuum_vacuum_threshold    = 1000
);

-- ── 1. Retention function ──────────────────────────────────────────────────
create or replace function public.sf_sync_log_prune(
  p_age     interval default interval '30 days',
  p_dry_run boolean  default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff    timestamptz := now() - p_age;
  v_candidate int;
  v_deleted   int := 0;
begin
  -- Only object_intake rows in terminal, never-read-back states are
  -- eligible. crawl_run (watermark), error (retry queue), dead (manual
  -- queue), and link_all rows are preserved regardless of age.
  select count(*) into v_candidate
    from public.sf_sync_log
   where sync_type = 'object_intake'
     and status in ('ok', 'skipped')
     and created_at < v_cutoff;

  if not p_dry_run then
    delete from public.sf_sync_log
     where sync_type = 'object_intake'
       and status in ('ok', 'skipped')
       and created_at < v_cutoff;
    get diagnostics v_deleted = row_count;
  end if;

  return jsonb_build_object(
    'cutoff', v_cutoff,
    'candidates', v_candidate,
    'deleted', v_deleted,
    'dry_run', p_dry_run,
    'remaining_total', (select count(*) from public.sf_sync_log)
  );
end;
$$;

revoke all on function public.sf_sync_log_prune(interval, boolean) from public;
grant execute on function public.sf_sync_log_prune(interval, boolean) to service_role;

comment on function public.sf_sync_log_prune(interval, boolean) is
  'Prunes terminal object_intake rows (status ok/skipped) older than p_age from sf_sync_log. Never touches crawl_run (watermark), error (retry queue), dead (manual queue), or link_all rows. Returns a jsonb summary; p_dry_run=true counts without deleting. Added after the 2026-05-29 disk-full / read-only auth outage.';

-- ── 2. Schedule retention cron — 04:50 UTC ─────────────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin perform cron.unschedule('sf-sync-log-prune'); exception when others then null; end;
    perform cron.schedule(
      'sf-sync-log-prune',
      '50 4 * * *',
      $cmd$select public.sf_sync_log_prune(interval '30 days')$cmd$
    );
  end if;
end $$;

-- ── 3. Disk-pressure health alert ──────────────────────────────────────────
-- Postgres cannot read the provisioned disk cap, so this watches absolute
-- database size against configurable thresholds. Defaults are tuned to the
-- 2026-05-29 incident, where read-only mode engaged around a 13 GB database:
-- warn at 11 GB gives headroom to act before the danger zone. After raising
-- the project's provisioned disk, bump these thresholds in the cron command
-- (and re-run the cron.schedule below) to match ~75% / ~90% of the new disk.
create or replace function public.lcc_check_disk_health(
  p_warn_gb numeric default 11,
  p_crit_gb numeric default 12.5
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bytes    bigint := pg_database_size(current_database());
  v_gb       numeric := round(v_bytes / 1024.0 / 1024.0 / 1024.0, 2);
  v_severity text := null;
  v_new      int := 0;
  v_top      jsonb;
begin
  if v_gb >= p_crit_gb then
    v_severity := 'critical';
  elsif v_gb >= p_warn_gb then
    v_severity := 'warn';
  end if;

  if v_severity is not null then
    -- Largest tables, to point remediation at the right place.
    select jsonb_agg(t) into v_top from (
      select relname,
             pg_size_pretty(pg_total_relation_size(relid)) as size
        from pg_catalog.pg_statio_user_tables
       order by pg_total_relation_size(relid) desc
       limit 5
    ) t;

    -- One open alert at a time (no-op if one already exists unresolved).
    insert into public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    select 'disk_pressure', 'database_size', v_severity,
           'LCC Opps database size is ' || v_gb || ' GB (' || v_severity ||
           ' threshold ' || case when v_severity='critical' then p_crit_gb else p_warn_gb end ||
           ' GB). Disk-full puts the DB read-only and locks out sign-in.',
           jsonb_build_object('db_gb', v_gb, 'warn_gb', p_warn_gb,
                              'crit_gb', p_crit_gb, 'largest_tables', v_top)
     where not exists (
       select 1 from public.lcc_health_alerts a
        where a.alert_kind = 'disk_pressure'
          and a.source = 'database_size'
          and a.resolved_at is null
     );
    get diagnostics v_new = row_count;
  else
    -- Back under the warn threshold — auto-resolve any open disk alert.
    update public.lcc_health_alerts a
       set resolved_at = now(),
           resolved_note = 'Auto-resolved: database size ' || v_gb || ' GB back under warn threshold'
     where a.alert_kind = 'disk_pressure'
       and a.source = 'database_size'
       and a.resolved_at is null;
  end if;

  return jsonb_build_object(
    'db_gb', v_gb, 'severity', coalesce(v_severity, 'ok'),
    'new_alerts', v_new, 'warn_gb', p_warn_gb, 'crit_gb', p_crit_gb
  );
end;
$$;

revoke all on function public.lcc_check_disk_health(numeric, numeric) from public;
grant execute on function public.lcc_check_disk_health(numeric, numeric) to service_role;

comment on function public.lcc_check_disk_health(numeric, numeric) is
  'Opens a disk_pressure alert in lcc_health_alerts when database size crosses warn/crit thresholds (GB); auto-resolves when size drops back under warn. Thresholds default to the 2026-05-29 read-only incident level (~13 GB); raise them after provisioning more disk. Surfaced by v_cron_health_summary and the daily briefing.';

-- ── 4. Schedule disk-health cron — hourly at :50 ───────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin perform cron.unschedule('lcc-disk-health-check'); exception when others then null; end;
    perform cron.schedule(
      'lcc-disk-health-check',
      '50 * * * *',
      'select public.lcc_check_disk_health();'
    );
  end if;
end $$;
