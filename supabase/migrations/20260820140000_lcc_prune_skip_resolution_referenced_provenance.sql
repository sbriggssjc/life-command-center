-- ============================================================================
-- Repo mirror of the migration APPLIED LIVE to LCC Opps 2026-08-06 via Supabase
-- MCP (name: lcc_prune_skip_resolution_referenced_provenance) during the alert
-- triage sweep (AUDIT_REFRESH_2026-08-06 §3A; ROLLOUT_STATUS session 36g).
-- DO NOT re-apply blindly — already live; this file exists so the repo tracks
-- the function's current source of truth.
--
-- Root cause (alert 1028): the nightly field-provenance-prune cron failed with
-- FK 23503 — the prune deleted field_provenance rows still referenced by
-- field_provenance_resolutions.current_provenance_id. Same never-delete-
-- referenced hazard class as the TFC contacts bug (3rd instance). Fix: exclude
-- resolution-referenced ids from the candidate set (dry-run count AND batch
-- select). A resolution's current pointer keeps its provenance row alive; the
-- row prunes naturally once the resolution moves on. Verified clean post-apply:
-- 8,551 pruned, 0 errors.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.field_provenance_prune(p_age interval DEFAULT '90 days'::interval, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                      and fp2.decision='write' and fp2.recorded_at>fp.recorded_at)
       and not exists (select 1 from public.field_provenance_resolutions r
                        where r.current_provenance_id = fp.id);
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
         and not exists (select 1 from public.field_provenance_resolutions r
                          where r.current_provenance_id = fp.id)
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
