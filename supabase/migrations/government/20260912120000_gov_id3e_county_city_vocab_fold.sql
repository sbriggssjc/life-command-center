-- ⚠️ HISTORICAL — DO NOT RE-APPLY. This directory does not own the government database;
-- `government-lease` does (see supabase/migrations/government/README.md, 2026-09-12).
-- This file is kept as a record of what this repo applied in the past. The live, correct
-- copy of any object it defines may have since diverged -- read the deployed database or
-- government-lease's committed source, never this file, before trusting its content.

-- ID3e: county/city vocabulary fold (I14 controlled-vocabulary normalization).
-- Applied live to gov (scknotsqkcheojiaewwh) 2026-09-12. Committed here (life-command-center is
-- the attached repo for this build) as the record of what shipped — the "second copy that is
-- correct beats no copy at all" doctrine (P194/N18): a rebuild must not silently regress this.
--
-- Additive only: one IMMUTABLE normalizer + two STORED generated columns + review/parity views.
-- Comparator key is ALWAYS (normalized name, lower(trim(state))) as a PAIR, never name alone —
-- confirmed live: St Louis MN and St Louis MO carry DIFFERENT keys; Le Flore OK / Leflore MS,
-- LaSalle IL/TX, DeSoto FL/MS are the same class and are protected by the same mechanism.
-- Punctuation is normalized to a SPACE (never stripped to nothing) so "(city)"/"city" survives
-- as a token — this is what lets a VA independent city ("RICHMOND (CITY)" / "Richmond city")
-- fold together while never colliding with a same-named county.

create or replace function gov_normalize_place_token(p_text text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(trim(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', ' ', 'g')), '')
$$;

comment on function gov_normalize_place_token(text) is
  'ID3e: lowercase + collapse punctuation/whitespace to single spaces (never strips words). '
  'Used ONLY as one half of a (name, state) pair key — never as an identity key alone.';

alter table properties
  add column if not exists county_norm text generated always as (
    case when county is not null then gov_normalize_place_token(county) || '|' || lower(trim(coalesce(state,'')))
         else null end
  ) stored;

alter table properties
  add column if not exists city_norm text generated always as (
    case when city is not null then gov_normalize_place_token(city) || '|' || lower(trim(coalesce(state,'')))
         else null end
  ) stored;

comment on column properties.county_norm is
  'ID3e generated: gov_normalize_place_token(county) || ''|'' || lower(trim(state)). Fold key for county+state case/punctuation variants. Never merges across a different state.';
comment on column properties.city_norm is
  'ID3e generated: gov_normalize_place_token(city) || ''|'' || lower(trim(state)). Fold key for city+state case/punctuation variants. Never merges across a different state.';

create index if not exists idx_properties_county_norm on properties (county_norm);
create index if not exists idx_properties_city_norm on properties (city_norm);

-- Human-review list: state values that don't look like a real 2-letter code.
-- Never auto-repaired here (2026-09-12: property_id 6638 state='M', property_id 16465 state='|').
create or replace view v_gov_place_vocab_state_review as
select property_id, address, city, county, state, 'state_not_two_letters' as review_reason
from properties
where state is not null
  and lower(trim(state)) !~ '^[a-z]{2}$';

comment on view v_gov_place_vocab_state_review is
  'ID3e: properties whose state value is not a plausible 2-letter code (e.g. corrupted capture). '
  'Routed here for human review, never auto-repaired by the county/city fold.';

-- Parity views: fold groups with >1 raw variant, for auditing what the fold actually merged.
create or replace view v_gov_county_fold_groups as
select county_norm,
       array_agg(distinct county order by county) as raw_variants,
       count(distinct county) as n_variants,
       count(*) as n_properties
from properties
where county_norm is not null
group by county_norm
having count(distinct county) > 1
order by n_properties desc;

create or replace view v_gov_city_fold_groups as
select city_norm,
       array_agg(distinct city order by city) as raw_variants,
       count(distinct city) as n_variants,
       count(*) as n_properties
from properties
where city_norm is not null
group by city_norm
having count(distinct city) > 1
order by n_properties desc;

comment on view v_gov_county_fold_groups is 'ID3e parity: county+state groups where >1 raw spelling collapses under the fold. Audit before trusting any consumer of county_norm.';
comment on view v_gov_city_fold_groups is 'ID3e parity: city+state groups where >1 raw spelling collapses under the fold.';
