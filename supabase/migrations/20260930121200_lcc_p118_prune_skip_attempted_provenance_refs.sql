-- ============================================================================
-- P118 (a) — field_provenance_prune: guard BOTH resolution FK columns.
--
-- Symptom (LCC Opps, cron `field-provenance-prune`, 2026-08-20 04:30Z):
--   ERROR: update or delete on table "field_provenance" violates foreign key
--   constraint "field_provenance_resolutions_attempted_provenance_id_fkey"
--   DETAIL: Key (id)=(187741) is still referenced from field_provenance_resolutions.
--
-- Root cause: `field_provenance_resolutions` references `field_provenance`
-- through TWO FK columns --
--     field_provenance_resolutions_current_provenance_id_fkey
--     field_provenance_resolutions_attempted_provenance_id_fkey
-- The 2026-08-06 fix (20260820140000) added a candidate guard for
-- `current_provenance_id` ONLY. A provenance row referenced solely via
-- `attempted_provenance_id` (id 187741 and its cohort) therefore passed the
-- guard, and the batch DELETE aborted on the FK.
--
-- Because the delete is `where id = any(v_ids)` over a 5,000-id batch, ONE
-- referenced id fails the ENTIRE batch -- so the prune deleted nothing at all
-- and `field_provenance` (1.66M rows) grew unbounded. That matters beyond the
-- cron alert: LCC Opps hosts auth (GoTrue), and a full disk there forces the DB
-- read-only = total sign-in lockout (CLAUDE.md footgun).
--
-- Fix: exclude a candidate referenced by EITHER column, in BOTH the dry-run
-- count block and the delete loop's candidate CTE. Kept as two separate
-- NOT EXISTS clauses (rather than one OR'd subquery) so each can use its own
-- index as `field_provenance_resolutions` grows.
--
-- Deliberately NOT done: nulling `attempted_provenance_id` to make those rows
-- prunable (the way `superseded_by_id` is reset). `attempted_provenance_id` is
-- the audit record of what a resolution TRIED to write; blanking it to win back
-- 3 rows would destroy provenance to save nothing. Conservative skip -- the row
-- prunes naturally once the resolution that points at it is gone.
--
-- Discipline: idempotent (CREATE OR REPLACE) - additive guard only, never
-- widens what is deleted - no data mutated by this migration itself.
-- REVERSAL: re-apply 20260820140000_lcc_prune_skip_resolution_referenced_provenance.sql.
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
                        where r.current_provenance_id = fp.id)
       -- P118: the second FK column -- a resolution's ATTEMPTED pointer keeps
       -- its provenance row alive exactly as its CURRENT pointer does.
       and not exists (select 1 from public.field_provenance_resolutions r
                        where r.attempted_provenance_id = fp.id);
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
         -- P118: see above.
         and not exists (select 1 from public.field_provenance_resolutions r
                          where r.attempted_provenance_id = fp.id)
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
