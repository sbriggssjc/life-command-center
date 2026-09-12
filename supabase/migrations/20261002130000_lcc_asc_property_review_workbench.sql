-- Governed ASC row-level review boundary. Reconciles the persisted scorecard
-- vocabulary with healthcare_property_review:1.0 and preserves independent
-- second-review identity/disagreement. No canonical, CRM, outreach, or IDTF write.

alter table public.healthcare_research_reviews
  drop constraint if exists healthcare_research_reviews_property_form_check;

update public.healthcare_research_reviews
set property_form = case property_form
  when 'multi_tenant' then 'minority_mob'
  when 'owner_occupied' then 'operator_owned'
  when 'unresolved' then 'unknown'
  when 'other' then 'unknown'
  else property_form
end
where property_form in ('multi_tenant','owner_occupied','unresolved','other');

alter table public.healthcare_research_reviews
  add constraint healthcare_research_reviews_property_form_check
  check (property_form is null or property_form in
    ('stnl','dominant_user','minority_mob','campus','operator_owned','unknown','unresolved')),
  add column if not exists primary_reviewer uuid,
  add column if not exists primary_reviewed_at timestamptz,
  add column if not exists second_reviewed_at timestamptz,
  add column if not exists second_review_verdict text
    check (second_review_verdict is null or second_review_verdict in ('agree','disagree')),
  add column if not exists second_review_notes text;

create or replace function public.lcc_save_asc_primary_review(
  p_run_id uuid,
  p_candidate_fingerprint text,
  p_reviewer uuid,
  p_review jsonb
) returns setof public.healthcare_research_reviews
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_required boolean;
  v_capture_required boolean := false;
begin
  if p_reviewer is null then raise exception 'authenticated primary reviewer required'; end if;
  if not exists (
    select 1 from public.healthcare_research_candidates c
    where c.run_id = p_run_id and c.candidate_fingerprint = p_candidate_fingerprint
      and c.status in ('captured','reviewed','second_review')
  ) then raise exception 'candidate is not ready for property review'; end if;

  select coalesce((c.reconciliation #>> '{asc_identity_match,second_review_required}')::boolean, false)
  into v_capture_required
  from public.healthcare_research_captures c
  where c.run_id = p_run_id and c.candidate_fingerprint = p_candidate_fingerprint
  order by c.captured_at desc
  limit 1;
  v_capture_required := coalesce(v_capture_required, false);

  select coalesce(r.second_review_required, false)
    or v_capture_required
    or coalesce((p_review->>'second_review_required')::boolean, false)
    or p_review->>'property_form' = 'unknown'
    or p_review->>'reviewer_confidence' = 'low'
  into v_required
  from (select 1) seed
  left join public.healthcare_research_reviews r
    on r.run_id = p_run_id and r.candidate_fingerprint = p_candidate_fingerprint;

  insert into public.healthcare_research_reviews (
    run_id, candidate_fingerprint, clinical_verified, property_form, landlord_owner,
    ownership_evidence, landlord_addressable, economics_bounded, reviewer_confidence,
    second_review_required, research_minutes, evidence_citations, notes,
    primary_reviewer, primary_reviewed_at, updated_by, updated_at
  ) values (
    p_run_id, p_candidate_fingerprint, (p_review->>'clinical_verified')::boolean,
    p_review->>'property_form', nullif(p_review->>'landlord_owner',''),
    coalesce(p_review->'ownership_evidence','[]'::jsonb),
    (p_review->>'landlord_addressable')::boolean, (p_review->>'economics_bounded')::boolean,
    p_review->>'reviewer_confidence', v_required,
    coalesce(p_review->'research_minutes','{}'::jsonb),
    coalesce(p_review->'evidence_citations','[]'::jsonb), nullif(p_review->>'notes',''),
    p_reviewer, now(), p_reviewer, now()
  )
  on conflict on constraint healthcare_research_reviews_pkey do update set
    clinical_verified = excluded.clinical_verified,
    property_form = excluded.property_form,
    landlord_owner = excluded.landlord_owner,
    ownership_evidence = excluded.ownership_evidence,
    landlord_addressable = excluded.landlord_addressable,
    economics_bounded = excluded.economics_bounded,
    reviewer_confidence = excluded.reviewer_confidence,
    second_review_required = healthcare_research_reviews.second_review_required or excluded.second_review_required,
    research_minutes = excluded.research_minutes,
    evidence_citations = excluded.evidence_citations,
    notes = excluded.notes,
    primary_reviewer = excluded.primary_reviewer,
    primary_reviewed_at = excluded.primary_reviewed_at,
    second_reviewer = null,
    second_reviewed_at = null,
    second_review_verdict = null,
    second_review_notes = null,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  update public.healthcare_research_candidates
  set status = case when v_required then 'second_review' else 'reviewed' end,
      reviewed_at = now()
  where run_id = p_run_id and candidate_fingerprint = p_candidate_fingerprint;

  return query select * from public.healthcare_research_reviews r
    where r.run_id = p_run_id and r.candidate_fingerprint = p_candidate_fingerprint;
end;
$$;

create or replace function public.lcc_save_asc_second_review(
  p_run_id uuid,
  p_candidate_fingerprint text,
  p_reviewer uuid,
  p_verdict text,
  p_notes text default null
) returns setof public.healthcare_research_reviews
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare v_primary uuid;
begin
  if p_reviewer is null then raise exception 'authenticated second reviewer required'; end if;
  if p_verdict not in ('agree','disagree') then raise exception 'invalid second-review verdict'; end if;
  select primary_reviewer into v_primary from public.healthcare_research_reviews
    where run_id = p_run_id and candidate_fingerprint = p_candidate_fingerprint
      and primary_reviewed_at is not null and second_review_required = true;
  if v_primary is null then raise exception 'completed primary review requiring second review not found'; end if;
  if v_primary = p_reviewer then raise exception 'second reviewer must differ from primary reviewer'; end if;

  update public.healthcare_research_reviews
  set second_reviewer = p_reviewer::text, second_reviewed_at = now(),
      second_review_verdict = p_verdict, second_review_notes = nullif(trim(p_notes),''),
      updated_by = p_reviewer, updated_at = now()
  where run_id = p_run_id and candidate_fingerprint = p_candidate_fingerprint;

  update public.healthcare_research_candidates
  set status = case when p_verdict = 'agree' then 'reviewed' else 'second_review' end
  where run_id = p_run_id and candidate_fingerprint = p_candidate_fingerprint;

  return query select * from public.healthcare_research_reviews r
    where r.run_id = p_run_id and r.candidate_fingerprint = p_candidate_fingerprint;
end;
$$;

revoke all on function public.lcc_save_asc_primary_review(uuid,text,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.lcc_save_asc_second_review(uuid,text,uuid,text,text) from public, anon, authenticated;
grant execute on function public.lcc_save_asc_primary_review(uuid,text,uuid,jsonb) to service_role;
grant execute on function public.lcc_save_asc_second_review(uuid,text,uuid,text,text) to service_role;
