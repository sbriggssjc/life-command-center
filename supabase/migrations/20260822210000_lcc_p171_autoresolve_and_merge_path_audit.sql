-- ============================================================================
-- P171 — (a) attach the unambiguous contacts, (b) a REPEATABLE audit for the
--        defect class that produced P160 and P167 (2026-08-22).
--        Applied live to LCC Opps (xengecqvemvfknjvbvrq).
--
-- ─── (a) AUTO-RESOLVE, FILL-BLANKS ONLY ─────────────────────────────────────
-- P170 proposed 31 owners with exactly one clean person at the firm. The write
-- is smaller than the proposal, and the difference matters:
--
--     31  auto_resolve candidates
--      9  BLANK pivot            -> ATTACHED ($37.9M)
--     17  already point at EXACTLY this person -> no-op
--      3  already have a DIFFERENT contact     -> never clobbered
--      2  no pivot row at all                  -> follow-up
--
-- ⚠️ THOSE 17 NO-OPS ARE THE ACCURACY EVIDENCE. The resolver independently
-- picked the same person that a human or another process had already
-- established, 17 times out of the 20 owners where a comparison was possible.
-- That is a far better argument for the rule than any reasoning about it.
--
-- Attached (all 9 read by name before the write): Trammell Crow Co -> Thomas
-- Finan, Saban Capital Group -> Daniel Goldstone, Procacci Development Company
-- -> Philip Procacci, Acquest Development -> Omar Abu-Sitta, Excelsior
-- Westbrook III -> William George, Garrett Development -> Andrew Garrett, Crown
-- MedRealty -> Steve Bessenbacher, Marlene Gast -> Jim Gast, Escape Velocity ->
-- Grant Rodolph.
--
-- NOTED, not hidden: "Marlene Gast -> Jim Gast <jimg@gast-construction.com>" is
-- an INDIVIDUAL owner matched to a contact at the family firm. Defensible (same
-- surname, same business) but it is the one row a human should glance at.
--
-- Reversible: lcc_unresolve_owner_contacts('p171-autoresolve-20260822').
--
-- ─── (b) THE AUDIT — lcc_audit_merge_path_coverage() ────────────────────────
-- P160 found four entity FKs missing from the merge path. P167 found a fifth
-- (owner_contact_pivot.active_contact_entity_id). Both were found BY HAND, one
-- at a time, after they had already stranded live rows. This generalises it.
--
-- The function enumerates every uuid column named like an entity reference,
-- checks it against the WHOLE merge path, and counts rows currently pointing at
-- a tombstone.
--
-- ⚠️ TWO DESIGN POINTS THAT EACH FIXED A WRONG ANSWER WHILE BUILDING IT:
--
--  1. DECLARED FOREIGN KEYS ARE NOT ENOUGH. The first version enumerated
--     pg_constraint FKs to entities(id) — and would have MISSED
--     owner_contact_pivot.active_contact_entity_id, the P167 defect, because
--     that column carries no FK constraint. The audit matches on COLUMN NAME
--     instead, which is looser but catches the undeclared references that are
--     precisely the ones nobody remembered to add to the merge path.
--
--  2. THE MERGE PATH IS MORE THAN ONE FUNCTION. Checking only
--     lcc_reconcile_tombstone_backrefs reported lcc_property_owner.owner_entity_id
--     as uncovered — a false positive, because P160 put that repoint in
--     lcc_merge_entity. The audit reads all three functions
--     (lcc_reconcile_tombstone_backrefs, lcc_merge_entity, lcc_entity_survivor).
--     28 apparent defects fell to 20 real ones once this was fixed.
--
-- LIVE RESULT (2026-08-22): 27 columns not covered, 9 with LIVE strands,
-- 370 stranded rows. Ranked:
--
--     lcc_decisions.subject_entity_id                286   <- Decision Center
--     lcc_owner_reconcile_evidence.candidate_entity_id 72
--     lcc_buyer_spe_resolved.parent_entity_id          4
--     lcc_operator_affiliate_patterns.parent_entity_id 2
--     + 5 single-row columns
--
-- lcc_decisions is the notable one: 286 Decision Center cards whose SUBJECT was
-- merged away. A card about an entity that no longer exists cannot be actioned
-- correctly, and nothing was detecting it.
--
-- ⚠️ NOT FIXED HERE, DELIBERATELY. This migration ships the DETECTOR, not the
-- repairs. Each column needs its own disposition decision — P167 proved that
-- "repoint to the survivor" is the obvious answer and the wrong one (all three
-- survivors were organisations, and repointing would have made Boyd Watterson
-- its own contact). Repairing 370 rows across 9 columns on one blanket rule is
-- exactly the mistake this session already made once, in P164.
--
-- SUGGESTED USE: run it after any bulk merge, and before believing any count
-- that joins entities.
--
-- VERIFICATION GATE:
--   select count(*) filter (where not covered_by_merge_path and stranded_rows > 0)
--     from lcc_audit_merge_path_coverage();     -- expect 9 today
--   select * from lcc_autoresolve_owner_contacts(true);  -- expect 0 (idempotent)
--
-- REVERSAL: select * from lcc_unresolve_owner_contacts('p171-autoresolve-20260822');
--           drop function if exists lcc_audit_merge_path_coverage();
-- ============================================================================

create table if not exists lcc_contact_autoresolve_log (
  id bigserial primary key,
  batch_tag text not null,
  entity_id uuid not null,
  owner_name text,
  attached_person_id uuid,
  attached_person_name text,
  attached_email text,
  prior_active_contact_entity_id uuid,
  attached_at timestamptz not null default now(),
  reverted_at timestamptz
);

create or replace function lcc_autoresolve_owner_contacts(
  p_dry_run boolean default true, p_batch text default null
) returns table(action text, owners bigint, annual_rent numeric)
language plpgsql as $$
declare v_batch text := coalesce(p_batch, 'autoresolve-' || to_char(now(),'YYYYMMDDHH24MI'));
begin
  drop table if exists _ar;
  create temp table _ar on commit drop as
  select c.owner_entity_id, c.owner_name, c.person_id, c.person_name, c.email,
         c.known_annual_rent as rent
  from v_lcc_contact_autoresolve_candidates c
  join owner_contact_pivot p on p.entity_id = c.owner_entity_id
  where c.disposition = 'auto_resolve'
    and p.active_contact_entity_id is null;   -- FILL-BLANKS ONLY, never clobber

  if p_dry_run then
    return query select 'DRY-RUN would_attach'::text, count(*)::bigint, coalesce(sum(rent),0) from _ar;
    return;
  end if;

  insert into lcc_contact_autoresolve_log(batch_tag, entity_id, owner_name,
    attached_person_id, attached_person_name, attached_email, prior_active_contact_entity_id)
  select v_batch, a.owner_entity_id, a.owner_name, a.person_id, a.person_name, a.email, null from _ar a;

  update owner_contact_pivot p
     set active_contact_entity_id = a.person_id,
         active_contact_name      = a.person_name,
         active_contact_role      = coalesce(p.active_contact_role,'decision_maker_candidate'),
         updated_at               = now()
  from _ar a where a.owner_entity_id = p.entity_id;

  return query select 'ATTACHED (batch ' || v_batch || ')', count(*)::bigint, coalesce(sum(rent),0) from _ar;
end $$;

create or replace function lcc_unresolve_owner_contacts(p_batch text)
returns table(action text, owners bigint) language plpgsql as $$
begin
  update owner_contact_pivot p
     set active_contact_entity_id = l.prior_active_contact_entity_id,
         active_contact_name = null, active_contact_role = null, updated_at = now()
  from lcc_contact_autoresolve_log l
  where l.batch_tag = p_batch and l.reverted_at is null and p.entity_id = l.entity_id;
  update lcc_contact_autoresolve_log set reverted_at = now()
   where batch_tag = p_batch and reverted_at is null;
  return query select 'REVERTED ' || p_batch, count(*)::bigint
               from lcc_contact_autoresolve_log where batch_tag=p_batch and reverted_at is not null;
end $$;

create or replace function lcc_audit_merge_path_coverage()
returns table(tbl text, col text, covered_by_merge_path boolean, stranded_rows bigint)
language plpgsql as $$
declare r record; n bigint;
begin
  for r in
    with cols as (
      select c.table_name t, c.column_name c
      from information_schema.columns c
      join information_schema.tables tb on tb.table_name=c.table_name and tb.table_schema='public'
      where c.table_schema='public' and tb.table_type='BASE TABLE' and c.data_type='uuid'
        and (c.column_name like '%entity_id' or c.column_name like '%_entity')
        and c.column_name <> 'merged_into_entity_id'
    ), body as (
      select string_agg(pg_get_functiondef(oid), E'\n') d from pg_proc
      where proname in ('lcc_reconcile_tombstone_backrefs','lcc_merge_entity','lcc_entity_survivor')
    )
    select cols.t, cols.c, (body.d ilike '%'||cols.c||'%') as cov from cols, body
  loop
    begin
      execute format('select count(*) from %I x join entities e on e.id = x.%I '
                     'where e.merged_into_entity_id is not null', r.t, r.c) into n;
    exception when others then n := -1;   -- report, never fail the audit
    end;
    tbl := r.t; col := r.c; covered_by_merge_path := r.cov; stranded_rows := n;
    return next;
  end loop;
end $$;
