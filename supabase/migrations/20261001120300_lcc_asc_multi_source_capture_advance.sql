-- Keep one frozen candidate active across CoStar, RCA, public-record, and
-- Salesforce read-only captures. Advance only after the analyst explicitly
-- completes evidence collection for that property.

create or replace function public.lcc_capture_asc_research_evidence(
  p_run_id uuid,
  p_candidate_fingerprint text,
  p_capture jsonb,
  p_evidence jsonb,
  p_captured_by uuid default null
) returns table (capture_id uuid, evidence_count integer, candidate_status text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_expected_token text;
  v_capture_id uuid;
  v_evidence_count integer;
begin
  if jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then
    raise exception 'structured evidence array is required';
  end if;
  select c.address_token into v_expected_token
  from public.healthcare_research_candidates c
  join public.healthcare_research_runs r on r.run_id = c.run_id
  where c.run_id = p_run_id and c.candidate_fingerprint = p_candidate_fingerprint
    and c.status = 'pending' and r.lane = 'asc' and r.status = 'active';
  if v_expected_token is null then raise exception 'active frozen candidate not found'; end if;
  if p_capture->>'address_token' is distinct from v_expected_token then
    raise exception 'capture address does not match frozen candidate';
  end if;

  insert into public.healthcare_research_captures (
    run_id, candidate_fingerprint, source, source_url, captured_at, captured_by,
    address, city, state, zip, address_token, payload_sha256,
    structured_payload, reconciliation
  ) values (
    p_run_id, p_candidate_fingerprint, p_capture->>'source', p_capture->>'source_url',
    (p_capture->>'captured_at')::timestamptz, p_captured_by, p_capture->>'address',
    p_capture->>'city', p_capture->>'state', p_capture->>'zip', p_capture->>'address_token',
    p_capture->>'payload_sha256', p_capture->'structured_payload',
    coalesce(p_capture->'reconciliation','{}'::jsonb)
  )
  on conflict (run_id, candidate_fingerprint, source, payload_sha256)
  do update set source_url = excluded.source_url
  returning healthcare_research_captures.capture_id into v_capture_id;

  insert into public.healthcare_research_evidence (
    capture_id, run_id, candidate_fingerprint, field_name, asserted_value,
    source, source_url, observed_at, confidence
  )
  select v_capture_id, p_run_id, p_candidate_fingerprint, x->>'field_name',
    x->'asserted_value', x->>'source', x->>'source_url',
    (x->>'observed_at')::timestamptz, (x->>'confidence')::numeric
  from jsonb_array_elements(p_evidence) x
  where not exists (
    select 1 from public.healthcare_research_evidence e
    where e.capture_id = v_capture_id and e.field_name = x->>'field_name'
  );
  get diagnostics v_evidence_count = row_count;
  return query select v_capture_id, v_evidence_count, 'pending'::text;
end;
$$;

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

revoke all on function public.lcc_capture_asc_research_evidence(uuid,text,jsonb,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.lcc_complete_asc_candidate_capture(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.lcc_capture_asc_research_evidence(uuid,text,jsonb,jsonb,uuid) to service_role;
grant execute on function public.lcc_complete_asc_candidate_capture(uuid,text,uuid) to service_role;
notify pgrst, 'reload schema';
