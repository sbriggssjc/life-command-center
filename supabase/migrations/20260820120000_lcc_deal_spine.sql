-- ===========================================================================
-- Deal-spine data model (prompt 06) — the missing structures the living deal
-- dossier needs, all keyed to the deal/asset entity (entities.id, bridged from
-- the domain property via external_identities (dia|gov, asset, property_id)).
--
-- Reuses what already exists:
--   • bd_opportunities        → the deal container + SF Opportunity mirror
--   • entity_relationships    → the party graph AND the role-history store
--                               (effective_from / effective_to + metadata->>'role')
--   • activity_events         → correspondence (dated, directional)
--   • party_extract_*         → sales-field disagreement handling
--
-- Adds (idempotent, additive, reversible — DROP the tables to revert):
--   • lcc_deal_commission            — deal-level commission / ELA terms + stage
--   • lcc_deal_milestone             — chronological transaction milestones
--   • lcc_deal_diligence             — third-party diligence vendor tracker
--   • lcc_deal_correspondence_summary— rolling per-deal summary (living, decays)
--   • lcc_deal_document              — deal-room / SF / Sharefile docs, reconciled
--   • lcc_deal_conflict              — surfaced (never auto-resolved) reconciliations
--   • lcc_deal_spine(entity)         — one-call read model for buildDealPacket
--   • lcc_deal_parties(entity)       — party graph w/ side + role + effective date
--   • v_lcc_deal_correspondence_summary_current — latest summary per deal
--
-- Discipline: no fabrication (absent → the packet omits it → renderer prints
-- "Not on file"); every writer carries a `source`; our systems (sf/outlook/
-- sharefile) are authoritative for parties/commission/narrative, costar is a
-- fallback that must not overwrite a sourced party (enforced in the assembly
-- layer, not here). APPLIED LIVE to LCC Opps (xengecqvemvfknjvbvrq).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Commission / ELA
-- ---------------------------------------------------------------------------
create table if not exists public.lcc_deal_commission (
  id             uuid primary key default gen_random_uuid(),
  entity_id      uuid not null,                    -- deal/asset entity
  stage_basis    text,                             -- 'bov_proposed'|'ela_negotiated'|'ela_executed'|'loi'|'closed'
  direct_pct     numeric,                          -- our direct rate (decimal, 0.02 = 2%)
  co_broker_pct  numeric,                          -- co-broker rate (decimal)
  co_broker_split numeric,                         -- our share of a shared fee (decimal)
  structure      text,                             -- 'direct'|'co_broker'|'referral'|free text
  fee_amount     numeric,                          -- computed/known fee on the transaction
  executed_date  date,
  source         text not null default 'unknown',  -- 'sf'|'sharefile'|'ela'|'manual'|...
  source_doc     text,                             -- storage_ref / SF field / doc name
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists uq_lcc_deal_commission_entity_stage
  on public.lcc_deal_commission (entity_id, coalesce(stage_basis,''));
create index if not exists lcc_deal_commission_entity_idx
  on public.lcc_deal_commission (entity_id);

-- ---------------------------------------------------------------------------
-- 2. Milestones — the compressing transaction timeline
-- ---------------------------------------------------------------------------
create table if not exists public.lcc_deal_milestone (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null,
  milestone_key text not null,                     -- prospecting|bov|ela|marketing|offers|loi|psa|escrow|diligence|close
  occurred_on   date,
  status        text not null default 'past' check (status in ('past','now','next')),
  summary       text,
  source        text not null default 'unknown',
  detail_ref    text,                              -- activity_events id / doc ref for double-click
  sort_order    int,                               -- canonical stage order; NULL → by date
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- one row per (deal, milestone_key, occurred_on) — re-emitting the same signal is a no-op
create unique index if not exists uq_lcc_deal_milestone
  on public.lcc_deal_milestone (entity_id, milestone_key, coalesce(occurred_on,'0001-01-01'::date));
create index if not exists lcc_deal_milestone_entity_idx
  on public.lcc_deal_milestone (entity_id, occurred_on);

-- ---------------------------------------------------------------------------
-- 3. Diligence vendors
-- ---------------------------------------------------------------------------
create table if not exists public.lcc_deal_diligence (
  id              uuid primary key default gen_random_uuid(),
  entity_id       uuid not null,
  vendor          text,
  vendor_type     text check (vendor_type in ('survey','pca','phase_i','appraisal','title','environmental','zoning','other')),
  ordered_date    date,
  site_visit_date date,
  report_eta      date,
  completed_date  date,
  lender_required boolean not null default false,
  source          text not null default 'unknown',
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists uq_lcc_deal_diligence
  on public.lcc_deal_diligence (entity_id, coalesce(vendor,''), coalesce(vendor_type,''));
create index if not exists lcc_deal_diligence_entity_idx
  on public.lcc_deal_diligence (entity_id);

-- ---------------------------------------------------------------------------
-- 4. Correspondence summary — rolling, living, decays; keeps history
-- ---------------------------------------------------------------------------
create table if not exists public.lcc_deal_correspondence_summary (
  id                 uuid primary key default gen_random_uuid(),
  entity_id          uuid not null,
  summary            text,                          -- living rollup ("older topics decayed")
  topics             jsonb not null default '[]'::jsonb,
  thread_count       int,
  latest_activity_at timestamptz,
  source             text not null default 'activity_events',  -- 'outlook'|'ollama'|'activity_events'
  source_activity_ids jsonb not null default '[]'::jsonb,       -- for double-click detail
  is_current         boolean not null default true,
  generated_at       timestamptz not null default now(),
  metadata           jsonb not null default '{}'::jsonb
);
create index if not exists lcc_deal_corr_summary_entity_idx
  on public.lcc_deal_correspondence_summary (entity_id, generated_at desc);

-- Latest summary per deal — what the packet reads.
create or replace view public.v_lcc_deal_correspondence_summary_current as
  select distinct on (entity_id)
    entity_id, summary, topics, thread_count, latest_activity_at, source,
    source_activity_ids, generated_at
  from public.lcc_deal_correspondence_summary
  where is_current
  order by entity_id, generated_at desc;

-- ---------------------------------------------------------------------------
-- 5. Documents — deal-room / SF / Sharefile, with reconciled status
-- ---------------------------------------------------------------------------
create table if not exists public.lcc_deal_document (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid not null,
  doc_type    text,                                -- OM|BOV|ELA|LOI|PSA|roster|report|other
  name        text,
  doc_date    date,
  source      text not null default 'unknown',     -- sharefile|sf|folder_feed|intake|manual
  storage_ref text,                                -- server-relative path / bucket ref
  reconciled  boolean not null default false,      -- matched to a known milestone/party
  detail_ref  text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists uq_lcc_deal_document
  on public.lcc_deal_document (entity_id, coalesce(storage_ref, name, id::text));
create index if not exists lcc_deal_document_entity_idx
  on public.lcc_deal_document (entity_id);

-- ---------------------------------------------------------------------------
-- 6. Conflicts — surfaced, never auto-resolved (the reconciliation discipline).
--    e.g. CoStar attributes listing_broker=CBRE while our systems say sell-side.
-- ---------------------------------------------------------------------------
create table if not exists public.lcc_deal_conflict (
  id           uuid primary key default gen_random_uuid(),
  entity_id    uuid not null,
  field        text not null,                      -- 'listing_broker'|'cap_rate'|'seller'|...
  values       jsonb not null default '[]'::jsonb, -- [{v, source}, ...]
  reconciled   jsonb,                              -- {v, source} once a human/authority decides; NULL = open
  note         text,
  status       text not null default 'open' check (status in ('open','resolved','dismissed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists uq_lcc_deal_conflict
  on public.lcc_deal_conflict (entity_id, field);
create index if not exists lcc_deal_conflict_entity_idx
  on public.lcc_deal_conflict (entity_id, status);

-- ---------------------------------------------------------------------------
-- 7. lcc_deal_parties(entity) — party graph w/ side + role + effective date.
--    Reads entity_relationships as the role-history store (from=party → to=deal).
-- ---------------------------------------------------------------------------
create or replace function public.lcc_deal_parties(p_entity uuid, p_limit int default 60)
 returns table (
   party_entity_id uuid,
   name            text,
   entity_type     text,
   relationship    text,
   side            text,
   role            text,
   effective_from  date,
   effective_to    date,
   is_current      boolean,
   source          text
 )
 language sql stable security definer set search_path to 'public'
as $function$
  select r.from_entity_id as party_entity_id,
         e.name, e.entity_type,
         r.relationship_type as relationship,
         case r.relationship_type
           when 'purchases' then 'buyer'
           when 'sells'     then 'seller'
           when 'owns'      then 'seller'
           when 'brokers'   then 'third_party'   -- reconciled to us/third_party in the assembly layer
           when 'finances'  then 'lender'
           else 'other' end as side,
         coalesce(r.metadata->>'role', r.relationship_type) as role,
         r.effective_from, r.effective_to,
         (r.effective_to is null) as is_current,
         coalesce(r.metadata->>'source','entity_relationships') as source
  from public.entity_relationships r
  join public.entities e on e.id = r.from_entity_id
  where r.to_entity_id = p_entity
    and r.relationship_type in ('purchases','sells','owns','brokers','finances','deal_party','guaranteed_by','developed')
  order by is_current desc, r.effective_from desc nulls last
  limit greatest(1, coalesce(p_limit, 60));
$function$;

-- ---------------------------------------------------------------------------
-- 8. lcc_deal_spine(entity) — one-call read model for buildDealPacket.
--    Returns only the spine sections (commission/milestones/diligence/
--    correspondence-summary/documents/conflicts); parties/economics are
--    assembled by the JS layer from the graph + domain sale row.
-- ---------------------------------------------------------------------------
create or replace function public.lcc_deal_spine(p_entity uuid)
 returns jsonb
 language sql stable security definer set search_path to 'public'
as $function$
  select jsonb_build_object(
    'entity_id', p_entity,
    'commission', coalesce((
      select jsonb_agg(jsonb_build_object(
        'stage_basis',stage_basis,'direct_pct',direct_pct,'co_broker_pct',co_broker_pct,
        'co_broker_split',co_broker_split,'structure',structure,'fee_amount',fee_amount,
        'executed_date',executed_date,'source',source,'source_doc',source_doc)
        order by executed_date desc nulls last, created_at desc)
      from public.lcc_deal_commission where entity_id = p_entity), '[]'::jsonb),
    'milestones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'milestone_key',milestone_key,'date',occurred_on,'status',status,'summary',summary,
        'source',source,'detail_ref',detail_ref)
        order by coalesce(sort_order, 999), occurred_on nulls last)
      from public.lcc_deal_milestone where entity_id = p_entity), '[]'::jsonb),
    'diligence', coalesce((
      select jsonb_agg(jsonb_build_object(
        'vendor',vendor,'type',vendor_type,'ordered_date',ordered_date,'site_visit_date',site_visit_date,
        'report_eta',report_eta,'completed_date',completed_date,'lender_required',lender_required,'source',source)
        order by ordered_date nulls last)
      from public.lcc_deal_diligence where entity_id = p_entity), '[]'::jsonb),
    'correspondence_summary', (
      select jsonb_build_object('summary',summary,'topics',topics,'thread_count',thread_count,
        'latest_activity_at',latest_activity_at,'source',source,'generated_at',generated_at)
      from public.v_lcc_deal_correspondence_summary_current where entity_id = p_entity),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'type',doc_type,'name',name,'date',doc_date,'source',source,'reconciled',reconciled,'detail_ref',detail_ref)
        order by doc_date desc nulls last)
      from public.lcc_deal_document where entity_id = p_entity), '[]'::jsonb),
    'conflicts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'field',field,'values',values,'reconciled',reconciled,'note',note,'status',status)
        order by created_at)
      from public.lcc_deal_conflict where entity_id = p_entity and status = 'open'), '[]'::jsonb)
  );
$function$;

-- Grants (service-role reaches everything; mirror the pattern of sibling deal fns).
grant execute on function public.lcc_deal_parties(uuid, int) to anon, authenticated, service_role;
grant execute on function public.lcc_deal_spine(uuid)        to anon, authenticated, service_role;
