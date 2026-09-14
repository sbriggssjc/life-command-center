-- ===========================================================================
-- P117 -- the resolved owner reaches the portfolio store
-- APPLIED LIVE to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-17.
-- ===========================================================================
-- FOUND BY THE REDESIGN. With a property and its owner docked side by side, the
-- property panel said "this entity owns this asset" while the owner panel next
-- to it said "0 Properties". Both were reading honestly -- from two stores that
-- were never joined:
--
--   lcc_property_owner          fed by relationship_graph / supersession /
--                               domain_true_owner / sf_seller / rel_purchase
--   lcc_entity_portfolio_facts  fed by gsa_lease_diff / sales_transaction* /
--                               gsa_lease_lessor / county_records / costar
--
-- ZERO feeder overlap. Not a bug in any one function -- two rounds built two
-- stores and nothing ever bridged them. Measured live BEFORE writing this:
--   resolved owner->asset pairs .................. 2,337
--   present in lcc_entity_portfolio_facts .........  386
--   MISSING ...................................... 1,951  (83.5%; gov 1,418 / dia 533)
--   owners showing "0 Properties" ................ 1,246 of 1,552 (80.3%)
--
-- DIRECTION: facts <- owner, never the reverse. lcc_entity_portfolio_facts has
-- its own authoritative feeders and its own exit history (ownership_end_date);
-- this is FILL-BLANKS ONLY on (entity, domain, property) and never touches,
-- updates or ends an existing row.
--
-- BLAST RADIUS, measured BEFORE applying. Portfolio rent is a cadence-admission
-- arm (bdSignalFromFacts: portfolioValue >= CADENCE_SIGNAL_MIN_VALUE $500k), so
-- filling it can enrol cadences:
--   owners gaining assets ........................ 1,118
--   newly crossing the $500k floor ...............   228
--   ... with no cadence today ....................   156
--   ... REACHABLE (actually seedable) ............    23
--   ... UNREACHABLE ..............................   133  <- withheld by the
--       EXISTING P112 reachability precondition in cadenceSeedDecision(), which
--       refuses to seed a party that can never advance. So this adds ~23 real
--       cadences, not 156. No new gate is added here on purpose: a second
--       definition of "reachable" would drift from the first (P116 lesson).
--
-- GUARDS: a brokerage is the agent and an operator is the tenant -- neither is a
-- portfolio holder. Both reuse the existing single definitions
-- (lcc_owner_name_is_brokerage / lcc_is_operator_owner_name) rather than being
-- re-implemented. Live: they blocked 5 brokerage + 6 operator rows.
--
-- RENT SANITY (the check that rules out a unit error -- $1.36B is a big claim):
--   dia  n=281  median $228,884/yr  median $26.14/SF
--   gov  n=698  median $640,422/yr  median $28.02/SF
-- Both PSF medians land in the mid-to-high $20s, which is correct for dialysis
-- NNN and GSA-leased space; a unit error would show an absurd PSF.
--
-- RESULT (verified live): owners showing zero 1,246 -> 135; gap dia 1.0% /
-- gov 0.2% (the guarded residue); re-run writes 0 rows.
--
-- Discipline: dry-run default - fill-blanks-only - guarded - provenance-tagged
-- (ownership_source='lcc_property_owner') - reversible by that tag - idempotent.
--
-- REVERSAL RUNBOOK:
--   delete from lcc_entity_portfolio_facts where ownership_source = 'lcc_property_owner';
--   -- (1,940 rows; nothing else writes that tag)
-- ===========================================================================

create or replace function lcc_sync_property_owner_to_portfolio(
  p_dry_run boolean default true,
  p_limit   int     default null
)
returns table(
  action              text,
  n                   bigint,
  distinct_owners     bigint,
  with_rent           bigint,
  total_annual_rent   numeric
)
language plpgsql
as $fn$
#variable_conflict use_column
declare
  v_inserted bigint := 0;
begin
  create temp table _p117_cand on commit drop as
  with owned as (
    select
      po.owner_entity_id                  as owner_entity_id,
      po.owner_name                       as owner_name,
      ei.source_system                    as source_domain,
      ei.external_id                      as source_property_id
    from lcc_property_owner po
    join external_identities ei
      on ei.entity_id    = po.entity_id
     and ei.source_type   = 'asset'
     and ei.source_system in ('dia','gov')
    where po.owner_entity_id is not null
  )
  select
    o.owner_entity_id,
    o.source_domain,
    o.source_property_id,
    a.annual_rent,
    case
      when lcc_owner_name_is_brokerage(o.owner_name)  then 'skip_brokerage'
      when lcc_is_operator_owner_name(o.owner_name)   then 'skip_operator'
      else 'insert'
    end as verdict
  from owned o
  left join lcc_entity_portfolio_facts pf
    on  pf.entity_id            = o.owner_entity_id
    and pf.source_domain        = o.source_domain
    and pf.source_property_id::text = o.source_property_id
  left join lcc_property_attributes a
    on  a.source_domain             = o.source_domain
    and a.source_property_id::text  = o.source_property_id
  where pf.entity_id is null;          -- FILL-BLANKS: never touch an existing row

  if p_limit is not null then
    delete from _p117_cand c
    where c.ctid not in (
      select ctid from _p117_cand where verdict = 'insert' order by annual_rent desc nulls last limit p_limit
    ) and c.verdict = 'insert';
  end if;

  if not p_dry_run then
    -- is_current is GENERATED (= ownership_end_date IS NULL) -- omit it.
    -- ownership_start_date stays NULL: we know they own it NOW, we do not know
    -- when they acquired it, and inventing a date would be fabrication.
    insert into lcc_entity_portfolio_facts
      (entity_id, source_domain, source_property_id, ownership_end_date, annual_rent, ownership_source, updated_at)
    select c.owner_entity_id, c.source_domain, c.source_property_id::bigint, null, c.annual_rent, 'lcc_property_owner', now()
    from _p117_cand c
    where c.verdict = 'insert'
    on conflict (entity_id, source_domain, source_property_id) do nothing;
    get diagnostics v_inserted = row_count;
  end if;

  return query
  select
    c.verdict::text,
    count(*)::bigint,
    count(distinct c.owner_entity_id)::bigint,
    count(c.annual_rent)::bigint,
    sum(c.annual_rent)
  from _p117_cand c
  group by c.verdict
  union all
  select
    case when p_dry_run then 'DRY_RUN_no_write' else 'rows_written' end,
    case when p_dry_run then 0::bigint else v_inserted end,
    0::bigint, 0::bigint, null::numeric;
end;
$fn$;

comment on function lcc_sync_property_owner_to_portfolio(boolean,int) is
  'P117: fill-blanks bridge lcc_property_owner -> lcc_entity_portfolio_facts so the owner panel''s portfolio agrees with the property panel''s owner. Dry-run default. Reverse: delete from lcc_entity_portfolio_facts where ownership_source=''lcc_property_owner''.';

-- Drift detector: the gap this closed, so it can never silently reopen.
create or replace view v_lcc_portfolio_owner_sync_gap as
with owned as (
  select po.owner_entity_id, ei.source_system as source_domain, ei.external_id as source_property_id
  from lcc_property_owner po
  join external_identities ei
    on ei.entity_id = po.entity_id and ei.source_type='asset' and ei.source_system in ('dia','gov')
  where po.owner_entity_id is not null
)
select
  o.source_domain,
  count(*)                                          as resolved_pairs,
  count(pf.entity_id)                               as in_portfolio,
  count(*) - count(pf.entity_id)                    as missing_from_portfolio,
  round(100.0*(count(*)-count(pf.entity_id))/nullif(count(*),0),1) as pct_missing
from owned o
left join lcc_entity_portfolio_facts pf
  on  pf.entity_id = o.owner_entity_id
  and pf.source_domain = o.source_domain
  and pf.source_property_id::text = o.source_property_id
group by o.source_domain;

comment on view v_lcc_portfolio_owner_sync_gap is
  'P117 drift detector: resolved owner->asset pairs absent from lcc_entity_portfolio_facts. Should trend to ~0 (brokerage/operator-guarded rows are the honest residue).';

grant select on v_lcc_portfolio_owner_sync_gap to anon, authenticated, service_role;
