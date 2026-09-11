-- Advance an ASC candidate whose licensed-source observation is useful only at
-- the parcel/recorded-owner level. The adjacent CoStar building is deliberately
-- not captured; the disposition remains mandatory-second-review evidence.

create or replace function public.lcc_complete_asc_candidate_parcel_evidence(
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
  v_alias jsonb;
  v_alias_count integer;
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

  select count(*), min(a.value::text)::jsonb
  into v_alias_count, v_alias
  from public.healthcare_research_candidates c
  cross join lateral jsonb_array_elements(
    coalesce(c.cms_evidence->'approved_same_parcel_address_conflicts', '[]'::jsonb)
  ) a
  where c.run_id = p_run_id
    and c.candidate_fingerprint = p_candidate_fingerprint
    and a.value->>'status' = 'approved'
    and a.value->>'reason_code' =
      'service_location_multi_address_same_parcel_recorded_owner_identity'
    and a.value->>'frozen_address_token' = c.address_token
    and a.value->>'assessor_address_token' = c.address_token
    and nullif(a.value->>'captured_address_token', '') is not null
    and a.value->>'captured_address_token' <> c.address_token
    and nullif(a.value->>'owner_mailing_address_token', '') is not null
    and a.value->>'owner_mailing_address_token' <> c.address_token
    and a.value->>'owner_mailing_address_token' <> a.value->>'captured_address_token'
    and nullif(a.value->>'costar_property_id', '') is not null
    and nullif(a.value->>'parcel_number', '') is not null
    and a.value->>'capture_authorized' = 'false'
    and a.value->>'candidate_completion_authorized' = 'false'
    and a.value->>'second_review_required' = 'true'
    and regexp_replace(upper(a.value->>'recorded_owner_name'), '[^A-Z0-9]+', '', 'g')
      = regexp_replace(upper(c.cms_identity->>'facility_name'), '[^A-Z0-9]+', '', 'g')
    and exists (
      select 1
      from jsonb_array_elements_text(coalesce(c.cms_evidence->'enrollment_org_names', '[]'::jsonb)) n
      where regexp_replace(upper(n.value), '[^A-Z0-9]+', '', 'g')
        = regexp_replace(upper(a.value->>'recorded_owner_name'), '[^A-Z0-9]+', '', 'g')
    )
    and exists (
      select 1 from jsonb_array_elements(coalesce(a.value->'evidence_citations', '[]'::jsonb)) e
      where e.value->>'source' = 'official_facility_registry'
        and e.value->>'url' ~ '^https://'
    )
    and exists (
      select 1 from jsonb_array_elements(coalesce(a.value->'evidence_citations', '[]'::jsonb)) e
      where e.value->>'source' = 'licensed_property_public_record'
        and e.value->>'url' ~ '^https://'
    );
  if v_alias_count <> 1 then
    raise exception 'exactly one approved parcel-owner evidence alias is required';
  end if;

  select count(*) into v_capture_count
  from public.healthcare_research_captures c
  where c.run_id = p_run_id
    and c.candidate_fingerprint = p_candidate_fingerprint;
  if v_capture_count <> 0 then
    raise exception 'parcel-evidence-only completion requires zero captures';
  end if;

  insert into public.healthcare_research_reviews (
    run_id, candidate_fingerprint, property_form, reviewer_confidence,
    second_review_required, final_disposition, evidence_citations, notes,
    updated_by, updated_at
  ) values (
    p_run_id, p_candidate_fingerprint, 'unresolved', 'medium',
    true, 'parcel_owner_evidence_only',
    v_alias->'evidence_citations',
    'Approved same-parcel recorded-owner evidence preserved; adjacent licensed-source building was not captured.',
    p_completed_by, v_observed_at
  )
  on conflict (run_id, candidate_fingerprint) do update set
    property_form = 'unresolved',
    reviewer_confidence = 'medium',
    second_review_required = true,
    final_disposition = 'parcel_owner_evidence_only',
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
    'parcel_owner_evidence_only'::text;
end;
$$;

revoke all on function public.lcc_complete_asc_candidate_parcel_evidence(uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function public.lcc_complete_asc_candidate_parcel_evidence(uuid,text,uuid)
  to service_role;

notify pgrst, 'reload schema';
