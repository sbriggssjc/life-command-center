-- ===========================================================================
-- OWN-T0 -- the property panel reads ONE reconciled ownership chain
-- ===========================================================================
-- Scott, 2026-09-02 (UX23): "almost every property I open seems to have similar
-- errors -- gaps or lapses in owners, even conflicting on the property's own
-- ownership history tab, like no reconciliation is occurring."
--
-- He is right at population scale and the standing detector reads ZERO.
-- Measured live on LCC Opps before writing a line (2026-09-02):
--
--   properties with >1 CURRENT owner in lcc_entity_portfolio_facts ....  756  (9.4%)
--   ... of 8,068 properties carrying any current fact
--   resolved owner (lcc_property_owner) absent from that current set ...  667
--       (of 5,964 assets that have BOTH -- 11.2%, not the 8.1% a
--        denominator of "all resolved assets" reports)
--   resolved owner vs the DOMAIN true_owner (operator rows excluded) ... 1,260
--       disagree of 7,678 comparable (16.4%)
--   gov's OWN two stores: latest recorded transition grantee vs
--       properties.true_owner_id ......................................  1,509
--       disagree of 3,474 comparable (43.4%) -- the largest cell in the
--       matrix, and it is INSIDE the domain database before LCC sees it
--   v_lcc_portfolio_ownership_conflict ................................    0 rows
--
-- ---------------------------------------------------------------------------
-- 1. THE PRODUCER DEFECT (fixed here)
-- ---------------------------------------------------------------------------
-- Every writer of lcc_entity_portfolio_facts keys its "already recorded?" test
-- on (entity_id, source_domain, source_property_id) -- the OWNER-property pair.
-- Not one of them asks whether the PROPERTY already has a current owner. So
-- "fill-blanks" is answered at the wrong grain and a second current owner is
-- minted beside the first, silently.
--
-- P117 (lcc_sync_property_owner_to_portfolio) is the clearest instance and the
-- dominant one. Its candidate CTE reads:
--       left join lcc_entity_portfolio_facts pf
--         on pf.entity_id = o.owner_entity_id   <-- the OWNER
--        and pf.source_domain = o.source_domain
--        and pf.source_property_id::text = o.source_property_id
--       where pf.entity_id is null;             -- "FILL-BLANKS"
-- Measured: 632 of the 756 multi-current properties (83.6%) are exactly one
-- lcc_property_owner row plus at least one row from another source, and
-- p117-only pairs are 0 (it cannot create two of its own).
--
-- The function has NO cron -- it is a one-shot whose own drift view
-- (v_lcc_portfolio_owner_sync_gap) invites re-running it. Measured today, a
-- re-run under the old predicate inserts 2,595 rows of which **480 would create
-- a NEW second current owner**; under the fixed predicate it inserts 2,115 and
-- records those 480 as `skip_property_has_current_owner`. That 480 is the
-- growth this migration prevents; it is not a reduction of the existing 756.
--
-- ---------------------------------------------------------------------------
-- 2. THE PRESCRIBED REPAIR WAS MEASURED ON NAMED ROWS AND REFUTED
-- ---------------------------------------------------------------------------
-- The brief said: end-date the earlier owner, date-ordered, conflict where the
-- dates cannot decide. That is the right rule for a stale owner and it is the
-- WRONG remedy for this population, because most of these pairs are not rival
-- claims -- they are ONE asset held at TWO LEVELS, and both rows are true:
--
--   gov/14203  USAA Real Estate         || Usgbf Tsa LLC                  $26.7M
--   gov/3063   Trammell Crow Co         || USBGF SENTINEL SQUARE III, LLC $24.1M
--   gov/14197  Boyd Watterson AM        || Boyd Ashburn, LLC              $18.9M
--   gov/14398  NGP Capital              || NGP VI FALLS CHURCH VA LLC      $9.9M
--   gov/14194  GI Partners              || GI TC 801 FOLLIN LANE, LLC      $8.6M
--   gov/5405   Easterly Gov Properties  || EGP 2300 Des Plaines LLC        $7.4M
--   gov/14238  Boyd Watterson AM        || Reston Va II FGF, LLC           $6.9M
--
-- The sponsor is who we prospect; the SPE is who is on the deed and the GSA
-- lease. End-dating either destroys a true fact. Reading the top 60 by rent,
-- that shape is the clear majority. Three further named classes fall out of the
-- same read and each needs a DIFFERENT answer, which is why one blanket rule
-- could not have been right:
--   gov/3181  George Washington University || George Washington University (The)
--             -- one party, two entities: a MERGE (P195/A2a), not an end-date.
--   gov/12575 Easterly Gov Properties (REIT) || EastGroup Properties, Inc.
--             -- two DIFFERENT REITs sharing the `egp` token: exactly the
--                collision A3 measured and refused to key on.
--   gov/11504 Brandywine Realty Trust || Cira Square Master Tenant LLC
--             -- a master TENANT sitting in the owner slot.
--
-- ** No portfolio fact is end-dated, deleted or repointed by this migration. **
-- The 11 properties whose two current facts collapse to ONE survivor (a
-- tombstone still holding a live fact beside its survivor -- the P175a class)
-- are collapsed IN THE VIEW by resolving through lcc_entity_survivor, and
-- reported by the detector as a distinct defect class for a repair that owns
-- the merge path.
--
-- ---------------------------------------------------------------------------
-- 3. WHAT SHIPS
-- ---------------------------------------------------------------------------
--   lcc_ownership_evidence_level(text)          -- what KIND of record says so
--   lcc_ownership_sponsor_family_token(uuid,text) -- CONFIRMED families only
--   v_lcc_property_ownership_reconciled         -- the ONE view the panel reads
--   v_lcc_property_ownership_current            -- its one-row-per-property head
--   v_lcc_property_multi_current                -- the detector that read 0
--   lcc_sync_property_owner_to_portfolio        -- producer fix (property grain)
--
-- Discipline: additive - no data mutated - view-level reconciliation only -
-- every disagreement NAMED rather than silently resolved - reversible (drop the
-- views; the function reverts by re-applying 20260916120000).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 3.1  What KIND of record makes this claim.
--      A provenance fact, not a name judgement. `reconciled` is our own
--      resolver's answer (which on gov systematically names the sponsor);
--      lease/title records name the party on the instrument. Saying so is the
--      whole point -- the panel currently shows both with no label at all.
-- ---------------------------------------------------------------------------
create or replace function lcc_ownership_evidence_level(p_source text)
returns text
language sql
immutable
as $fn$
  select case
    when p_source is null or p_source = 'unattributed'      then 'unattributed'
    when p_source = 'lcc_property_owner'                    then 'reconciled'
    when p_source = 'domain_true_owner'                     then 'domain_record'
    when p_source like 'county_deed%'
      or p_source = 'county_records'                        then 'title_record'
    when p_source in ('sales_transaction','sales_transactions_seller_exit',
                      'costar','costar_sidebar')            then 'transaction_record'
    when p_source like 'gsa_lease%'                         then 'lease_record'
    when p_source like '%ownership_chain%'
      or p_source like 'a2_%'                               then 'chain_apply'
    else 'other'
  end;
$fn$;

comment on function lcc_ownership_evidence_level(text) is
  'OWN-T0: which KIND of record makes an ownership claim (reconciled / title / lease / transaction / domain / chain_apply / unattributed). Provenance, never a name judgement. `unattributed` means the producer recorded no source -- it is NOT a bucket for sources the map has not learned yet, which stay `other` so a new producer is visible.';

-- Both arms above were WRONG on the first cut, and reading the LABEL
-- DISTRIBUTION is what found it, not reading the code: evidence_level='other'
-- held 3,364 links and every one of them was something the map should have
-- named -- 1,965 with no recorded source (the fact CTE coalesces null to the
-- STRING 'unattributed', so the `is null` arm never saw them) and 1,399 A2
-- chain-apply rows whose source is `gov_ownership_chain:<uuid>`. Corrected,
-- `other` reads 0 over all 28,435 links.
--
-- STATED, NOT FIXED: `ownership_source` carries a PER-ROW UUID on two producers
-- (`county_deed:<uuid>`, `gov_ownership_chain:<uuid>`), so it cannot be grouped
-- on without a prefix strip. That is a producer defect, filed not patched.

-- ---------------------------------------------------------------------------
-- 3.2  A CONFIRMED sponsor family only.
--      A3 measured the lexical sponsor detector at ~25% raw / 4-of-6 guarded
--      and refused to key an ownership fact on it; P198 measured co-proposal at
--      7%. So this reads the human-confirmed registry and nothing else. A pair
--      that is genuinely sponsor/SPE but unconfirmed stays `conflict` -- which
--      is the honest state, and the confirm is one row in
--      lcc_ownership_sponsor_family.
-- ---------------------------------------------------------------------------
create or replace function lcc_ownership_sponsor_family_token(p_sponsor uuid, p_other_name text)
returns text
language sql
stable
as $fn$
  select f.sponsor_token
  from lcc_ownership_sponsor_family f
  where f.sponsor_entity_id = lcc_entity_survivor(p_sponsor)
    and p_other_name is not null
    and lower(p_other_name) ~ ('\m' || lower(f.sponsor_token) || '\M')
  order by length(f.sponsor_token) desc
  limit 1;
$fn$;

comment on function lcc_ownership_sponsor_family_token(uuid,text) is
  'OWN-T0: the CONFIRMED sponsor token linking a sponsor entity to an SPE name, from lcc_ownership_sponsor_family. Never a lexical guess (A3 measured that at ~25%).';

-- ---------------------------------------------------------------------------
-- 3.3  Why does this property have more than one current owner?
--      ORDERED, and every arm rests on a RECORDED fact or an existing single
--      owner of a name rule -- never a new name judgement. The default is
--      `unclassified_rival`, which is an honest "we do not know", not a verdict:
--      the unearned-positive default is what P124 cost.
-- ---------------------------------------------------------------------------
create or replace function lcc_ownership_conflict_class(p_owner_ids uuid[], p_names text[])
returns text
language plpgsql
stable
as $fn$
declare
  i int; j int; n int;
  a text; b text;
begin
  n := coalesce(array_length(p_owner_ids, 1), 0);
  if n < 2 then
    return null;
  end if;

  -- 1. one party wearing two entity rows -> a MERGE question (P195 / A2a),
  --    never an end-date. Keyed on the N15c canonical key, the same key the
  --    duplicate detector uses.
  for i in 1..n loop
    for j in i+1..n loop
      if lcc_entity_canonical_key(p_names[i]) is not null
         and lcc_entity_canonical_key(p_names[i]) = lcc_entity_canonical_key(p_names[j]) then
        return 'duplicate_entity';
      end if;
    end loop;
  end loop;

  -- 2. a CONFIRMED sponsor family covers the pair (lcc_ownership_sponsor_family).
  for i in 1..n loop
    for j in 1..n loop
      if i <> j and lcc_ownership_sponsor_family_token(p_owner_ids[i], p_names[j]) is not null then
        return 'sponsor_family_confirmed';
      end if;
    end loop;
  end loop;

  -- 3. a party that is structurally not an owner is in the pair.
  for i in 1..n loop
    a := p_names[i];
    if lcc_is_placeholder_owner_name(a) then return 'placeholder_in_pair'; end if;
  end loop;
  for i in 1..n loop
    a := p_names[i];
    if lcc_is_operator_owner_name(a) then return 'operator_in_pair'; end if;
  end loop;
  for i in 1..n loop
    a := p_names[i];
    if lcc_owner_name_is_brokerage(a) then return 'brokerage_in_pair'; end if;
  end loop;

  -- 4. Everything else. Measured 2026-09-02: this bucket is dominated by
  --    UNCONFIRMED sponsor/SPE pairs (Boyd/FGF, NGP VI/VII, EGP, USGBF, USGP),
  --    which the lexical detectors cannot see -- A3 measured
  --    lcc_tier0_sponsor_brand_token at 3 of 74 on GSA SPEs because a
  --    government SPE is named for its city and agency, not "Propco".
  --    Confirming the family in lcc_ownership_sponsor_family is what moves a
  --    row out of here; widening the regex is what P189/A3/P198 each refused.
  return 'unclassified_rival';
end;
$fn$;

comment on function lcc_ownership_conflict_class(uuid[],text[]) is
  'OWN-T0: ordered classification of a property''s competing current owners. Every arm rests on a recorded fact or an existing single-owner name rule; the default is an honest unclassified_rival.';

-- ---------------------------------------------------------------------------
-- 3.4  THE ONE VIEW THE PANEL READS.
--      One row per (asset, owner link). Every LCC-resident store that can name
--      an owner of this asset lands here ONCE, labelled with what kind of
--      record said so. Nothing is silently chosen: `is_primary` names a
--      headline owner and `primary_reason` says why, while every other current
--      claim stays on the row with `property_state='conflict'`.
--
--      Survivor-collapsed, which is how the 11 tombstone-beside-survivor pairs
--      stop rendering as a conflict without touching a row.
--
--      `property_state` counts OWNER CANDIDATES, not every claim. The first cut
--      counted every current link and 884 properties read `conflict` purely
--      because a P113 operator/tenant sits in the owner slot beside the real
--      owner -- a KNOWN non-owner the panel already guards on, so calling it a
--      conflict is the badge-that-is-noise failure. Operator / brokerage /
--      placeholder links stay on the row FLAGGED and are excluded from the
--      count and the classification, never dropped.
--
--      PERFORMANCE -- `not materialized` is load-bearing, not decoration. The
--      panel opens this view for ONE property. Measured without it:
--      1,013.9 ms / 216,947 buffers for a 3-row point query, because a CTE
--      referenced more than once is ALWAYS materialized (C13b s7.7) so the
--      predicate cannot push down -- `fact` aggregated all 14,119 portfolio
--      rows and `domain_owner` joined all 31,160 owner-fact rows on every open,
--      then the materialized CTEs were re-scanned (loops=3). With it:
--      20.1 ms / 674 buffers -- 50x faster, 322x fewer buffers, every leg an
--      index scan. Aggregates over the whole view are byte-identical before and
--      after (10,084 / 7,678 / 1,614 / 417 / 64 by property_state+class).
-- ---------------------------------------------------------------------------
drop view if exists v_lcc_property_ownership_current;
drop view if exists v_lcc_property_ownership_reconciled;

create view v_lcc_property_ownership_reconciled as
with asset as not materialized (
  select ei.entity_id as asset_entity_id, ei.source_system as source_domain, ei.external_id as source_property_id
  from external_identities ei
  where ei.source_system in ('dia','gov') and ei.source_type = 'asset'
),
fact as not materialized (
  select f.source_domain, f.source_property_id,
         lcc_entity_survivor(f.entity_id) as owner_entity_id,
         min(f.ownership_start_date) as ownership_start_date,
         case when bool_or(f.ownership_end_date is null) then null else max(f.ownership_end_date) end as ownership_end_date,
         max(f.annual_rent) as annual_rent,
         min(coalesce(f.ownership_source,'unattributed')) as link_source,
         count(distinct f.entity_id) as fact_entity_ids
  from lcc_entity_portfolio_facts f
  group by 1,2,3
),
resolved as not materialized (
  select a.source_domain, a.source_property_id,
         lcc_entity_survivor(po.owner_entity_id) as owner_entity_id,
         po.confidence, po.source as resolver_rung, po.resolved_at
  from asset a join lcc_property_owner po on po.entity_id = a.asset_entity_id
  where po.owner_entity_id is not null
),
domain_owner as not materialized (
  select pf.source_domain, pf.source_property_id,
         lcc_entity_survivor(coalesce(oe.entity_id, oe2.entity_id)) as owner_entity_id,
         coalesce(pf.true_owner_is_operator, false) as domain_says_operator
  from lcc_property_owner_facts pf
  left join external_identities oe
    on oe.source_system = pf.source_domain and oe.source_type = 'true_owner'
   and oe.external_id  = pf.true_owner_effective_id::text
  left join external_identities oe2
    on oe2.source_system = pf.source_domain and oe2.source_type = 'true_owner'
   and oe2.external_id  = pf.true_owner_id::text
  where coalesce(oe.entity_id, oe2.entity_id) is not null
),
link as (
  select source_domain, source_property_id, owner_entity_id, ownership_start_date,
         ownership_end_date, annual_rent, link_source, fact_entity_ids
  from fact
  union all
  select r.source_domain, r.source_property_id, r.owner_entity_id,
         null::date, null::date, null::numeric, 'lcc_property_owner', 1
  from resolved r
  where not exists (select 1 from fact f where f.source_domain = r.source_domain
                      and f.source_property_id = r.source_property_id and f.owner_entity_id = r.owner_entity_id)
  union all
  select d.source_domain, d.source_property_id, d.owner_entity_id,
         null::date, null::date, null::numeric, 'domain_true_owner', 1
  from domain_owner d
  where not exists (select 1 from fact f where f.source_domain = d.source_domain
                      and f.source_property_id = d.source_property_id and f.owner_entity_id = d.owner_entity_id)
    and not exists (select 1 from resolved r where r.source_domain = d.source_domain
                      and r.source_property_id = d.source_property_id and r.owner_entity_id = d.owner_entity_id)
),
enriched as (
  select l.source_domain, l.source_property_id, a.asset_entity_id, l.owner_entity_id,
         e.name as owner_name, l.ownership_start_date, l.ownership_end_date,
         (l.ownership_end_date is null) as is_current, l.annual_rent, l.link_source,
         lcc_ownership_evidence_level(l.link_source) as evidence_level, l.fact_entity_ids,
         (r.owner_entity_id is not null) as is_resolved_owner,
         r.confidence as resolver_confidence, r.resolver_rung, r.resolved_at,
         (d.owner_entity_id is not null) as is_domain_true_owner,
         coalesce(d.domain_says_operator, false) or lcc_is_operator_owner_name(e.name) as is_operator,
         lcc_owner_name_is_brokerage(e.name) as is_brokerage,
         lcc_is_placeholder_owner_name(e.name) as is_placeholder
  from link l
  join entities e on e.id = l.owner_entity_id
  left join asset a on a.source_domain = l.source_domain and a.source_property_id = l.source_property_id
  left join resolved r on r.source_domain = l.source_domain and r.source_property_id = l.source_property_id
                      and r.owner_entity_id = l.owner_entity_id
  left join domain_owner d on d.source_domain = l.source_domain and d.source_property_id = l.source_property_id
                      and d.owner_entity_id = l.owner_entity_id
  where e.merged_into_entity_id is null
),
flagged as (
  select en.*,
    (en.is_current and not en.is_operator and not en.is_brokerage and not en.is_placeholder) as is_owner_candidate
  from enriched en
),
ranked as (
  select f.*,
    case
      when f.is_placeholder then 0
      when f.is_brokerage then 5
      when f.is_operator then 10
      when f.is_resolved_owner and f.resolver_rung = 'manual' then 100
      when f.is_resolved_owner then 80
      when f.is_domain_true_owner then 60
      when f.ownership_start_date is not null then 40
      else 20
    end as primary_rank,
    count(*) filter (where f.is_current) over w as n_current_claims,
    count(*) filter (where f.is_owner_candidate) over w as n_current_owners,
    array_agg(f.owner_entity_id) filter (where f.is_owner_candidate) over w as cur_owner_ids,
    array_agg(f.owner_name) filter (where f.is_owner_candidate) over w as cur_owner_names,
    lag(f.ownership_end_date) over (partition by f.source_domain, f.source_property_id
                                    order by f.ownership_start_date nulls first, f.owner_entity_id) as prev_end_date
  from flagged f
  window w as (partition by f.source_domain, f.source_property_id)
)
select r.source_domain, r.source_property_id, r.asset_entity_id, r.owner_entity_id, r.owner_name,
       r.ownership_start_date, r.ownership_end_date, r.is_current, r.annual_rent,
       r.link_source, r.evidence_level, r.is_resolved_owner, r.resolver_confidence,
       r.resolver_rung, r.resolved_at, r.is_domain_true_owner, r.is_operator,
       r.is_brokerage, r.is_placeholder, r.is_owner_candidate,
       r.n_current_claims, r.n_current_owners, r.primary_rank,
       (r.is_current and row_number() over (
          partition by r.source_domain, r.source_property_id
          order by (case when r.is_current then 0 else 1 end), r.primary_rank desc,
                   r.ownership_start_date desc nulls last, r.owner_entity_id) = 1) as is_primary,
       case
         when not r.is_current then null
         when r.is_resolved_owner and r.resolver_rung = 'manual' then 'human-verified owner'
         when r.is_resolved_owner then 'reconciled owner (' || coalesce(r.resolver_rung,'?') || ')'
         when r.is_domain_true_owner then 'domain true owner of record'
         when r.ownership_start_date is not null then 'dated ' || r.evidence_level
         else 'only owner on file'
       end as primary_reason,
       case
         when coalesce(r.n_current_claims,0) = 0 then 'no_current_owner'
         when coalesce(r.n_current_owners,0) = 0 then 'only_non_owner_claims'
         when r.n_current_owners = 1 then 'single_current_owner'
         else 'conflict'
       end as property_state,
       case when coalesce(r.n_current_owners,0) > 1
            then lcc_ownership_conflict_class(r.cur_owner_ids, r.cur_owner_names)
            else null end as conflict_class,
       -- a break in the recorded chain: the previous link ENDED and this one
       -- starts later. Reported, never bridged -- an unrecorded intermediate
       -- owner is exactly the thing that must not be invented. NOTE it can only
       -- fire where BOTH sides are dated, which today is 60 links fleet-wide;
       -- `start_date_unknown` is the far larger honest state.
       (r.ownership_start_date is not null and r.prev_end_date is not null
          and r.ownership_start_date > r.prev_end_date) as gap_before,
       (r.ownership_start_date is null) as start_date_unknown
from ranked r;

comment on view v_lcc_property_ownership_reconciled is
  'OWN-T0: the SINGLE ownership chain the property panel reads. One row per (asset, owner link) across every LCC-resident store, survivor-collapsed, labelled by evidence level, with an explicit is_primary / property_state / conflict_class / gap_before. A P113 operator, a brokerage and a placeholder are flagged and excluded from the owner count, never silently dropped. Nothing is end-dated or deleted to produce it.';

-- One row per property: the head of the chain, for a badge or a list.
-- NOTE it covers only properties with a CURRENT claim -- is_primary requires
-- is_current, and naming a former owner "current" would be worse than absence.
-- The 185 history-only properties live on the chain view with
-- property_state='no_current_owner'.
create view v_lcc_property_ownership_current as
select source_domain, source_property_id, asset_entity_id, owner_entity_id, owner_name,
       evidence_level, link_source, resolver_confidence, resolver_rung, is_operator,
       n_current_claims, n_current_owners, property_state, conflict_class, primary_reason, annual_rent
from v_lcc_property_ownership_reconciled
where is_primary;

comment on view v_lcc_property_ownership_current is
  'OWN-T0: one row per property -- the headline owner the panel shows, with the property_state/conflict_class that says whether anyone disagrees.';

-- ---------------------------------------------------------------------------
-- 3.5  THE DETECTOR THAT READ ZERO.
--      v_lcc_portfolio_ownership_conflict is CORRECT and NARROW: it requires a
--      tombstone that is CURRENT beside a survivor that has ENDED (the P175a
--      shape), so it is structurally unable to see two LIVE entities both
--      marked current on one property -- which is 745 of the 756. Leave it
--      alone; this is the complement, and it carries BOTH defect classes rather
--      than lumping them, because they need different repairs.
--
--      PERFORMANCE: the first cut used correlated scalar subqueries against
--      v_lcc_property_ownership_reconciled and TIMED OUT at 60 s -- the
--      documented correlated-subplan footgun (a node with loops = the output
--      row count, which no index can fix). Hoisted to one LEFT JOIN against the
--      one-row-per-property head view.
--
--      POSITIVE CONTROL (2026-09-02): reads 756 properties / $903,291,687 --
--      745 multi_current_distinct_parties + 11 tombstone_duplicate_current,
--      632 of them carrying a P117 row. That reproduces the independently
--      measured baseline exactly, so the zero it replaces was the instrument.
-- ---------------------------------------------------------------------------
drop view if exists v_lcc_property_multi_current;

create view v_lcc_property_multi_current as
with cur as (
  select f.source_domain, f.source_property_id,
         count(*)                                           as current_fact_rows,
         count(distinct f.entity_id)                        as current_entity_ids,
         count(distinct lcc_entity_survivor(f.entity_id))   as current_survivors,
         max(f.annual_rent)                                 as annual_rent,
         bool_or(f.ownership_source = 'lcc_property_owner') as has_p117_row,
         string_agg(e.name || ' [' || coalesce(f.ownership_source,'unattributed') || ']', ' | ' order by e.name) as current_owners
  from lcc_entity_portfolio_facts f
  join entities e on e.id = f.entity_id
  where f.is_current
  group by 1,2
)
select
  c.source_domain,
  c.source_property_id,
  case when c.current_survivors > 1 then 'multi_current_distinct_parties'
       else 'tombstone_duplicate_current' end as defect_class,
  c.current_fact_rows,
  c.current_entity_ids,
  c.current_survivors,
  c.annual_rent,
  h.conflict_class,
  h.owner_name as primary_owner_name,
  h.primary_reason,
  c.current_owners,
  c.has_p117_row
from cur c
left join v_lcc_property_ownership_current h
  on h.source_domain = c.source_domain and h.source_property_id = c.source_property_id
where c.current_survivors > 1
   or c.current_entity_ids > c.current_survivors;

comment on view v_lcc_property_multi_current is
  'OWN-T0 detector: properties carrying more than one CURRENT owner in lcc_entity_portfolio_facts. Complements v_lcc_portfolio_ownership_conflict, which only sees the P175a tombstone-vs-ENDED shape and therefore read 0 over this 756-property defect. Read defect_class: multi_current_distinct_parties is a modelling/merge/confirm question; tombstone_duplicate_current is merge-path residue (P175/P160).';

grant select on v_lcc_property_ownership_reconciled to service_role;
grant select on v_lcc_property_ownership_current    to service_role;
grant select on v_lcc_property_multi_current        to service_role;

-- ---------------------------------------------------------------------------
-- 3.6  PRODUCER FIX -- the fill-blanks predicate moves to the PROPERTY grain.
--      Byte-identical to 20260916120000 apart from the added probe and its
--      named verdict.
--
--      MEASURED DELTA, dry run 2026-09-02, before and after:
--        insert                            2,595  ->  2,115
--        skip_property_has_current_owner       -       480   ($400,274,132)
--        skip_operator / skip_brokerage      6 / 5     6 / 5   (unchanged)
--      That 480 is the growth this prevents. It is NOT a reduction of the
--      existing 756 -- see the header: no fact is end-dated here.
--
--      It SKIPS rather than superseding ON PURPOSE. The rows it would collide
--      with are dominated by sponsor/SPE pairs where BOTH facts are true, so
--      ending one destroys a true fact, and choosing between them is a
--      judgement this feeder has no evidence to make. The skip is visible in
--      the return and the residue on v_lcc_property_multi_current.
-- ---------------------------------------------------------------------------
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
    select po.owner_entity_id as owner_entity_id,
           po.owner_name      as owner_name,
           ei.source_system   as source_domain,
           ei.external_id     as source_property_id
    from lcc_property_owner po
    join external_identities ei
      on ei.entity_id = po.entity_id
     and ei.source_type = 'asset'
     and ei.source_system in ('dia','gov')
    where po.owner_entity_id is not null
  )
  select
    o.owner_entity_id,
    o.source_domain,
    o.source_property_id,
    a.annual_rent,
    case
      when lcc_owner_name_is_brokerage(o.owner_name) then 'skip_brokerage'
      when lcc_is_operator_owner_name(o.owner_name)  then 'skip_operator'
      -- OWN-T0: fill-blanks is a question about the PROPERTY, not about this
      -- owner. Asking it on (owner, property) is what minted a second current
      -- owner on 632 of the 756 multi-current properties.
      when exists (
        select 1 from lcc_entity_portfolio_facts pc
         where pc.source_domain = o.source_domain
           and pc.source_property_id::text = o.source_property_id
           and pc.is_current
           and lcc_entity_survivor(pc.entity_id) is distinct from lcc_entity_survivor(o.owner_entity_id)
      ) then 'skip_property_has_current_owner'
      else 'insert'
    end as verdict
  from owned o
  left join lcc_entity_portfolio_facts pf
    on  pf.entity_id = o.owner_entity_id
    and pf.source_domain = o.source_domain
    and pf.source_property_id::text = o.source_property_id
  left join lcc_property_attributes a
    on  a.source_domain = o.source_domain
    and a.source_property_id::text = o.source_property_id
  where pf.entity_id is null;

  if p_limit is not null then
    delete from _p117_cand c
    where c.ctid not in (
      select ctid from _p117_cand where verdict = 'insert' order by annual_rent desc nulls last limit p_limit
    ) and c.verdict = 'insert';
  end if;

  if not p_dry_run then
    insert into lcc_entity_portfolio_facts
      (entity_id, source_domain, source_property_id, ownership_end_date, annual_rent, ownership_source, updated_at)
    select c.owner_entity_id, c.source_domain, c.source_property_id::bigint, null, c.annual_rent, 'lcc_property_owner', now()
    from _p117_cand c where c.verdict = 'insert'
    on conflict (entity_id, source_domain, source_property_id) do nothing;
    get diagnostics v_inserted = row_count;
  end if;

  return query
  select c.verdict::text, count(*)::bigint, count(distinct c.owner_entity_id)::bigint,
         count(c.annual_rent)::bigint, sum(c.annual_rent)
  from _p117_cand c
  group by c.verdict
  union all
  select case when p_dry_run then 'DRY_RUN_no_write' else 'rows_written' end,
         case when p_dry_run then 0::bigint else v_inserted end,
         0::bigint, 0::bigint, null::numeric;
end;
$fn$;

comment on function lcc_sync_property_owner_to_portfolio(boolean,int) is
  'P117 + OWN-T0: fill-blanks bridge lcc_property_owner -> lcc_entity_portfolio_facts. Fill-blanks is asked at the PROPERTY grain (OWN-T0): a property that already carries a DIFFERENT current owner is skipped as skip_property_has_current_owner, never given a second one. Dry-run default. Reverse: delete from lcc_entity_portfolio_facts where ownership_source=''lcc_property_owner''.';
