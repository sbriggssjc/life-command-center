-- DIA1c — one operator identity everywhere (Dialysis_DB zqzrriwuavgrquhisnoa)
--
-- Scott's decision S2 (2026-09-16, filed as prompts/done/DIA1c): "The name and
-- which is used should not be evidence of the control of operations we are
-- summarizing here. US Renal vs U.S. Renal Care as the name should be one
-- operator displayed and linked everywhere, not two." So the Operators
-- Tracked tile does not choose between the raw-string count (45) and the
-- resolved-operator_id count (21, measured pre-fix) — the canonical count is
-- the only number, and every property carrying a raw operator string with no
-- operator_id is either folded onto its canonical operator or, if genuinely
-- new, registered as one.
--
-- Measured live before this migration:
--   878 dia properties had operator_id NULL with a non-blank properties.operator.
--   Of those, 807 are ALREADY correctly classified via properties.operator_class
--   (category=784 "Independent"/"Other"/"State Owned", payer=21 "Kaiser
--   Permanente"/"UnitedHealthcare", non_operator=2 "DaVita | <agency>") — set
--   by the existing dia_operator_write_guard trigger, which deliberately
--   leaves operator_id NULL for these because they are not operating
--   companies. Folding them into the operator count would be the OPPOSITE of
--   "one operator identity" — it would count categories as companies.
--   The genuine residue was 71 properties across 13 distinct raw strings,
--   none of them a spelling variant of an existing canonical operator —
--   each is a real, previously-unregistered operator (Greenfield Health
--   Systems, Atlantic Dialysis Management Services, Diversified Specialty
--   Institutes (DSI), Intermountain Healthcare, Independent Dialysis
--   Foundation (IDF), Gundersen Lutheran, Scott & White Memorial Hospital,
--   Veterans Administration, UPMC Health System, Nevada Kidney, Chattanooga
--   Kidney Center, Memorial Hermann Healthcare System, Liberty).
--
--   Separately, the ID2a operator-registry dedup (2026-09-11) had merged
--   several duplicate operator rows (operators.merged_into_operator_id set —
--   e.g. two "Us Renal Care Inc" rows and one "Dialysis Clinic Inc" row into
--   their survivors) but never repointed the referencing tables:
--   properties/tenants/leases/medicare_clinics.operator_id, AND
--   dia_operator_aliases.operator_id itself, still carried the pre-merge ids.
--   "DaVita at Home" (operator_id 77, 1 property) was never merged into
--   DaVita at all — same corporate entity, a service-line label.
--
-- What this migration does, in order:
--   1. Repoints properties/tenants/leases/medicare_clinics.operator_id AND
--      dia_operator_aliases.operator_id onto dia_operator_survivor() for
--      every row still pointing at an already-merged operator.
--   2. Merges "DaVita at Home" into "DaVita" (dia_id2a_merge_operator_group),
--      repoints, and confirms its alias survives the merge (the pre-existing
--      id2a_seed alias for "DaVita at Home" is repointed by step 1, not
--      re-inserted — a global UNIQUE(alias_norm) forbids a duplicate).
--   3. Registers the 13 genuinely new operators (kind='company',
--      id2a_source='dia1c_new_registration', a self-alias each) and
--      fill-blanks properties.operator_id on their exact-match rows only —
--      never a fold by resemblance to an existing operator.
--   4. Rebuilds mv_dia_overview_stats so operators_tracked =
--      COUNT(DISTINCT properties.operator_id) (canonical operators only,
--      never raw text) and adds operators_unresolved = count of properties
--      whose operator column names something with no operator_id and no
--      category/payer/non_operator classification — reads 0 today, and is
--      the honest signal for new unregistered capture going forward, never
--      folded silently into operators_tracked.
--      Also re-groups top_operators_by_count / top_operators_by_rent by the
--      canonical operator name (falling back to the raw string only for the
--      genuine residue) so the two lists Scott reads day to day show the
--      same fold as the headline tile.
--   5. Adds v_dia_operator_unresolved_review — every property with a raw
--      operator name that has not been resolved and is not a known
--      category/payer label. Should read 0 rows the day this ships; exists
--      so a future unregistered operator surfaces as a review row rather
--      than silently inflating (or deflating) the tile.
--
-- Discipline: fill-blanks only (never overwrites a set operator_id);
-- conservative/exact-match only (no fuzzy fold — a new operator name is
-- registered, never guessed onto an existing one); reversible (every UPDATE
-- here only repoints an id to its own already-established
-- dia_operator_survivor(); the new operator rows and aliases can be deleted
-- by id2a_source='dia1c_new_registration'/'dia1c_fold'); idempotent (re-run
-- writes 0 rows).
--
-- Live verification after apply: operators_tracked 33, operators_unresolved 0,
-- v_dia_operator_unresolved_review 0 rows, top_operators_by_count shows one
-- "US Renal Care" row (465 properties, was split 2/0/465 across three
-- operator rows) and one "DaVita" row (4,439 properties, folded "DaVita at
-- Home").

-- 1) Repoint every referencing table (+ the alias table itself) onto its
--    merge survivor.
update dia_operator_aliases a
   set operator_id = dia_operator_survivor(a.operator_id)
  from operators o
 where o.operator_id = a.operator_id
   and o.merged_into_operator_id is not null;

update properties
   set operator_id = dia_operator_survivor(operator_id)
 where operator_id is not null
   and operator_id <> dia_operator_survivor(operator_id);

update tenants
   set operator_id = dia_operator_survivor(operator_id)
 where operator_id is not null
   and operator_id <> dia_operator_survivor(operator_id);

update leases
   set operator_id = dia_operator_survivor(operator_id)
 where operator_id is not null
   and operator_id <> dia_operator_survivor(operator_id);

update medicare_clinics
   set operator_id = dia_operator_survivor(operator_id)
 where operator_id is not null
   and operator_id <> dia_operator_survivor(operator_id);

-- 2) DaVita at Home is DaVita.
select dia_id2a_merge_operator_group('DaVita', ARRAY['DaVita at Home']);

update properties
   set operator_id = dia_operator_survivor(operator_id)
 where operator_id is not null
   and operator_id <> dia_operator_survivor(operator_id);

update dia_operator_aliases a
   set operator_id = dia_operator_survivor(a.operator_id)
  from operators o
 where o.operator_id = a.operator_id
   and o.merged_into_operator_id is not null;

-- 3) Register genuinely new operators, exact-match backfill only.
with new_ops as (
  select unnest(array[
    'Greenfield Health Systems','Atlantic Dialysis Management Services',
    'Diversified Specialty Institutes (DSI)','Intermountain Healthcare',
    'Independent Dialysis Foundation (IDF)','Gundersen Lutheran',
    'Scott & White Memorial Hospital','Veterans Administration',
    'UPMC Health System','Nevada Kidney','Chattanooga Kidney Center',
    'Memorial Hermann Healthcare System','Liberty'
  ]) as name
)
insert into operators (name, normalized_name, kind, id2a_source, id2a_note)
select n.name, lower(n.name), 'company', 'dia1c_new_registration',
       'DIA1c: registered from unresolved properties.operator with no prior operators row; one raw string per property, no fold candidate found in the existing registry.'
from new_ops n
where not exists (select 1 from operators o where lower(o.name) = lower(n.name));

insert into dia_operator_aliases (operator_id, alias_text, source, confidence)
select o.operator_id, o.name, 'dia1c_new_registration', 'high'
from operators o
where o.id2a_source = 'dia1c_new_registration'
  and not exists (select 1 from dia_operator_aliases a where lower(a.alias_text) = lower(o.name));

update properties p
   set operator_id = o.operator_id
  from operators o
 where p.operator_id is null
   and p.operator is not null and trim(p.operator) <> ''
   and p.merged_into_property_id is null
   and lower(trim(p.operator)) = lower(o.name)
   and o.id2a_source = 'dia1c_new_registration';

-- 4) mv_dia_overview_stats: canonical operator count + unresolved residue.
drop materialized view if exists mv_dia_overview_stats;

create materialized view mv_dia_overview_stats as
with base as (
  select
    v.property_id,
    nullif(trim(v.operator), '') as raw_operator,
    p.operator_id,
    p.operator_class,
    nullif(trim(v.state), '') as state,
    v.building_size,
    v.annual_rent as rent,
    le.lease_expiration
  from v_property_attributes_portfolio v
  left join properties p on p.property_id = v.property_id
  left join lateral (
    select l.lease_expiration
      from leases l
     where l.property_id = v.property_id and l.lease_expiration is not null
     order by l.is_active desc nulls last, l.leased_area desc nulls last, l.lease_start desc nulls last
     limit 1
  ) le on true
),
op_resolved as (
  select
    b.property_id,
    b.raw_operator,
    b.operator_id,
    b.operator_class,
    b.state,
    b.building_size,
    b.rent,
    b.lease_expiration,
    -- canonical display name: the registry's own name for a resolved
    -- operator_id; the raw string only for the genuine residue (no
    -- operator_id and not a category/payer/non_operator classification).
    coalesce(o.name,
      case when b.operator_id is null and b.operator_class is null then b.raw_operator end
    ) as operator_display,
    b.operator_id is not null as is_canonical_operator,
    (b.operator_id is null and b.operator_class is null and b.raw_operator is not null)
      as is_unresolved_operator
  from base b
  left join operators o on o.operator_id = b.operator_id
),
portfolio as (
  select
    count(*) as total_properties,
    count(*) filter (where building_size > 0) as properties_with_sf,
    coalesce(sum(building_size) filter (where building_size > 0), 0)::bigint as total_sf,
    coalesce(round(sum(rent) filter (where rent > 0)), 0) as total_rent,
    count(*) filter (where rent > 0) as properties_with_rent,
    -- DIA1c: canonical operator count — folded, one identity per company.
    count(distinct operator_id) filter (where operator_id is not null) as operators_tracked,
    -- DIA1c: raw operator text present, no operator_id, and not a
    -- category/payer/non_operator classification — the true residue.
    count(*) filter (where is_unresolved_operator) as operators_unresolved,
    case
      when count(*) filter (where rent > 0 and building_size > 0) > 0
        then round(avg(rent / nullif(building_size, 0)) filter (where rent > 0 and building_size > 0), 2)
      else 0
    end as avg_rent_psf,
    count(*) filter (where lease_expiration is not null) as properties_with_lease_exp,
    count(*) filter (where lease_expiration < current_date) as lease_expired_count,
    count(*) filter (where lease_expiration < current_date - interval '1 year') as lease_expired_stale,
    count(*) filter (where lease_expiration >= current_date and lease_expiration < current_date + interval '6 mons') as exp_lease_lt_6mo,
    count(*) filter (where lease_expiration >= current_date and lease_expiration < current_date + interval '1 year') as exp_lease_lt_1yr,
    count(*) filter (where lease_expiration >= current_date + interval '1 year' and lease_expiration < current_date + interval '2 years') as exp_lease_1_2yr,
    count(*) filter (where lease_expiration >= current_date + interval '2 years' and lease_expiration < current_date + interval '5 years') as exp_lease_2_5yr,
    count(*) filter (where lease_expiration >= current_date + interval '5 years') as exp_lease_5plus,
    case
      when count(*) filter (where lease_expiration >= current_date) > 0
        then round(avg((lease_expiration - current_date)::numeric / 365.25) filter (where lease_expiration >= current_date), 1)
      else 0
    end as avg_term_remaining
  from op_resolved
),
lease_exp_buckets as (
  select jsonb_build_array(
    jsonb_build_object('label', 'Expired / holdover', 'count', count(*) filter (where lease_expiration < current_date), 'color', '#ef4444'),
    jsonb_build_object('label', '< 6 months', 'count', count(*) filter (where lease_expiration >= current_date and lease_expiration < current_date + interval '6 mons'), 'color', '#f87171'),
    jsonb_build_object('label', '6 – 12 months', 'count', count(*) filter (where lease_expiration >= current_date + interval '6 mons' and lease_expiration < current_date + interval '1 year'), 'color', '#fb923c'),
    jsonb_build_object('label', '1 – 2 years', 'count', count(*) filter (where lease_expiration >= current_date + interval '1 year' and lease_expiration < current_date + interval '2 years'), 'color', '#fbbf24'),
    jsonb_build_object('label', '2 – 5 years', 'count', count(*) filter (where lease_expiration >= current_date + interval '2 years' and lease_expiration < current_date + interval '5 years'), 'color', '#34d399'),
    jsonb_build_object('label', '5+ years', 'count', count(*) filter (where lease_expiration >= current_date + interval '5 years'), 'color', '#60a5fa')
  ) as lease_distribution_by_expiry
  from op_resolved
  where lease_expiration is not null
),
-- DIA1c: grouped by canonical operator_display, not the raw string — this is
-- the fold. A resolved operator_id always wins its registry name; the
-- residue (raw_operator, no operator_id, not a category) keeps its own
-- bucket so it stays visible rather than silently dropped.
op_agg as (
  select
    operator_display as name,
    bool_or(is_canonical_operator) as is_canonical,
    count(*) as cnt,
    coalesce(sum(rent) filter (where rent > 0), 0) as rent,
    coalesce(sum(building_size) filter (where building_size > 0), 0)::bigint as sf
  from op_resolved
  where operator_display is not null
  group by operator_display
),
top_operators_by_count as (
  select jsonb_agg(jsonb_build_object('name', t.name, 'count', t.cnt, 'rent', t.rent, 'sf', t.sf, 'canonical', t.is_canonical) order by t.cnt desc) as j
  from (select name, cnt, rent, sf, is_canonical from op_agg order by cnt desc limit 12) t
),
top_operators_by_rent as (
  select jsonb_agg(jsonb_build_object('name', t.name, 'count', t.cnt, 'rent', t.rent, 'canonical', t.is_canonical) order by t.rent desc) as j
  from (select name, cnt, rent, is_canonical from op_agg order by rent desc limit 10) t
),
state_agg as (
  select state as name, count(*) as cnt,
    coalesce(sum(rent) filter (where rent > 0), 0) as rent,
    coalesce(sum(building_size) filter (where building_size > 0), 0)::bigint as sf
  from op_resolved
  where state is not null
  group by state
),
top_states_by_count as (
  select jsonb_agg(jsonb_build_object('name', t.name, 'count', t.cnt, 'rent', t.rent, 'sf', t.sf) order by t.cnt desc) as j
  from (select name, cnt, rent, sf from state_agg order by cnt desc limit 10) t
),
top_states_by_rent as (
  select jsonb_agg(jsonb_build_object('name', t.name, 'rent', t.rent) order by t.rent desc) as j
  from (select name, cnt, rent from state_agg order by rent desc limit 10) t
),
extra as (
  select
    (select count(*) from contacts) as total_contacts,
    (select count(distinct medicare_id) from medicare_clinics) as cms_clinics
)
select
  pf.total_properties,
  ex.cms_clinics,
  pf.properties_with_sf,
  pf.total_sf,
  pf.total_rent,
  pf.total_rent as total_noi,
  pf.properties_with_rent,
  pf.operators_tracked,
  pf.operators_unresolved,
  pf.avg_rent_psf,
  ex.total_contacts,
  pf.properties_with_lease_exp,
  pf.lease_expired_count,
  pf.lease_expired_stale,
  pf.exp_lease_lt_6mo,
  pf.exp_lease_lt_1yr,
  pf.exp_lease_1_2yr,
  pf.exp_lease_2_5yr,
  pf.exp_lease_5plus,
  pf.avg_term_remaining,
  leb.lease_distribution_by_expiry,
  (select j from top_operators_by_count) as top_operators_by_count,
  (select j from top_operators_by_rent) as top_operators_by_rent,
  (select j from top_states_by_count) as top_states_by_count,
  (select j from top_states_by_rent) as top_states_by_rent,
  now() as computed_at
from portfolio pf, lease_exp_buckets leb, extra ex;

create unique index mv_dia_overview_stats_computed_at_idx on mv_dia_overview_stats (computed_at);
create unique index mv_dia_overview_stats_singleton on mv_dia_overview_stats ((1));

grant select on mv_dia_overview_stats to anon, authenticated, service_role;

-- 5) Review list: genuinely unresolved operator names, live going forward.
create or replace view v_dia_operator_unresolved_review as
select
  p.property_id,
  p.tenant,
  p.operator as raw_operator,
  p.state,
  p.updated_at
from properties p
where p.operator_id is null
  and p.operator_class is null
  and p.operator is not null and trim(p.operator) <> ''
  and p.merged_into_property_id is null
order by p.operator, p.property_id;

grant select on v_dia_operator_unresolved_review to anon, authenticated, service_role;
