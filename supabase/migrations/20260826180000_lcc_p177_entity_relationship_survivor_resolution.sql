-- ============================================================================
-- P177 — an edge must never be written against a merged-away party
--        (2026-08-26). Applied live to LCC Opps (xengecqvemvfknjvbvrq).
--
-- Third Class-8 producer found by the sweep (see DEAD_END_AUDIT_PLAYBOOK.md).
-- `entity_relationships` held 184 edges whose FROM endpoint was a tombstone —
-- **131 of them CREATED AFTER the merge, 125 in the last 30 days.** This is the
-- party-role store the deal spine and reachability both read, so unlike a log
-- table these strands are not inert.
--
-- ⚠️ THE "OBSERVABILITY GAP" THAT BLOCKED THIS WAS MY OWN DETECTOR'S FAULT.
-- The first Class-8 sweep reported entity_relationships as "unmeasurable — no
-- updated_at" and filed it as an instrumentation gap. The table has
-- **`created_at`**, which is a STRICTLY BETTER signal for this question: "was
-- this row CREATED after the merge?" is unambiguous, where `updated_at` can move
-- on an unconditional no-op touch (the caveat P175 had already documented).
-- Same for `lcc_owner_reconcile_evidence` and `external_identities`. **Before
-- declaring something unmeasurable, check the columns that ARE there.**
--
-- WHAT THE EDGES ARE (post-merge creations): brokers/listing_broker 48,
-- sells/true_seller 20, purchases/buyer 17, owns/owner 12, sells/seller 12,
-- purchases/true_buyer 9, leases/tenant 5, associated_with/parent_of 4.
-- Transaction history, not contacts — so the BD cost is concrete: **41 distinct
-- survivors were under-reporting their own deal history**, because their sales
-- and purchases sat on a dead twin. An active seller looks less active than
-- they are, which is exactly the signal Scott's prospecting ranks on.
--
-- THE FIX IS A TRIGGER, NOT A PATCHED CALLER. `insertEntityRelationship`
-- (api/_shared/ops-db.js) is the single JS choke point and guards missing
-- endpoints + self-loops, but not liveness. A BEFORE INSERT trigger resolving
-- BOTH endpoints is writer-agnostic (covers SQL writers too), costs no extra
-- round trip, and follows the existing trg_lcc_cadence_future_touch_guard
-- precedent.
--
-- ⚠️ TWO CASES THE TRIGGER MUST SKIP RATHER THAN RAISE:
--   • SELF-LOOP. If both endpoints resolve to the same survivor the edge is
--     meaningless AND `chk_entity_relationships_no_self_loop` would raise,
--     breaking the ingestion that wrote it. This is the P167 shape (an org
--     becoming its own contact) reappearing as a constraint.
--   • DUPLICATE. Resolution can land on an edge the survivor already has;
--     inserting it would double-count the party's transaction history. Note
--     there is NO unique constraint on (from,to,type) — duplicates are legal,
--     so nothing would have caught this.
--
-- ⚠️ THE FIRST REPAIR WAS HALF A REPAIR, AND MY OWN GATE CAUGHT IT. It selected
-- only rows whose FROM endpoint was a tombstone; the verification then reported
-- 0 stranded on `from` and **14 still stranded on `to`**. An edge has two ends.
-- (P118: fix every layer, not the one the error names.) P177b re-selects on
-- either endpoint.
--
-- RESULT:
--   pass 1 (from-side)  166 repointed,  18 dedup-deleted
--   pass 2 (to-side)      4 repointed,   2 dedup-deleted
--   remaining                8 — both endpoints resolve to the SAME survivor,
--                            i.e. an edge between an entity and itself. Void by
--                            construction and correctly skipped. Left in place
--                            rather than deleted: 8 void rows do not justify
--                            another broadly-applied rule (the P164 lesson).
--
-- TRIGGER MUTATION TESTS (self-cleaning, 0 residue) — all PASS:
--   T1 an edge written against a ghost lands on the survivor        true
--   T2 the same edge inserted twice yields ONE row                     1
--   T3 a ghost->survivor edge is skipped, raising NO exception          0
--   T4 probe residue after cleanup                                      0
--
-- REVERSAL:
--   select * from lcc_unrepair_stranded_entity_edges('p177-edges-20260826');
--   select * from lcc_unrepair_stranded_entity_edges('p177b-to-side-20260826');
--   drop trigger trg_lcc_entity_rel_resolve_survivor on entity_relationships;
--   (dedup_delete rows are recoverable from lcc_p177_edge_repair_log.old_row)
-- ============================================================================

create or replace function lcc_entity_rel_resolve_survivor()
returns trigger language plpgsql as $$
declare f uuid; t uuid;
begin
  f := coalesce(public.lcc_entity_survivor(NEW.from_entity_id), NEW.from_entity_id);
  t := coalesce(public.lcc_entity_survivor(NEW.to_entity_id),   NEW.to_entity_id);

  -- A merge must never turn a real edge into a self-loop (the P167 shape:
  -- an org becoming its own contact). chk_entity_relationships_no_self_loop
  -- would raise; skipping is correct because the edge is meaningless.
  if f is not null and f = t then return null; end if;

  NEW.from_entity_id := f;
  NEW.to_entity_id   := t;

  -- Resolution can make this a duplicate of an edge the survivor already has.
  -- The insert was semantically a no-op, so drop it rather than double-count
  -- the party's transaction history.
  if exists (select 1 from public.entity_relationships w
              where w.from_entity_id = f and w.to_entity_id = t
                and w.relationship_type is not distinct from NEW.relationship_type
                and coalesce(w.metadata->>'role','') = coalesce(NEW.metadata->>'role','')) then
    return null;
  end if;

  return NEW;
end $$;

drop trigger if exists trg_lcc_entity_rel_resolve_survivor on public.entity_relationships;
create trigger trg_lcc_entity_rel_resolve_survivor
  before insert on public.entity_relationships
  for each row execute function lcc_entity_rel_resolve_survivor();

create table if not exists lcc_p177_edge_repair_log (
  id bigserial primary key,
  batch_tag text not null,
  action text not null,               -- 'repoint' | 'dedup_delete'
  edge_id uuid,
  old_from uuid, old_to uuid, new_from uuid, new_to uuid,
  old_row jsonb not null,
  repaired_at timestamptz not null default now(),
  reverted_at timestamptz
);

create or replace function lcc_repair_stranded_entity_edges(
  p_dry_run boolean default true, p_batch text default null
) returns table(action text, edges bigint)
language plpgsql as $$
declare v_batch text := coalesce(p_batch, 'p177-' || to_char(now(),'YYYYMMDDHH24MI'));
begin
  drop table if exists _er;
  create temp table _er on commit drop as
  select r.id as edge_id, r.from_entity_id as old_from, r.to_entity_id as old_to,
         coalesce(lcc_entity_survivor(r.from_entity_id), r.from_entity_id) as new_from,
         coalesce(lcc_entity_survivor(r.to_entity_id),   r.to_entity_id)   as new_to,
         r.relationship_type, r.metadata->>'role' as role, to_jsonb(r.*) as old_row
  from entity_relationships r
  -- BOTH endpoints, not just `from` (P177b).
  where exists (select 1 from entities e where e.id = r.from_entity_id and e.merged_into_entity_id is not null)
     or exists (select 1 from entities e where e.id = r.to_entity_id   and e.merged_into_entity_id is not null);

  delete from _er where new_from = new_to
     or (new_from = old_from and new_to = old_to);
  delete from _er using entities s
   where (s.id = _er.new_from or s.id = _er.new_to) and s.merged_into_entity_id is not null;

  drop table if exists _erd;
  create temp table _erd on commit drop as
  select p.*, exists (select 1 from entity_relationships w
                       where w.from_entity_id=p.new_from and w.to_entity_id=p.new_to
                         and w.relationship_type is not distinct from p.relationship_type
                         and coalesce(w.metadata->>'role','')=coalesce(p.role,'')
                         and w.id <> p.edge_id) as is_dup
  from _er p;

  if p_dry_run then
    return query select case when d.is_dup then 'DRY-RUN dedup_delete (survivor already has this edge)'
                             else 'DRY-RUN repoint' end, count(*)::bigint
                 from _erd d group by d.is_dup order by 1;
    return;
  end if;

  insert into lcc_p177_edge_repair_log(batch_tag, action, edge_id, old_from, old_to, new_from, new_to, old_row)
  select v_batch, case when d.is_dup then 'dedup_delete' else 'repoint' end,
         d.edge_id, d.old_from, d.old_to, d.new_from, d.new_to, d.old_row
  from _erd d;

  delete from entity_relationships r using _erd d where d.is_dup and r.id = d.edge_id;

  update entity_relationships r
     set from_entity_id = d.new_from, to_entity_id = d.new_to
  from _erd d where not d.is_dup and r.id = d.edge_id;

  return query select case when d.is_dup then 'DEDUP_DELETED (batch '||v_batch||')'
                           else 'REPOINTED (batch '||v_batch||')' end, count(*)::bigint
               from _erd d group by d.is_dup order by 1;
end $$;

create or replace function lcc_unrepair_stranded_entity_edges(p_batch text)
returns table(action text, edges bigint) language plpgsql as $$
begin
  update entity_relationships r
     set from_entity_id = l.old_from, to_entity_id = l.old_to
  from lcc_p177_edge_repair_log l
  where l.batch_tag = p_batch and l.reverted_at is null and l.action='repoint' and r.id = l.edge_id;

  update lcc_p177_edge_repair_log set reverted_at = now()
   where batch_tag = p_batch and reverted_at is null;
  return query select 'REVERTED '||p_batch, count(*)::bigint
               from lcc_p177_edge_repair_log where batch_tag=p_batch and reverted_at is not null;
end $$;
