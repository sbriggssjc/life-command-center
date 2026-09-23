-- GOV-AVAIL1 (2026-09-22) — LCC Opps half: brokerage-office registry, the mis-named
-- asset entity behind the Tulsa gov listing, and a detector for that entity class.
--
-- TRACE (measured live 2026-09-22). gov available_listings c04dc749… (6120 South Yale
-- Avenue, Suite 300, Tulsa — Team Briggs' office) was promoted from staged intake
-- 9c2dc902… (USRenalMOB_Findlay_OH_OM_SB.pdf, seed source_vertical='dia'). The matcher's
-- 0.97 'canonical_address_lcc' hit was BYTE-TRUE: LCC asset entity 658c4713… is NAMED
-- "6120 South Yale Ave" (minted 2026-06-08 from an earlier snapshot's office address) while
-- its only identity is gov:asset:11255, a real excel_master property at 5110 South Yale Ave.
-- Since June that entity has absorbed 124 match rows from five intakes (four email bodies
-- whose signature block carried the office, re-matched weekly). The JS guards (intake-
-- address-guard.js, intake-promoter.js) stop the chain; this migration fixes its source.
--
-- ⚠️ The DB holds NO brokerage office street address anywhere to seed from: gov
-- broker_firms carries name only; dia broker_companies HQ city/state only; LCC
-- unified_contacts city/state only. The seed is therefore the two offices measured on the
-- gov Available list itself. Our own Tulsa office also lives in code
-- (BUILTIN_BROKERAGE_OFFICES) so it never depends on this table being readable.
--
-- REVERSAL RUNBOOK:
--   select * from lcc_gov_avail1_restore_entity_names('gov_avail1_20260922');
--   drop view if exists v_lcc_asset_entity_civic_drift;
--   drop table if exists lcc_brokerage_office_address;   -- the JS falls back to the builtin row

-- ── 1. Registry (read by api/_handlers/intake-extractor.js::loadBrokerageOfficeRegistry) ──
create table if not exists lcc_brokerage_office_address (
  id          bigserial primary key,
  firm_name   text        not null,
  address     text        not null,   -- street line incl. suite; the JS keys on civic + street
  city        text,
  state       text,
  zip         text,
  is_active   boolean     not null default true,
  source      text        not null,
  evidence    text,
  created_at  timestamptz not null default now(),
  unique (firm_name, address)
);
comment on table lcc_brokerage_office_address is
  'GOV-AVAIL1: brokerage/listing-firm office addresses that must never be taken as a subject '
  'property address by the OM intake chain. Extends BUILTIN_BROKERAGE_OFFICES in '
  'api/_shared/intake-address-guard.js; matching is civic number + normalized street (+ state).';

alter table lcc_brokerage_office_address enable row level security;
revoke all on table lcc_brokerage_office_address from public, anon, authenticated;
revoke all on sequence lcc_brokerage_office_address_id_seq from public, anon, authenticated;

insert into lcc_brokerage_office_address (firm_name, address, city, state, zip, source, evidence) values
  ('Northmarq (Team Briggs)', '6120 S Yale Ave, Suite 300', 'Tulsa', 'OK', '74136',
   'gov_avail1_20260922',
   'Own office. Extracted as the subject of the Findlay OH dialysis OM (intake 9c2dc902…) and 4 email-body intakes; gov listing c04dc749… (SBN-22).'),
  ('CBRE (Houston)', '2800 Post Oak Blvd, Suite 500', 'Houston', 'TX', '77056',
   'gov_avail1_20260922',
   'Stored as the address of gov listing 6cdda883… / property 36662 in Brownsville TX (costar_sidebar, 2026-08-03); listing_firm CBRE.')
on conflict (firm_name, address) do nothing;

-- ── 2. The mis-named asset entity: rename to its own domain property's address ─────────
create table if not exists lcc_gov_avail1_entity_name_log (
  id            bigserial primary key,
  batch_tag     text        not null,
  entity_id     uuid        not null,
  prior_name    text,
  prior_address text,
  new_name      text,
  reason        text        not null,
  logged_at     timestamptz not null default now(),
  restored_at   timestamptz
);
alter table lcc_gov_avail1_entity_name_log enable row level security;
revoke all on table lcc_gov_avail1_entity_name_log from public, anon, authenticated;
revoke all on sequence lcc_gov_avail1_entity_name_log_id_seq from public, anon, authenticated;

-- Guarded: only when the row still carries the office name AND its identity is still
-- gov:asset:11255 (re-running after a restore or a later human rename is a no-op).
insert into lcc_gov_avail1_entity_name_log (batch_tag, entity_id, prior_name, prior_address, new_name, reason)
select 'gov_avail1_20260922', e.id, e.name, e.address, '5110 South Yale Ave',
       'asset entity named for the Northmarq office; identity gov:asset:11255 is 5110 South Yale Ave'
  from entities e
 where e.id = '658c4713-a0f7-4f27-b03f-46d4fcb625db'
   and e.name = '6120 South Yale Ave'
   and exists (select 1 from external_identities x
                where x.entity_id = e.id and x.source_system = 'gov'
                  and x.source_type = 'asset' and x.external_id = '11255')
   and not exists (select 1 from lcc_gov_avail1_entity_name_log l
                    where l.entity_id = e.id and l.restored_at is null);

update entities e
   set name = l.new_name, address = l.new_name, updated_at = now()
  from lcc_gov_avail1_entity_name_log l
 where l.entity_id = e.id and l.batch_tag = 'gov_avail1_20260922' and l.restored_at is null
   and e.name = l.prior_name;

create or replace function lcc_gov_avail1_restore_entity_names(p_batch_tag text)
returns table (entity_id uuid, restored boolean)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  return query
  with r as (
    update entities e
       set name = l.prior_name, address = l.prior_address, updated_at = now()
      from lcc_gov_avail1_entity_name_log l
     where l.batch_tag = p_batch_tag and l.restored_at is null and l.entity_id = e.id
    returning e.id
  ), m as (
    update lcc_gov_avail1_entity_name_log l set restored_at = now()
      from r where l.entity_id = r.id and l.batch_tag = p_batch_tag and l.restored_at is null
    returning l.entity_id
  )
  select m.entity_id, true from m;
end;
$$;
revoke all on function lcc_gov_avail1_restore_entity_names(text) from public, anon, authenticated;

-- ── 3. Detector: bridged asset entities whose civic number disagrees with the domain
--       property they are bridged to (the class the Tulsa entity belongs to). Report-only.
--       Measured on this view right after apply, 2026-09-22: dia 51 / gov 64 rows (the Tulsa
--       entity itself no longer appears). An earlier ad-hoc count read 48/32; it used a
--       different overlap predicate. Quote the view, not either number.
create or replace view v_lcc_asset_entity_civic_drift
with (security_invoker = on) as
with b as (
  select e.id as entity_id, e.name as entity_name, e.address as entity_address,
         x.source_system, x.external_id as domain_property_id,
         a.address as property_address, a.city as property_city, a.state as property_state,
         e.created_at as entity_created_at,
         substring(coalesce(e.address, e.name) from '^\s*(\d+)')::numeric                     as e_lo,
         coalesce(substring(coalesce(e.address, e.name) from '^\s*\d+\s*-\s*(\d+)'),
                  substring(coalesce(e.address, e.name) from '^\s*(\d+)'))::numeric            as e_hi,
         substring(a.address from '^\s*(\d+)')::numeric                                        as p_lo,
         coalesce(substring(a.address from '^\s*\d+\s*-\s*(\d+)'),
                  substring(a.address from '^\s*(\d+)'))::numeric                              as p_hi
    from entities e
    join external_identities x
      on x.entity_id = e.id and x.source_type = 'asset' and x.source_system in ('gov', 'dia')
    join lcc_property_attributes a
      on a.source_domain = x.source_system and a.source_property_id::text = x.external_id
   where e.entity_type = 'asset' and e.merged_into_entity_id is null
)
select entity_id, entity_name, entity_address, source_system, domain_property_id,
       property_address, property_city, property_state, entity_created_at
  from b
 where e_lo is not null and p_lo is not null
   and not (e_lo <= p_hi and p_lo <= e_hi);
comment on view v_lcc_asset_entity_civic_drift is
  'GOV-AVAIL1: LCC asset entities whose name/address civic number is disjoint from the domain '
  'property their asset identity points at. Such an entity makes the intake matcher''s '
  'canonical_address_lcc tier bridge an OM to the wrong building. Report-only.';
revoke all on v_lcc_asset_entity_civic_drift from public, anon, authenticated;

-- ── 4. Assertions: privileges read back, never assumed ─────────────────────────────────
do $$
begin
  if has_table_privilege('anon', 'public.lcc_brokerage_office_address', 'select')
     or has_table_privilege('authenticated', 'public.lcc_brokerage_office_address', 'select') then
    raise exception 'GOV-AVAIL1: lcc_brokerage_office_address readable by anon/authenticated';
  end if;
  if has_table_privilege('anon', 'public.v_lcc_asset_entity_civic_drift', 'select')
     or has_table_privilege('authenticated', 'public.v_lcc_asset_entity_civic_drift', 'select') then
    raise exception 'GOV-AVAIL1: v_lcc_asset_entity_civic_drift readable by anon/authenticated';
  end if;
  if has_function_privilege('anon', 'public.lcc_gov_avail1_restore_entity_names(text)', 'execute')
     or has_function_privilege('authenticated', 'public.lcc_gov_avail1_restore_entity_names(text)', 'execute') then
    raise exception 'GOV-AVAIL1: restore function executable by anon/authenticated';
  end if;
end $$;
