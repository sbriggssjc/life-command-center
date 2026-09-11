-- Advance an ASC candidate supported by exact-situs parcel evidence when the
-- open licensed-source property is an adjacent context record only. No
-- licensed-source property capture or canonical/CRM write is performed.

create or replace function public.lcc_complete_asc_candidate_parcel_situs_evidence(
  p_run_id uuid,
  p_candidate_fingerprint text,
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
  v_evidence jsonb;
  v_evidence_count integer;
begin
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

  select count(*), min(e.value::text)::jsonb
  into v_evidence_count, v_evidence
  from public.healthcare_research_candidates c
  cross join lateral jsonb_array_elements(
    coalesce(c.cms_evidence->'approved_parcel_situs_evidence', '[]'::jsonb)
  ) e
  where c.run_id = p_run_id
    and c.candidate_fingerprint = p_candidate_fingerprint
    and e.value->>'status' = 'approved'
    and e.value->>'reason_code' =
      'service_location_exact_parcel_situs_adjacent_context_record'
    and e.value->>'frozen_address_token' = c.address_token
    and e.value->>'parcel_situs_address_token' = c.address_token
    and nullif(e.value->>'context_property_address_token', '') is not null
    and e.value->>'context_property_address_token' <> c.address_token
    and nullif(e.value->>'context_costar_property_id', '') is not null
    and nullif(e.value->>'parcel_number', '') is not null
    and nullif(e.value->>'context_parcel_number', '') is not null
    and regexp_replace(upper(e.value->>'context_parcel_number'), '[^A-Z0-9]+', '', 'g')
      <> regexp_replace(upper(e.value->>'parcel_number'), '[^A-Z0-9]+', '', 'g')
    and nullif(e.value->>'recorded_owner_name', '') is not null
    and nullif(e.value->>'owner_mailing_address', '') is not null
    and e.value->>'adjacent_context_only' = 'true'
    and e.value->>'capture_authorized' = 'false'
    and e.value->>'candidate_completion_authorized' = 'false'
    and e.value->>'second_review_required' = 'true'
    and exists (
      select 1 from jsonb_array_elements(coalesce(e.value->'evidence_citations', '[]'::jsonb)) x
      where x.value->>'source' = 'official_facility_registry'
        and x.value->>'url' ~ '^https://'
    )
    and exists (
      select 1 from jsonb_array_elements(coalesce(e.value->'evidence_citations', '[]'::jsonb)) x
      where x.value->>'source' = 'licensed_property_public_record'
        and x.value->>'url' ~ '^https://'
    );
  if v_evidence_count <> 1 then
    raise exception 'exactly one approved parcel-situs evidence entry is required';
  end if;

  select count(*) into v_capture_count
  from public.healthcare_research_captures c
  where c.run_id = p_run_id
    and c.candidate_fingerprint = p_candidate_fingerprint;
  if v_capture_count <> 0 then
    raise exception 'parcel-situs-evidence-only completion requires zero captures';
  end if;

  insert into public.healthcare_research_reviews (
    run_id, candidate_fingerprint, property_form, reviewer_confidence,
    second_review_required, final_disposition, evidence_citations, notes,
    updated_by, updated_at
  ) values (
    p_run_id, p_candidate_fingerprint, 'unresolved', 'medium',
    true, 'parcel_situs_evidence_only',
    v_evidence->'evidence_citations',
    'Approved exact-situs parcel evidence preserved; adjacent licensed-source property was context only and was not captured.',
    p_completed_by, v_observed_at
  )
  on conflict on constraint healthcare_research_reviews_pkey do update set
    property_form = 'unresolved',
    reviewer_confidence = 'medium',
    second_review_required = true,
    final_disposition = 'parcel_situs_evidence_only',
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
    'parcel_situs_evidence_only'::text;
end;
$$;

revoke all on function public.lcc_complete_asc_candidate_parcel_situs_evidence(uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function public.lcc_complete_asc_candidate_parcel_situs_evidence(uuid,text,uuid)
  to service_role;

notify pgrst, 'reload schema';
