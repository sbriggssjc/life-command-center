-- N15: mint unified_contacts hub rows for the SF-campaign-gated email orphans
-- (Scott, 2026-09-15).
--
-- Decision (verbatim): "These are members of a specific group? Usually means
-- that there is some vested interest in the space mapped by the name. Some
-- may be brokers, some may be a new fund exploring the space, but the vast
-- majority will be owners or prior owners and the membership is evidence
-- that some prior research has concluded that in our team's BD history and
-- just because the LCC doesn't yet have that connection mapped, does not
-- mean that its not out there undiscovered."
--
-- Background (P197, 2026-08-27, docs/audits/P197_TIER0_EMPLOYER_RESOLVER_2026-08-27.md
-- §4): of 5,193 (now 5,672, population moves) live person entities with an
-- email and no unified_contacts hub row, membership in a Salesforce campaign
-- (via lcc_sf_list_membership) was measured as "the only gate that
-- discriminates" among candidate criteria -- 1,475 admitted, correspondence
-- only 33, has-an-entity-edge 94% (not a gate), person-shaped 99% (not a
-- gate). P197 explicitly did NOT mint -- "1,475 rows is an operator-surface
-- decision with a blast radius" -- and filed it for Scott. Re-measured live
-- 2026-09-15: still exactly 1,475 (lcc_sf_list_membership is a frozen
-- 2026-07-16 to 07-21 snapshot, not a live-syncing producer -- itself worth
-- noting as a separate gap, not fixed here).
--
-- Sampled the population before minting (side distribution: seller 1,030,
-- unknown 416, buyer 88 -- consistent with Scott's "vast majority will be
-- owners" expectation; spot-checked 15 random rows, all real BD-relevant
-- names/companies/campaigns, e.g. "VCA Animal Hospital Owners", "DMR Urgent
-- Care Owners", "SAB GSA Prospects", "GSA Buyer"). Checked for mint
-- collision risk the way P197 did for its own reconcile: 0 of the 1,475
-- already resolve to a hub row under sf_contact_id.
--
-- ⚠️ NEVER FABRICATES company_name -- reuses lcc_tier0_company_confirms_domain
-- (the same domain-corroboration gate P197 built after finding that a bare
-- company label from lcc_sf_list_membership is a human/capture label, not an
-- employer register, and copying it verbatim manufactures employers: city/
-- zip strings, the person's own name, a different firm entirely, a bank).
-- Live run: only 228 of 1,475 (15%) get a company_name written; the other
-- 1,247 get an honest hub row with company_name left null ("Not on file"),
-- never a guess.
--
-- Applied and run live on xengecqvemvfknjvbvrq via mcp__Supabase__apply_migration
-- / execute_sql (RLS/ownership on this project means Cowork's Supabase tools
-- are the actual execution path). Dry run matched live: 1,475 would_create /
-- 1,475 created, 0 failures. Batch tag 'n15_sf_campaign_2026-09-15', fully
-- logged to lcc_n15_sf_campaign_hub_mint_log, reversible via
-- lcc_n15_unmint_sf_campaign_hub_rows('n15_sf_campaign_2026-09-15').
--
-- This file is DDL-only (the log table + both functions); the live mint run
-- itself was a data operation and is documented here for the audit trail.

create table if not exists public.lcc_n15_sf_campaign_hub_mint_log (
  id bigserial primary key,
  unified_id uuid not null references public.unified_contacts(unified_id),
  entity_id uuid not null references public.entities(id),
  sf_contact_id text,
  company_name_written text,
  batch_tag text not null,
  created_at timestamptz not null default now(),
  unmerged_at timestamptz
);

create or replace function public.lcc_n15_mint_sf_campaign_hub_rows(
  p_dry_run boolean default true,
  p_batch_tag text default null
)
returns table(out_entity_id uuid, out_unified_id uuid, out_name text, out_email text, out_company text, out_action text)
language plpgsql
as $function$
declare
  r record;
  v_unified_id uuid;
  v_batch text := coalesce(p_batch_tag, 'n15_sf_campaign_' || to_char(now(), 'YYYY-MM-DD'));
begin
  for r in
    with email_orphans as (
      select e.id, e.name, e.email, e.first_name, e.last_name, e.entity_type
      from public.entities e
      where e.email is not null and e.email <> ''
        and e.merged_into_entity_id is null
        and not exists (select 1 from public.unified_contacts u where lower(u.email) = lower(e.email))
        and not exists (select 1 from public.unified_contacts u where u.entity_id = e.id)
    ),
    sld as (
      select eo.id, regexp_replace(lower(split_part(split_part(eo.email,'@',2),'.',1)), '[^a-z0-9]','','g') as s
      from email_orphans eo
    ),
    ranked as (
      select
        eo.id, eo.name, eo.email, eo.first_name, eo.last_name,
        m.company_name, m.city, m.state, m.sf_contact_id, m.campaign_name, m.last_seen_at,
        public.lcc_tier0_company_confirms_domain(m.company_name, sld.s) as domain_confirmed,
        row_number() over (
          partition by eo.id
          order by public.lcc_tier0_company_confirms_domain(m.company_name, sld.s) desc, m.last_seen_at desc nulls last
        ) as rn
      from email_orphans eo
      join public.lcc_sf_list_membership m on m.entity_id = eo.id
      join sld on sld.id = eo.id
    )
    select * from ranked where rn = 1
    order by name
  loop
    if p_dry_run then
      out_entity_id := r.id;
      out_unified_id := null;
      out_name := r.name;
      out_email := r.email;
      out_company := case when r.domain_confirmed then r.company_name else null end;
      out_action := 'would_create';
      return next;
      continue;
    end if;

    insert into public.unified_contacts(
      contact_class, first_name, last_name, email, city, state,
      company_name, sf_contact_id, entity_id, match_method, match_confidence, field_sources
    ) values (
      'business', r.first_name, r.last_name, r.email, r.city, r.state,
      case when r.domain_confirmed then r.company_name else null end,
      r.sf_contact_id, r.id, 'n15_sf_campaign_mint', 1.0,
      jsonb_build_object(
        'email', 'entity',
        'company', case when r.domain_confirmed then 'lcc_sf_list_membership' else null end,
        'campaign', r.campaign_name
      )
    )
    returning unified_id into v_unified_id;

    insert into public.lcc_n15_sf_campaign_hub_mint_log(
      unified_id, entity_id, sf_contact_id, batch_tag, company_name_written
    ) values (
      v_unified_id, r.id, r.sf_contact_id, v_batch,
      case when r.domain_confirmed then r.company_name else null end
    );

    out_entity_id := r.id;
    out_unified_id := v_unified_id;
    out_name := r.name;
    out_email := r.email;
    out_company := case when r.domain_confirmed then r.company_name else null end;
    out_action := 'created';
    return next;
  end loop;
end;
$function$;

comment on function public.lcc_n15_mint_sf_campaign_hub_rows(boolean, text) is
  'N15, Scott 2026-09-15: mints unified_contacts hub rows for entities that are '
  'email orphans (no hub row, by email or entity_id) AND appear in '
  'lcc_sf_list_membership (the SF-campaign gate P197 measured as the only '
  'discriminating one, 1,475 as of 2026-09-15). One row per entity, picking the '
  'best campaign-membership row (domain-confirmed company preferred, else most '
  'recent). company_name is written ONLY when lcc_tier0_company_confirms_domain '
  'corroborates it against the persons own email domain -- never fabricated, '
  'per the P197 lesson (a bare company label manufactures an employer). '
  'Reversible via lcc_n15_unmint_sf_campaign_hub_rows(batch_tag).';

create or replace function public.lcc_n15_unmint_sf_campaign_hub_rows(p_batch_tag text)
returns integer
language plpgsql
as $function$
declare
  v_n integer;
begin
  with victims as (
    select unified_id from public.lcc_n15_sf_campaign_hub_mint_log
    where batch_tag = p_batch_tag and unmerged_at is null
  )
  delete from public.unified_contacts u using victims v
  where u.unified_id = v.unified_id;
  get diagnostics v_n = row_count;

  update public.lcc_n15_sf_campaign_hub_mint_log
  set unmerged_at = now()
  where batch_tag = p_batch_tag and unmerged_at is null;

  return v_n;
end;
$function$;
