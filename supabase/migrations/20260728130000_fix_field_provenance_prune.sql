-- ============================================================================
-- 20260728130000_fix_field_provenance_prune.sql
-- OPS project — fix the nightly `field-provenance-prune` cron (jobid 23, "30 4 * * *"),
-- which had failed every night (statement timeout + FK violation). Applied live 2026-07-28.
--
-- Root causes:
--   1) self-FK field_provenance_superseded_by_id_fkey had NO index on superseded_by_id,
--      so the per-row FK check on a bulk DELETE scanned 1.6M rows -> 2min statement_timeout.
--   2) the single bulk DELETE could remove a row still referenced by a *kept* row's
--      superseded_by_id -> "violates foreign key constraint ... still referenced".
-- Fixes: (a) partial index on superseded_by_id; (b) batched + FK-safe + time-budgeted prune.
-- Post-apply: one run deleted 14,224 eligible rows, nulled 66 external refs, exited cleanly;
-- dry-run after = 0 candidates. Cron is caught up.
-- ============================================================================

-- (a) Index the self-FK column. Prod built this CONCURRENTLY (no write lock); plain form here
--     so the migration replays inside a transaction in fresh environments.
create index if not exists idx_field_prov_superseded_by
  on public.field_provenance (superseded_by_id)
  where superseded_by_id is not null;

-- (b) Batched, FK-safe, time-budgeted prune.
create or replace function public.field_provenance_prune(p_age interval default '90 days'::interval, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_cutoff          timestamptz := now() - p_age;
  v_batch           int := 5000;
  v_ids             bigint[];
  v_deleted_total   bigint := 0;
  v_nulled_total    bigint := 0;
  v_del             int;
  v_nul             int;
  v_iter            int := 0;
  v_start           timestamptz := clock_timestamp();
  v_budget          interval := interval '90 seconds';
  v_candidate_count bigint := null;
begin
  if p_dry_run then
    select count(*) into v_candidate_count
      from public.field_provenance fp
     where fp.decision in ('write','superseded') and fp.recorded_at < v_cutoff
       and exists (select 1 from public.field_provenance fp2
                    where fp2.target_database=fp.target_database and fp2.target_table=fp.target_table
                      and fp2.record_pk_value=fp.record_pk_value and fp2.field_name=fp.field_name
                      and fp2.decision='write' and fp2.recorded_at>fp.recorded_at);
    return jsonb_build_object('cutoff',v_cutoff,'candidates',v_candidate_count,'deleted',0,'dry_run',true,
                              'remaining_total',(select count(*) from public.field_provenance));
  end if;

  loop
    exit when clock_timestamp() - v_start > v_budget;
    v_iter := v_iter + 1;

    select array_agg(b.id) into v_ids
    from (
      select fp.id
        from public.field_provenance fp
       where fp.decision in ('write','superseded') and fp.recorded_at < v_cutoff
         and exists (select 1 from public.field_provenance fp2
                      where fp2.target_database=fp.target_database and fp2.target_table=fp.target_table
                        and fp2.record_pk_value=fp.record_pk_value and fp2.field_name=fp.field_name
                        and fp2.decision='write' and fp2.recorded_at>fp.recorded_at)
       limit v_batch
    ) b;

    exit when v_ids is null;

    update public.field_provenance
       set superseded_by_id = null
     where superseded_by_id = any(v_ids)
       and not (id = any(v_ids));
    get diagnostics v_nul = row_count;
    v_nulled_total := v_nulled_total + v_nul;

    delete from public.field_provenance where id = any(v_ids);
    get diagnostics v_del = row_count;
    v_deleted_total := v_deleted_total + v_del;

    exit when v_del = 0;
  end loop;

  return jsonb_build_object('cutoff',v_cutoff,'deleted',v_deleted_total,'refs_nulled',v_nulled_total,
                            'iterations',v_iter,'dry_run',false,
                            'time_budget_hit',(clock_timestamp()-v_start > v_budget),
                            'remaining_total',(select count(*) from public.field_provenance));
end;
$function$;
