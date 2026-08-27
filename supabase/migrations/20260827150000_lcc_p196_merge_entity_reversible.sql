-- P196 Unit 1 (backlog N11) -- make the SHARED merge path reversible.
--
-- THE DEFECT. `lcc_merge_entity` called
--     lcc_reconcile_tombstone_backrefs(loser, winner, p_snapshot => FALSE)
-- so every dedup DELETE it performed -- portfolio facts, external identities,
-- relationships, watchers -- was unrecoverable. On top of that, the P160 block that
-- lives INSIDE lcc_merge_entity (lcc_property_owner, lcc_property_owner_evidence,
-- owner_contact_pivot, bd_opportunities) had NO snapshot at all, in either function.
-- Flipping p_snapshot alone would therefore have left the single worst path -- the
-- owner_contact_pivot DELETE -- exactly as unrecoverable as before.
--
-- ⚠ ONE CORRECTION TO THE FILED DEFECT. P195 called the pivot dedup predicate
--    "uncorrelated": `... where l.entity_id = p_loser and exists (select 1 from
--    owner_contact_pivot w where w.entity_id = v_winner)`. Measured:
--    owner_contact_pivot's PRIMARY KEY is (entity_id), and so is lcc_property_owner's,
--    so at most one row exists per entity and the un-correlated EXISTS is *equivalent*
--    to a correlated one. The predicate is not the bug. The bug is that it DELETES
--    content instead of FOLDING it, with no ledger. That is what is fixed here.
--
-- WHY IT MATTERS NOW. P195 recorded the auto-merge loop (`lcc_apply_fuzzy_merges`,
-- 3,053 auto_mergeable groups) as the risk and noted it has no caller -- still true
-- (cron scan: 0 rows; api/ callers: 0). But `lcc_merge_entity` ITSELF is not dormant:
-- nine human-verdict call sites in api/ drive it and **285 entities were merged in the
-- last 30 days, 176 in the last 7**. The irreversible pivot delete has been running all
-- along; it is not a latent risk waiting on a wiring decision.
--
-- WHAT THIS MIGRATION DOES
--   1. `lcc_merge_snapshot_loser` / `lcc_merge_fold_pivot` -- the P195 driver's two
--      helpers, promoted to the shared path. `lcc_p195_snapshot_loser` and
--      `lcc_p195_fold_pivot` become thin delegates so there is ONE implementation
--      (the prompt's "reuse that code; do not write a second version").
--   2. `lcc_merge_entity` snapshots the whole loser side, folds the pivot FILL-BLANKS,
--      calls the reconcile with p_snapshot => TRUE, and writes an action-labelled
--      backup row before every P160 dedup DELETE and repoint.
--   3. `lcc_entity_merge_log` -- one row per merge, and `lcc_unmerge_entity(loser)` --
--      the reversal the path has never had.
--
-- ⚠ active_source is carried across VERBATIM by the fold, never restamped. The Tier 0
--   lane reads that column with `<>` and `IN`, and inventing a new value there is the
--   P194 trap (a new enum member silently satisfies every inequality written against
--   the old one).
--
-- ⚠ lcc_entity_portfolio_facts.is_current is GENERATED ALWAYS. A bare `select *`
--   restore of a snapshotted row fails 428C9. P195's round trip caught that; this
--   file omits the column by name in every restore.
--
-- REVERSAL RUNBOOK:
--   select * from public.lcc_unmerge_entity('<loser-uuid>');
--   -- honest limits are stated in the function header; reverse promptly or not at all.
--
-- VERIFIED LIVE 2026-08-27, before this was called done:
--   * REAL round trip on `Monaco Holdings` (77a2e107) -> `Monaco Holdings LLC`
--     (69ed8a49), an auto_mergeable byte-name duplicate. The merge dedup-DELETED a
--     portfolio fact (dia:26141) and the loser's owner_contact_pivot, repointed 3
--     relationships, 1 external identity and 1 lcc_property_owner.owner_entity_id.
--     lcc_unmerge_entity restored 10 rows. Full-row diff over entities /
--     portfolio_facts / external_identities / entity_relationships /
--     owner_contact_pivot / lcc_property_owner / lcc_property_owner_evidence /
--     touchpoint_cadence / bd_opportunities / watchers for BOTH entities:
--     16 rows before, 16 after, ZERO lost, ZERO new. `auto_mergeable` 3,053 -> 3,053.
--     (updated_at is excluded from the diff -- the merge and the unmerge both touch
--     it. Content is restored; the timestamp is not rewound.)
--   * The FOLD path, which Monaco could not exercise (both its pivots were blank),
--     proven by a self-rolling-back synthetic gate: winner names nobody, loser names
--     "Alex Bias Test" (active_source='tier0_confirm'). After the merge the winner
--     holds the contact with active_source STILL 'tier0_confirm' and
--     pivot_history[0].source='entity_merge_fold'; after the unmerge the winner is
--     blank again on 'worklist_sweep' and the loser holds its contact. 0 residue.
--   * Pre-P196 backlog, stated honestly: 2,411 existing tombstones,
--     `v_lcc_entity_merge_reversibility.reversible` = FALSE for all of them. Those
--     merges have no snapshot and never will.
--
-- NOT DONE HERE, DELIBERATELY: nothing wires up `lcc_apply_fuzzy_merges`. Whether
-- 3,053 groups should ever auto-merge unattended is a decision, not a consequence of
-- making the path reversible. `auto_mergeable` is untouched.

-- ---------------------------------------------------------------------------
-- 1. The ledger.
-- ---------------------------------------------------------------------------
create table if not exists public.lcc_entity_merge_log (
  id             bigserial   primary key,
  loser_id       uuid        not null,
  winner_id      uuid        not null,
  snapshot_note  text        not null,
  snapshot_rows  integer     not null default 0,
  pivot_note     text,
  reconcile      jsonb,
  merged_at      timestamptz not null default now(),
  unmerged_at    timestamptz,
  unmerged_rows  integer
);
create index if not exists idx_lcc_entity_merge_log_loser  on public.lcc_entity_merge_log(loser_id);
create index if not exists idx_lcc_entity_merge_log_winner on public.lcc_entity_merge_log(winner_id);
create unique index if not exists uq_lcc_entity_merge_log_open
  on public.lcc_entity_merge_log(loser_id) where unmerged_at is null;

comment on table public.lcc_entity_merge_log is
  'P196/N11: one row per lcc_merge_entity call. snapshot_note keys the r40_merge_reconcile_backup rows that make the merge reversible via lcc_unmerge_entity(loser).';

-- ---------------------------------------------------------------------------
-- 2. Shared snapshot. Body promoted verbatim from lcc_p195_snapshot_loser -- the
--    whole loser side BEFORE anything touches it, plus the WINNER's pivot, which
--    the fold mutates.
-- ---------------------------------------------------------------------------
create or replace function public.lcc_merge_snapshot_loser(p_loser uuid, p_winner uuid, p_note text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare n int; total int := 0;
begin
  insert into public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  select p_loser, p_winner, 'entities', e.id::text, 'p196_pre_merge', to_jsonb(e.*), p_winner, p_note
    from public.entities e where e.id = p_loser;
  get diagnostics n = row_count; total := total + n;

  insert into public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  select p_loser, p_winner, 'lcc_entity_portfolio_facts', f.source_domain||':'||f.source_property_id,
         'p196_pre_merge', to_jsonb(f.*), p_winner, p_note
    from public.lcc_entity_portfolio_facts f where f.entity_id = p_loser;
  get diagnostics n = row_count; total := total + n;

  insert into public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  select p_loser, p_winner, 'external_identities', x.id::text, 'p196_pre_merge', to_jsonb(x.*), p_winner, p_note
    from public.external_identities x where x.entity_id = p_loser;
  get diagnostics n = row_count; total := total + n;

  insert into public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  select p_loser, p_winner, 'entity_relationships', r.id::text, 'p196_pre_merge', to_jsonb(r.*), p_winner, p_note
    from public.entity_relationships r where r.from_entity_id = p_loser or r.to_entity_id = p_loser;
  get diagnostics n = row_count; total := total + n;

  insert into public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  select p_loser, p_winner, 'owner_contact_pivot', p.entity_id::text, 'p196_pre_merge', to_jsonb(p.*), p_winner, p_note
    from public.owner_contact_pivot p where p.entity_id = p_loser;
  get diagnostics n = row_count; total := total + n;

  -- the WINNER's pivot too: the fold mutates it, so reversal needs its prior state.
  insert into public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  select p_loser, p_winner, 'owner_contact_pivot_winner', p.entity_id::text, 'p196_pre_merge', to_jsonb(p.*), p_winner, p_note
    from public.owner_contact_pivot p where p.entity_id = p_winner;
  get diagnostics n = row_count; total := total + n;

  insert into public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  select p_loser, p_winner, 'lcc_property_owner', po.entity_id::text, 'p196_pre_merge', to_jsonb(po.*), p_winner, p_note
    from public.lcc_property_owner po where po.owner_entity_id = p_loser or po.entity_id = p_loser;
  get diagnostics n = row_count; total := total + n;

  insert into public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  select p_loser, p_winner, 'lcc_property_owner_evidence',
         ev.entity_id::text||'|'||coalesce(ev.candidate_owner_entity::text,'')||'|'||coalesce(ev.source,''),
         'p196_pre_merge', to_jsonb(ev.*), p_winner, p_note
    from public.lcc_property_owner_evidence ev
   where ev.entity_id = p_loser or ev.candidate_owner_entity = p_loser;
  get diagnostics n = row_count; total := total + n;

  insert into public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  select p_loser, p_winner, 'touchpoint_cadence', c.id::text, 'p196_pre_merge', to_jsonb(c.*), p_winner, p_note
    from public.touchpoint_cadence c where c.entity_id = p_loser or c.contact_id = p_loser;
  get diagnostics n = row_count; total := total + n;

  insert into public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  select p_loser, p_winner, 'bd_opportunities', b.id::text, 'p196_pre_merge', to_jsonb(b.*), p_winner, p_note
    from public.bd_opportunities b where b.entity_id = p_loser;
  get diagnostics n = row_count; total := total + n;

  insert into public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  select p_loser, p_winner, 'watchers', w.id::text, 'p196_pre_merge', to_jsonb(w.*), p_winner, p_note
    from public.watchers w where w.entity_id = p_loser;
  get diagnostics n = row_count; total := total + n;

  return total;
end;
$$;

comment on function public.lcc_merge_snapshot_loser(uuid,uuid,text) is
  'P196: snapshot the whole loser side (plus the winner pivot the fold mutates) into r40_merge_reconcile_backup under p_note, BEFORE lcc_merge_entity touches anything.';

-- ---------------------------------------------------------------------------
-- 3. Shared pivot fold. Body promoted from lcc_p195_fold_pivot.
--    FILL-BLANKS. A winner that already names someone KEEPS them and the loser's row
--    is snapshotted, not resolved -- a disagreement about who the contact is is a
--    genuine question, never a fill-blank.
-- ---------------------------------------------------------------------------
create or replace function public.lcc_merge_fold_pivot(p_loser uuid, p_winner uuid)
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
    if coalesce(jsonb_array_length(coalesce(w.bench,'[]'::jsonb)),0) = 0
       and coalesce(jsonb_array_length(coalesce(l.bench,'[]'::jsonb)),0) > 0 then
      update public.owner_contact_pivot set bench = l.bench, updated_at = now() where entity_id = p_winner;
      return 'same_contact_bench_folded';
    end if;
    return 'same_contact_no_change';
  end if;

  if w.active_contact_entity_id is not null or coalesce(w.active_contact_name,'') <> '' then
    return 'winner_contact_kept_loser_contact_snapshotted_only';
  end if;

  update public.owner_contact_pivot set
    active_contact_name      = l.active_contact_name,
    active_contact_entity_id = l.active_contact_entity_id,
    active_authority_level   = coalesce(l.active_authority_level, active_authority_level),
    active_contact_role      = coalesce(l.active_contact_role, active_contact_role),
    -- VERBATIM, never restamped (P194).
    active_source            = coalesce(l.active_source, active_source),
    confidence               = coalesce(l.confidence, confidence),
    enrichment_action        = case when l.active_contact_entity_id is not null then null else enrichment_action end,
    bench                    = case when coalesce(jsonb_array_length(coalesce(bench,'[]'::jsonb)),0) = 0
                                    then l.bench else bench end,
    pivot_history            = coalesce(pivot_history,'[]'::jsonb) || jsonb_build_object(
                                 'at', now(), 'source', 'entity_merge_fold',
                                 'from_entity_id', p_loser,
                                 'contact', l.active_contact_name),
    updated_at               = now()
  where entity_id = p_winner;

  return 'loser_contact_folded_into_blank_winner';
end;
$$;

comment on function public.lcc_merge_fold_pivot(uuid,uuid) is
  'P196: fold the loser owner_contact_pivot into the winner FILL-BLANKS before the merge dedup-deletes it. active_source carried verbatim (P194). Returns the disposition, never null.';

-- ---------------------------------------------------------------------------
-- 4. The P195 helpers become delegates -- ONE implementation, not two that drift.
-- ---------------------------------------------------------------------------
create or replace function public.lcc_p195_snapshot_loser(p_loser uuid, p_winner uuid, p_note text)
returns integer
language sql
security definer
set search_path to 'public'
as $$ select public.lcc_merge_snapshot_loser(p_loser, p_winner, p_note); $$;

create or replace function public.lcc_p195_fold_pivot(p_loser uuid, p_winner uuid)
returns text
language sql
security definer
set search_path to 'public'
as $$ select public.lcc_merge_fold_pivot(p_loser, p_winner); $$;

comment on function public.lcc_p195_snapshot_loser(uuid,uuid,text) is
  'P196: delegates to lcc_merge_snapshot_loser. Kept so lcc_p195_merge_byte_identical and its reversal path are unchanged.';
comment on function public.lcc_p195_fold_pivot(uuid,uuid) is
  'P196: delegates to lcc_merge_fold_pivot. NOTE the pivot_history source tag is now entity_merge_fold, not p195_merge_fold.';

-- ---------------------------------------------------------------------------
-- 5. lcc_merge_entity -- WHOLE function, carried in this file.
--    (P194: a migration that changes a function must carry the whole function. The
--    live body drifting from the newest committed source is what made P194's rebuild
--    silently drop two arms.)
-- ---------------------------------------------------------------------------
create or replace function public.lcc_merge_entity(p_loser uuid, p_winner uuid)
 returns table(portfolio_edges_moved integer, external_identities_moved integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v jsonb;
  v_winner uuid;
  v_note text;
  v_snap int;
  v_pivot text;
  v_hw bigint;
BEGIN
  IF p_loser = p_winner THEN
    RAISE EXCEPTION 'lcc_merge_entity: loser and winner must differ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.entities WHERE id=p_winner) THEN
    RAISE EXCEPTION 'lcc_merge_entity: winner % does not exist', p_winner;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.entities WHERE id=p_loser) THEN
    RAISE EXCEPTION 'lcc_merge_entity: loser % does not exist', p_loser;
  END IF;

  -- P160: never merge an entity that is already merged away.
  IF EXISTS (SELECT 1 FROM public.entities WHERE id=p_loser AND merged_into_entity_id IS NOT NULL) THEN
    RAISE EXCEPTION 'lcc_merge_entity: loser % is already a tombstone', p_loser;
  END IF;

  -- P160: a caller naming a tombstone as the winner means the SURVIVOR.
  v_winner := public.lcc_entity_survivor(p_winner);

  IF v_winner = p_loser THEN
    RAISE EXCEPTION
      'lcc_merge_entity: refusing to create a merge cycle -- winner % resolves to the loser %',
      p_winner, p_loser;
  END IF;
  IF v_winner IS NULL OR EXISTS (SELECT 1 FROM public.entities
                                  WHERE id=v_winner AND merged_into_entity_id IS NOT NULL) THEN
    RAISE EXCEPTION 'lcc_merge_entity: winner % does not resolve to a live survivor', p_winner;
  END IF;

  -- P196: one tag per merge, so a reversal can scope exactly its own rows.
  v_note := 'entity_merge:' || gen_random_uuid()::text;

  -- P196 (a): snapshot the whole loser side BEFORE anything moves.
  v_snap := public.lcc_merge_snapshot_loser(p_loser, v_winner, v_note);

  -- P196 (b): fold the pivot FILL-BLANKS before the dedup DELETE below can destroy it.
  --   Measured live on `bamproperties` during P195: the winner-by-ownership named
  --   NOBODY and the loser carried the group's only named contact. A bare merge
  --   deleted it with no error and no ledger.
  v_pivot := public.lcc_merge_fold_pivot(p_loser, v_winner);

  -- P196 (c): the reconcile now snapshots. Its rows land with note NULL, so stamp
  -- them with this merge's tag; the alternative is a signature change on a function
  -- with three callers.
  SELECT coalesce(max(id), 0) INTO v_hw FROM public.r40_merge_reconcile_backup;
  v := public.lcc_reconcile_tombstone_backrefs(p_loser, v_winner, true);
  UPDATE public.r40_merge_reconcile_backup
     SET note = v_note
   WHERE id > v_hw AND tombstone_id = p_loser AND note IS NULL;

  -- P160: ownership + BD backrefs the reconcile does not handle. Dedup, then move.
  -- P196: each dedup DELETE and each repoint is now action-labelled in the ledger,
  -- because knowing WHICH of the two happened is what makes the reversal exact.
  INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  SELECT p_loser, v_winner, 'lcc_property_owner', l.entity_id::text, 'p196_po_dedup_delete', to_jsonb(l.*), v_winner, v_note
    FROM public.lcc_property_owner l
   WHERE l.entity_id = p_loser
     AND EXISTS (SELECT 1 FROM public.lcc_property_owner w WHERE w.entity_id = v_winner);
  DELETE FROM public.lcc_property_owner l
   WHERE l.entity_id = p_loser
     AND EXISTS (SELECT 1 FROM public.lcc_property_owner w WHERE w.entity_id = v_winner);

  INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  SELECT p_loser, v_winner, 'lcc_property_owner', l.entity_id::text, 'p196_po_repoint_entity', to_jsonb(l.*), v_winner, v_note
    FROM public.lcc_property_owner l WHERE l.entity_id = p_loser;
  UPDATE public.lcc_property_owner SET entity_id = v_winner WHERE entity_id = p_loser;

  INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  SELECT p_loser, v_winner, 'lcc_property_owner', l.entity_id::text, 'p196_po_repoint_owner', to_jsonb(l.*), v_winner, v_note
    FROM public.lcc_property_owner l WHERE l.owner_entity_id = p_loser;
  UPDATE public.lcc_property_owner SET owner_entity_id = v_winner,
         owner_name = COALESCE((SELECT name FROM public.entities WHERE id=v_winner), owner_name)
   WHERE owner_entity_id = p_loser;

  INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  SELECT p_loser, v_winner, 'lcc_property_owner_evidence',
         l.entity_id::text||'|'||coalesce(l.candidate_owner_entity::text,'')||'|'||coalesce(l.source,''),
         'p196_ev_dedup_delete', to_jsonb(l.*), v_winner, v_note
    FROM public.lcc_property_owner_evidence l
   WHERE l.candidate_owner_entity = p_loser
     AND EXISTS (SELECT 1 FROM public.lcc_property_owner_evidence w
                  WHERE w.entity_id = l.entity_id
                    AND w.candidate_owner_entity = v_winner
                    AND w.source = l.source);
  DELETE FROM public.lcc_property_owner_evidence l
   WHERE l.candidate_owner_entity = p_loser
     AND EXISTS (SELECT 1 FROM public.lcc_property_owner_evidence w
                  WHERE w.entity_id = l.entity_id
                    AND w.candidate_owner_entity = v_winner
                    AND w.source = l.source);
  UPDATE public.lcc_property_owner_evidence SET candidate_owner_entity = v_winner
   WHERE candidate_owner_entity = p_loser;

  INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  SELECT p_loser, v_winner, 'lcc_property_owner_evidence',
         l.entity_id::text||'|'||coalesce(l.candidate_owner_entity::text,'')||'|'||coalesce(l.source,''),
         'p196_ev_dedup_delete', to_jsonb(l.*), v_winner, v_note
    FROM public.lcc_property_owner_evidence l
   WHERE l.entity_id = p_loser
     AND EXISTS (SELECT 1 FROM public.lcc_property_owner_evidence w
                  WHERE w.entity_id = v_winner
                    AND w.candidate_owner_entity = l.candidate_owner_entity
                    AND w.source = l.source);
  DELETE FROM public.lcc_property_owner_evidence l
   WHERE l.entity_id = p_loser
     AND EXISTS (SELECT 1 FROM public.lcc_property_owner_evidence w
                  WHERE w.entity_id = v_winner
                    AND w.candidate_owner_entity = l.candidate_owner_entity
                    AND w.source = l.source);
  UPDATE public.lcc_property_owner_evidence SET entity_id = v_winner WHERE entity_id = p_loser;

  INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  SELECT p_loser, v_winner, 'owner_contact_pivot', l.entity_id::text, 'p196_pivot_dedup_delete', to_jsonb(l.*), v_winner, v_note
    FROM public.owner_contact_pivot l
   WHERE l.entity_id = p_loser
     AND EXISTS (SELECT 1 FROM public.owner_contact_pivot w WHERE w.entity_id = v_winner);
  DELETE FROM public.owner_contact_pivot l
   WHERE l.entity_id = p_loser
     AND EXISTS (SELECT 1 FROM public.owner_contact_pivot w WHERE w.entity_id = v_winner);

  INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  SELECT p_loser, v_winner, 'owner_contact_pivot', l.entity_id::text, 'p196_pivot_repoint', to_jsonb(l.*), v_winner, v_note
    FROM public.owner_contact_pivot l WHERE l.entity_id = p_loser;
  UPDATE public.owner_contact_pivot SET entity_id = v_winner WHERE entity_id = p_loser;

  INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
  SELECT p_loser, v_winner, 'bd_opportunities', b.id::text, 'p196_bd_repoint', to_jsonb(b.*), v_winner, v_note
    FROM public.bd_opportunities b WHERE b.entity_id = p_loser;
  UPDATE public.bd_opportunities SET entity_id = v_winner WHERE entity_id = p_loser;

  UPDATE public.entities SET merged_into_entity_id=v_winner, updated_at=now() WHERE id=p_loser;

  portfolio_edges_moved     := (v->>'portfolio_edges_moved')::int;
  external_identities_moved := (v->>'external_identities_moved')::int;

  INSERT INTO public.lcc_entity_merge_log(loser_id,winner_id,snapshot_note,snapshot_rows,pivot_note,reconcile)
  VALUES (p_loser, v_winner, v_note, v_snap, v_pivot,
          v || jsonb_build_object('pivot_fold', v_pivot));

  RETURN NEXT;
END;
$function$;

comment on function public.lcc_merge_entity(uuid,uuid) is
  'P196/N11: snapshots the loser side, folds owner_contact_pivot fill-blanks, reconciles with p_snapshot=true and action-labels every P160 dedup/repoint. Reverse with lcc_unmerge_entity(loser).';

-- ---------------------------------------------------------------------------
-- 6. The reversal the path has never had.
--
--    HONEST LIMITS, stated rather than papered over -- the same two P195 recorded,
--    because they are properties of the reconcile, not of this wrapper:
--      * a touchpoint_cadence row the reconcile CONSOLIDATED had its counters summed
--        into the winner's row; unmerge re-inserts the loser's row but does not
--        subtract them.
--      * the winner's owner_contact_pivot is restored from its pre-merge snapshot, so
--        anything written to it since the merge is overwritten. Reverse promptly or
--        not at all.
--    A third, specific to a shared path: rows CREATED after the merge that point at
--    the winner are not attributed back to the loser. They were never the loser's.
-- ---------------------------------------------------------------------------
-- ⚠ THE ROUND TRIP CAUGHT A BUG REVIEW DID NOT, EXACTLY AS THE PROMPT WARNED.
--    The first cut restored entity_relationships / external_identities / watchers with
--    INSERT ... ON CONFLICT (id) DO UPDATE. Both of those tables carry a BEFORE INSERT
--    survivor-resolving trigger (P177/P178), and P177's SKIPS a row that duplicates an
--    edge the resolved entity already holds -- it returns NULL, so the row never reaches
--    the ON CONFLICT clause and the DO UPDATE never runs.
--    Measured live on `Monaco Holdings`: three BYTE-IDENTICAL (loser -> 4f1b724a,
--    'purchases') edges. Edge 1 restored; edges 2 and 3 were then duplicates of edge 1
--    and were silently skipped, leaving them on the WINNER -- and the unmerge returned
--    'restored'. A reversal path that has never been RUN is a claim, not a capability.
--    Fix: repoint rows that still EXIST with an UPDATE (both triggers are BEFORE INSERT
--    only, so an UPDATE bypasses them) and INSERT only rows the merge actually DELETED.
--    A deleted row the trigger still refuses is COUNTED and named in the return value
--    rather than passing as a clean restore.
create or replace function public.lcc_unmerge_entity(p_loser uuid)
returns table(loser_id uuid, entity_name text, rows_restored integer, note text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare g record; n int; total int := 0; v_note text; v_live boolean;
        v_rel_want int := 0; v_rel_have int := 0; v_notes text[] := '{}';
begin
  select * into g from public.lcc_entity_merge_log
   where lcc_entity_merge_log.loser_id = p_loser and unmerged_at is null
   order by id desc limit 1;
  if not found then
    loser_id := p_loser;
    entity_name := (select e.name from public.entities e where e.id = p_loser);
    rows_restored := 0; note := 'no_open_merge_log_row';
    return next; return;
  end if;

  v_note := g.snapshot_note;

  select (e.merged_into_entity_id is null) into v_live from public.entities e where e.id = p_loser;
  if coalesce(v_live, false) then
    update public.lcc_entity_merge_log set unmerged_at = now(), unmerged_rows = 0 where id = g.id;
    loser_id := p_loser;
    entity_name := (select e.name from public.entities e where e.id = p_loser);
    rows_restored := 0; note := 'already_live_ledger_closed';
    return next; return;
  end if;

  -- Clear the tombstone FIRST: the P177/P178 INSERT triggers would otherwise send every
  -- restored row straight back to the winner and make the unmerge a silent no-op.
  update public.entities set merged_into_entity_id = null, updated_at = now() where id = p_loser;

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
  where b.note = v_note and b.tombstone_id = p_loser
    and b.table_name = 'owner_contact_pivot_winner' and p.entity_id = g.winner_id;
  get diagnostics n = row_count; total := total + n;

  -- portfolio facts. is_current is GENERATED ALWAYS: omit it by name (428C9).
  insert into public.lcc_entity_portfolio_facts
    (entity_id, source_domain, source_property_id, ownership_start_date, ownership_end_date,
     annual_rent, sale_price, cap_rate, ownership_source, updated_at)
  select r.entity_id, r.source_domain, r.source_property_id, r.ownership_start_date, r.ownership_end_date,
         r.annual_rent, r.sale_price, r.cap_rate, r.ownership_source, r.updated_at
    from jsonb_populate_recordset(null::public.lcc_entity_portfolio_facts,
      (select coalesce(jsonb_agg(b.old_row - 'is_current'),'[]'::jsonb)
         from public.r40_merge_reconcile_backup b
        where b.note=v_note and b.tombstone_id=p_loser
          and b.table_name='lcc_entity_portfolio_facts' and b.action='p196_pre_merge')) r
    on conflict (entity_id, source_domain, source_property_id) do nothing;
  get diagnostics n = row_count; total := total + n;

  update public.lcc_entity_portfolio_facts f set entity_id = p_loser
    from public.r40_merge_reconcile_backup b
   where b.note=v_note and b.tombstone_id=p_loser
     and b.table_name='lcc_entity_portfolio_facts' and b.action='p196_pre_merge'
     and f.entity_id = g.winner_id
     and f.source_domain = b.old_row->>'source_domain'
     and f.source_property_id = b.old_row->>'source_property_id'
     and not exists (select 1 from public.lcc_entity_portfolio_facts x
                      where x.entity_id=p_loser and x.source_domain=f.source_domain
                        and x.source_property_id=f.source_property_id);
  get diagnostics n = row_count; total := total + n;

  -- external identities: UPDATE what survives, INSERT only what was deleted.
  update public.external_identities x set entity_id = (b.old_row->>'entity_id')::uuid
    from public.r40_merge_reconcile_backup b
   where b.note=v_note and b.tombstone_id=p_loser
     and b.table_name='external_identities' and b.action='p196_pre_merge'
     and x.id = (b.old_row->>'id')::uuid;
  get diagnostics n = row_count; total := total + n;

  insert into public.external_identities
    select * from jsonb_populate_recordset(null::public.external_identities,
      (select coalesce(jsonb_agg(b.old_row),'[]'::jsonb) from public.r40_merge_reconcile_backup b
        where b.note=v_note and b.tombstone_id=p_loser
          and b.table_name='external_identities' and b.action='p196_pre_merge'
          and not exists (select 1 from public.external_identities x2
                           where x2.id = (b.old_row->>'id')::uuid)))
    on conflict (id) do nothing;
  get diagnostics n = row_count; total := total + n;

  -- relationships: same shape, and the one that bit. Count what was wanted vs what
  -- is actually back, so a trigger-skipped row is reported, never silent.
  select count(*) into v_rel_want from public.r40_merge_reconcile_backup b
   where b.note=v_note and b.tombstone_id=p_loser
     and b.table_name='entity_relationships' and b.action='p196_pre_merge';

  update public.entity_relationships r
     set from_entity_id = (b.old_row->>'from_entity_id')::uuid,
         to_entity_id   = (b.old_row->>'to_entity_id')::uuid
    from public.r40_merge_reconcile_backup b
   where b.note=v_note and b.tombstone_id=p_loser
     and b.table_name='entity_relationships' and b.action='p196_pre_merge'
     and r.id = (b.old_row->>'id')::uuid;
  get diagnostics n = row_count; total := total + n;

  insert into public.entity_relationships
    select * from jsonb_populate_recordset(null::public.entity_relationships,
      (select coalesce(jsonb_agg(b.old_row),'[]'::jsonb) from public.r40_merge_reconcile_backup b
        where b.note=v_note and b.tombstone_id=p_loser
          and b.table_name='entity_relationships' and b.action='p196_pre_merge'
          and not exists (select 1 from public.entity_relationships r2
                           where r2.id = (b.old_row->>'id')::uuid)))
    on conflict (id) do nothing;
  get diagnostics n = row_count; total := total + n;

  select count(*) into v_rel_have from public.r40_merge_reconcile_backup b
    join public.entity_relationships r on r.id = (b.old_row->>'id')::uuid
   where b.note=v_note and b.tombstone_id=p_loser
     and b.table_name='entity_relationships' and b.action='p196_pre_merge'
     and r.from_entity_id is not distinct from (b.old_row->>'from_entity_id')::uuid
     and r.to_entity_id   is not distinct from (b.old_row->>'to_entity_id')::uuid;
  if v_rel_have < v_rel_want then
    v_notes := v_notes || ('relationships_not_restored=' || (v_rel_want - v_rel_have)::text);
  end if;

  -- watchers
  update public.watchers w set entity_id = (b.old_row->>'entity_id')::uuid
    from public.r40_merge_reconcile_backup b
   where b.note=v_note and b.tombstone_id=p_loser
     and b.table_name='watchers' and b.action='p196_pre_merge'
     and w.id = (b.old_row->>'id')::uuid;
  get diagnostics n = row_count; total := total + n;

  insert into public.watchers
    select * from jsonb_populate_recordset(null::public.watchers,
      (select coalesce(jsonb_agg(b.old_row),'[]'::jsonb) from public.r40_merge_reconcile_backup b
        where b.note=v_note and b.tombstone_id=p_loser
          and b.table_name='watchers' and b.action='p196_pre_merge'
          and not exists (select 1 from public.watchers w2 where w2.id = (b.old_row->>'id')::uuid)))
    on conflict (id) do nothing;
  get diagnostics n = row_count; total := total + n;

  -- the loser's own pivot
  update public.owner_contact_pivot p set entity_id = p_loser
    from public.r40_merge_reconcile_backup b
   where b.note=v_note and b.tombstone_id=p_loser and b.action='p196_pivot_repoint'
     and p.entity_id = g.winner_id
     and not exists (select 1 from public.owner_contact_pivot x where x.entity_id = p_loser);
  get diagnostics n = row_count; total := total + n;

  insert into public.owner_contact_pivot
    select * from jsonb_populate_recordset(null::public.owner_contact_pivot,
      (select coalesce(jsonb_agg(b.old_row),'[]'::jsonb) from public.r40_merge_reconcile_backup b
        where b.note=v_note and b.tombstone_id=p_loser
          and b.table_name='owner_contact_pivot' and b.action='p196_pre_merge'))
    on conflict (entity_id) do nothing;
  get diagnostics n = row_count; total := total + n;

  -- lcc_property_owner
  insert into public.lcc_property_owner
    select * from jsonb_populate_recordset(null::public.lcc_property_owner,
      (select coalesce(jsonb_agg(b.old_row),'[]'::jsonb) from public.r40_merge_reconcile_backup b
        where b.note=v_note and b.tombstone_id=p_loser and b.action='p196_po_dedup_delete'))
    on conflict (entity_id) do nothing;
  get diagnostics n = row_count; total := total + n;

  update public.lcc_property_owner po set entity_id = p_loser
    from public.r40_merge_reconcile_backup b
   where b.note=v_note and b.tombstone_id=p_loser and b.action='p196_po_repoint_entity'
     and po.entity_id = g.winner_id
     and not exists (select 1 from public.lcc_property_owner x where x.entity_id = p_loser);
  get diagnostics n = row_count; total := total + n;

  update public.lcc_property_owner po set owner_entity_id = p_loser,
         owner_name = coalesce((select e.name from public.entities e where e.id=p_loser), po.owner_name)
    from public.r40_merge_reconcile_backup b
   where b.note=v_note and b.tombstone_id=p_loser and b.action='p196_po_repoint_owner'
     and po.entity_id = (b.old_row->>'entity_id')::uuid
     and po.owner_entity_id = g.winner_id;
  get diagnostics n = row_count; total := total + n;

  -- evidence: the repoint changes part of the PK, so delete-the-moved-row then
  -- re-insert the pre-merge rows is the exact reversal.
  delete from public.lcc_property_owner_evidence ev
   using public.r40_merge_reconcile_backup b
   where b.note=v_note and b.tombstone_id=p_loser
     and b.table_name='lcc_property_owner_evidence' and b.action='p196_pre_merge'
     and ev.entity_id = (case when b.old_row->>'entity_id' = p_loser::text then g.winner_id
                              else (b.old_row->>'entity_id')::uuid end)
     and ev.candidate_owner_entity is not distinct from
         (case when b.old_row->>'candidate_owner_entity' = p_loser::text then g.winner_id
               else nullif(b.old_row->>'candidate_owner_entity','')::uuid end)
     and ev.source is not distinct from (b.old_row->>'source');
  get diagnostics n = row_count; total := total + n;

  insert into public.lcc_property_owner_evidence
    select * from jsonb_populate_recordset(null::public.lcc_property_owner_evidence,
      (select coalesce(jsonb_agg(b.old_row),'[]'::jsonb) from public.r40_merge_reconcile_backup b
        where b.note=v_note and b.tombstone_id=p_loser
          and b.table_name='lcc_property_owner_evidence' and b.action='p196_pre_merge'))
    on conflict (entity_id, candidate_owner_entity, source) do nothing;
  get diagnostics n = row_count; total := total + n;

  update public.bd_opportunities b2 set entity_id = p_loser
    from public.r40_merge_reconcile_backup b
   where b.note=v_note and b.tombstone_id=p_loser and b.action='p196_bd_repoint'
     and b2.id = (b.old_row->>'id')::uuid;
  get diagnostics n = row_count; total := total + n;

  insert into public.touchpoint_cadence
    select * from jsonb_populate_recordset(null::public.touchpoint_cadence,
      (select coalesce(jsonb_agg(b.old_row),'[]'::jsonb) from public.r40_merge_reconcile_backup b
        where b.note=v_note and b.tombstone_id=p_loser
          and b.table_name='touchpoint_cadence' and b.action='p196_pre_merge'
          and not exists (select 1 from public.touchpoint_cadence c2
                           where c2.id = (b.old_row->>'id')::uuid)))
    on conflict (id) do nothing;
  get diagnostics n = row_count; total := total + n;

  update public.touchpoint_cadence c set entity_id = p_loser
    from public.r40_merge_reconcile_backup b
   where b.note=v_note and b.tombstone_id=p_loser
     and b.table_name='touchpoint_cadence' and b.action='p196_pre_merge'
     and c.id = (b.old_row->>'id')::uuid and b.old_row->>'entity_id' = p_loser::text;
  get diagnostics n = row_count; total := total + n;

  update public.touchpoint_cadence c set contact_id = p_loser
    from public.r40_merge_reconcile_backup b
   where b.note=v_note and b.tombstone_id=p_loser
     and b.table_name='touchpoint_cadence' and b.action='p196_pre_merge'
     and c.id = (b.old_row->>'id')::uuid and b.old_row->>'contact_id' = p_loser::text;
  get diagnostics n = row_count; total := total + n;

  update public.lcc_entity_merge_log set unmerged_at = now(), unmerged_rows = total where id = g.id;

  loser_id := p_loser;
  entity_name := (select e.name from public.entities e where e.id = p_loser);
  rows_restored := total;
  note := case when array_length(v_notes,1) is null then 'restored'
               else 'restored_with_residue:' || array_to_string(v_notes, ',') end;
  return next;
end;
$$;

comment on function public.lcc_unmerge_entity(uuid) is
  'P196/N11: reverse one lcc_merge_entity call. Repoints surviving rows with UPDATE (the P177/P178 survivor triggers are BEFORE INSERT only and SKIP duplicates, which silently defeats an ON CONFLICT restore) and inserts only rows the merge deleted. Reports relationships_not_restored rather than passing a partial restore as clean.';

grant execute on function public.lcc_unmerge_entity(uuid) to service_role;
grant select on public.lcc_entity_merge_log to service_role;

-- ---------------------------------------------------------------------------
-- 7. The instrument. A merge with no ledger row is a merge nobody can reverse --
--    which is the state EVERY merge before this migration is in, permanently.
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_entity_merge_reversibility as
select e.id                                       as loser_id,
       e.name                                     as entity_name,
       e.merged_into_entity_id                    as winner_id,
       e.updated_at                               as merged_at_approx,
       (g.id is not null)                         as reversible,
       g.snapshot_rows,
       g.pivot_note,
       g.unmerged_at
  from public.entities e
  left join public.lcc_entity_merge_log g
         on g.loser_id = e.id and g.unmerged_at is null
 where e.merged_into_entity_id is not null;

comment on view public.v_lcc_entity_merge_reversibility is
  'P196: every tombstone, and whether lcc_unmerge_entity can reverse it. reversible=false is the pre-P196 backlog -- those merges have no snapshot and never will.';

grant select on public.v_lcc_entity_merge_reversibility to service_role, authenticated;
