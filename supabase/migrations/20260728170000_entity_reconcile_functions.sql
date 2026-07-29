-- ============================================================================
-- 20260728170000_entity_reconcile_functions.sql   (OPS project xengecqvemvfknjvbvrq)
-- A1 entity reconciliation. Applied live 2026-07-28. Two SECURITY DEFINER functions the engine calls via RPC
-- (see mcp/entity-reconcile.js → /api/pipeline/flagged-deals + /api/pipeline/reconcile-entity):
--   * reconcile_entity(placeholder, canonical, keep_new) — atomic merge: repoint bd_opportunities, move
--     activity_events (guarding the workspace/source/external unique constraint) + deal_party edges, retire the
--     placeholder to a reversible tombstone (metadata.merged_into). Or keep_new to clear the flag in place.
--   * list_flagged_open_deals(tb_only) — the review list (flagged, still-open deals + candidate assets).
-- ============================================================================

create or replace function public.reconcile_entity(
  p_placeholder uuid,
  p_canonical   uuid default null,
  p_keep_new    boolean default false
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_deals int := 0; v_acts int := 0; v_from int := 0; v_to int := 0;
  v_flag jsonb;
begin
  select metadata->'ambiguous_resolution' into v_flag from public.entities where id = p_placeholder;
  if not found then return jsonb_build_object('ok', false, 'error', 'placeholder_not_found'); end if;

  if p_keep_new then
    update public.entities
       set metadata = (coalesce(metadata,'{}'::jsonb) - 'ambiguous_resolution')
                      || jsonb_build_object('reconciled','kept_as_new','reconciled_at', now()::text)
     where id = p_placeholder;
    return jsonb_build_object('ok', true, 'action','kept_as_new','placeholder', p_placeholder);
  end if;

  if p_canonical is null then return jsonb_build_object('ok', false, 'error','canonical_required'); end if;
  if p_canonical = p_placeholder then return jsonb_build_object('ok', false, 'error','canonical_equals_placeholder'); end if;
  perform 1 from public.entities where id = p_canonical and entity_type = 'asset';
  if not found then return jsonb_build_object('ok', false, 'error','canonical_not_found_or_not_asset'); end if;

  update public.bd_opportunities set entity_id = p_canonical where entity_id = p_placeholder;
  get diagnostics v_deals = row_count;

  update public.activity_events a set entity_id = p_canonical
   where a.entity_id = p_placeholder
     and not exists (select 1 from public.activity_events b
                     where b.entity_id = p_canonical and b.source_type = a.source_type
                       and b.external_id is not distinct from a.external_id);
  get diagnostics v_acts = row_count;

  update public.entity_relationships set from_entity_id = p_canonical where from_entity_id = p_placeholder;
  get diagnostics v_from = row_count;
  update public.entity_relationships set to_entity_id = p_canonical where to_entity_id = p_placeholder;
  get diagnostics v_to = row_count;

  update public.entities
     set metadata = (coalesce(metadata,'{}'::jsonb) - 'ambiguous_resolution')
                    || jsonb_build_object('merged_into', p_canonical::text, 'reconciled_at', now()::text)
   where id = p_placeholder;

  return jsonb_build_object('ok', true, 'action','merged', 'placeholder', p_placeholder, 'canonical', p_canonical,
                            'deals_moved', v_deals, 'activity_moved', v_acts, 'edges_moved', v_from + v_to,
                            'candidates_were', v_flag);
end;
$$;

create or replace function public.list_flagged_open_deals(p_tb_only boolean default true)
returns jsonb language sql stable security definer set search_path to 'public'
as $$
  select coalesce(jsonb_agg(x order by x->>'deal'), '[]'::jsonb) from (
    select jsonb_build_object(
      'placeholder_id', e.id, 'deal', e.name, 'city', e.city, 'state', e.state,
      'sf_opp_id', o.sf_opp_id, 'stage', o.stage,
      'candidates', e.metadata->'ambiguous_resolution'
    ) as x
    from public.bd_opportunities o
    join public.entities e on e.id = o.entity_id
    where o.workspace_id = 'a0000000-0000-0000-0000-000000000001'
      and o.is_open and (e.metadata->'ambiguous_resolution') is not null
      and (not p_tb_only or o.owner_user_id in (select lcc_user_id from public.lcc_users where active))
  ) t;
$$;
