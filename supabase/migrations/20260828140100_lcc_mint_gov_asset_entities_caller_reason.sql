-- C2e (2026-08-28): let the CALLER state why it minted.
--
-- The function hard-coded metadata.minted_because =
--   'a verified dated gov ownership transition exists and the property cleared
--    the caller''s rent floor'
-- which was true of its only caller (the ownership-transition feeder) and is
-- FALSE ON BOTH CLAUSES for C2e: the eligible-set mint requires no transition
-- and applies no rent floor.  Stamping it anyway would write a provenance claim
-- the rows do not support -- 2,000 times -- into the field a future reader would
-- use to decide whether the entity is justified.
--
-- ⚠️ DROP FIRST.  Adding a defaulted parameter creates an OVERLOAD, and with
-- defaults on both signatures every 3-arg call becomes 42725 "function is not
-- unique" (the N15d / B1 lesson).  The existing PostgREST caller
-- (scripts/feed-gov-ownership-transitions.mjs) passes named args
-- {p_rows, p_batch, p_dry_run} and keeps resolving against the 4-arg form.
--
-- ⚠️ PostgREST caches the function signature -- the NOTIFY at the foot is not
-- optional, or the feeder's next RPC 404s on a function that exists (the
-- PGRST204 schema-cache footgun in CLAUDE.md).
--
-- Behaviour is otherwise BYTE-IDENTICAL, and the default preserves the feeder's
-- exact existing string, so a call that does not pass p_reason is unchanged.
--
-- NOTE: canonical_name is supplied here for the NOT NULL, but since N15c the
-- BEFORE INSERT trigger recomputes it via lcc_entity_canonical_key().  The
-- trigger is the single writer; this argument is a floor, not the value.
-- Verified live on this batch: 2,000 of 2,000 minted rows are on-key and
-- v_lcc_canonical_name_drift stayed 0.
drop function if exists public.lcc_mint_gov_asset_entities(jsonb, text, boolean);

create or replace function public.lcc_mint_gov_asset_entities(
  p_rows    jsonb,
  p_batch   text,
  p_dry_run boolean DEFAULT true,
  p_reason  text    DEFAULT 'a verified dated gov ownership transition exists '
                         || 'and the property cleared the caller''s rent floor')
returns jsonb
language plpgsql
as $function$
#variable_conflict use_column
declare
  v_ws        uuid := 'a0000000-0000-0000-0000-000000000001';
  v_minted    int  := 0;
  v_skipped   int  := 0;
  v_sample    jsonb;
begin
  create temp table _mint on commit drop as
  select (e->>'pid')           as pid,
         btrim(e->>'name')     as name,
         (e->>'rent')::numeric as rent
  from jsonb_array_elements(p_rows) e;

  -- never mint a nameless asset, and never a second identity for one property
  delete from _mint m
   where coalesce(m.name,'') = ''
      or exists (select 1 from public.external_identities ei
                  where ei.source_system='gov' and ei.source_type='asset'
                    and ei.external_id = m.pid);
  get diagnostics v_skipped = row_count;

  select jsonb_agg(x) into v_sample
    from (select pid, name, rent from _mint order by rent desc nulls last limit 5) x;

  if p_dry_run then
    return jsonb_build_object('ok', true, 'dry_run', true, 'batch', p_batch,
      'would_mint', (select count(*) from _mint), 'skipped', v_skipped,
      'reason', p_reason,
      'sample', coalesce(v_sample, '[]'::jsonb));
  end if;

  with ins as (
    insert into public.entities
      (workspace_id, entity_type, name, canonical_name, domain, metadata)
    select v_ws, 'asset', m.name,
           public.lcc_normalize_entity_name(m.name),   -- the SQL normaliser, not a JS copy
           'gov',
           jsonb_build_object(
             'source', 'gov_ownership_transition_mint',
             'domain_property_id', m.pid::bigint,
             'mint_batch', p_batch,
             'minted_because', p_reason)
    from _mint m
    returning id, (metadata->>'domain_property_id') as pid
  )
  insert into public.external_identities
    (workspace_id, entity_id, source_system, source_type, external_id, metadata)
  select v_ws, i.id, 'gov', 'asset', i.pid,
         jsonb_build_object('bridge_source', 'lcc_mint_gov_asset_entities',
                            'mint_batch', p_batch)
  from ins i;
  get diagnostics v_minted = row_count;

  return jsonb_build_object('ok', true, 'dry_run', false, 'batch', p_batch,
    'minted', v_minted, 'skipped', v_skipped, 'reason', p_reason,
    'sample', coalesce(v_sample, '[]'::jsonb));
end;
$function$;

notify pgrst, 'reload schema';
