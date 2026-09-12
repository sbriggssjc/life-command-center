-- ID3a — Government agency identity: wire the registry that already exists.
-- Project: government (scknotsqkcheojiaewwh).  Date: 2026-09-12.
-- Audit: docs/audits/ID3a_GOV_AGENCY_IDENTITY_WIRING_2026-09-12.md
--
-- WHAT THIS IS
--   `government_agencies` (65 rows) and `properties.agency_canonical` (1,286 raw strings ->
--   45 codes) already exist.  The two FK columns that should point at the registry do not:
--   `properties.agency_id` 0 / 20,509 and `property_agencies.agency_id` 160 / 132,243 (0.12%).
--   This migration wires them — alias table + one resolver + hard write guard + reviewed,
--   reversible backfill + parity view + an agency-specific identity detector.
--
-- ⚠️ DECISION 1 — THE ALIAS TABLE IS **NOT** SEEDED FROM `agency_canonical`.
--   The ID3a brief called `agency_canonical` "a working normalizer".  Measured live it
--   collapses variants AND conflates three different things, so seeding from it would write
--   a wrong FK at scale:
--     * `NAVY` (150 properties) is 145x **Navy Federal Credit Union** — a bank, not the Navy.
--     * `ICE` (44) includes "Handel's Homemade Ice Cream & Yogurt".
--     * `VA` (2,174) folds in ARKANSAS DEPARTMENT OF VETERANS AFFAIRS, Virginia Department of
--       Veterans Services and `RICHMOND FIELD OFFICE (VA)` — state bodies / a state suffix.
--     * `USDA` folds in Florida / Texas / Washington **State** Departments of Agriculture.
--     * `HHS` is dominated by Texas Health & Human Services **Commission** (a state agency).
--     * `DOJ` includes "TEXAS JUVENILE JUSTICE DEPARTMENT"; `EPA` includes "State of Ga -
--       Dept of Environmental Protection"; `DOL` includes the PA Department of Labor.
--   `agency_canonical` is left untouched (a display/rollup column with existing consumers).
--   The FK is resolved ONLY from an explicit alias, so every auto-applied row is a string a
--   human enumerated.  Everything else goes to the review lane with its raw text intact.
--
-- ⚠️ DECISION 2 — `(VA)` IS A STATE SUFFIX, NOT VETERANS AFFAIRS.  `RICHMOND FIELD OFFICE (VA)`
--   (74 rows) matches the `<CITY> FIELD OFFICE (<ST>)` shape used all over this column
--   (BALTIMORE FIELD OFFICE (MD), CHARLESTON FIELD OFFICE (WV), PITTSBURGH FIELD OFFICE (PA)...).
--   Never aliased; routed to review as `state_suffix_ambiguous`.
--
-- ⚠️ DECISION 3 — `ACE` / `ACOE` / `ACoe` / `Army COE` = U.S. Army Corps of Engineers (USACE).
--   Evidence, not assumption: property 511 (`ACE`) is 475 Quality Cir **NW**, Huntsville AL and
--   property 31087 (`ACOE`) is 475 Quality Cir **SW**, Huntsville AL — the USACE Huntsville
--   Center campus; the other `ACOE` rows are Little Rock AR, St. Paul MN, Lakewood CO and
--   Winchester VA, all USACE district cities; all rows are `government_type='Federal'`.
--   `AMRY` (a probable ARMY typo) is NOT aliased — the Corps cannot be inferred from it.
--
-- ⚠️ DECISION 4 — `GSA - <occupant>` COMPOUNDS ARE NOT AUTO-APPLIED.  ~90 raw strings name GSA
--   as the contracting/lessee agency and a second, occupying agency ("GSA - Dept of Justice",
--   "GSA - Social Security Admin").  `agency_canonical` resolves some to GSA and some to the
--   occupant — two different answers for one shape.  Which agency `properties.agency_id` should
--   name is a modelling decision (the occupant belongs on `property_agencies`), so all of them
--   go to review as `gsa_compound_occupant`.  This costs coverage on purpose: 150 properties on
--   "GSA - Social Security Admin" alone.  Never guessed.
--
-- ⚠️ DECISION 5 — 14 CANONICAL CODES HAVE NO REGISTRY ROW and are routed, not invented:
--   LSC (312 props), DOL (174), STATE (155), NAVY (150), USGS (38), ARMY (17), DOC (16),
--   NRC (9), NIH (6), ED (5), USAF (2), NLRB (2), TREAS (1).  Adding a registry row is a
--   curation decision for a human (`no_registry_row` in the review lane).
--
-- DISCIPLINE: fill-blanks only · exact/alias matches only, never fuzzy, never guessed ·
--   provenance-tagged · batch-reversible · idempotent · dry-run by default.
--
-- REVERSAL RUNBOOK (undoes every FK this migration's backfill wrote, and nothing else):
--   update properties p set agency_id = null
--     from gov_agency_id_backfill_log l
--    where l.target_table='properties' and l.record_pk = p.property_id::text
--      and l.batch_tag = '<batch>' and l.reverted_at is null;
--   update property_agencies a set agency_id = null
--     from gov_agency_id_backfill_log l
--    where l.target_table='property_agencies' and l.record_pk = a.property_agency_id::text
--      and l.batch_tag = '<batch>' and l.reverted_at is null;
--   update gov_agency_id_backfill_log set reverted_at = now() where batch_tag='<batch>';

-- (transaction is supplied by the migration runner)

-- ---------------------------------------------------------------------------
-- 1. The comparator.  AGENCY-SPECIFIC, and deliberately NOT a generic alnum key
--    (ID4's per-class-comparators decision): it keeps word boundaries, so
--    "US DEPARTMENT OF AGRICULTURE" and "USDA" stay distinct strings that an
--    explicit alias row relates, rather than being mashed together by a
--    normalizer that would also collide unrelated agencies.
-- ---------------------------------------------------------------------------
create or replace function gov_agency_alias_key(p_text text)
returns text
language sql
immutable
as $$
  select nullif(
           btrim(
             regexp_replace(
               regexp_replace(upper(translate(coalesce(p_text,''), '.''`', '')),
                              '[^A-Z0-9]+', ' ', 'g'),
               '\s+', ' ', 'g')),
           '');
$$;

comment on function gov_agency_alias_key(text) is
  'ID3a agency comparator: strip periods/apostrophes, non-alnum -> space, collapse, upper. '
  'Word boundaries preserved on purpose (per-class comparator, never a shared alnum key).';

-- ---------------------------------------------------------------------------
-- 2. Alias table: raw string -> agency_id.
-- ---------------------------------------------------------------------------
create table if not exists gov_agency_aliases (
  alias_id    bigserial primary key,
  alias_raw   text not null,
  alias_key   text not null,
  agency_id   uuid not null references government_agencies(agency_id) on delete restrict,
  source      text not null,             -- registry_code | registry_full_name | id3a_curated
  note        text,
  created_at  timestamptz not null default now()
);
create unique index if not exists uq_gov_agency_aliases_key on gov_agency_aliases(alias_key);
create index if not exists ix_gov_agency_aliases_agency on gov_agency_aliases(agency_id);

comment on table gov_agency_aliases is
  'ID3a: the ONLY thing that may resolve a raw agency string to government_agencies.agency_id. '
  'Add a row to teach the resolver a string; never widen the resolver itself.';

-- ---------------------------------------------------------------------------
-- 3. Review lane.  Raw text kept verbatim; nothing is ever guessed into the FK.
-- ---------------------------------------------------------------------------
create table if not exists gov_agency_resolution_review (
  review_id      bigserial primary key,
  raw_text       text not null,
  raw_key        text not null,
  source_table   text not null,          -- properties | property_agencies
  source_column  text not null,
  row_count      integer not null default 0,
  reason         text not null,
  status         text not null default 'open',   -- open | resolved | rejected
  resolved_agency_id uuid references government_agencies(agency_id),
  resolved_note  text,
  first_seen_at  timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists uq_gov_agency_review_key
  on gov_agency_resolution_review(source_table, source_column, raw_key);
create index if not exists ix_gov_agency_review_open
  on gov_agency_resolution_review(status, row_count desc);

-- ---------------------------------------------------------------------------
-- 4. Reversible backfill ledger.
-- ---------------------------------------------------------------------------
create table if not exists gov_agency_id_backfill_log (
  log_id        bigserial primary key,
  batch_tag     text not null,
  target_table  text not null,
  record_pk     text not null,
  raw_text      text,
  agency_id     uuid not null references government_agencies(agency_id),
  applied_at    timestamptz not null default now(),
  reverted_at   timestamptz
);
create index if not exists ix_gov_agency_backfill_batch on gov_agency_id_backfill_log(batch_tag);

-- ---------------------------------------------------------------------------
-- 5. Write-guard log (an aborting transaction cannot durably self-log, so the
--    guard RAISES and this table is written by the caller / detector path).
-- ---------------------------------------------------------------------------
create table if not exists gov_agency_write_review (
  id           bigserial primary key,
  target_table text not null,
  record_pk    text,
  offending_agency_id uuid,
  reason       text not null,
  logged_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6. Seed the aliases.
-- ---------------------------------------------------------------------------

-- 6a. Every registry code.
insert into gov_agency_aliases (alias_raw, alias_key, agency_id, source, note)
select g.code, gov_agency_alias_key(g.code), g.agency_id, 'registry_code', null
  from government_agencies g
 where gov_agency_alias_key(g.code) is not null
on conflict (alias_key) do nothing;

-- 6b. Every registry full_name.
--     NOTE: `CIS` and `USCIS` carry the IDENTICAL full_name ("U.S. Citizenship and Immigration
--     Services") — a pre-existing registry duplicate.  ON CONFLICT DO NOTHING makes the first
--     one win deterministically by agency_id order; the duplicate is reported by the detector
--     (`registry_duplicate_full_name`) rather than silently merged.  Filed as ID3a-regdup.
insert into gov_agency_aliases (alias_raw, alias_key, agency_id, source, note)
select g.full_name, gov_agency_alias_key(g.full_name), g.agency_id, 'registry_full_name', null
  from (select * from government_agencies order by agency_id) g
 where gov_agency_alias_key(g.full_name) is not null
on conflict (alias_key) do nothing;

-- 6c. Curated aliases.  EVERY string below was read off the live census in
--     docs/audits/ID3a_GOV_AGENCY_IDENTITY_WIRING_2026-09-12.md §2.  A string that names a
--     state body, a company, more than one agency, or a city/state suffix is deliberately absent.
insert into gov_agency_aliases (alias_raw, alias_key, agency_id, source, note)
select v.raw, gov_agency_alias_key(v.raw), g.agency_id, 'id3a_curated', v.note
  from (values
    -- ---- SSA (federal Social Security Administration) ----
    ('SSA','SSA',null),
    ('ssa','SSA',null),
    ('Social Security Administration (SSA)','SSA',null),
    ('U.S. Social Security Administration','SSA',null),
    ('US Social Security Administration','SSA',null),
    ('Social Security Office','SSA',null),
    ('SSA Administration','SSA',null),
    ('SSA-ODAR','SSA','ODAR = SSA Office of Disability Adjudication and Review'),
    ('SSA/ODAR','SSA','ODAR = SSA Office of Disability Adjudication and Review'),
    ('SSA (Condo)','SSA','ownership form, not a second agency'),
    ('The United States of America Social Security Services','SSA',null),
    ('Columbus Ohio Social Security','SSA',null),
    -- ---- VA (federal Department of Veterans Affairs) ----
    ('US Department of Veteran Affairs','VA',null),
    ('US Department of Veterans Affairs','VA',null),
    ('Us Department of Veterans Affairs','VA',null),
    ('US Department of Veterans Affairs - 1','VA','"- 1" is an ingest suffix, not a distinct body'),
    ('U.S. Department of Veterans Affairs','VA',null),
    ('U.S Department of Veterans Affairs','VA',null),
    ('U.S. Department of Veteran Affairs','VA',null),
    ('U.S. Department of Veteran''s Affairs','VA',null),
    ('United States Department of Veterans Affairs','VA',null),
    ('The US Department of Veteran Affairs','VA',null),
    ('Department of Veteran Affairs','VA',null),
    ('Dept of Veterans Affairs','VA',null),
    ('Department-veterans Affairs','VA',null),
    ('US Dept of Veteran Affairs','VA',null),
    ('US Veterans Affairs Department','VA',null),
    ('US Department of Veterans Services','VA',null),
    ('Department Vetran Affairs','VA','misspelling in source'),
    ('Veterans Affairs','VA',null),
    ('Veterans Administration','VA','historical name of the same federal department'),
    ('United States Veteran Administration','VA',null),
    ('Veterans Affairs Clinic','VA',null),
    ('Veterans Affairs Outpatient Clinic','VA',null),
    ('Veterans Affairs Health Care System','VA',null),
    ('Veterans Administration Clinic','VA',null),
    ('Veterans Administration Medical Outpatient Clinic','VA',null),
    ('VA Clinic','VA',null),
    ('VA CBOC','VA','CBOC = Community Based Outpatient Clinic'),
    ('VA/CBOC','VA',null),
    ('VA Outpatient Clinic','VA',null),
    ('VA Center','VA',null),
    ('VA Vet Center','VA',null),
    ('VA/Vet Center','VA',null),
    ('Department of Veterans Affairs located','VA','truncated source string'),
    -- ---- GSA (bare forms only; see DECISION 4 for the compounds) ----
    ('GSA','GSA',null),
    ('GSA/PBS','GSA','PBS = GSA Public Buildings Service, the same agency'),
    ('General Services Administration (GSA)','GSA',null),
    ('U.S. General Services Administration','GSA',null),
    ('General Service Administration','GSA','misspelling in source'),
    ('United States of America (GSA)','GSA',null),
    ('GSA Heartland Region 6','GSA',null),
    ('GSA Pacific Rim Region 9','GSA',null),
    ('GSA Southeast Sunbelt Region 4','GSA',null),
    -- ---- USDA (federal only; state departments of agriculture excluded) ----
    ('USDA','USDA',null),
    ('Usda','USDA',null),
    ('US Department of Agriculture (USDA)','USDA',null),
    ('U.S. Dept. of Agriculture (USDA)','USDA',null),
    ('United States Department of Agriculture','USDA',null),
    ('USDA Service Center','USDA',null),
    -- ---- USPS ----
    ('USPS','USPS',null),
    ('UPSPS','USPS','transposition typo of USPS'),
    ('United States Postal Service (USPS)','USPS',null),
    ('U.S. Postal Service','USPS',null),
    ('US Postal Service','USPS',null),
    ('U S Postal Service','USPS',null),
    ('US Postal','USPS',null),
    ('US Post Office','USPS',null),
    ('United States Post Office','USPS',null),
    ('Miami US Postal Service','USPS',null),
    -- ---- FBI ----
    ('FBI','FBI',null),
    ('Federal Bureau of Investigation (FBI)','FBI',null),
    ('Federal Bureau Investigation (FBI)','FBI',null),
    ('Federal Bureau-Investigation','FBI',null),
    ('United States Of America Fbi','FBI',null),
    ('Louisville - FBI','FBI','city prefix names an FBI field office'),
    -- ---- IRS ----
    ('IRS','IRS',null),
    ('IRS - Internal Revenue Service','IRS',null),
    ('IRS National Distribution','IRS',null),
    -- ---- USACE (see DECISION 3) ----
    ('ACE','USACE','Army Corps of Engineers; 475 Quality Cir NW Huntsville AL, sibling of the ACOE row at SW'),
    ('ACOE','USACE',null),
    ('ACoe','USACE',null),
    ('Army COE','USACE',null),
    ('US Army Corps of Engineers','USACE',null),
    ('US Army Corp of Engineers','USACE',null),
    ('United States Army Corps of Engineers','USACE',null),
    -- ---- DHS family ----
    ('DHS','DHS',null),
    ('U.S. Department of Homeland Security','DHS',null),
    ('US Department of Homeland Security','DHS',null),
    ('The Department of Homeland Security','DHS',null),
    ('CBP','CBP',null),
    ('CBP (Customs & Border Protection)','CBP',null),
    ('US CBP','CBP',null),
    ('U.S. Customs & Border Protection','CBP',null),
    ('U.S. Customs and Border Protection','CBP',null),
    ('US Customs & Border Protection','CBP',null),
    ('ICE','ICE',null),
    ('U.S. Immigration and Customs Enforcement','ICE',null),
    ('US Immigration and Customs Enforcement','ICE',null),
    ('US Immigration and Customs Enforcement (ICE)','ICE',null),
    ('USCIS','USCIS',null),
    ('U.S. Citizenship and Immigration Services','USCIS',null),
    ('US Citizen & Immigration Services','USCIS',null),
    ('TSA','TSA',null),
    ('FEMA','FEMA',null),
    ('Federal Emergency Management Agency','FEMA',null),
    ('USCG','USCG',null),
    -- ---- DOJ family ----
    ('DOJ','DOJ',null),
    ('Department of Justice','DOJ',null),
    ('DEA','DEA',null),
    ('US Drug Enforcement Administration','DEA',null),
    ('US Drug Enforcement Agency','DEA',null),
    ('Drug Enforcement ADM','DEA',null),
    ('United States of America - DEA','DEA',null),
    ('ATF','ATF',null),
    ('BOP','BOP',null),
    ('Bureau of Prisons','BOP',null),
    -- ---- other federal singles ----
    ('EPA','EPA',null),
    ('FDA','FDA',null),
    ('FAA','FAA',null),
    ('DOD','DOD',null),
    ('DOE','DOE',null),
    ('US Department of Energy','DOE',null),
    ('DOI','DOI',null),
    ('U.S. Department of the Interior','DOI',null),
    ('DOT','DOT',null),
    ('NOAA','NOAA',null),
    ('NOAA Tides and Currents','NOAA',null),
    ('OPM','OPM',null),
    ('US Office of Personnel','OPM',null),
    ('CDC','CDC',null),
    ('HUD','HUD',null),
    ('FCC','FCC',null),
    ('SEC','SEC',null),
    ('SBA','SBA',null),
    ('NASA','NASA',null),
    ('NATIONAL AERONAUTICS AND SPACE ADMINISTRATION','NASA',null),
    ('MEPS','MEPS',null),
    ('Military Entrance Processing Station','MEPS',null),
    ('US Military Entrance Processing Station','MEPS',null),
    ('BLM','BLM',null),
    ('Bureau of Land Management','BLM',null),
    ('US Bureau of Land Management (BLM)','BLM',null),
    ('NPS','NPS',null),
    ('National Park Service','NPS',null),
    ('USFS','USFS',null),
    ('US Forest Service','USFS',null),
    ('United States Forest Service','USFS',null),
    ('APHIS','APHIS',null),
    ('Usda Animal and Plant Inspection Service','APHIS',null),
    ('USMS','USMS',null),
    ('HHS','HHS','federal HHS only; Texas HHSC and state equivalents are NOT aliased here'),
    ('DHHS','HHS',null)
  ) as v(raw, code, note)
  join government_agencies g on g.code = v.code
on conflict (alias_key) do nothing;

-- ---------------------------------------------------------------------------
-- 7. The ONE resolver.  Text in, {agency_id, code, status} out.  Fails CLOSED —
--    it never mints a registry row and never returns a fuzzy best guess.
-- ---------------------------------------------------------------------------
create or replace function gov_resolve_agency(p_text text)
returns table(agency_id uuid, code text, status text)
language plpgsql
stable
as $$
declare
  v_key text := gov_agency_alias_key(p_text);
begin
  if v_key is null then
    return query select null::uuid, null::text, 'blank'::text;
    return;
  end if;

  return query
    select a.agency_id, g.code, 'matched'::text
      from gov_agency_aliases a
      join government_agencies g on g.agency_id = a.agency_id
     where a.alias_key = v_key
       and coalesce(g.active, true)
     limit 1;

  if not found then
    return query select null::uuid, null::text, 'unresolved'::text;
  end if;
end;
$$;

revoke all on function gov_resolve_agency(text) from public, anon, authenticated;
grant execute on function gov_resolve_agency(text) to service_role;

do $$
begin
  if has_function_privilege('anon', 'gov_resolve_agency(text)', 'EXECUTE') then
    raise exception 'ID3a: gov_resolve_agency still executable by anon after revoke';
  end if;
end $$;

comment on function gov_resolve_agency(text) is
  'ID3a: the single resolver for a raw government-agency string. Exact alias match only. '
  'Returns status blank|matched|unresolved and NEVER guesses.';

-- ---------------------------------------------------------------------------
-- 8. Hard write guard on agency_id.  The FK already enforces "this uuid exists";
--    the guard adds "and it is an ACTIVE registry row", and refuses the write
--    rather than letting a retired agency be attached silently.
-- ---------------------------------------------------------------------------
create or replace function gov_agency_id_write_guard()
returns trigger
language plpgsql
as $$
declare
  v_ok boolean;
begin
  if new.agency_id is null then
    return new;
  end if;
  select coalesce(g.active, true) into v_ok
    from government_agencies g where g.agency_id = new.agency_id;
  if v_ok is null then
    raise exception 'ID3a agency write guard: agency_id % is not in government_agencies (table %)',
      new.agency_id, tg_table_name
      using errcode = 'check_violation';
  end if;
  if not v_ok then
    raise exception 'ID3a agency write guard: agency_id % is a RETIRED registry row (table %)',
      new.agency_id, tg_table_name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function gov_agency_id_write_guard() from public, anon, authenticated;

drop trigger if exists trg_gov_properties_agency_id_guard on properties;
create trigger trg_gov_properties_agency_id_guard
  before insert or update of agency_id on properties
  for each row execute function gov_agency_id_write_guard();

drop trigger if exists trg_gov_property_agencies_agency_id_guard on property_agencies;
create trigger trg_gov_property_agencies_agency_id_guard
  before insert or update of agency_id on property_agencies
  for each row execute function gov_agency_id_write_guard();

-- Reason classifier for the review lane.  Names WHY a string was not auto-applied, so the
-- lane is triageable instead of being one undifferentiated pile.
create or replace function gov_id3a_review_reason(p_raw text)
returns text
language sql
immutable
as $$
  select case
    when p_raw ~* '^\s*GSA\s*[-/]'                      then 'gsa_compound_occupant'
    when p_raw ~ '\([A-Z]{2}\)\s*$'                     then 'state_suffix_ambiguous'
    when p_raw ~* '(^|[^a-z])(state of|commonwealth of|county of|city of|town of)([^a-z]|$)'
                                                        then 'state_or_local_body'
    when p_raw ~* '(credit union|bank|federal savings|insurance|LLC|L\.L\.C|Inc\.|, Inc|Corporation|Company)'
                                                        then 'commercial_lookalike'
    when p_raw ~ '[/|]|&|\+'                            then 'multi_agency_compound'
    when p_raw ~* '(field office|service center|services division|pmc\s*$|office park|business center)'
                                                        then 'facility_label_not_agency'
    else 'unmatched_needs_alias'
  end;
$$;

-- ---------------------------------------------------------------------------
-- 9. The reviewed, reversible, dry-run-by-default backfill.
--    FILL-BLANKS ONLY: a row that already carries an agency_id is never touched.
-- ---------------------------------------------------------------------------
create or replace function gov_id3a_backfill_agency_ids(
  p_dry_run boolean default true,
  p_batch   text    default null
)
returns table(
  target_table   text,
  auto_rows      bigint,
  auto_distinct_strings bigint,
  review_rows    bigint,
  review_distinct_strings bigint,
  blank_rows     bigint
)
language plpgsql
as $$
declare
  v_batch text := coalesce(p_batch, 'id3a_' || to_char(now(),'YYYYMMDD'));
begin
  -- Explicit drops: `on commit drop` alone collides (42P07) if the function is called
  -- twice inside one transaction (e.g. dry run then apply).
  drop table if exists _id3a_prop;
  drop table if exists _id3a_pa;

  create temp table _id3a_prop on commit drop as
  select p.property_id, p.agency as raw, r.agency_id, r.status
    from properties p
    cross join lateral gov_resolve_agency(p.agency) r
   where p.agency_id is null;

  create temp table _id3a_pa on commit drop as
  select a.property_agency_id, a.agency_code as raw, r.agency_id, r.status
    from property_agencies a
    cross join lateral gov_resolve_agency(a.agency_code) r
   where a.agency_id is null;

  if not p_dry_run then
    update properties p
       set agency_id = t.agency_id, updated_at = now()
      from _id3a_prop t
     where t.property_id = p.property_id
       and t.status = 'matched'
       and p.agency_id is null;

    insert into gov_agency_id_backfill_log (batch_tag, target_table, record_pk, raw_text, agency_id)
    select v_batch, 'properties', t.property_id::text, t.raw, t.agency_id
      from _id3a_prop t where t.status = 'matched';

    update property_agencies a
       set agency_id = t.agency_id, updated_at = now()
      from _id3a_pa t
     where t.property_agency_id = a.property_agency_id
       and t.status = 'matched'
       and a.agency_id is null;

    insert into gov_agency_id_backfill_log (batch_tag, target_table, record_pk, raw_text, agency_id)
    select v_batch, 'property_agencies', t.property_agency_id::text, t.raw, t.agency_id
      from _id3a_pa t where t.status = 'matched';

    -- Route every unresolved string to the review lane, raw text intact, with a REASON.
    insert into gov_agency_resolution_review
      (raw_text, raw_key, source_table, source_column, row_count, reason)
    select t.raw, gov_agency_alias_key(t.raw), 'properties', 'agency',
           count(*), gov_id3a_review_reason(t.raw)
      from _id3a_prop t where t.status = 'unresolved'
     group by 1,2,3,4,6
    on conflict (source_table, source_column, raw_key)
      do update set row_count = excluded.row_count, updated_at = now()
      where gov_agency_resolution_review.status = 'open';

    insert into gov_agency_resolution_review
      (raw_text, raw_key, source_table, source_column, row_count, reason)
    select t.raw, gov_agency_alias_key(t.raw), 'property_agencies', 'agency_code',
           count(*), gov_id3a_review_reason(t.raw)
      from _id3a_pa t where t.status = 'unresolved'
     group by 1,2,3,4,6
    on conflict (source_table, source_column, raw_key)
      do update set row_count = excluded.row_count, updated_at = now()
      where gov_agency_resolution_review.status = 'open';
  end if;

  return query
  select 'properties'::text,
         count(*) filter (where status='matched'),
         count(distinct raw) filter (where status='matched'),
         count(*) filter (where status='unresolved'),
         count(distinct raw) filter (where status='unresolved'),
         count(*) filter (where status='blank')
    from _id3a_prop
  union all
  select 'property_agencies'::text,
         count(*) filter (where status='matched'),
         count(distinct raw) filter (where status='matched'),
         count(*) filter (where status='unresolved'),
         count(distinct raw) filter (where status='unresolved'),
         count(*) filter (where status='blank')
    from _id3a_pa;
end;
$$;

revoke all on function gov_id3a_backfill_agency_ids(boolean, text) from public, anon, authenticated;
grant execute on function gov_id3a_backfill_agency_ids(boolean, text) to service_role;

-- ---------------------------------------------------------------------------
-- 10. Parity view: property counts per agency_canonical code, before vs after.
--     The ONLY expected movement is variants of one agency collapsing onto one
--     registry code (SSA's 24 raw strings, VA's 76).  A code whose properties
--     land on MORE than one registry code is a finding, not a merge.
-- ---------------------------------------------------------------------------
create or replace view v_gov_agency_wiring_parity as
select
  p.agency_canonical,
  count(*)                                         as properties_total,
  count(p.agency_id)                               as properties_wired,
  count(*) - count(p.agency_id)                    as properties_unwired,
  count(distinct p.agency)                         as raw_strings_total,
  count(distinct p.agency) filter (where p.agency_id is not null) as raw_strings_collapsed,
  count(distinct g.code)                           as registry_codes_hit,
  string_agg(distinct g.code, ',' order by g.code) as registry_codes
from properties p
left join government_agencies g on g.agency_id = p.agency_id
group by 1;

comment on view v_gov_agency_wiring_parity is
  'ID3a parity gate. registry_codes_hit > 1 for one agency_canonical code means the canonical '
  'column was conflating agencies (expected for VA/USDA/HHS/EPA/DOJ — see the migration header).';

-- ---------------------------------------------------------------------------
-- 11. THE IDENTITY DETECTOR, scoped to this class (ID4: prove it on agencies
--     first, generalize later).  Reports collapse + orphan, per column.
-- ---------------------------------------------------------------------------
create or replace view v_gov_agency_identity_detector as
with prop as (
  select 'properties'::text as target_table, 'agency_id'::text as target_column,
         count(*) as rows_total,
         count(agency_id) as rows_resolved,
         count(*) filter (where agency_id is null and gov_agency_alias_key(agency) is not null)
           as rows_orphan_unresolved,
         count(*) filter (where gov_agency_alias_key(agency) is null) as rows_no_raw_text,
         count(distinct agency) filter (where agency_id is not null) as raw_strings_collapsed,
         count(distinct agency_id) as distinct_agencies
    from properties
), pa as (
  select 'property_agencies'::text, 'agency_id'::text,
         count(*), count(agency_id),
         count(*) filter (where agency_id is null and gov_agency_alias_key(agency_code) is not null),
         count(*) filter (where gov_agency_alias_key(agency_code) is null),
         count(distinct agency_code) filter (where agency_id is not null),
         count(distinct agency_id)
    from property_agencies
)
select * from prop union all select * from pa;

comment on view v_gov_agency_identity_detector is
  'ID3a/I13 identity detector for the government-agency class. rows_orphan_unresolved is the '
  'honest gap: a raw string exists and no alias resolves it. Read it beside the review lane.';

-- Collapse detail: which raw strings merged onto which registry code.
create or replace view v_gov_agency_identity_collapse as
select g.code, g.full_name,
       count(distinct p.agency) as raw_strings,
       count(*)                 as properties,
       string_agg(distinct p.agency, ' | ' order by p.agency) as raws
  from properties p
  join government_agencies g on g.agency_id = p.agency_id
 group by 1,2;

-- Registry rows nothing maps to, and registry duplicates — both are curation findings.
create or replace view v_gov_agency_registry_health as
select g.code, g.full_name, g.government_type,
       (select count(*) from gov_agency_aliases a where a.agency_id = g.agency_id) as aliases,
       (select count(*) from properties p where p.agency_id = g.agency_id)         as properties,
       (select count(*) from property_agencies x where x.agency_id = g.agency_id)  as bridge_rows,
       (select count(*) from government_agencies d
         where gov_agency_alias_key(d.full_name) = gov_agency_alias_key(g.full_name)) > 1
         as registry_duplicate_full_name
  from government_agencies g;

