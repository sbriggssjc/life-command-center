-- P195 — merge the byte-identical owner groups surfaced by P189's fallback grouping key.
--
-- P189 made this population visible (60 groups / 147 entities / $102.4M) and merged nothing.
-- This migration is the machinery that lands the cleanup, driven group by group.
--
-- TWO THINGS MEASURED HERE THAT CHANGE THE PROMPT'S PLAN — read before touching this file:
--
--  1. A BYTE-IDENTICAL NAME IS NOT AN IDENTITY CLAIM WHEN EVERY TOKEN IS GENERIC.
--     The blind view's own filter is `lcc_normalize_entity_name(name) = ''`, i.e. it selects
--     names that reduce to NOTHING under the generic-CRE stoplist. That set contains two
--     different things: acronym-named REAL firms ("NGP Capital" -> "ngp", 3 chars, below the
--     normalizer's length floor) and pure-generic FRAGMENTS ("Capital", "Properties",
--     "Partners Group") which are failed extractions, not firms. Merging the second kind
--     asserts that unrelated parties are one company. Measured: 4 groups / 25 entities carry
--     no distinctive residue -- 18 of them are empty "Partners Group" husks minted in two
--     bursts on 2026-06-24/26, and "Capital" x3 spans dia + gov with three different
--     external identities. `lcc_p195_name_has_distinctive_residue` is the gate; those 4
--     groups are HELD, not merged.
--
--  2. `lcc_merge_entity` DELETES THE LOSER'S owner_contact_pivot ROW WHENEVER THE WINNER HAS
--     ONE, AND DOES NOT SNAPSHOT IT. The dedup predicate is uncorrelated -- it asks only
--     whether the winner has a pivot at all -- and `lcc_merge_entity` calls
--     `lcc_reconcile_tombstone_backrefs(..., p_snapshot => false)`, so the deleted row is
--     gone with no ledger. Measured live on `bamproperties`: the winner by ownership
--     (1d0b30a9, 1 asset, $517k) has a pivot with NO contact; the loser (b430f8e8) carries
--     the group's only named contact, "Alex Bias". A bare merge would have destroyed it,
--     silently, in the exact lane this pass exists to clean. So the driver folds the pivot
--     FILL-BLANKS before calling the merge, and snapshots every loser-side row first.
--
-- Discipline: dry-run default - fill-blanks - conservative/unambiguous (ambiguity held, never
-- guessed) - snapshotted + reversible by batch_tag - idempotent - honest counts.
--
-- REVERSAL RUNBOOK:
--   select * from public.lcc_p195_unmerge('<batch_tag>');
--   -- restores each tombstone (merged_into_entity_id = null) and re-inserts every row the
--   -- merge dedup-DELETED. Rows that were merely REPOINTED are moved back by primary key
--   -- from the snapshot. See the function header for what it cannot undo.

-- ---------------------------------------------------------------------------
-- 1. The gate. NARROW and scoped to this pass (the lcc_p131_is_document_row_label
--    precedent) -- it is NOT a general-purpose name filter and must not be reused as one.
--    It answers exactly one question: after stripping the generic-CRE stoplist that
--    `lcc_normalize_entity_name` strips, does the name carry ANY distinctive token left?
-- ---------------------------------------------------------------------------
create or replace function public.lcc_p195_name_has_distinctive_residue(p_name text)
returns boolean
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(btrim(regexp_replace(regexp_replace(regexp_replace(
    lower(coalesce(p_name, '')),
    '\m(llc|l\.l\.c\.|inc|inc\.|corp|corp\.|corporation|company|co|co\.|lp|l\.p\.|llp|trust|holdings|properties|partners|capital|group|the|n\.a\.|na)\M', ' ', 'gi'),
    '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g')), '') <> '';
$$;

comment on function public.lcc_p195_name_has_distinctive_residue(text) is
  'P195 gate ONLY. True when a name keeps a distinctive token after the generic-CRE stoplist. "NGP Capital"->"ngp" true; "Capital"/"Partners Group"->"" false. Never reuse as a general name filter.';

-- ---------------------------------------------------------------------------
-- 2. The plan. One row per member entity, with the winner ranked deterministically.
--    Winner rule, in order: owns the most assets -> most current rent -> most portfolio
--    facts -> most external identities -> most relationships -> oldest -> id.
--    OWNERSHIP FIRST, not rent: the entity that actually owns assets is the one every
--    downstream consumer already points at.
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_p195_merge_plan as
with g as (
  select v.group_key, v.member_count, v.resolved_owner_members, v.combined_annual_rent,
         unnest(v.member_entity_ids) as entity_id
  from public.v_lcc_merge_candidates_normalizer_blind v
  where v.names_identical
),
m as (
  select g.group_key, g.member_count, g.resolved_owner_members, g.combined_annual_rent,
         e.id as entity_id, e.name, e.domain, e.created_at,
         (select count(*) from public.lcc_property_owner po where po.owner_entity_id = e.id) as owns_assets,
         coalesce((select sum(f.annual_rent) from public.lcc_entity_portfolio_facts f
                    where f.entity_id = e.id and f.is_current), 0) as current_rent,
         (select count(*) from public.lcc_entity_portfolio_facts f where f.entity_id = e.id) as portfolio_facts,
         (select count(*) from public.external_identities x where x.entity_id = e.id) as external_ids,
         (select count(*) from public.entity_relationships r
           where r.from_entity_id = e.id or r.to_entity_id = e.id) as relationships,
         (select count(*) from public.owner_contact_pivot p where p.entity_id = e.id) as pivots,
         (select p.active_contact_entity_id from public.owner_contact_pivot p where p.entity_id = e.id) as pivot_contact_entity_id,
         (select p.active_contact_name from public.owner_contact_pivot p where p.entity_id = e.id) as pivot_contact_name
  from g join public.entities e on e.id = g.entity_id
  where e.merged_into_entity_id is null
),
r as (
  select m.*,
         row_number() over (partition by m.group_key
                            order by m.owns_assets desc, m.current_rent desc, m.portfolio_facts desc,
                                     m.external_ids desc, m.relationships desc, m.created_at asc, m.entity_id asc) as win_rank,
         public.lcc_p195_name_has_distinctive_residue(m.name) as gate_ok
  from m
)
select r.group_key,
       r.entity_id,
       r.name,
       r.domain,
       r.created_at,
       r.win_rank = 1 as is_winner,
       first_value(r.entity_id) over (partition by r.group_key order by r.win_rank) as winner_id,
       r.win_rank,
       r.member_count,
       r.resolved_owner_members,
       r.combined_annual_rent,
       case when r.resolved_owner_members > 1 then 'multi_owner'
            when r.resolved_owner_members = 1 then 'one_owner'
            else 'no_owner' end as risk_slice,
       r.gate_ok,
       case when r.gate_ok then null
            else 'generic_name_only_no_distinctive_token' end as hold_reason,
       r.owns_assets, r.current_rent, r.portfolio_facts, r.external_ids, r.relationships,
       r.pivots, r.pivot_contact_entity_id, r.pivot_contact_name
from r;

comment on view public.v_lcc_p195_merge_plan is
  'P195 merge plan: one row per live member of a byte-identical owner group, with the deterministic winner (win_rank=1), the risk slice, and the distinctive-residue gate. gate_ok=false is HELD, never merged.';

-- ---------------------------------------------------------------------------
-- 3. Reversible ledger. The snapshot itself reuses the house table
--    r40_merge_reconcile_backup (note = 'p195:<batch_tag>') rather than minting a second
--    ledger -- one backup store, one reversal path.
-- ---------------------------------------------------------------------------
create table if not exists public.lcc_p195_merge_log (
  id            bigserial primary key,
  batch_tag     text        not null,
  group_key     text        not null,
  entity_name   text        not null,
  risk_slice    text        not null,
  winner_id     uuid        not null,
  loser_id      uuid        not null,
  pivot_folded  boolean     not null default false,
  pivot_note    text,
  snapshot_rows integer     not null default 0,
  reconcile     jsonb,
  merged_at     timestamptz not null default now(),
  unmerged_at   timestamptz
);
create index if not exists idx_lcc_p195_merge_log_batch on public.lcc_p195_merge_log(batch_tag);
create unique index if not exists uq_lcc_p195_merge_log_loser
  on public.lcc_p195_merge_log(loser_id) where unmerged_at is null;

-- ---------------------------------------------------------------------------
-- 4. Snapshot every loser-side row BEFORE the merge touches it.
--    lcc_merge_entity passes p_snapshot => false, so without this the dedup DELETEs
--    (portfolio facts, external identities, relationships, watchers, owner_contact_pivot)
--    are unrecoverable. This is what makes the pass reversible.
-- ---------------------------------------------------------------------------
create or replace function public.lcc_p195_snapshot_loser(p_loser uuid, p_winner uuid, p_note text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare n int; total int := 0;
begin
  insert into public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  select p_loser, p_winner, 'entities', e.id::text, 'p195_pre_merge', to_jsonb(e.*), p_winner, p_note
    from public.entities e where e.id = p_loser;
  get diagnostics n = row_count; total := total + n;

  insert into public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  select p_loser, p_winner, 'lcc_entity_portfolio_facts', f.source_domain||':'||f.source_property_id,
         'p195_pre_merge', to_jsonb(f.*), p_winner, p_note
    from public.lcc_entity_portfolio_facts f where f.entity_id = p_loser;
  get diagnostics n = row_count; total := total + n;

  insert into public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  select p_loser, p_winner, 'external_identities', x.id::text, 'p195_pre_merge', to_jsonb(x.*), p_winner, p_note
    from public.external_identities x where x.entity_id = p_loser;
  get diagnostics n = row_count; total := total + n;

  insert into public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  select p_loser, p_winner, 'entity_relationships', r.id::text, 'p195_pre_merge', to_jsonb(r.*), p_winner, p_note
    from public.entity_relationships r where r.from_entity_id = p_loser or r.to_entity_id = p_loser;
  get diagnostics n = row_count; total := total + n;

  insert into public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  select p_loser, p_winner, 'owner_contact_pivot', p.entity_id::text, 'p195_pre_merge', to_jsonb(p.*), p_winner, p_note
    from public.owner_contact_pivot p where p.entity_id = p_loser;
  get diagnostics n = row_count; total := total + n;

  -- the winner's pivot too: the fold below mutates it, so reversal needs its prior state
  insert into public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  select p_loser, p_winner, 'owner_contact_pivot_winner', p.entity_id::text, 'p195_pre_merge', to_jsonb(p.*), p_winner, p_note
    from public.owner_contact_pivot p where p.entity_id = p_winner;
  get diagnostics n = row_count; total := total + n;

  insert into public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  select p_loser, p_winner, 'lcc_property_owner', po.entity_id::text, 'p195_pre_merge', to_jsonb(po.*), p_winner, p_note
    from public.lcc_property_owner po where po.owner_entity_id = p_loser or po.entity_id = p_loser;
  get diagnostics n = row_count; total := total + n;

  insert into public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  select p_loser, p_winner, 'lcc_property_owner_evidence', ev.entity_id::text||'|'||coalesce(ev.candidate_owner_entity::text,'')||'|'||coalesce(ev.source,''),
         'p195_pre_merge', to_jsonb(ev.*), p_winner, p_note
    from public.lcc_property_owner_evidence ev
   where ev.entity_id = p_loser or ev.candidate_owner_entity = p_loser;
  get diagnostics n = row_count; total := total + n;

  insert into public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  select p_loser, p_winner, 'touchpoint_cadence', c.id::text, 'p195_pre_merge', to_jsonb(c.*), p_winner, p_note
    from public.touchpoint_cadence c where c.entity_id = p_loser or c.contact_id = p_loser;
  get diagnostics n = row_count; total := total + n;

  insert into public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  select p_loser, p_winner, 'bd_opportunities', b.id::text, 'p195_pre_merge', to_jsonb(b.*), p_winner, p_note
    from public.bd_opportunities b where b.entity_id = p_loser;
  get diagnostics n = row_count; total := total + n;

  insert into public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  select p_loser, p_winner, 'watchers', w.id::text, 'p195_pre_merge', to_jsonb(w.*), p_winner, p_note
    from public.watchers w where w.entity_id = p_loser;
  get diagnostics n = row_count; total := total + n;

  return total;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Fold the loser's owner_contact_pivot into the winner's, FILL-BLANKS, before the merge
--    dedup-deletes it. Never overwrites a contact the winner already has -- a winner that
--    already names someone keeps them, and the loser's row is snapshotted either way.
--    active_source is carried across VERBATIM, not restamped: it is read with `<>` and `IN`
--    predicates elsewhere (the tier0 lane), and inventing a new value there is exactly the
--    P194 trap.
-- ---------------------------------------------------------------------------
create or replace function public.lcc_p195_fold_pivot(p_loser uuid, p_winner uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare l record; w record;
begin
  select * into l from public.owner_contact_pivot where entity_id = p_loser;
  if not found then return 'loser_has_no_pivot'; end if;

  select * into w from public.owner_contact_pivot where entity_id = p_winner;
  if not found then return 'winner_has_no_pivot_row_repoints'; end if;   -- no dedup delete will occur

  if l.active_contact_entity_id is null and coalesce(l.active_contact_name,'') = ''
     and coalesce(jsonb_array_length(coalesce(l.bench,'[]'::jsonb)),0) = 0 then
    return 'loser_pivot_empty_nothing_to_fold';
  end if;

  if w.active_contact_entity_id is not null
     and l.active_contact_entity_id is not null
     and w.active_contact_entity_id = l.active_contact_entity_id then
    -- same person on both sides: only the bench can add anything
    if coalesce(jsonb_array_length(coalesce(w.bench,'[]'::jsonb)),0) = 0
       and coalesce(jsonb_array_length(coalesce(l.bench,'[]'::jsonb)),0) > 0 then
      update public.owner_contact_pivot set bench = l.bench, updated_at = now() where entity_id = p_winner;
      return 'same_contact_bench_folded';
    end if;
    return 'same_contact_no_change';
  end if;

  if w.active_contact_entity_id is not null or coalesce(w.active_contact_name,'') <> '' then
    -- the winner already names someone else. Never overwrite; the loser's row is in the
    -- snapshot and the difference is a genuine question, not a fill-blank.
    return 'winner_contact_kept_loser_contact_snapshotted_only';
  end if;

  update public.owner_contact_pivot set
    active_contact_name      = l.active_contact_name,
    active_contact_entity_id = l.active_contact_entity_id,
    active_authority_level   = coalesce(l.active_authority_level, active_authority_level),
    active_contact_role      = coalesce(l.active_contact_role, active_contact_role),
    active_source            = coalesce(l.active_source, active_source),
    confidence               = coalesce(l.confidence, confidence),
    enrichment_action        = case when l.active_contact_entity_id is not null then null else enrichment_action end,
    bench                    = case when coalesce(jsonb_array_length(coalesce(bench,'[]'::jsonb)),0) = 0
                                    then l.bench else bench end,
    pivot_history            = coalesce(pivot_history,'[]'::jsonb) || jsonb_build_object(
                                 'at', now(), 'source', 'p195_merge_fold',
                                 'from_entity_id', p_loser,
                                 'contact', l.active_contact_name),
    updated_at               = now()
  where entity_id = p_winner;

  return 'loser_contact_folded_into_blank_winner';
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The driver. Dry-run by default. Drives group by group -- it never touches
--    v_lcc_merge_candidates.auto_mergeable and never calls lcc_apply_fuzzy_merges.
-- ---------------------------------------------------------------------------
create or replace function public.lcc_p195_merge_byte_identical(
  p_dry_run    boolean default true,
  p_risk_slice text    default null,     -- 'no_owner' | 'one_owner' | 'multi_owner' | null = all
  p_group_key  text    default null,     -- drive a single named group
  p_batch_tag  text    default null,
  p_limit      int     default null
)
returns table(
  group_key text, entity_name text, risk_slice text,
  winner_id uuid, loser_id uuid, pivot_note text, snapshot_rows int, reconcile jsonb, applied boolean
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_batch text := coalesce(p_batch_tag, 'p195_'||to_char(now(),'YYYYMMDDHH24MISS'));
  v_note  text;
  rec record;
  v_snap int;
  v_pivot text;
  v_res record;
  v_done int := 0;
begin
  v_note := 'p195:'||v_batch;

  for rec in
    select l.group_key, l.entity_id as loser_id, l.winner_id, l.name, l.risk_slice
      from public.v_lcc_p195_merge_plan l
     where l.gate_ok
       and not l.is_winner
       and (p_risk_slice is null or l.risk_slice = p_risk_slice)
       and (p_group_key  is null or l.group_key  = p_group_key)
       and not exists (select 1 from public.lcc_p195_merge_log g
                        where g.loser_id = l.entity_id and g.unmerged_at is null)
     order by l.group_key, l.win_rank
  loop
    if p_limit is not null and v_done >= p_limit then exit; end if;

    -- re-read liveness at apply time: an earlier iteration may have moved this row
    if not exists (select 1 from public.entities e
                    where e.id = rec.loser_id and e.merged_into_entity_id is null) then
      continue;
    end if;
    if public.lcc_entity_survivor(rec.winner_id) = rec.loser_id then
      continue;   -- would be a cycle; lcc_merge_entity would raise anyway
    end if;

    if p_dry_run then
      group_key := rec.group_key; entity_name := rec.name; risk_slice := rec.risk_slice;
      winner_id := rec.winner_id; loser_id := rec.loser_id;
      pivot_note := 'dry_run';
      snapshot_rows := 0; reconcile := null; applied := false;
      return next;
      v_done := v_done + 1;
      continue;
    end if;

    v_snap  := public.lcc_p195_snapshot_loser(rec.loser_id, rec.winner_id, v_note);
    v_pivot := public.lcc_p195_fold_pivot(rec.loser_id, rec.winner_id);

    select * into v_res from public.lcc_merge_entity(rec.loser_id, rec.winner_id);

    insert into public.lcc_p195_merge_log(batch_tag,group_key,entity_name,risk_slice,winner_id,loser_id,
                                          pivot_folded,pivot_note,snapshot_rows,reconcile)
    values (v_batch, rec.group_key, rec.name, rec.risk_slice, rec.winner_id, rec.loser_id,
            v_pivot in ('loser_contact_folded_into_blank_winner','same_contact_bench_folded'),
            v_pivot, v_snap,
            jsonb_build_object('portfolio_edges_moved', v_res.portfolio_edges_moved,
                               'external_identities_moved', v_res.external_identities_moved));

    group_key := rec.group_key; entity_name := rec.name; risk_slice := rec.risk_slice;
    winner_id := rec.winner_id; loser_id := rec.loser_id;
    pivot_note := v_pivot; snapshot_rows := v_snap;
    reconcile := jsonb_build_object('portfolio_edges_moved', v_res.portfolio_edges_moved,
                                    'external_identities_moved', v_res.external_identities_moved);
    applied := true;
    return next;
    v_done := v_done + 1;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Reversal. Restores the tombstones and re-inserts every snapshotted loser-side row
--    that the merge deleted, then repoints the rows it moved back to the loser.
--    HONEST LIMITS, stated rather than papered over:
--      * a touchpoint_cadence row the reconcile CONSOLIDATED into the winner's row had its
--        counters summed in; unmerge re-inserts the loser's row but does not subtract them.
--      * the winner's owner_contact_pivot is restored from its own pre-merge snapshot, so a
--        folded contact is undone; a contact written by anything else since the merge is
--        overwritten. Reverse promptly or not at all.
-- ---------------------------------------------------------------------------
create or replace function public.lcc_p195_unmerge(p_batch_tag text)
returns table(loser_id uuid, entity_name text, rows_restored int)
language plpgsql
security definer
set search_path to 'public'
as $$
declare g record; n int; total int; v_note text;
begin
  v_note := 'p195:'||p_batch_tag;
  for g in select * from public.lcc_p195_merge_log where batch_tag = p_batch_tag and unmerged_at is null
           order by id desc
  loop
    total := 0;

    -- clear the tombstone FIRST: entity_relationships / external_identities carry
    -- survivor-resolving INSERT triggers (P177/P178) that would otherwise send every
    -- restored row straight back to the winner and make the unmerge a silent no-op.
    update public.entities set merged_into_entity_id = null, updated_at = now() where id = g.loser_id;

    -- restore the winner's pivot to its pre-merge state (undoes the fold)
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

    -- re-insert / repoint each snapshotted table
    -- is_current is GENERATED ALWAYS on this table: it must be omitted from the column
    -- list. Caught by the round-trip gate, not by review -- a bare `select *` restore of a
    -- snapshotted row fails 428C9 on any table carrying a generated column.
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
    -- a fact that was REPOINTED (not deleted) now sits on the winner under the same key; the
    -- insert above is a no-op for it, so move it back explicitly.
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

    insert into public.external_identities
      select * from jsonb_populate_recordset(null::public.external_identities,
        (select coalesce(jsonb_agg(b.old_row),'[]'::jsonb) from public.r40_merge_reconcile_backup b
          where b.note=v_note and b.tombstone_id=g.loser_id and b.table_name='external_identities'))
      on conflict (id) do update set entity_id = excluded.entity_id;
    get diagnostics n = row_count; total := total + n;

    insert into public.entity_relationships
      select * from jsonb_populate_recordset(null::public.entity_relationships,
        (select coalesce(jsonb_agg(b.old_row),'[]'::jsonb) from public.r40_merge_reconcile_backup b
          where b.note=v_note and b.tombstone_id=g.loser_id and b.table_name='entity_relationships'))
      on conflict (id) do update set from_entity_id = excluded.from_entity_id,
                                     to_entity_id   = excluded.to_entity_id;
    get diagnostics n = row_count; total := total + n;

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
    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Class 8 -- what re-creates the row tomorrow?
--    A one-shot repair of a recurring producer is a chore you repeat silently forever
--    (P176). This detector runs nightly and opens a deduped health alert when a NEW
--    byte-identical duplicate appears with a distinctive name, so the re-sweep is
--    automatic rather than something a human has to remember.
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_p195_resurrection_watch as
select v.group_key,
       v.member_count,
       v.resolved_owner_members,
       v.combined_annual_rent,
       v.member_names,
       (select max(e.created_at) from public.entities e where e.id = any(v.member_entity_ids)) as newest_member_created_at,
       exists (select 1 from public.lcc_p195_merge_log g
                where g.group_key = v.group_key and g.unmerged_at is null) as previously_merged_by_p195
from public.v_lcc_merge_candidates_normalizer_blind v
where v.names_identical
  and public.lcc_p195_name_has_distinctive_residue(split_part(v.member_names, ' | ', 1));

comment on view public.v_lcc_p195_resurrection_watch is
  'P195 Class-8 watch: byte-identical owner groups with a distinctive name that are still open. previously_merged_by_p195 = true means a group P195 cleaned has re-accumulated members -- a producer is re-minting, not a leftover.';

create or replace function public.lcc_p195_check_resurrection()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_groups int; v_regrown int; v_alerts int := 0;
begin
  select count(*), count(*) filter (where previously_merged_by_p195)
    into v_groups, v_regrown
    from public.v_lcc_p195_resurrection_watch;

  if v_regrown > 0 then
    insert into public.lcc_health_alerts(alert_kind, source, severity, summary, details)
    select 'p195_duplicate_owner_resurrection', 'lcc_p195_check_resurrection', 'warning',
           'byte-identical owner duplicates re-minted after the P195 merge',
           jsonb_build_object('regrown_groups', v_regrown, 'open_groups', v_groups,
                              'keys', (select jsonb_agg(group_key) from public.v_lcc_p195_resurrection_watch
                                        where previously_merged_by_p195))
    where not exists (select 1 from public.lcc_health_alerts a
                       where a.alert_kind = 'p195_duplicate_owner_resurrection' and a.resolved_at is null);
    get diagnostics v_alerts = row_count;
  else
    update public.lcc_health_alerts set resolved_at = now(),
           resolved_note = 'p195-resurrection-auto-resolve: no re-minted group'
     where alert_kind = 'p195_duplicate_owner_resurrection' and resolved_at is null;
  end if;

  return jsonb_build_object('open_groups', v_groups, 'regrown_groups', v_regrown, 'alerts_opened', v_alerts);
end;
$$;

grant select on public.v_lcc_p195_merge_plan          to service_role;
grant select on public.v_lcc_p195_resurrection_watch  to service_role, authenticated;

-- ---------------------------------------------------------------------------
-- 9. The Class-8 sweep is SCHEDULED, not a chore anyone has to remember.
--    06:52 UTC -- the only free minute in the 06:20-06:58 block, and after
--    generate-research-tasks (06:35) so a group re-minted overnight is caught the
--    same morning. A pure-SQL check, so it needs no lcc_cron_post round trip.
-- ---------------------------------------------------------------------------
select cron.schedule('lcc-p195-resurrection-watch', '52 6 * * *',
                     $cron$select public.lcc_p195_check_resurrection();$cron$);
