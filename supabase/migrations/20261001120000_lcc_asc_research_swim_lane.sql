-- Restricted ASC research swim lane for the one authorized frozen 50-property
-- sample. Research/evidence only: no canonical property, Salesforce, outreach,
-- opportunity, or IDTF writes.

create table if not exists public.healthcare_research_runs (
  run_id uuid primary key default gen_random_uuid(),
  workspace_id uuid,
  lane text not null default 'asc' check (lane = 'asc'),
  release_id text not null check (release_id ~ '^[a-f0-9]{64}$'),
  selection_fingerprint text not null check (selection_fingerprint ~ '^[a-f0-9]{64}$'),
  candidate_pool_fingerprint text not null check (candidate_pool_fingerprint ~ '^[a-f0-9]{64}$'),
  packet_id text,
  sample_size integer not null default 50 check (sample_size = 50),
  status text not null default 'active' check (status in ('active','capture_complete','review_complete','closed')),
  canonical_write_authorized boolean not null default false check (canonical_write_authorized = false),
  salesforce_write_authorized boolean not null default false check (salesforce_write_authorized = false),
  outreach_authorized boolean not null default false check (outreach_authorized = false),
  production_opportunity_authorized boolean not null default false check (production_opportunity_authorized = false),
  idtf_activated boolean not null default false check (idtf_activated = false),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (workspace_id, selection_fingerprint)
);

create table if not exists public.healthcare_research_candidates (
  run_id uuid not null references public.healthcare_research_runs(run_id) on delete cascade,
  candidate_fingerprint text not null check (candidate_fingerprint ~ '^[a-f0-9]{64}$'),
  sample_ordinal integer not null check (sample_ordinal between 1 and 50),
  sampling_cell text not null,
  cms_identity jsonb not null,
  cms_evidence jsonb not null default '{}'::jsonb,
  address_token text not null,
  status text not null default 'pending' check (status in ('pending','captured','reviewed','second_review','excluded')),
  captured_at timestamptz,
  capture_completed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (run_id, candidate_fingerprint),
  unique (run_id, sample_ordinal)
);

create table if not exists public.healthcare_research_captures (
  capture_id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  candidate_fingerprint text not null,
  source text not null check (source in ('costar','rca','public_records','salesforce')),
  source_url text,
  captured_at timestamptz not null,
  captured_by uuid,
  address text not null,
  city text,
  state text not null,
  zip text,
  address_token text not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  structured_payload jsonb not null,
  reconciliation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (run_id, candidate_fingerprint)
    references public.healthcare_research_candidates(run_id, candidate_fingerprint)
    on delete cascade,
  unique (run_id, candidate_fingerprint, source, payload_sha256)
);

create table if not exists public.healthcare_research_evidence (
  evidence_id bigint generated always as identity primary key,
  capture_id uuid not null references public.healthcare_research_captures(capture_id) on delete cascade,
  run_id uuid not null,
  candidate_fingerprint text not null,
  field_name text not null,
  asserted_value jsonb not null,
  source text not null check (source in ('costar','rca','public_records','salesforce')),
  source_url text,
  observed_at timestamptz not null,
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  foreign key (run_id, candidate_fingerprint)
    references public.healthcare_research_candidates(run_id, candidate_fingerprint)
    on delete cascade
);

create table if not exists public.healthcare_research_reviews (
  run_id uuid not null,
  candidate_fingerprint text not null,
  clinical_verified boolean,
  property_form text check (property_form is null or property_form in ('stnl','dominant_user','multi_tenant','campus','owner_occupied','other','unresolved')),
  landlord_owner text,
  ownership_evidence jsonb not null default '[]'::jsonb,
  landlord_addressable boolean,
  economics_bounded boolean,
  reviewer_confidence text check (reviewer_confidence is null or reviewer_confidence in ('high','medium','low')),
  second_review_required boolean not null default false,
  second_reviewer text,
  final_disposition text,
  research_minutes jsonb not null default '{}'::jsonb,
  evidence_citations jsonb not null default '[]'::jsonb,
  notes text,
  canonical_write_authorized boolean not null default false check (canonical_write_authorized = false),
  salesforce_write_authorized boolean not null default false check (salesforce_write_authorized = false),
  outreach_authorized boolean not null default false check (outreach_authorized = false),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (run_id, candidate_fingerprint),
  foreign key (run_id, candidate_fingerprint)
    references public.healthcare_research_candidates(run_id, candidate_fingerprint)
    on delete cascade
);

create index if not exists idx_healthcare_research_candidates_next
  on public.healthcare_research_candidates (run_id, status, sample_ordinal);
create index if not exists idx_healthcare_research_captures_candidate
  on public.healthcare_research_captures (run_id, candidate_fingerprint, captured_at desc);
create index if not exists idx_healthcare_research_evidence_candidate_field
  on public.healthcare_research_evidence (run_id, candidate_fingerprint, field_name, observed_at desc);
create index if not exists idx_healthcare_research_evidence_capture
  on public.healthcare_research_evidence (capture_id);

alter table public.healthcare_research_runs enable row level security;
alter table public.healthcare_research_candidates enable row level security;
alter table public.healthcare_research_captures enable row level security;
alter table public.healthcare_research_evidence enable row level security;
alter table public.healthcare_research_reviews enable row level security;

revoke all on public.healthcare_research_runs from public, anon, authenticated;
revoke all on public.healthcare_research_candidates from public, anon, authenticated;
revoke all on public.healthcare_research_captures from public, anon, authenticated;
revoke all on public.healthcare_research_evidence from public, anon, authenticated;
revoke all on public.healthcare_research_reviews from public, anon, authenticated;

revoke all on public.healthcare_research_runs from service_role;
revoke all on public.healthcare_research_candidates from service_role;
revoke all on public.healthcare_research_captures from service_role;
revoke all on public.healthcare_research_evidence from service_role;
revoke all on public.healthcare_research_reviews from service_role;

grant select, insert, update on public.healthcare_research_runs to service_role;
grant select, insert, update on public.healthcare_research_candidates to service_role;
grant select, insert on public.healthcare_research_captures to service_role;
grant select, insert on public.healthcare_research_evidence to service_role;
grant select, insert, update on public.healthcare_research_reviews to service_role;
grant usage, select on sequence public.healthcare_research_evidence_evidence_id_seq to service_role;

create or replace function public.lcc_import_asc_research_run(
  p_workspace_id uuid,
  p_release_id text,
  p_selection_fingerprint text,
  p_candidate_pool_fingerprint text,
  p_packet_id text,
  p_candidates jsonb,
  p_created_by uuid default null
) returns table (run_id uuid, candidate_count integer, status text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_run_id uuid;
  v_count integer;
  v_unique integer;
begin
  if jsonb_typeof(p_candidates) <> 'array' then raise exception 'candidates must be an array'; end if;
  v_count := jsonb_array_length(p_candidates);
  if v_count <> 50 then raise exception 'authorized ASC research run requires exactly 50 candidates'; end if;
  select count(distinct x->>'candidate_fingerprint') into v_unique from jsonb_array_elements(p_candidates) x;
  if v_unique <> 50 then raise exception 'candidate fingerprints must be unique'; end if;

  insert into public.healthcare_research_runs (
    workspace_id, release_id, selection_fingerprint, candidate_pool_fingerprint,
    packet_id, sample_size, created_by
  ) values (
    p_workspace_id, p_release_id, p_selection_fingerprint, p_candidate_pool_fingerprint,
    nullif(p_packet_id,''), 50, p_created_by
  ) returning healthcare_research_runs.run_id into v_run_id;

  insert into public.healthcare_research_candidates (
    run_id, candidate_fingerprint, sample_ordinal, sampling_cell,
    cms_identity, cms_evidence, address_token
  )
  select v_run_id, x->>'candidate_fingerprint', (x->>'sample_ordinal')::integer,
    x->>'sampling_cell', x->'cms_identity', coalesce(x->'cms_evidence','{}'::jsonb),
    x->>'address_token'
  from jsonb_array_elements(p_candidates) x;

  return query select v_run_id, 50, 'active'::text;
end;
$$;

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
    and r.lane = 'asc' and r.status = 'active';
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

revoke all on function public.lcc_import_asc_research_run(uuid,text,text,text,text,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.lcc_capture_asc_research_evidence(uuid,text,jsonb,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.lcc_complete_asc_candidate_capture(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.lcc_import_asc_research_run(uuid,text,text,text,text,jsonb,uuid) to service_role;
grant execute on function public.lcc_capture_asc_research_evidence(uuid,text,jsonb,jsonb,uuid) to service_role;
grant execute on function public.lcc_complete_asc_candidate_capture(uuid,text,uuid) to service_role;

comment on table public.healthcare_research_runs is 'Restricted ASC frozen-sample research runs. Every production/CRM/outreach authorization flag is DB-enforced false.';
comment on table public.healthcare_research_evidence is 'Append-only structured evidence captured from authenticated analyst sessions; never canonical property truth.';
notify pgrst, 'reload schema';
