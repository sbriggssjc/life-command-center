-- Phase 1 content-aware next-step engine (task #63).
-- Extend lcc_advance_todos with AI-derived next-action params, appended after
-- p_owner_user_id (all defaulted => existing named-param callers still resolve).
-- The inbound branch uses the AI-derived title/type/due when provided, else the
-- generic review_response. Backward-compatible. APPLIED LIVE 2026-07-30 via MCP;
-- this file mirrors it into the repo migration history.
drop function if exists public.lcc_advance_todos(uuid, uuid, uuid, text, text, text, date, uuid);

create or replace function public.lcc_advance_todos(
  p_entity_id uuid default null::uuid,
  p_activity_id uuid default null::uuid,
  p_party_entity_id uuid default null::uuid,
  p_channel text default 'email'::text,
  p_direction text default 'outbound'::text,
  p_context text default null::text,
  p_follow_due date default null::date,
  p_owner_user_id uuid default null::uuid,
  p_next_action text default null::text,
  p_next_type text default null::text,
  p_next_due_offset int default null::int
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ws uuid := 'a0000000-0000-0000-0000-000000000001';
  v_sys uuid := 'b0000000-0000-0000-0000-000000000001';
  v_owner uuid := coalesce(p_owner_user_id, 'b0000000-0000-0000-0000-000000000001');
  v_offer int := 0; v_reach int := 0; v_resolved_await int := 0;
  v_deal text; v_new_id uuid; v_created jsonb := '[]'::jsonb;
  v_prov jsonb;
  v_next_type text;
  v_next_title text;
  v_next_due date;
  v_ai jsonb;
begin
  if p_entity_id is null and p_party_entity_id is null then
    return jsonb_build_object('ok',true,'note','no_anchor');
  end if;
  select name into v_deal from public.entities where id = p_entity_id;
  v_prov := jsonb_build_object('auto_engine',true,'by_activity',p_activity_id,'channel',p_channel,
                               'reversible',true,'at',now());

  if p_direction = 'outbound' then
    update public.action_items ai set status='completed'::action_status,
      metadata = coalesce(ai.metadata,'{}') || v_prov || jsonb_build_object('auto_resolved',true,'auto_resolved_reason','offer_submitted')
     where ai.workspace_id=v_ws and ai.entity_id=p_entity_id and ai.action_type='offer_review' and ai.status='open';
    get diagnostics v_offer = row_count;

    update public.action_items ai set status='completed'::action_status,
      metadata = coalesce(ai.metadata,'{}') || v_prov || jsonb_build_object('auto_resolved',true,'auto_resolved_reason','outreach_touch')
     where ai.workspace_id=v_ws
       and ai.entity_id in (select x from unnest(array[p_entity_id,p_party_entity_id]) x where x is not null)
       and ai.action_type='follow_up' and ai.status in ('open'::action_status,'in_progress'::action_status)
       and coalesce(ai.metadata->>'premise','') not in ('awaiting_seller','awaiting_response');
    get diagnostics v_reach = row_count;

    if v_offer > 0 and p_entity_id is not null
       and not exists (select 1 from public.action_items where workspace_id=v_ws and entity_id=p_entity_id
                        and action_type='seller_follow_up' and status in ('open','in_progress')) then
      insert into public.action_items (workspace_id, created_by, owner_id, visibility, action_type, status, title, description,
                                       priority, due_date, entity_id, source_type, metadata)
      values (v_ws, v_sys, v_owner, 'shared', 'seller_follow_up', 'open',
              'Follow up with seller — '||coalesce(v_deal,'deal'),
              coalesce(p_context,'Offer submitted; awaiting seller decision.'),
              'high', coalesce(p_follow_due, current_date + 1), p_entity_id, 'auto_engine',
              v_prov || jsonb_build_object('auto_created',true,'premise','awaiting_seller','context',p_context))
      returning id into v_new_id;
      v_created := jsonb_build_array(jsonb_build_object('id',v_new_id,'action_type','seller_follow_up',
                    'due',coalesce(p_follow_due, current_date+1)));
    end if;

  elsif p_direction = 'inbound' then
    update public.action_items ai set status='completed'::action_status,
      metadata = coalesce(ai.metadata,'{}') || v_prov || jsonb_build_object('auto_resolved',true,'auto_resolved_reason','inbound_reply_received')
     where ai.workspace_id=v_ws
       and ai.entity_id in (select x from unnest(array[p_entity_id,p_party_entity_id]) x where x is not null)
       and ai.action_type in ('seller_follow_up','follow_up')
       and ai.status in ('open'::action_status,'in_progress'::action_status)
       and coalesce(ai.metadata->>'premise','awaiting_seller') in ('awaiting_seller','awaiting_response');
    get diagnostics v_resolved_await = row_count;

    -- AI-derived next step (Phase 1). Falls back to the generic review_response when unspecified.
    v_next_type  := coalesce(nullif(trim(p_next_type),''), 'review_response');
    v_next_title := coalesce(nullif(trim(p_next_action),''), 'Review seller response & set next step')
                      || ' — ' || coalesce(v_deal,'deal');
    v_next_due   := current_date + coalesce(p_next_due_offset, 0);
    v_ai := case when nullif(trim(p_next_action),'') is not null or nullif(trim(p_next_type),'') is not null
                 then jsonb_build_object('ai_derived',true,'ai_next_action',p_next_action,
                                         'ai_next_type',p_next_type,'ai_due_offset',p_next_due_offset)
                 else jsonb_build_object('ai_derived',false) end;

    if p_entity_id is not null
       and not exists (select 1 from public.action_items where workspace_id=v_ws and entity_id=p_entity_id
                        and action_type=v_next_type and status in ('open','in_progress')) then
      insert into public.action_items (workspace_id, created_by, owner_id, visibility, action_type, status, title, description,
                                       priority, due_date, entity_id, source_type, metadata)
      values (v_ws, v_sys, v_owner, 'shared', v_next_type, 'open',
              v_next_title,
              coalesce(p_context,'Seller replied — read the message and decide the next move.'),
              'high', v_next_due, p_entity_id, 'auto_engine',
              v_prov || v_ai || jsonb_build_object('auto_created',true,'premise','review_inbound','context',p_context))
      returning id into v_new_id;
      v_created := jsonb_build_array(jsonb_build_object('id',v_new_id,'action_type',v_next_type,'due',v_next_due));
    end if;
  end if;

  return jsonb_build_object('ok',true,'direction',p_direction,
    'resolved_offer_review',v_offer,'resolved_reach_follow_up',v_reach,
    'resolved_awaiting',v_resolved_await,'created',v_created);
end $function$;
