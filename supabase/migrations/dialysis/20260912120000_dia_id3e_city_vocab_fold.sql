-- ID3e: city/state vocabulary fold on dia.medicare_clinics (I14 controlled-vocabulary normalization).
-- Applied live to Dialysis_DB (zqzrriwuavgrquhisnoa) 2026-09-12. Mirrors the gov migration
-- mechanism (supabase/migrations/government/20260912120000_gov_id3e_county_city_vocab_fold.sql).
--
-- dia.properties.property_type is DELIBERATELY NOT touched here — measured live 2026-09-12:
-- 96 raw values, only 9 collapse under lower(trim()) (96 -> 87). That is a semantic
-- taxonomy/rollup decision (which distinct labels mean the same thing), not a case/punctuation
-- vocabulary fold, so bundling it into this mechanism would risk guessing category boundaries.
-- Filed separately as ID3e-property-type-taxonomy (see docs/os/PLANNED-BACKLOG.md).

create or replace function dia_normalize_place_token(p_text text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(trim(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', ' ', 'g')), '')
$$;

comment on function dia_normalize_place_token(text) is
  'ID3e: lowercase + collapse punctuation/whitespace to single spaces (never strips words). '
  'Used ONLY as one half of a (name, state) pair key — never as an identity key alone.';

alter table medicare_clinics
  add column if not exists city_norm text generated always as (
    case when city is not null then dia_normalize_place_token(city) || '|' || lower(trim(coalesce(state,'')))
         else null end
  ) stored;

comment on column medicare_clinics.city_norm is
  'ID3e generated: dia_normalize_place_token(city) || ''|'' || lower(trim(state)). Fold key for city+state case/punctuation variants. Never merges across a different state.';

create index if not exists idx_medicare_clinics_city_norm on medicare_clinics (city_norm);

create or replace view v_dia_place_vocab_state_review as
select medicare_id, facility_name, city, state, 'state_not_two_letters' as review_reason
from medicare_clinics
where state is not null
  and lower(trim(state)) !~ '^[a-z]{2}$';

comment on view v_dia_place_vocab_state_review is
  'ID3e: medicare_clinics rows whose state value is not a plausible 2-letter code. Routed here for human review, never auto-repaired.';

create or replace view v_dia_city_fold_groups as
select city_norm,
       array_agg(distinct city order by city) as raw_variants,
       count(distinct city) as n_variants,
       count(*) as n_clinics
from medicare_clinics
where city_norm is not null
group by city_norm
having count(distinct city) > 1
order by n_clinics desc;

comment on view v_dia_city_fold_groups is 'ID3e parity: city+state groups where >1 raw spelling collapses under the fold.';
