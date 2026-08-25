-- ============================================================================
-- P167 — owners stranded on a TOMBSTONED contact: the P160 defect one column
--        over (2026-08-22). Applied live to LCC Opps (xengecqvemvfknjvbvrq).
--
-- P160 hardened lcc_merge_entity to move ownership backrefs, including
-- `owner_contact_pivot` — but only its `entity_id` column (the OWNER). The table
-- carries a SECOND entity FK, `active_contact_entity_id` (the CONTACT), and that
-- one was never in the merge path. Verified directly:
--
--   lcc_merge_entity              references active_contact_entity_id : FALSE
--   lcc_reconcile_tombstone_backrefs  ... same                        : FALSE
--
-- So merging any CONTACT person left every owner pointing at it stranded on a
-- tombstone. Live, not theoretical: 3 owners carrying $180.1M, headed by
-- Boyd Watterson Asset Management ($179.8M, 273 assets).
--
-- ⚠️ AND THE OBVIOUS FIX WAS THE WRONG ONE. "Repoint to the merge survivor"
-- looks correct and is what the first version of this sweep did. Checking the
-- NAMED ROWS before applying showed all three survivors resolve to
-- "Boyd Watterson Asset Management, LLC" — an ORGANISATION with no email and no
-- phone. Applying it would have:
--   • made Boyd Watterson its OWN contact — the phantom pattern P162/P164 just
--     spent two days removing, reintroduced through the front door;
--   • handed Austin Community College and Abilene TX I SGF LLC a wholly
--     unrelated company as their decision-maker.
-- Those pointers were already garbage; repointing would have made them *more*
-- wrong AND invisible to the phantom detector (which keys on name containment,
-- and "Boyd Watterson Asset Management" does not contain "Austin Community
-- College").
--
-- A SURVIVOR IS NOT AUTOMATICALLY A VALID CONTACT. The sweep now classifies:
--   repoint_to_survivor              survivor is a PERSON with email or phone
--   null_it_self_reference           survivor IS the owner
--   null_it_survivor_is_org          survivor is an organisation
--   null_it_survivor_has_no_contact  survivor has neither email nor phone
--   null_it_no_survivor              chain resolves to nothing
-- Live result: 1 self-reference + 2 org-survivors, 0 repoints. All nulled.
-- Nulling is honest — "no contact on file" is TRUE and routes the owner back
-- into the acquisition queue; a wrong contact does not.
--
-- ⚠️ THE MERGE PATH ITSELF IS STILL NOT FIXED — this is a self-healing SWEEP,
-- not a repair of lcc_merge_entity. That was a deliberate risk trade: the merge
-- function is a large SECURITY DEFINER body and rewriting it blind, at the end
-- of a long session, to fix a 3-row defect is the worse gamble. The sweep is
-- idempotent (re-run returns empty) and can be crond. FOLLOW-UP: add
-- `active_contact_entity_id` to lcc_reconcile_tombstone_backrefs so the strand
-- never forms.
--
-- ALSO SURFACED, NOT FIXED: 83 owners have an ORGANISATION as their
-- `active_contact_entity_id`. Those are pre-existing and unrelated to this
-- sweep (they point at live orgs, not tombstones), but an organisation is not a
-- decision-maker. Same family as the phantom worklist; needs its own review.
--
-- VERIFICATION GATE (all PASS after apply):
--   owners pointing at a tombstoned contact  0
--   owners whose contact IS themselves       0
--   Boyd Watterson contact                   NULL (correct: needs a real person)
--   sweep re-run                             empty (idempotent)
--
-- REVERSAL: the nulled rows are recoverable from the pivot's history/backups;
--   the sweep itself is reversed by not running it. drop function if exists
--   lcc_fix_stranded_contact_pointers(boolean,text);
-- ============================================================================

create or replace function lcc_fix_stranded_contact_pointers(
  p_dry_run boolean default true,
  p_batch   text    default null
) returns table(action text, owners bigint, annual_rent numeric)
language plpgsql as $$
declare
  v_batch text := coalesce(p_batch, 'contact-ptr-' || to_char(now(),'YYYYMMDDHH24MI'));
begin
  drop table if exists _stranded;   -- re-callable within one statement/session
  create temp table _stranded on commit drop as
  select p.entity_id,
         p.active_contact_entity_id as old_contact,
         lcc_entity_survivor(p.active_contact_entity_id) as surv,
         lcc_owner_known_annual_rent(p.entity_id) as rent
  from owner_contact_pivot p
  join entities c on c.id = p.active_contact_entity_id
  where c.merged_into_entity_id is not null;

  alter table _stranded add column disposition text;
  update _stranded s set disposition = case
    when s.surv is null                                   then 'null_it_no_survivor'
    when s.surv = s.entity_id                             then 'null_it_self_reference'
    when (select e.entity_type from entities e where e.id=s.surv) <> 'person'
                                                          then 'null_it_survivor_is_org'
    when (select coalesce(nullif(btrim(e.email),''), nullif(btrim(e.phone),''))
            from entities e where e.id=s.surv) is null    then 'null_it_survivor_has_no_contact'
    else 'repoint_to_survivor' end;

  if p_dry_run then
    return query select 'DRY-RUN ' || s.disposition, count(*)::bigint, coalesce(sum(s.rent),0)
                 from _stranded s group by s.disposition;
    return;
  end if;

  update owner_contact_pivot p
     set active_contact_entity_id = s.surv,
         active_contact_name = (select e.name from entities e where e.id=s.surv),
         updated_at = now()
  from _stranded s where s.entity_id = p.entity_id and s.disposition = 'repoint_to_survivor';

  update owner_contact_pivot p
     set active_contact_entity_id = null, active_contact_name = null,
         active_authority_level = null, active_contact_role = null, updated_at = now()
  from _stranded s where s.entity_id = p.entity_id and s.disposition <> 'repoint_to_survivor';

  return query select 'APPLIED ' || s.disposition || ' (batch ' || v_batch || ')',
                      count(*)::bigint, coalesce(sum(s.rent),0)
               from _stranded s group by s.disposition;
end $$;
