-- Deal-stage next-step engine: every open transaction-stage deal (bov, listing_signed,
-- off_market_listing, loi_executed, non_refundable) that has NO open action item gets a
-- stage-appropriate next step, so My Day's Do Now reflects all deal work in motion.
-- Owner-scoping is handled by the entity override (lcc_my_day reads it) → self-routes to the
-- deal's reconciled owner. Self-correcting: retires auto steps when a deal advances/closes,
-- then regenerates. Deterministic + idempotent. APPLIED LIVE 2026-07-31.
-- Cron: lcc-deal-next-steps-daily @ 05:15 UTC (before the 05:30 owner reconcile).
create or replace function public.lcc_generate_deal_next_steps()
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_ws uuid := 'a0000000-0000-0000-0000-000000000001';
        v_sys uuid := 'b0000000-0000-0000-0000-000000000001';
        v_created int := 0; v_retired int := 0;
begin
  update action_items ai set status='completed',
    metadata = coalesce(ai.metadata,'{}'::jsonb) || jsonb_build_object('auto_retired',true,'retired_reason','stage_changed_or_closed','at',now())
  from bd_opportunities b
  where ai.source_type='deal_stage_engine' and ai.status in ('open','in_progress')
    and ai.entity_id = b.entity_id
    and (b.is_open is not true or coalesce(b.stage,'') is distinct from (ai.metadata->>'stage'));
  get diagnostics v_retired = row_count;
  update action_items ai set status='completed',
    metadata = coalesce(ai.metadata,'{}'::jsonb) || jsonb_build_object('auto_retired',true,'retired_reason','deal_gone','at',now())
  where ai.source_type='deal_stage_engine' and ai.status in ('open','in_progress')
    and not exists (select 1 from bd_opportunities b where b.entity_id=ai.entity_id and b.is_open);

  with cand as (
    select b.entity_id, coalesce(nullif(b.deal_name,''), b.property_address, e.name) as deal, b.stage, b.expected_close_date,
      case b.stage
        when 'non_refundable'    then 'Confirm closing date & coordinate settlement'
        when 'loi_executed'      then 'Track due diligence & confirm closing timeline'
        when 'off_market_listing'then 'Advance off-market buyer outreach'
        when 'listing_signed'    then 'Confirm marketing launch / OM status'
        when 'bov'               then 'Deliver BOV & set listing discussion'
      end as action,
      case when b.stage in ('non_refundable','loi_executed') then 'high' else 'normal' end as pri,
      case b.stage
        when 'non_refundable' then coalesce(b.expected_close_date - 7, current_date + 2)
        when 'loi_executed'   then coalesce(b.expected_close_date - 14, current_date + 5)
        else current_date + 5 end as due
    from bd_opportunities b
    left join entities e on e.id = b.entity_id
    where b.is_open and b.entity_id is not null
      and b.stage in ('non_refundable','loi_executed','off_market_listing','listing_signed','bov')
      and not exists (select 1 from action_items ai
                      where ai.workspace_id=v_ws and ai.entity_id=b.entity_id and ai.status in ('open','in_progress'))
  ), ins as (
    insert into action_items (workspace_id, created_by, owner_id, visibility, action_type, status, title, description,
                              priority, due_date, entity_id, source_type, metadata)
    select v_ws, v_sys, v_sys, 'shared', 'deal_next_step', 'open',
           action || ' — ' || coalesce(deal,'deal'),
           'Auto-generated from deal stage ('||stage||'). Update or complete as the deal advances.',
           pri, due, entity_id, 'deal_stage_engine',
           jsonb_build_object('auto_engine',true,'stage',stage,'reversible',true,'at',now())
    from cand
    returning 1
  ) select count(*) into v_created from ins;
  return jsonb_build_object('ok',true,'next_steps_created', v_created, 'retired_stale', v_retired);
end $function$;
