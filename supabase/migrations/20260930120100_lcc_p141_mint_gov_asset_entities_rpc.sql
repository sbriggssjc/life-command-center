-- ============================================================================
-- P141/P141a — mint gov asset entities, server-side and transactional.
-- Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-19.
-- ----------------------------------------------------------------------------
-- WHY IT MOVED SERVER-SIDE: two NOT NULL columns with no default and no trigger,
-- found one at a time.
--
--   entities.canonical_name            -- 23502 in Scott's terminal on the first
--                                         live --mint --apply
--   external_identities.workspace_id   -- 23502 in the self-rolling-back gate
--                                         here, at zero cost, one table over
--
-- On every existing asset row canonical_name equals lcc_normalize_entity_name(name).
-- The obvious fix -- compute it in JS -- is the normaliser-drift risk CLAUDE.md
-- warns about repeatedly: a second implementation that silently diverges, after
-- which merge grouping stops agreeing with itself. So the mint lives here, where
-- the real function is in scope.
--
-- Doing it in one RPC also removes a race the JS version had: it inserted
-- entities, then identities, in two calls. A failure between them leaves entities
-- with no identity -- invisible to every consumer AND unfindable by batch, which
-- is the worst possible residue. Now both happen in one CTE inside one
-- transaction.
--
-- ⚠️ lcc_normalize_entity_name is BANNED FOR IDENTITY (it strips holdings /
-- partners / capital and would equate different companies -- see the P116 note).
-- It is used correctly here: canonical_name exists to GROUP candidate duplicates
-- for human review, which is precisely what that function is for.
-- Grouping-for-review is not identity-for-write.
--
-- THE VALUE GATE IS THE CALLER'S (--min-rent, which --mint refuses to run
-- without). This function does not re-derive it. It enforces only the two things
-- that protect the graph regardless of who calls it:
--   * a non-empty name -- 78 gov attribute rows have no address, and a nameless
--     asset entity is worse than no entity
--   * no second identity for a property that already has one
--
-- LIVE GATES:
--   self-rolling-back mint: entity + identity created, canonical_name populated,
--     exception rolled it back, residue 0
--   dry-run with three rows (one good, one nameless, one duplicate identity):
--     would_mint 1, skipped 2
--
-- REVERSAL (identities first, or the entities orphan):
--   delete from external_identities where metadata->>'mint_batch' = '<batch>';
--   delete from lcc_property_owner_evidence e using entities x
--    where e.entity_id = x.id and x.metadata->>'mint_batch' = '<batch>';
--   delete from entities where metadata->>'mint_batch' = '<batch>';
-- RETIRE PREDICATE: a minted entity that ends up with no evidence and no
-- portfolio fact has no consumer and should be retired by the same keys.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_mint_gov_asset_entities(
  p_rows     jsonb,
  p_batch    text,
  p_dry_run  boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
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
             'minted_because', 'a verified dated gov ownership transition exists '
                            || 'and the property cleared the caller''s rent floor')
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
    'minted', v_minted, 'skipped', v_skipped, 'sample', coalesce(v_sample, '[]'::jsonb));
end;
$$;

COMMENT ON FUNCTION public.lcc_mint_gov_asset_entities(jsonb, text, boolean) IS
  'P141. Mints gov asset entities + their gov/asset identity in ONE transaction. '
  'Exists server-side because entities.canonical_name and '
  'external_identities.workspace_id are both NOT NULL with no default, and '
  'canonical_name must come from lcc_normalize_entity_name -- reimplementing that '
  'in JS is the normaliser-drift risk CLAUDE.md warns about. Refuses nameless '
  'rows and properties that already carry an identity. The VALUE GATE is the '
  'caller''s. Reverse by metadata->>''mint_batch'', identities before entities.';

GRANT EXECUTE ON FUNCTION public.lcc_mint_gov_asset_entities(jsonb, text, boolean)
  TO service_role;
