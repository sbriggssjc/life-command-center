-- Avoid PL/pgSQL ambiguity between the table-return field named
-- candidate_fingerprint and the review table's primary-key column.

create or replace function public.lcc_complete_asc_candidate_missingness(
  p_run_id uuid,
  p_candidate_fingerprint text,
  p_source_dispositions jsonb,
  p_completed_by uuid default null
) returns table (
  candidate_fingerprint text,
  candidate_status text,
  capture_count integer,
  final_disposition text
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_capture_count integer;
  v_observed_at timestamptz := clock_timestamp();
begin
  if p_source_dispositions is distinct from
    '{"costar":"not_found","rca":"not_found"}'::jsonb then
    raise exception 'exact CoStar and RCA not-found attestations are required';
  end if;

  perform 1
  from public.healthcare_research_candidates c
  join public.healthcare_research_runs r on r.run_id = c.run_id
  where c.run_id = p_run_id
    and c.candidate_fingerprint = p_candidate_fingerprint
    and c.status = 'pending'
    and r.lane = 'asc'
    and r.status = 'active'
  for update of c;
  if not found then raise exception 'pending frozen ASC candidate not found'; end if;

  select count(*) into v_capture_count
  from public.healthcare_research_captures c
  where c.run_id = p_run_id
    and c.candidate_fingerprint = p_candidate_fingerprint;
  if v_capture_count <> 0 then
    raise exception 'captured candidates must use normal evidence completion';
  end if;

  insert into public.healthcare_research_reviews (
    run_id, candidate_fingerprint, property_form, reviewer_confidence,
    second_review_required, final_disposition, evidence_citations, notes,
    updated_by, updated_at
  ) values (
    p_run_id, p_candidate_fingerprint, 'unresolved', 'low',
    true, 'licensed_sources_not_found',
    jsonb_build_array(
      jsonb_build_object('source','costar','disposition','not_found','method','manual_exact_property_search','observed_at',v_observed_at),
      jsonb_build_object('source','rca','disposition','not_found','method','manual_exact_property_search','observed_at',v_observed_at)
    ),
    'Exact frozen candidate was not found in CoStar or RCA; no property evidence was captured.',
    p_completed_by, v_observed_at
  )
  on conflict on constraint healthcare_research_reviews_pkey do update set
    property_form = 'unresolved',
    reviewer_confidence = 'low',
    second_review_required = true,
    final_disposition = 'licensed_sources_not_found',
    evidence_citations = excluded.evidence_citations,
    notes = excluded.notes,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  update public.healthcare_research_candidates c
  set status = 'reviewed', reviewed_at = coalesce(c.reviewed_at, v_observed_at)
  where c.run_id = p_run_id
    and c.candidate_fingerprint = p_candidate_fingerprint
    and c.status = 'pending';
  if not found then raise exception 'pending frozen ASC candidate not found'; end if;

  return query select p_candidate_fingerprint, 'reviewed'::text, 0,
    'licensed_sources_not_found'::text;
end;
$$;

revoke all on function public.lcc_complete_asc_candidate_missingness(uuid,text,jsonb,uuid)
  from public, anon, authenticated;
grant execute on function public.lcc_complete_asc_candidate_missingness(uuid,text,jsonb,uuid)
  to service_role;

notify pgrst, 'reload schema';
