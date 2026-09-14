-- ============================================================================
-- P178 — an external identity must never be minted against a merged-away entity
--        (2026-08-26). Applied live to LCC Opps (xengecqvemvfknjvbvrq).
--
-- Fourth and final Class-8 producer from the 2026-08-26 sweep. 45 identities sat
-- on tombstones, **26 of them created AFTER the merge**, dominated by the CoStar
-- sidebar (`costar/company` 18, `salesforce/Account` 3, `rca/company` 3).
-- `lcc_reconcile_tombstone_backrefs` DOES move identities on merge, so this was
-- the familiar shape: the merge path is correct and a producer re-mints.
--
-- ⚠️ MEASURED BEFORE BUILDING, AND IT CHANGED THE DESIGN TWICE:
--
--  1. **The unique key does NOT include entity_id.** It is
--     `(workspace_id, source_system, source_type, external_id)`. So repointing an
--     identity to its survivor cannot collide the way an EDGE could — the P177
--     dedup class is structurally almost impossible here (it needs the ghost and
--     survivor to hold the same identity in DIFFERENT workspaces). Measured: **0
--     collisions**, so the repair is a pure repoint, 45 for 45.
--
--  2. **NONE of the 45 are domain-anchor identities.** Zero `asset` / zero
--     `true_owner`. That is the reassuring half of the finding: the canonical
--     domain anchors CLAUDE.md warns about (`external_identities(source_system=
--     'dia'|'gov', source_type='true_owner', external_id=properties.true_owner_id)`
--     — the join that resolves a domain owner to an LCC entity BY ID) were clean.
--     Had they not been, the blast radius would have been the entire
--     owner-resolution path rather than 45 vendor rows.
--
-- The guard is kept anyway and SKIPS rather than raises: if the survivor already
-- holds the identity, the desired end state is already true, so a 23505 that
-- aborts the ingestion which wrote it would be strictly worse than a no-op.
-- (Same reasoning as P119's `already_out` and P177's duplicate-edge skip.)
--
-- The trigger deliberately does NOT touch `source_system` / `source_type` — the
-- canonical scheme and `chk_external_identities_source_system` remain the single
-- authority on spelling (see CLAUDE.md, "external_identities canonical scheme").
--
-- RESULT: 45 repointed, 0 dedup-deleted, 0 stranded remaining.
--
-- TRIGGER MUTATION TESTS (self-cleaning, 0 residue) — all PASS:
--   T1 an identity written against a ghost lands on the survivor    true
--   T2 the same identity inserted twice yields ONE row, no 23505       1
--   T3 probe residue after cleanup                                     0
--
-- ─── CLASS 8 IS NOW CLEAN ────────────────────────────────────────────────────
-- Full re-sweep of every entity-referencing column carrying a `created_at`
-- (excluding this work's own repair logs, which record ghosts by design):
--
--   lcc_decisions.subject_entity_id      61 exact_name_merge — BY DESIGN, 0 open
--                                          (the card records WHICH entity merged)
--                                         + 1 sf_contact_account_mismatch, open,
--                                           deliberately left for a human by P172
--   entity_relationships.to_entity_id     8 — both endpoints resolve to the SAME
--                                           survivor, i.e. an edge from an entity
--                                           to itself. Void; left, not deleted
--                                           (P164 lesson: 8 void rows do not
--                                           justify another broad rule).
--   lcc_boyd_reconcile_2026_07           42 — one-off reconcile snapshot
--   sf_account_on_person_cleanup_backup   1 — a backup table
--
-- Nothing left is a live producer. Everything remaining is by-design history, a
-- backup, or a held human judgement.
--
-- REVERSAL:
--   select * from lcc_unrepair_stranded_identities('p178-identities-20260826');
--   drop trigger trg_lcc_external_identity_resolve_survivor on external_identities;
-- ============================================================================

create or replace function lcc_external_identity_resolve_survivor()
returns trigger language plpgsql as $$
declare v uuid;
begin
  v := coalesce(public.lcc_entity_survivor(NEW.entity_id), NEW.entity_id);
  NEW.entity_id := v;

  -- The unique key is (workspace_id, source_system, source_type, external_id) and
  -- does NOT include entity_id, so resolution cannot normally collide. Guard it
  -- anyway: if the survivor already holds this exact identity the desired end
  -- state is already true, so skip rather than raise a 23505 that would abort
  -- the ingestion that wrote it.
  if exists (select 1 from public.external_identities w
              where w.workspace_id  is not distinct from NEW.workspace_id
                and w.source_system = NEW.source_system
                and w.source_type   is not distinct from NEW.source_type
                and w.external_id   = NEW.external_id
                and w.entity_id     = v) then
    return null;
  end if;

  return NEW;
end $$;

drop trigger if exists trg_lcc_external_identity_resolve_survivor on public.external_identities;
create trigger trg_lcc_external_identity_resolve_survivor
  before insert on public.external_identities
  for each row execute function lcc_external_identity_resolve_survivor();

create table if not exists lcc_p178_identity_repair_log (
  id bigserial primary key,
  batch_tag text not null,
  identity_id uuid,
  ghost_entity_id uuid not null,
  survivor_entity_id uuid not null,
  source_system text, source_type text, external_id text,
  repaired_at timestamptz not null default now(),
  reverted_at timestamptz
);

create or replace function lcc_repair_stranded_identities(
  p_dry_run boolean default true, p_batch text default null
) returns table(action text, identities bigint)
language plpgsql as $$
declare v_batch text := coalesce(p_batch, 'p178-' || to_char(now(),'YYYYMMDDHH24MI'));
begin
  drop table if exists _ei;
  create temp table _ei on commit drop as
  select x.id as identity_id, x.entity_id as ghost,
         lcc_entity_survivor(x.entity_id) as surv,
         x.workspace_id, x.source_system, x.source_type, x.external_id
  from external_identities x
  join entities e on e.id = x.entity_id
  where e.merged_into_entity_id is not null;

  delete from _ei where surv is null or surv = ghost;
  delete from _ei using entities y where y.id = _ei.surv and y.merged_into_entity_id is not null;

  drop table if exists _eid;
  create temp table _eid on commit drop as
  select p.*, exists (select 1 from external_identities w
                       where w.entity_id = p.surv
                         and w.workspace_id is not distinct from p.workspace_id
                         and w.source_system = p.source_system
                         and w.source_type is not distinct from p.source_type
                         and w.external_id = p.external_id) as is_dup
  from _ei p;

  if p_dry_run then
    return query select case when d.is_dup then 'DRY-RUN dedup_delete' else 'DRY-RUN repoint' end,
                        count(*)::bigint from _eid d group by d.is_dup order by 1;
    return;
  end if;

  insert into lcc_p178_identity_repair_log(batch_tag, identity_id, ghost_entity_id,
    survivor_entity_id, source_system, source_type, external_id)
  select v_batch, d.identity_id, d.ghost, d.surv, d.source_system, d.source_type, d.external_id
  from _eid d;

  delete from external_identities x using _eid d where d.is_dup and x.id = d.identity_id;

  update external_identities x set entity_id = d.surv
  from _eid d where not d.is_dup and x.id = d.identity_id;

  return query select case when d.is_dup then 'DEDUP_DELETED (batch '||v_batch||')'
                           else 'REPOINTED (batch '||v_batch||')' end,
                      count(*)::bigint from _eid d group by d.is_dup order by 1;
end $$;

create or replace function lcc_unrepair_stranded_identities(p_batch text)
returns table(action text, identities bigint) language plpgsql as $$
begin
  update external_identities x set entity_id = l.ghost_entity_id
  from lcc_p178_identity_repair_log l
  where l.batch_tag = p_batch and l.reverted_at is null and x.id = l.identity_id;
  update lcc_p178_identity_repair_log set reverted_at = now()
   where batch_tag = p_batch and reverted_at is null;
  return query select 'REVERTED '||p_batch, count(*)::bigint
               from lcc_p178_identity_repair_log where batch_tag=p_batch and reverted_at is not null;
end $$;
