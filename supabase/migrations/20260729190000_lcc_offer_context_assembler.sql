-- ============================================================================
-- 20260729190000_lcc_offer_context_assembler.sql   (OPS xengecqvemvfknjvbvrq)
-- Applied live 2026-07-29. Connective tissue for the offer-submission skill: ONE deal-scoped call that
-- assembles every context element the skill needs and reports what's missing, composing EXISTING sources
-- (no new tables): entities/bd_opportunities, activity_events (correspondence), lcc_cre_properties +
-- lcc_cre_bov_extraction (economics/owner), sharepoint_documents + lcc_cre_property_documents (OM/docs).
--
-- Two real-world facts it handles, both found while grounding on the Snellville DaVita deal:
--   (1) Entity fragmentation — the seller correspondence (Frank Meyrath / RCG) landed on SIBLING entities,
--       not the listing's bd_opportunities entity (reconciliation hasn't merged them). So correspondents are
--       gathered from the deal entity OR any activity whose title references the deal's city.
--   (2) Ingestion gaps — this listing has no lcc_cre_properties row, no bov_extraction economics, and its OM
--       isn't indexed in sharepoint_documents. The function returns `gaps[]` so the skill degrades gracefully
--       (falls back to the attached/linked OM for economics).
-- Deliberately gathers ALL external correspondents (excludes us @northmarq, tenant @davita.com, and the known
-- buyer side) and lets the skill / owner-link disambiguate the SELLER — Frank Meyrath (RCG) here.
-- ============================================================================
create or replace function public.lcc_offer_context(p_deal text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_eid uuid; v_ent record; v_cre record;
  v_corr jsonb; v_docs jsonb; v_econ jsonb; v_owner text; v_gaps text[] := '{}';
begin
  select o.entity_id into v_eid
  from public.bd_opportunities o join public.entities e on e.id=o.entity_id
  where o.workspace_id='a0000000-0000-0000-0000-000000000001'
    and (e.id::text = p_deal or e.name ilike '%'||p_deal||'%' or e.address ilike '%'||p_deal||'%')
  order by o.is_open desc limit 1;
  if v_eid is null then return jsonb_build_object('ok',false,'reason','deal_not_found','query',p_deal); end if;

  select id,name,address,city,state into v_ent from public.entities where id=v_eid;

  select coalesce(jsonb_agg(jsonb_build_object('email',email,'last_seen',last_seen,'sample_subject',subj) order by last_seen desc), '[]'::jsonb)
    into v_corr
  from (
    select lower((regexp_matches(a.body, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}','g'))[1]) as email,
           max(a.occurred_at) as last_seen, (array_agg(a.title order by a.occurred_at desc))[1] as subj
    from public.activity_events a
    where a.body ~ '@'
      and (a.entity_id = v_eid
           or (v_ent.city is not null and length(v_ent.city) >= 4 and a.title ilike '%'||v_ent.city||'%'))
    group by 1
  ) x
  where email not like '%northmarq%' and email not like '%davita.com%'
    and email not like '%sheldongilman%' and email not like '%millerbarondess%';

  select * into v_cre from public.lcc_cre_properties p
   where public.addr_key(p.address)=public.addr_key(v_ent.address) limit 1;
  if v_cre.id is not null then
    select record into v_econ from public.lcc_cre_bov_extraction
      where cre_property_id=v_cre.id order by extracted_at desc nulls last limit 1;
    if v_cre.owner_entity_id is not null then
      select name into v_owner from public.entities where id=v_cre.owner_entity_id;
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('name',name,'doc_type',dt,'url',url)), '[]'::jsonb) into v_docs
  from (
    select name, doc_type as dt, web_url as url from public.sharepoint_documents where property_entity_id=v_eid
    union all
    select file_name, document_type, source_url from public.lcc_cre_property_documents where cre_property_id = v_cre.id
  ) d;

  if v_econ is null then v_gaps := array_append(v_gaps,'economics_missing'); end if;
  if v_cre.id is null then v_gaps := array_append(v_gaps,'cre_property_missing'); end if;
  if v_docs = '[]'::jsonb then v_gaps := array_append(v_gaps,'documents_missing'); end if;
  if v_corr = '[]'::jsonb then v_gaps := array_append(v_gaps,'no_external_correspondent'); end if;

  return jsonb_build_object(
    'ok', true,
    'deal', jsonb_build_object('entity_id',v_ent.id,'name',v_ent.name,'address',v_ent.address,'city',v_ent.city,'state',v_ent.state),
    'seller_owner', v_owner,
    'correspondents', v_corr,
    'economics', v_econ,
    'documents', v_docs,
    'gaps', to_jsonb(v_gaps)
  );
end $$;
revoke all on function public.lcc_offer_context(text) from anon, authenticated;
