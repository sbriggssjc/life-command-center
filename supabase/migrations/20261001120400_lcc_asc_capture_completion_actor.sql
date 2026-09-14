-- Preserve the analyst identity on the explicit multi-source capture advance.
alter table public.healthcare_research_candidates
  add column if not exists capture_completed_by uuid;

create or replace function public.lcc_complete_asc_candidate_capture(
  p_run_id uuid,
  p_candidate_fingerprint text,
  p_completed_by uuid default null
) returns table (candidate_fingerprint text, candidate_status text, capture_count integer)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.healthcare_research_captures c
  where c.run_id = p_run_id and c.candidate_fingerprint = p_candidate_fingerprint;
  if v_count = 0 then raise exception 'at least one evidence capture is required before advancing'; end if;

  update public.healthcare_research_candidates c
  set status = 'captured', captured_at = coalesce(c.captured_at, now()),
      capture_completed_by = p_completed_by
  where c.run_id = p_run_id and c.candidate_fingerprint = p_candidate_fingerprint
    and c.status = 'pending';
  if not found then raise exception 'pending frozen candidate not found'; end if;

  return query select p_candidate_fingerprint, 'captured'::text, v_count;
end;
$$;

revoke all on function public.lcc_complete_asc_candidate_capture(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.lcc_complete_asc_candidate_capture(uuid,text,uuid) to service_role;
notify pgrst, 'reload schema';
