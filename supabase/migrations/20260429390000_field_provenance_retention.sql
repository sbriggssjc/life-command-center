-- field_provenance retention policy (2026-04-29).
--
-- The table is append-only. After 4 days of production it had 28144
-- rows / 17 MB at ~4270 rows/day → ~1.5M rows/year unbounded. Add a
-- nightly cron that prunes old, low-value rows while keeping
-- everything that's actively useful for audit:
--
--  - decision='write' / 'superseded' rows older than 90 days where a
--    NEWER write exists for the same (target_database, target_table,
--    record_pk_value, field_name). The latest write per key is the
--    only row v_field_provenance_current cares about; older write
--    rows are noise once they've been superseded.
--  - decision='write' / 'superseded' rows with no newer write (the
--    "current authoritative" row) are kept regardless of age — that
--    row is the answer to "who set this value?"
--  - decision IN ('skip','conflict') rows: kept forever. They're the
--    audit trail for warn/strict-mode enforcement events; small
--    absolute volume (~14% of writes today) and high diagnostic
--    value (you want to be able to trace "when did costar try to
--    overwrite this?" months later).
--
-- Schedule mirrors the existing cleanup-cron-history job (04:00 UTC)
-- so both run during a low-traffic window.

create or replace function public.field_provenance_prune(
  p_age interval default interval '90 days',
  p_dry_run boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate_count int;
  v_deleted_count   int := 0;
  v_cutoff          timestamptz := now() - p_age;
begin
  -- Identify rows safe to delete: write/superseded older than cutoff
  -- AND a newer write exists for the same key (so we're not pruning
  -- the current authoritative row).
  with candidates as (
    select fp.id
      from public.field_provenance fp
     where fp.decision in ('write', 'superseded')
       and fp.recorded_at < v_cutoff
       and exists (
         select 1 from public.field_provenance fp2
          where fp2.target_database = fp.target_database
            and fp2.target_table   = fp.target_table
            and fp2.record_pk_value = fp.record_pk_value
            and fp2.field_name     = fp.field_name
            and fp2.decision       = 'write'
            and fp2.recorded_at    > fp.recorded_at
       )
  )
  select count(*) into v_candidate_count from candidates;

  if not p_dry_run then
    delete from public.field_provenance
     where id in (
       select fp.id
         from public.field_provenance fp
        where fp.decision in ('write','superseded')
          and fp.recorded_at < v_cutoff
          and exists (
            select 1 from public.field_provenance fp2
             where fp2.target_database = fp.target_database
               and fp2.target_table   = fp.target_table
               and fp2.record_pk_value = fp.record_pk_value
               and fp2.field_name     = fp.field_name
               and fp2.decision       = 'write'
               and fp2.recorded_at    > fp.recorded_at
          )
     );
    get diagnostics v_deleted_count = row_count;
  end if;

  return jsonb_build_object(
    'cutoff', v_cutoff,
    'candidates', v_candidate_count,
    'deleted', v_deleted_count,
    'dry_run', p_dry_run,
    'remaining_total', (select count(*) from public.field_provenance)
  );
end;
$$;

revoke all on function public.field_provenance_prune(interval, boolean) from public;
grant execute on function public.field_provenance_prune(interval, boolean) to service_role;

comment on function public.field_provenance_prune(interval, boolean) is
  'Prunes field_provenance rows that are no longer authoritative. Keeps skip/conflict events forever (audit trail) and the latest write per key (current authoritative value). Returns a jsonb summary. Set p_dry_run=true to count without deleting.';

-- Schedule the cron. 04:30 UTC — between cleanup-cron-history (04:00)
-- and the start of the daily-briefing pipeline.
select cron.schedule(
  'field-provenance-prune',
  '30 4 * * *',
  $$select public.field_provenance_prune(interval '90 days')$$
);
