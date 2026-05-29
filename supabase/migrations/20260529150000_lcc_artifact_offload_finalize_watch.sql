-- ============================================================================
-- Auto-finalize the staged_intake_artifacts offload with a one-shot VACUUM FULL
-- (LCC Opps) — durable, server-side "reminder".
--
-- The lcc-artifact-offload cron drains inline_data → Storage over ~a day, but
-- nulling inline_data only frees space to the heap/TOAST free list; the ~6 GB
-- physical footprint isn't returned to the OS until a VACUUM FULL. VACUUM FULL
-- cannot run inside a transaction/function, so we can't do it conditionally in
-- plpgsql directly. Instead:
--
--   public.lcc_artifact_offload_finalize() — runs hourly via pg_cron:
--     * While the large backlog remains (any inline_data row with no
--       storage_path and size_bytes > 100 KB), do nothing.
--     * Once the large backlog is gone, schedule a NEAR-ONE-SHOT pg_cron job
--       'lcc-artifact-vacuum-run' whose command is a bare
--       `VACUUM FULL public.staged_intake_artifacts` (pg_cron runs bare VACUUM
--       outside a transaction), set to fire ~3 minutes later, and open a
--       lcc_health_alerts note.
--     * After that VACUUM has run (table physically shrinks below 1 GB),
--       unschedule both the vacuum-run job and this watcher, and record
--       completion in lcc_health_alerts.
--
-- New OM intake keeps arriving, so "drained" is scoped to the LARGE backlog
-- (size_bytes > 100 KB) — the tiny email-body tail and fresh arrivals don't
-- block finalization, and the steady-state offload cron keeps handling them.
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

create or replace function public.lcc_artifact_offload_finalize()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_large_remaining int;
  v_table_bytes     bigint := pg_total_relation_size('public.staged_intake_artifacts');
  v_run_exists      boolean;
  v_run_cron        text;
begin
  -- Large inline artifacts still awaiting offload (cheap: uses the size_bytes
  -- column, no detoast). >100 KB excludes the negligible email-body tail.
  select count(*) into v_large_remaining
    from public.staged_intake_artifacts
   where inline_data is not null
     and storage_path is null
     and coalesce(size_bytes, 0) > 100000;

  select exists(select 1 from cron.job where jobname = 'lcc-artifact-vacuum-run')
    into v_run_exists;

  -- Phase 2: the one-shot VACUUM has been scheduled previously. If the table
  -- has physically shrunk, the VACUUM ran — clean everything up.
  if v_run_exists then
    if v_table_bytes < 1024::bigint * 1024 * 1024 then  -- < 1 GB ⇒ compacted
      begin perform cron.unschedule('lcc-artifact-vacuum-run'); exception when others then null; end;
      begin perform cron.unschedule('lcc-artifact-offload-finalize-watch'); exception when others then null; end;
      insert into public.lcc_health_alerts (alert_kind, source, severity, summary, details)
      values ('artifact_offload', 'staged_intake_artifacts', 'warn',
              'Artifact offload finalized: VACUUM FULL reclaimed staged_intake_artifacts to '
                || pg_size_pretty(v_table_bytes) || '. Watcher self-removed.',
              jsonb_build_object('table_bytes', v_table_bytes,
                                 'db_size', pg_database_size(current_database())));
      return jsonb_build_object('phase', 'complete', 'table_bytes', v_table_bytes);
    end if;
    return jsonb_build_object('phase', 'vacuum_pending', 'table_bytes', v_table_bytes);
  end if;

  -- Phase 1: still draining.
  if v_large_remaining > 0 then
    return jsonb_build_object('phase', 'draining', 'large_remaining', v_large_remaining,
                              'table_bytes', v_table_bytes);
  end if;

  -- Drained: schedule the bare VACUUM FULL as a near-one-shot (fires once at a
  -- specific minute ~3 min out; the watcher unschedules it after it runs).
  v_run_cron := to_char(now() + interval '3 minutes', 'MI HH24 DD MM') || ' *';
  perform cron.schedule('lcc-artifact-vacuum-run', v_run_cron,
                        'VACUUM FULL public.staged_intake_artifacts');
  insert into public.lcc_health_alerts (alert_kind, source, severity, summary, details)
  values ('artifact_offload', 'staged_intake_artifacts', 'warn',
          'Artifact large backlog drained — one-shot VACUUM FULL scheduled at "'
            || v_run_cron || '" (UTC cron).',
          jsonb_build_object('vacuum_cron', v_run_cron, 'table_bytes', v_table_bytes));
  return jsonb_build_object('phase', 'vacuum_scheduled', 'vacuum_cron', v_run_cron,
                            'table_bytes', v_table_bytes);
end;
$$;

revoke all on function public.lcc_artifact_offload_finalize() from public;
grant execute on function public.lcc_artifact_offload_finalize() to service_role;

comment on function public.lcc_artifact_offload_finalize() is
  'Hourly watcher: once the large staged_intake_artifacts inline backlog is offloaded to Storage, schedules a one-shot VACUUM FULL to reclaim disk, then self-removes (and the vacuum-run job) after it completes. Logs to lcc_health_alerts. Added 2026-05-29 as the durable finalizer for the artifact offload.';

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin perform cron.unschedule('lcc-artifact-offload-finalize-watch'); exception when others then null; end;
    perform cron.schedule('lcc-artifact-offload-finalize-watch', '0 * * * *',
                          'select public.lcc_artifact_offload_finalize();');

    -- Speed up the drainer while the ~900-file large backlog clears. Each tick
    -- is time-budgeted (~7s) so the binding constraint is frequency, not the
    -- per-tick limit; every 5 min ≈ halves the drain time vs every 10 min.
    -- (Originally scheduled '2-59/10' in migration 20260529130000.)
    begin perform cron.unschedule('lcc-artifact-offload'); exception when others then null; end;
    perform cron.schedule('lcc-artifact-offload', '*/5 * * * *',
      $cmd$select public.lcc_cron_post('/api/admin?_route=artifact-offload&limit=15&grace_minutes=15', '{}'::jsonb, 'vercel')$cmd$);
  end if;
end $$;
