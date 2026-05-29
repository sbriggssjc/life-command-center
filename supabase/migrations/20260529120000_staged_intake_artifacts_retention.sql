-- ============================================================================
-- staged_intake_artifacts inline_data retention (2026-05-29)
--
-- The OM-intake pipeline stores raw PDF/email bytes as base64 in
-- staged_intake_artifacts.inline_data. There was no retention policy, so the
-- column grew unbounded — 6.5 GB across ~4,500 rows by 2026-05-29, pushing
-- the 12 GB LCC Opps database over its disk quota and tripping Postgres into
-- read-only mode. Read-only silently killed pg_cron (including the morning
-- briefing-intel-snapshot job) and blocked every write path (OM intake,
-- sidebar capture, BD syncs).
--
-- The extracted/parsed result is persisted independently in
-- staged_intake_extractions.extraction_snapshot, so the raw inline_data is
-- only needed transiently — for re-extraction or audit shortly after intake.
-- After 7 days it is safe to drop. (Older April artifacts were already
-- inline-cleared by an ad-hoc process; this formalizes that as a daily cron.)
--
-- The function only NULLs inline_data; it does not delete rows (metadata +
-- sha256 are kept for audit). autovacuum reclaims the freed TOAST space for
-- reuse, so the physical file stays bounded at roughly 7 days of artifacts
-- (~1.5-2 GB) instead of growing forever. A one-time VACUUM FULL was run at
-- rollout to return the already-accumulated ~4 GB to the OS.
-- ============================================================================

create or replace function public.staged_intake_artifacts_prune(
  p_age     interval default interval '7 days',
  p_dry_run boolean  default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate_count int;
  v_cleared_count   int := 0;
  v_cutoff          timestamptz := now() - p_age;
begin
  select count(*) into v_candidate_count
    from public.staged_intake_artifacts
   where inline_data is not null
     and created_at < v_cutoff;

  if not p_dry_run then
    update public.staged_intake_artifacts
       set inline_data = null
     where inline_data is not null
       and created_at < v_cutoff;
    get diagnostics v_cleared_count = row_count;
  end if;

  return jsonb_build_object(
    'cutoff', v_cutoff,
    'candidates', v_candidate_count,
    'cleared', v_cleared_count,
    'dry_run', p_dry_run,
    'inline_rows_remaining',
      (select count(*) from public.staged_intake_artifacts where inline_data is not null)
  );
end;
$$;

revoke all on function public.staged_intake_artifacts_prune(interval, boolean) from public;
grant execute on function public.staged_intake_artifacts_prune(interval, boolean) to service_role;

comment on function public.staged_intake_artifacts_prune(interval, boolean) is
  'Nulls staged_intake_artifacts.inline_data for rows older than p_age (default 7d). Keeps metadata + sha256. The extracted result lives in staged_intake_extractions, so raw bytes are transient. Prevents the table from growing the DB past its disk quota into read-only mode. Set p_dry_run=true to count without clearing.';

-- 03:50 UTC daily — low-traffic window, before cleanup-cron-history (04:00)
-- and well before the 10:00 UTC briefing-intel-snapshot job.
select cron.schedule(
  'lcc-staged-intake-artifacts-prune',
  '50 3 * * *',
  $$select public.staged_intake_artifacts_prune(interval '7 days')$$
);
