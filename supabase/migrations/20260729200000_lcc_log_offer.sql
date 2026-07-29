-- ============================================================================
-- 20260729200000_lcc_log_offer.sql   (OPS xengecqvemvfknjvbvrq)  — applied live 2026-07-29
-- The offer-submission LOGGING leg (DB-side, atomic, surface-agnostic). Given a deal + the extracted offer:
--   1) activity_event "Offer received: $X — <buyer>" on the deal (idempotent on the workspace/source_type/
--      external_id unique index — safe to re-call);
--   2) a review To-Do in action_items, priority high, due on the offer expiration (surfaces in the briefing);
--   3) an SF log via the existing sf_sync_queue → LCC→SF drainer as a **create_task** ("Offer Received — Pending
--      Seller Response"). ('offer' isn't an allowed queue kind; create_task is the standard, already-drained kind.)
-- Does NOT overwrite bd_opportunities.stage (SF-owned). The draft + file-back legs are HTTP/PA (see DELIVERY-LEGS).
-- Verified on Snellville: activity + To-Do (due 2026-07-31) + SF create_task enqueued.
-- ============================================================================
create or replace function public.lcc_log_offer(p_deal text, p_offer jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_eid uuid; v_name text;
  v_ws  uuid := 'a0000000-0000-0000-0000-000000000001';
  v_sys uuid := 'b0000000-0000-0000-0000-000000000001';
  v_exp date; v_ext text; v_ae uuid; v_ai uuid; v_q uuid;
begin
  select o.entity_id, e.name into v_eid, v_name
  from public.bd_opportunities o join public.entities e on e.id=o.entity_id
  where o.workspace_id=v_ws
    and ( e.id::text=p_deal or e.name ilike '%'||p_deal||'%' or e.address ilike '%'||p_deal||'%'
       or exists (select 1 from regexp_split_to_table(p_deal,'\s+') w
                   where length(w)>=4 and (e.city ilike '%'||w||'%' or e.address ilike '%'||w||'%')) )
  order by o.is_open desc limit 1;
  if v_eid is null then return jsonb_build_object('ok',false,'reason','deal_not_found','query',p_deal); end if;

  begin v_exp := (p_offer->>'expiration_date')::date; exception when others then v_exp := null; end;
  v_ext := 'offer:'||v_eid||':'||coalesce(p_offer->>'buyer','?')||':'||coalesce(p_offer->>'price','?');

  insert into public.activity_events (workspace_id, actor_id, category, title, body, entity_id, source_type, external_id, occurred_at, visibility, metadata)
  values (v_ws, v_sys, 'note',
     left('Offer received: '||coalesce(p_offer->>'price','')||coalesce(' — '||(p_offer->>'buyer'),''),500),
     coalesce(p_offer->>'summary',''), v_eid, 'offer_intake', v_ext, now(), 'shared', p_offer)
  on conflict (workspace_id, source_type, external_id) do nothing
  returning id into v_ae;

  insert into public.action_items (workspace_id, created_by, owner_id, visibility, title, description, action_type, status, priority, due_date, entity_id, source_type, external_id, metadata)
  values (v_ws, v_sys, v_sys, 'shared',
     left('Review & submit offer to seller — '||v_name,500),
     'Inbound LOI. Prepare/submit the seller submission; response strategy by phone. Expires '||coalesce(p_offer->>'expiration','(see LOI)')||'.',
     'offer_review', 'open'::action_status, 'high', v_exp, v_eid, 'offer_intake', v_ext||':todo', p_offer)
  on conflict do nothing
  returning id into v_ai;

  insert into public.sf_sync_queue (workspace_id, kind, payload, status, requested_by, requested_at)
  values (v_ws, 'create_task',
     jsonb_build_object(
       'deal_entity_id', v_eid, 'deal', v_name,
       'subject', left('Offer Received — '||coalesce(p_offer->>'buyer','')||' '||coalesce(p_offer->>'price',''),255),
       'body', 'Offer Received — Pending Seller Response. '||coalesce(p_offer->>'summary',''),
       'status_note', 'Offer Received — Pending Seller Response',
       'offer', p_offer),
     'pending', 'lcc:offer-submission', now())
  returning id into v_q;

  return jsonb_build_object('ok',true,'deal',v_name,'entity_id',v_eid,
    'activity_event',v_ae,'todo',v_ai,'sf_queue',v_q,'expiration',v_exp,
    'note', case when v_ae is null then 'activity already logged (idempotent)' else 'logged' end);
end $$;
revoke all on function public.lcc_log_offer(text, jsonb) from anon, authenticated;
