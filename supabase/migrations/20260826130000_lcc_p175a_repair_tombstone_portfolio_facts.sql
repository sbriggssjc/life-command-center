-- ============================================================================
-- P175a — repair the portfolio facts stranded on tombstones, THREE-WAY
--         (2026-08-26). Applied live to LCC Opps (xengecqvemvfknjvbvrq).
--
-- P175 closed the tap (the sync now resolves a merged-away owner to its
-- survivor). This drains the 198 facts across 119 tombstones it had already
-- created. Disposition is PER ROW — P167 proved "repoint to the survivor" is
-- the obvious answer and the wrong one.
--
-- ⚠️ THE FIRST RULE WAS TWO CLASSES AND IT WOULD HAVE DESTROYED LIVE RENT.
-- "The survivor already holds this property, so the ghost row is a duplicate"
-- reads as obviously safe. Checked on a NAMED row before applying — Carrington,
-- gov property 2654:
--
--     GHOST     is_current = TRUE   $1,706,498   ownership_end_date NULL
--     SURVIVOR  is_current = FALSE  $1,706,498   ownership_end_date 2024-05-01
--
-- Those two rows do not duplicate each other, they CONTRADICT each other: one
-- says the owner still holds the asset, the other says they sold it in May
-- 2024. Deleting the ghost silently resolves the conflict toward the STALE side
-- and drops $1.7M of apparently-live rent. The aggregate split (183 / 3) hid
-- this completely; only reading a named row with a stated expectation exposed
-- it. Same lesson as the `lower()`-before-strip 43x error.
--
-- THE THREE CLASSES (measured live):
--     A. repoint       —   3 facts    $95,721   survivor lacks the property
--     B. dedup_delete  — 183 facts  $86,102,557 survivor holds an equal-or-better row
--     C. CONFLICT      —  12 facts   $4,701,833 ghost says CURRENT, survivor says ENDED
--
-- C is NOT decided here. It is surfaced in v_lcc_portfolio_ownership_conflict
-- for a human, because "which of two contradictory ownership claims is true" is
-- a judgement about the asset, not a data-hygiene rule. Note it is also likely
-- to self-resolve: now that P175 routes domain truth onto the SURVIVOR, and the
-- ON CONFLICT clause overwrites ownership_end_date from the domain, the next
-- sync states the domain's current answer authoritatively. Surfaced anyway
-- rather than assumed.
--
-- RESULT (all gates PASS):
--   facts on a tombstone            198 -> 12   (exactly the held conflicts)
--   deleted rows whose property is
--     NOT still on the survivor       0         nothing lost; every delete was a true dup
--   repointed rows now on survivor    3
--   re-run (idempotent)               0 rows
--   Carrington 2654 ghost row         PRESERVED — the conflict was not auto-resolved
--
-- ⚠️ THE QUOTED PROSPECT FIGURES WERE NOT AFFECTED, AND THAT WAS CHECKED, NOT
-- ASSUMED: 0 tombstones appear as a resolved owner in lcc_property_owner and 0
-- in v_lcc_research_owner_worklist — P160's repoint had already protected them.
-- The $968.4M top-57 total and LCC_Top_Prospects_2026-08-22.xlsx stand.
--
-- REVERSAL: select * from lcc_unrepair_tombstone_portfolio_facts('p175-repair-20260826');
-- ============================================================================

create table if not exists lcc_p175_portfolio_repair_log (
  id bigserial primary key,
  batch_tag text not null,
  action text not null,                 -- 'repoint' | 'dedup_delete'
  ghost_entity_id uuid not null,
  survivor_entity_id uuid,
  source_domain text, source_property_id text,
  old_row jsonb not null,
  repaired_at timestamptz not null default now(),
  reverted_at timestamptz
);

-- Class C: contradictory ownership claims between a ghost and its survivor.
-- Surfaced, never auto-resolved.
create or replace view v_lcc_portfolio_ownership_conflict as
select f.entity_id as ghost_entity_id, ge.name as ghost_name,
       lcc_entity_survivor(f.entity_id) as survivor_entity_id, se.name as survivor_name,
       f.source_domain, f.source_property_id,
       f.annual_rent as ghost_annual_rent,
       w.ownership_end_date as survivor_says_ended_on,
       f.ownership_start_date as ghost_says_started_on
from lcc_entity_portfolio_facts f
join entities ge on ge.id = f.entity_id
join lcc_entity_portfolio_facts w
  on w.entity_id = lcc_entity_survivor(f.entity_id)
 and w.source_domain = f.source_domain
 and w.source_property_id = f.source_property_id
left join entities se on se.id = lcc_entity_survivor(f.entity_id)
where ge.merged_into_entity_id is not null
  and lcc_entity_survivor(f.entity_id) <> f.entity_id
  and f.is_current and not w.is_current;

create or replace function lcc_repair_tombstone_portfolio_facts(
  p_dry_run boolean default true, p_batch text default null
) returns table(action text, facts bigint, annual_rent numeric)
language plpgsql as $$
declare v_batch text := coalesce(p_batch, 'p175-' || to_char(now(),'YYYYMMDDHH24MI'));
begin
  drop table if exists _pf;
  create temp table _pf on commit drop as
  select f.entity_id as ghost, lcc_entity_survivor(f.entity_id) as surv,
         f.source_domain, f.source_property_id, f.annual_rent, f.is_current as ghost_current,
         to_jsonb(f.*) as old_row,
         (select w.is_current from lcc_entity_portfolio_facts w
           where w.entity_id = lcc_entity_survivor(f.entity_id)
             and w.source_domain = f.source_domain
             and w.source_property_id = f.source_property_id) as surv_current
  from lcc_entity_portfolio_facts f
  join entities e on e.id = f.entity_id
  where e.merged_into_entity_id is not null;

  -- "Merged into nothing" / an unresolved cycle is NOT a repair target.
  delete from _pf where surv is null or surv = ghost
     or exists (select 1 from entities s where s.id=_pf.surv and s.merged_into_entity_id is not null);

  -- CLASS C: the ghost claims CURRENT where the survivor claims ENDED. That is a
  -- conflicting ownership claim, not a duplicate. Left in place and surfaced in
  -- v_lcc_portfolio_ownership_conflict.
  delete from _pf where ghost_current and surv_current is not null and not surv_current;

  if p_dry_run then
    return query
      select case when p.surv_current is null then 'DRY-RUN repoint (survivor lacks this property)'
                  else 'DRY-RUN dedup_delete (survivor holds an equal-or-better row)' end,
             count(*)::bigint, coalesce(sum(p.annual_rent),0)
      from _pf p group by (p.surv_current is null) order by 1;
    return;
  end if;

  insert into lcc_p175_portfolio_repair_log(batch_tag, action, ghost_entity_id,
    survivor_entity_id, source_domain, source_property_id, old_row)
  select v_batch, case when p.surv_current is null then 'repoint' else 'dedup_delete' end,
         p.ghost, p.surv, p.source_domain, p.source_property_id, p.old_row
  from _pf p;

  delete from lcc_entity_portfolio_facts f
   using _pf p
   where p.surv_current is not null
     and f.entity_id = p.ghost and f.source_domain = p.source_domain
     and f.source_property_id = p.source_property_id;

  update lcc_entity_portfolio_facts f
     set entity_id = p.surv, updated_at = now()
  from _pf p
  where p.surv_current is null
    and f.entity_id = p.ghost and f.source_domain = p.source_domain
    and f.source_property_id = p.source_property_id;

  return query
    select case when p.surv_current is null then 'REPOINTED (batch ' || v_batch || ')'
                else 'DEDUP_DELETED (batch ' || v_batch || ')' end,
           count(*)::bigint, coalesce(sum(p.annual_rent),0)
    from _pf p group by (p.surv_current is null) order by 1;
end $$;

create or replace function lcc_unrepair_tombstone_portfolio_facts(p_batch text)
returns table(action text, facts bigint) language plpgsql as $$
begin
  update lcc_entity_portfolio_facts f
     set entity_id = l.ghost_entity_id, updated_at = now()
  from lcc_p175_portfolio_repair_log l
  where l.batch_tag = p_batch and l.reverted_at is null and l.action='repoint'
    and f.entity_id = l.survivor_entity_id and f.source_domain = l.source_domain
    and f.source_property_id = l.source_property_id;

  insert into lcc_entity_portfolio_facts (entity_id, source_domain, source_property_id,
    ownership_start_date, ownership_end_date, annual_rent, sale_price, cap_rate, ownership_source, updated_at)
  select l.ghost_entity_id, l.source_domain, l.source_property_id,
         nullif(l.old_row->>'ownership_start_date','')::date, nullif(l.old_row->>'ownership_end_date','')::date,
         nullif(l.old_row->>'annual_rent','')::numeric, nullif(l.old_row->>'sale_price','')::numeric,
         nullif(l.old_row->>'cap_rate','')::numeric, l.old_row->>'ownership_source', now()
  from lcc_p175_portfolio_repair_log l
  where l.batch_tag = p_batch and l.reverted_at is null and l.action='dedup_delete'
  on conflict (entity_id, source_domain, source_property_id) do nothing;

  update lcc_p175_portfolio_repair_log set reverted_at = now()
   where batch_tag = p_batch and reverted_at is null;
  return query select 'REVERTED ' || p_batch, count(*)::bigint
               from lcc_p175_portfolio_repair_log where batch_tag=p_batch and reverted_at is not null;
end $$;
