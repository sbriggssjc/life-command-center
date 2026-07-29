-- ============================================================================
-- 20260729192500_lcc_offer_context_v31.sql   (OPS xengecqvemvfknjvbvrq)
-- FINAL assembler (supersedes the 190000/191000/192000 iterations). One deal-scoped call for the
-- offer-submission skill; reads the DEAL RECORD first, correspondence + CRE tables as fallback.
--
-- Precedence:
--   economics  = bd_opportunities.metadata->'listing'  (captured at listing-signing)  ELSE lcc_cre_bov_extraction
--   seller     = bd_opportunities.metadata->'seller'    (of_record + contact)          ELSE correspondence graph
--   documents  = sharepoint_documents + lcc_cre_property_documents (folder-feed indexed)
--   correspondents = external emails on the deal entity OR any activity whose title references the city
--                    (bridges entity fragmentation — the seller thread is attributed to people's timelines)
-- Returns gaps[] so the skill degrades gracefully. Multi-token resolver ("DaVita Snellville" matches by city).
-- Applied + verified on Snellville: seller/economics deterministic; only `documents_missing` remains (OM not
-- yet indexed by the folder-feed — a PA/SharePoint setup step, see the runbook).
-- ============================================================================
create or replace function public.lcc_offer_context(p_deal text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_eid uuid; v_meta jsonb; v_ent record; v_cre record;
  v_corr jsonb; v_docs jsonb; v_econ jsonb; v_seller jsonb; v_owner text; v_gaps text[] := '{}';
begin
  select o.entity_id, o.metadata into v_eid, v_meta
  from public.bd_opportunities o join public.entities e on e.id=o.entity_id
  where o.workspace_id='a0000000-0000-0000-0000-000000000001'
    and ( e.id::text = p_deal
       or e.name ilike '%'||p_deal||'%'
       or e.address ilike '%'||p_deal||'%'
       or exists (select 1 from regexp_split_to_table(p_deal,'\s+') w
                   where length(w) >= 4 and (e.city ilike '%'||w||'%' or e.address ilike '%'||w||'%')) )
  order by o.is_open desc limit 1;
  if v_eid is null then return jsonb_build_object('ok',false,'reason','deal_not_found','query',p_deal); end if;

  select id,name,address,city,state into v_ent from public.entities where id=v_eid;

  v_econ := v_meta->'listing';
  if v_econ is null then
    select * into v_cre from public.lcc_cre_properties p where public.addr_key(p.address)=public.addr_key(v_ent.address) limit 1;
    if v_cre.id is not null then
      select record into v_econ from public.lcc_cre_bov_extraction where cre_property_id=v_cre.id order by extracted_at desc nulls last limit 1;
      if v_cre.owner_entity_id is not null then select name into v_owner from public.entities where id=v_cre.owner_entity_id; end if;
    end if;
  end if;

  v_seller := v_meta->'seller';
  if v_owner is null then v_owner := v_seller->>'of_record'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('email',email,'last_seen',last_seen,'sample_subject',subj) order by last_seen desc), '[]'::jsonb)
    into v_corr
  from (
    select lower((regexp_matches(a.body, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}','g'))[1]) as email,
           max(a.occurred_at) as last_seen, (array_agg(a.title order by a.occurred_at desc))[1] as subj
    from public.activity_events a
    where a.body ~ '@'
      and (a.entity_id = v_eid or (v_ent.city is not null and length(v_ent.city) >= 4 and a.title ilike '%'||v_ent.city||'%'))
    group by 1
  ) x
  where email not like '%northmarq%' and email not like '%davita.com%'
    and email not like '%sheldongilman%' and email not like '%millerbarondess%';

  select coalesce(jsonb_agg(jsonb_build_object('name',name,'doc_type',dt,'url',url)), '[]'::jsonb) into v_docs
  from (
    select name, doc_type as dt, web_url as url from public.sharepoint_documents where property_entity_id=v_eid
    union all
    select file_name, document_type, source_url from public.lcc_cre_property_documents
      where cre_property_id = (select id from public.lcc_cre_properties p where public.addr_key(p.address)=public.addr_key(v_ent.address) limit 1)
  ) d;

  if v_econ is null then v_gaps := array_append(v_gaps,'economics_missing'); end if;
  if v_seller is null then v_gaps := array_append(v_gaps,'seller_on_deal_missing'); end if;
  if v_docs = '[]'::jsonb then v_gaps := array_append(v_gaps,'documents_missing'); end if;
  if v_corr = '[]'::jsonb and v_seller is null then v_gaps := array_append(v_gaps,'no_seller_signal'); end if;

  return jsonb_build_object(
    'ok', true,
    'deal', jsonb_build_object('entity_id',v_ent.id,'name',v_ent.name,'address',v_ent.address,'city',v_ent.city,'state',v_ent.state),
    'seller', v_seller,
    'seller_owner', v_owner,
    'economics', v_econ,
    'correspondents', v_corr,
    'documents', v_docs,
    'gaps', to_jsonb(v_gaps)
  );
end $$;
revoke all on function public.lcc_offer_context(text) from anon, authenticated;
