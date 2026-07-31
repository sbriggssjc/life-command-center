-- ============================================================================
-- lcc_reconcile_deal_todo — deal-level to-do reconciliation from correspondence
-- ----------------------------------------------------------------------------
-- Gap closed: lcc_advance_todos / lcc_autoresolve_todos only touch offer_review,
-- follow_up, seller_follow_up. But the bulk of open work is `deal_next_step`
-- (stage-derived "next move" items) — nothing reconciled those when deal mail
-- arrived. This wires deal correspondence -> the deal's open deal_next_step,
-- NON-DESTRUCTIVELY: it never auto-completes a broad next-step on a single email
-- (that would drop real work); it stamps correspondence evidence, sets whose-
-- move-it-is, and re-prioritizes so My Day sorts the freshest signal to the top.
--
-- Doctrine (mirrors the existing engines): reversible, metadata-stamped, best-
-- effort, direction-driven.
--   inbound reply  -> ball_in_court='us',  priority 'high', awaiting_our_move
--   outbound touch -> ball_in_court='them', last_outreach stamped (no nag)
-- Both directions stamp last_correspondence_* so the deal_next_step de-stales.
--
-- Called per deal-stamped message by the correspondence pipeline:
--   api/_handlers/deal-correspondence-backfill.js  (logMessages, dir inferred from sender)
--   api/_shared/intake-correspondence.js           (live inbound dual-anchor)
--   api/intake.js                                  (handleOutlookSent, live outbound)
-- ============================================================================
create or replace function public.lcc_reconcile_deal_todo(
  p_deal_entity_id uuid,
  p_direction      text        default 'inbound',
  p_activity_id    uuid        default null,
  p_subject        text        default null,
  p_occurred_at    timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ws      uuid := 'a0000000-0000-0000-0000-000000000001';
  v_dir     text := lower(coalesce(p_direction,'inbound'));
  v_at      timestamptz := coalesce(p_occurred_at, now());
  v_touched int := 0;
  v_ev      jsonb;
begin
  if p_deal_entity_id is null then
    return jsonb_build_object('ok',true,'note','no_deal','todos_reconciled',0);
  end if;
  if v_dir not in ('inbound','outbound') then v_dir := 'inbound'; end if;

  v_ev := jsonb_build_object(
    'last_correspondence_at',       v_at,
    'last_correspondence_dir',      v_dir,
    'last_correspondence_subject',  left(coalesce(p_subject,''),200),
    'last_correspondence_activity', p_activity_id,
    'ball_in_court',                case when v_dir='inbound' then 'us' else 'them' end,
    'reconciled_at',                now(),
    'reversible',                   true);

  update public.action_items ai
     set metadata = coalesce(ai.metadata,'{}'::jsonb) || v_ev
                    || jsonb_build_object(
                         'correspondence_count',
                           (coalesce((ai.metadata->>'correspondence_count')::int,0) + 1),
                         'awaiting_our_move', (v_dir='inbound'))
       , priority = case when v_dir='inbound' then 'high' else ai.priority end
       , updated_at = now()
   where ai.workspace_id = v_ws
     and ai.entity_id    = p_deal_entity_id
     and ai.action_type  = 'deal_next_step'
     and ai.status in ('open'::action_status,'in_progress'::action_status);
  get diagnostics v_touched = row_count;

  return jsonb_build_object(
    'ok', true,
    'deal', p_deal_entity_id,
    'direction', v_dir,
    'ball_in_court', case when v_dir='inbound' then 'us' else 'them' end,
    'todos_reconciled', v_touched);
end
$function$;

grant execute on function public.lcc_reconcile_deal_todo(uuid,text,uuid,text,timestamptz) to anon, authenticated, service_role;

comment on function public.lcc_reconcile_deal_todo(uuid,text,uuid,text,timestamptz) is
'Non-destructive deal-level reconciliation: stamps the deal open deal_next_step to-dos with correspondence evidence + ball-in-court + de-stale. Called per deal-stamped message by the correspondence pipeline. Reversible; never auto-completes a broad next-step.';
