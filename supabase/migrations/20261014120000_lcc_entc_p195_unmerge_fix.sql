-- ENTC (2026-09-03) — PR5c-entities-c-p195-unmerge.
--
-- `lcc_p195_unmerge` restored `entity_relationships` and `external_identities`
-- with `insert ... on conflict (id) do update`. `trg_lcc_entity_rel_resolve_survivor`
-- is a BEFORE INSERT trigger that returns NULL for an edge duplicating one the
-- resolved entity already holds, so a byte-identical row NEVER REACHES the
-- conflict clause and stays on the winner while the function reports `restored`.
-- That is P196's exact finding, in the one reversal path that never got P196's fix.
--
-- ⚠️ THE BACKLOG'S RECOMMENDATION ("retire it or repoint it at lcc_unmerge_entity")
-- IS REFUSED, ON A MEASUREMENT: `lcc_p195_merge_log` holds 66 OPEN merges and
-- ZERO of them have a row in `lcc_entity_merge_log` (they predate P196's
-- self-snapshot by hours on 2026-08-27). `lcc_unmerge_entity` reads that ledger
-- and would return `no_open_merge_log_row` for every one of them. Retiring this
-- function would make 66 live tombstones IRREVERSIBLE. So it is FIXED, not retired.
--
-- Fix = P196's shape: UPDATE the rows that survived (the repoint the trigger
-- cannot block), INSERT only the rows that were actually deleted, then count
-- want-vs-have and REPORT the residue instead of swallowing it.
--
-- ⚠️ The row COUNT is identical whether or not the bug fires — only an
-- identity-keyed fingerprint (`id:from>to:type`) exposes it. A count-based
-- verification of any unmerge is worthless.
--
-- Return type gains `note`, so the function is DROPped first (CREATE OR REPLACE
-- cannot change OUT columns).
--
-- REVERSAL: re-apply the body from
-- supabase/migrations/20260827100000_lcc_p195_merge_byte_identical_owner_groups.sql
-- (and re-grant anon/authenticated if the narrowing below is unwanted).

drop function if exists public.lcc_p195_unmerge(text);

create or replace function public.lcc_p195_unmerge(p_batch_tag text)
returns table(loser_id uuid, entity_name text, rows_restored integer, note text)
language plpgsql security definer set search_path to 'public'
as $function$
declare g record; n int; total int; v_note text;
        v_rel_want int; v_rel_have int; v_xid_want int; v_xid_have int; v_notes text[];
begin
  v_note := 'p195:'||p_batch_tag;
  for g in select * from public.lcc_p195_merge_log
            where batch_tag = p_batch_tag and unmerged_at is null
            order by id desc
  loop
    total := 0; v_notes := '{}';

    -- clear the tombstone FIRST: entity_relationships / external_identities carry
    -- survivor-resolving INSERT triggers (P177/P178) that would otherwise send every
    -- restored row straight back to the winner.
    update public.entities set merged_into_entity_id = null, updated_at = now() where id = g.loser_id;

    update public.owner_contact_pivot p set
      active_contact_name      = b.old_row->>'active_contact_name',
      active_contact_entity_id = nullif(b.old_row->>'active_contact_entity_id','')::uuid,
      active_authority_level   = nullif(b.old_row->>'active_authority_level','')::int,
      active_contact_role      = b.old_row->>'active_contact_role',
      active_source            = b.old_row->>'active_source',
      confidence               = b.old_row->>'confidence',
      enrichment_action        = b.old_row->>'enrichment_action',
      bench                    = coalesce(b.old_row->'bench','[]'::jsonb),
      pivot_history            = coalesce(b.old_row->'pivot_history','[]'::jsonb),
      updated_at               = now()
    from public.r40_merge_reconcile_backup b
    where b.note = v_note and b.tombstone_id = g.loser_id
      and b.table_name = 'owner_contact_pivot_winner' and p.entity_id = g.winner_id;
    get diagnostics n = row_count; total := total + n;

    -- is_current is GENERATED ALWAYS: it must be omitted from the column list.
    insert into public.lcc_entity_portfolio_facts
      (entity_id, source_domain, source_property_id, ownership_start_date, ownership_end_date,
       annual_rent, sale_price, cap_rate, ownership_source, updated_at)
    select r.entity_id, r.source_domain, r.source_property_id, r.ownership_start_date, r.ownership_end_date,
           r.annual_rent, r.sale_price, r.cap_rate, r.ownership_source, r.updated_at
      from jsonb_populate_recordset(null::public.lcc_entity_portfolio_facts,
        (select coalesce(jsonb_agg(b.old_row - 'is_current'),'[]'::jsonb)
           from public.r40_merge_reconcile_backup b
          where b.note=v_note and b.tombstone_id=g.loser_id and b.table_name='lcc_entity_portfolio_facts')) r
      on conflict (entity_id, source_domain, source_property_id) do nothing;
    get diagnostics n = row_count; total := total + n;

    update public.lcc_entity_portfolio_facts f set entity_id = g.loser_id
      from public.r40_merge_reconcile_backup b
     where b.note=v_note and b.tombstone_id=g.loser_id and b.table_name='lcc_entity_portfolio_facts'
       and f.entity_id = g.winner_id
       and f.source_domain = b.old_row->>'source_domain'
       and f.source_property_id = b.old_row->>'source_property_id'
       and not exists (select 1 from public.lcc_entity_portfolio_facts x
                        where x.entity_id=g.loser_id and x.source_domain=f.source_domain
                          and x.source_property_id=f.source_property_id);
    get diagnostics n = row_count; total := total + n;

    -- external identities: UPDATE what survives, INSERT only what was deleted (P196).
    select count(*) into v_xid_want from public.r40_merge_reconcile_backup b
     where b.note=v_note and b.tombstone_id=g.loser_id and b.table_name='external_identities';

    update public.external_identities x set entity_id = (b.old_row->>'entity_id')::uuid
      from public.r40_merge_reconcile_backup b
     where b.note=v_note and b.tombstone_id=g.loser_id and b.table_name='external_identities'
       and x.id = (b.old_row->>'id')::uuid;
    get diagnostics n = row_count; total := total + n;

    insert into public.external_identities
      select * from jsonb_populate_recordset(null::public.external_identities,
        (select coalesce(jsonb_agg(b.old_row),'[]'::jsonb) from public.r40_merge_reconcile_backup b
          where b.note=v_note and b.tombstone_id=g.loser_id and b.table_name='external_identities'
            and not exists (select 1 from public.external_identities x2
                             where x2.id = (b.old_row->>'id')::uuid)))
      on conflict (id) do nothing;
    get diagnostics n = row_count; total := total + n;

    select count(*) into v_xid_have from public.r40_merge_reconcile_backup b
      join public.external_identities x on x.id = (b.old_row->>'id')::uuid
     where b.note=v_note and b.tombstone_id=g.loser_id and b.table_name='external_identities'
       and x.entity_id is not distinct from (b.old_row->>'entity_id')::uuid;
    if v_xid_have < v_xid_want then
      v_notes := v_notes || ('identities_not_restored=' || (v_xid_want - v_xid_have)::text);
    end if;

    -- relationships: the one that bit. Same shape, plus want-vs-have so a
    -- trigger-skipped row is REPORTED, never silent.
    select count(*) into v_rel_want from public.r40_merge_reconcile_backup b
     where b.note=v_note and b.tombstone_id=g.loser_id and b.table_name='entity_relationships';

    update public.entity_relationships r
       set from_entity_id = (b.old_row->>'from_entity_id')::uuid,
           to_entity_id   = (b.old_row->>'to_entity_id')::uuid
      from public.r40_merge_reconcile_backup b
     where b.note=v_note and b.tombstone_id=g.loser_id and b.table_name='entity_relationships'
       and r.id = (b.old_row->>'id')::uuid;
    get diagnostics n = row_count; total := total + n;

    insert into public.entity_relationships
      select * from jsonb_populate_recordset(null::public.entity_relationships,
        (select coalesce(jsonb_agg(b.old_row),'[]'::jsonb) from public.r40_merge_reconcile_backup b
          where b.note=v_note and b.tombstone_id=g.loser_id and b.table_name='entity_relationships'
            and not exists (select 1 from public.entity_relationships r2
                             where r2.id = (b.old_row->>'id')::uuid)))
      on conflict (id) do nothing;
    get diagnostics n = row_count; total := total + n;

    select count(*) into v_rel_have from public.r40_merge_reconcile_backup b
      join public.entity_relationships r on r.id = (b.old_row->>'id')::uuid
     where b.note=v_note and b.tombstone_id=g.loser_id and b.table_name='entity_relationships'
       and r.from_entity_id is not distinct from (b.old_row->>'from_entity_id')::uuid
       and r.to_entity_id   is not distinct from (b.old_row->>'to_entity_id')::uuid;
    if v_rel_have < v_rel_want then
      v_notes := v_notes || ('relationships_not_restored=' || (v_rel_want - v_rel_have)::text);
    end if;

    insert into public.owner_contact_pivot
      select * from jsonb_populate_recordset(null::public.owner_contact_pivot,
        (select coalesce(jsonb_agg(b.old_row),'[]'::jsonb) from public.r40_merge_reconcile_backup b
          where b.note=v_note and b.tombstone_id=g.loser_id and b.table_name='owner_contact_pivot'))
      on conflict (entity_id) do nothing;
    get diagnostics n = row_count; total := total + n;

    update public.lcc_property_owner po set owner_entity_id = g.loser_id,
           owner_name = coalesce((select name from public.entities where id=g.loser_id), po.owner_name)
      from public.r40_merge_reconcile_backup b
     where b.note=v_note and b.tombstone_id=g.loser_id and b.table_name='lcc_property_owner'
       and po.entity_id = (b.old_row->>'entity_id')::uuid
       and b.old_row->>'owner_entity_id' = g.loser_id::text;
    get diagnostics n = row_count; total := total + n;

    update public.bd_opportunities b2 set entity_id = g.loser_id
      from public.r40_merge_reconcile_backup b
     where b.note=v_note and b.tombstone_id=g.loser_id and b.table_name='bd_opportunities'
       and b2.id = (b.old_row->>'id')::uuid;
    get diagnostics n = row_count; total := total + n;

    update public.touchpoint_cadence c set entity_id = g.loser_id
      from public.r40_merge_reconcile_backup b
     where b.note=v_note and b.tombstone_id=g.loser_id and b.table_name='touchpoint_cadence'
       and c.id = (b.old_row->>'id')::uuid and b.old_row->>'entity_id' = g.loser_id::text;
    get diagnostics n = row_count; total := total + n;

    update public.lcc_p195_merge_log set unmerged_at = now() where id = g.id;

    loser_id := g.loser_id; entity_name := g.entity_name; rows_restored := total;
    note := case when array_length(v_notes,1) is null then 'restored'
                 else 'restored_with_residue:' || array_to_string(v_notes, ',') end;
    return next;
  end loop;
end;
$function$;

comment on function public.lcc_p195_unmerge(text) is
  'ENTC 2026-09-03: reverses a P195 batch. UPDATE-survivors + INSERT-deleted (P196 shape) so a BEFORE-INSERT survivor trigger cannot strand a byte-identical edge on the winner; reports want-vs-have residue in note. Kept (NOT retired) because 66 open lcc_p195_merge_log rows have no lcc_entity_merge_log row and lcc_unmerge_entity cannot reverse them.';

-- Narrow the definer unmerge surface. These three are one class: SECURITY
-- DEFINER functions that move ownership/relationship rows between entities, with
-- ZERO PostgREST callers (censused 2026-09-03 across api/, scripts/, test/).
-- ⚠️ REVOKE ... FROM anon, authenticated does NOT remove the PUBLIC grant, and
-- REVOKE ... FROM public does NOT remove Supabase's explicit default-privilege
-- grants — revoke BOTH, then assert with has_function_privilege().
revoke execute on function public.lcc_p195_unmerge(text)  from public, anon, authenticated;
revoke execute on function public.lcc_unmerge_entity(uuid) from public, anon, authenticated;
revoke execute on function public.lcc_a2a_unmerge(text)    from public, anon, authenticated;
grant execute on function public.lcc_p195_unmerge(text)  to service_role;
grant execute on function public.lcc_unmerge_entity(uuid) to service_role;
grant execute on function public.lcc_a2a_unmerge(text)    to service_role;

do $assert$
declare r record;
begin
  for r in select oid, proname from pg_proc
            where proname in ('lcc_p195_unmerge','lcc_unmerge_entity','lcc_a2a_unmerge')
  loop
    if has_function_privilege('anon', r.oid, 'EXECUTE')
       or has_function_privilege('authenticated', r.oid, 'EXECUTE') then
      raise exception 'ENTC: % still reachable by anon/authenticated', r.proname;
    end if;
    if not has_function_privilege('service_role', r.oid, 'EXECUTE') then
      raise exception 'ENTC: % lost service_role EXECUTE', r.proname;
    end if;
  end loop;
end $assert$;
