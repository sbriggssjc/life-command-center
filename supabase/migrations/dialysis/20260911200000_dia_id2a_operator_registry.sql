-- ============================================================================
-- ID2a — operator source-of-record, phase A: canonical registry + alias table
-- + one resolver + write guard.  NO CONSUMER SWITCH (that is ID2b — the CM
-- exhibits, rpc_query_comps, the market brief, the dossier, MCP tools all keep
-- reading dia.properties.operator (free text) exactly as before).
--
-- Full design + measurement: docs/audits/ID1_OPERATOR_IDENTITY_AUDIT_2026-09.md
-- (§1.2 registry duplication, §2 writer inventory W1-W10, §5 design, §9 live
-- findings). Scott's decisions: §11 of that doc.
--
-- Registry home (§11 decision): Dialysis_DB OWNS this registry. LCC Opps
-- references it through external_identities with source_type='operator' —
-- never a second identity (same pattern as the existing dia/gov asset +
-- true_owner anchors). `lcc_operator_affiliate_patterns` (LCC Opps) becomes a
-- CACHE keyed off this registry's operator_id via that external_identities
-- link — it is NOT retired here (its one live consumer,
-- lease-extractor.js::operatorFamiliesContradict, is untouched in phase A per
-- "no consumer switch yet"); the cache-vs-retire wiring is ID2b's job when
-- that consumer switches.
--
-- Applies to Dialysis_DB (zqzrriwuavgrquhisnoa). Per this repo's CLAUDE.md
-- data-write discipline: fill-blanks only, conservative/unambiguous matching
-- (surface ambiguity, never guess), provenance-tagged, reversible, idempotent,
-- dry-run-able.
--
-- ⚠️ APPLIED LIVE 2026-09-11 with a schema-mismatch fix (this file already
-- reflects it — see the header note below) plus a follow-up type-cast fix
-- shipped as 20260911200100 (operators.operator_id is `integer`, not
-- `bigint`; RETURN QUERY needs an explicit cast the plpgsql assignment form
-- does not). The property/lease BACKFILL below was run in DRY-RUN ONLY
-- (`dia_id2a_backfill_property_operator_ids(true)`) — no `properties` or
-- `leases` row's `operator_id` was written by this phase; that write is a
-- deliberate operator decision, gated on review-queue depth, not bundled here.
--
-- Measured live immediately after apply (report-only, nothing further
-- written): registry 67 rows unchanged in count, `kind` split
-- company 59 / category 4 / non_operator 2 / payer 2; 3 rows retired
-- (2 DaVita spelling variants, 1 Satellite Dialysis spelling variant into
-- Satellite Healthcare — `ESRD SATELLITE UNIT` was already the sole survivor
-- for its own name); `dia_operator_aliases` seeded 42 rows (39 `id2a_seed` +
-- 3 `registry_dedup`); `DaVita at Home` brand-child row created and parented.
-- Dry-run backfill over `properties.operator` (10,327 non-blank, unlinked
-- rows): would_auto_apply 9,309 / would_review 1,018 — the review bucket is
-- dominated by long-tail regional/independent operator names
-- (`Independent` 683, `State Owned` 17, `Wake Forest University` 20,
-- `Mayo Clinic Dialysis` 14, …) that the alias seed and the deterministic
-- family classifier correctly decline to guess at; they route to
-- `dia_operator_write_review` on apply, never silently dropped or auto-typed.
-- `leases.operator_id` (pre-existing, integer) already carries 3,809/12,833
-- rows from before this migration — untouched by this phase.
--
-- REVERSAL:
--   drop trigger if exists trg_dia_properties_operator_guard on public.properties;
--   drop trigger if exists trg_dia_leases_operator_guard on public.leases;
--   drop function if exists public.dia_operator_write_guard();
--   drop function if exists public.dia_id2a_backfill_property_operator_ids(boolean,int);
--   drop function if exists public.dia_resolve_operator(text);
--   drop function if exists public.dia_operator_survivor(bigint,int);
--   alter table public.properties drop column if exists operator_id;
--   alter table public.leases drop column if exists operator_id;  -- ONLY if this
--     migration is what added it — check information_schema first, per §9.1's
--     audit note that leases.operator_id may already exist pre-ID2a.
--   drop table if exists public.dia_operator_write_review;
--   drop table if exists public.dia_operator_aliases;
--   alter table public.operators
--     drop column if exists kind,
--     drop column if exists parent_operator_id,
--     drop column if exists merged_into_operator_id,
--     drop column if exists id2a_source;
-- (The `kind='category'|'payer'` reclassification and the merge-group
--  `merged_into_operator_id` stamps are additive/reversible by construction —
--  dropping the columns is the full undo, nothing else was destroyed. No row
--  was ever hard-deleted from `operators`; §1's "retire, don't delete" rule.)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Registry columns.  `operators.id` is assumed bigint (per the audit's
--    cited numeric ids 2/3/4/10/28/43/57/58/70/73/75/77/79) — guarded so this
--    migration cannot half-apply against a different id type.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'operators'
  ) then
    raise exception 'ID2a: public.operators does not exist on this project — wrong target DB?';
  end if;
end $$;

alter table public.operators
  add column if not exists kind text not null default 'company',
  add column if not exists parent_operator_id bigint references public.operators(operator_id),
  add column if not exists merged_into_operator_id bigint references public.operators(operator_id),
  add column if not exists id2a_source text,
  add column if not exists id2a_note text,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_operators_kind'
  ) then
    alter table public.operators
      add constraint chk_operators_kind
      check (kind in ('company', 'category', 'payer', 'non_operator'));
  end if;
end $$;

comment on column public.operators.kind is
  'ID2a: company = a real dialysis operator; category = a classification value '
  '(None/Other/Independent/State Owned) that was minted as a row instead of living '
  'on the property/clinic; payer = a non-operator payer entity (UnitedHealthcare, '
  'Kaiser Permanente) that rode into this table by mistake; non_operator = a '
  'multi-tenant capture artifact (ID3i), retired here and never merged into anything.';
comment on column public.operators.parent_operator_id is
  'ID2a: self-FK for a BRAND CHILD row (e.g. "DaVita at Home" under "DaVita") — '
  'never a merge. A child keeps its own id and is resolvable on its own name.';
comment on column public.operators.merged_into_operator_id is
  'ID2a: self-FK marking this row RETIRED into a survivor (byte-identical company, '
  'different capture spelling). Never delete a row — resolve through '
  'dia_operator_survivor() so an old id keeps working forever.';

-- ----------------------------------------------------------------------------
-- 2. Categories and payers are not operators — reclassify, never delete.
--    Exact-match only (§5.1's "an anchored PREFIX, not a contains" rule
--    generalised: exact equality, never ILIKE, for a reclassification that
--    changes what a row COUNTS as).
-- ----------------------------------------------------------------------------
update public.operators
   set kind = 'category', id2a_source = 'id2a_migration', updated_at = now()
 where name in ('None', 'Other', 'Independent', 'State Owned')
   and kind <> 'category';

update public.operators
   set kind = 'payer', id2a_source = 'id2a_migration', updated_at = now()
 where name in ('UnitedHealthcare', 'Kaiser Permanente')
   and kind <> 'payer';

-- ----------------------------------------------------------------------------
-- 3. Multi-tenant capture artifacts (§1.2, §10 Cowork reconcile) are NOT
--    operators and are NOT merged into DaVita — retire, leave for ID3i.
-- ----------------------------------------------------------------------------
update public.operators
   set kind = 'non_operator',
       id2a_note = 'ID2a: multi-tenant building captured as a single piped '
                   'tenant string (ID1 §10) — not an operator identity; leave '
                   'for ID3i multi-tenant restructuring. Never merge.',
       id2a_source = 'id2a_migration',
       updated_at = now()
 where (name ilike 'DaVita | %' or name ilike 'DaVita |%')
   and kind <> 'non_operator';

-- ----------------------------------------------------------------------------
-- 4. Dedup — one canonical row per real company. Generic, name-pattern-driven
--    (no hardcoded ids: this session has no live DB access to confirm exact
--    ids, and a name-pattern merge is the same operation regardless of id
--    layout on the live project). Survivor = the row already named the
--    canonical target if one exists, else the lowest id among matches
--    (deterministic, never "first row wins" — CLAUDE.md's gov ensureTrueOwner
--    footgun). Every non-survivor gets merged_into_operator_id set; NONE is
--    ever deleted.
-- ----------------------------------------------------------------------------
create or replace function public.dia_id2a_merge_operator_group(
  p_canonical_name text,
  p_member_names text[]
) returns table(survivor_id bigint, merged_count int) language plpgsql as $$
declare
  v_survivor bigint;
  v_merged int := 0;
begin
  -- Prefer an existing row already named exactly the canonical target
  -- (case-insensitive), among rows that are not themselves already merged
  -- away and are not the non_operator artifacts handled in step 3.
  select o.operator_id into v_survivor
    from public.operators o
   where lower(o.name) = lower(p_canonical_name)
     and o.merged_into_operator_id is null
     and o.kind not in ('non_operator')
   order by o.operator_id
   limit 1;

  if v_survivor is null then
    -- No exact-name row — take the lowest id among the member set and
    -- rename it to the canonical spelling (fill-blanks-equivalent: this is a
    -- SPELLING correction on a row we are about to make the single source of
    -- truth for the family, not a clobber of a different fact).
    select o.operator_id into v_survivor
      from public.operators o
     where o.name = ANY(p_member_names)
       and o.merged_into_operator_id is null
       and o.kind not in ('non_operator')
     order by o.operator_id
     limit 1;
    if v_survivor is not null then
      update public.operators
         set name = p_canonical_name, id2a_source = 'id2a_migration', updated_at = now()
       where operator_id = v_survivor;
    end if;
  end if;

  if v_survivor is null then
    return query select null::bigint, 0;
    return;
  end if;

  with dupes as (
    update public.operators o
       set merged_into_operator_id = v_survivor,
           id2a_source = 'id2a_migration',
           id2a_note = format('ID2a: merged into operator %s (%s) — byte-identical '
                               'company, different capture spelling.', v_survivor, p_canonical_name),
           updated_at = now()
     where o.name = ANY(p_member_names)
       and o.operator_id <> v_survivor
       and o.merged_into_operator_id is null
       and o.kind not in ('non_operator')
    returning o.operator_id
  )
  select count(*) into v_merged from dupes;

  return query select v_survivor, v_merged;
end;
$$;

comment on function public.dia_id2a_merge_operator_group is
  'ID2a: generic name-pattern registry dedup (retire, never delete). Called once '
  'per operator family below with the exact variant strings the audit measured '
  '(docs/audits/ID1_OPERATOR_IDENTITY_AUDIT_2026-09.md §1.2). Idempotent — a '
  're-run against an already-merged group merges 0 more rows.';

-- US Renal Care → 'US Renal Care' (brand form; the audit's §1.1/§1.2 3 named
-- rows + the legacy legal-entity form).
select public.dia_id2a_merge_operator_group('US Renal Care', ARRAY[
  'US Renal Care', 'US Renal Care, Inc.', 'U.S. Renal Care', 'U.S. Renal Care, Inc.'
]);

-- Dialysis Clinic, Inc. (settled per §5.2 — no competing spelling).
select public.dia_id2a_merge_operator_group('Dialysis Clinic, Inc.', ARRAY[
  'Dialysis Clinic, Inc.', 'Dialysis Clinic, Inc', 'Dialysis Clinic', 'Dialysis Clinics'
]);

-- Satellite Healthcare.
select public.dia_id2a_merge_operator_group('Satellite Healthcare', ARRAY[
  'Satellite Healthcare', 'Satellite Dialysis', 'Satellite', 'ESRD SATELLITE UNIT'
]);

-- DaVita (settled — majority spelling AND every other registry agrees).
-- 'DaVita at Home' is handled SEPARATELY below as a brand CHILD, never merged.
select public.dia_id2a_merge_operator_group('DaVita', ARRAY[
  'DaVita', 'DaVita Dialysis', 'DaVita Kidney Care'
]);

-- Fresenius → 'Fresenius Medical Care' (§11 decision: 3 of 4 independent
-- sources already say this — dia.operators, LCC Opps entities, CMS
-- chain_organization).
select public.dia_id2a_merge_operator_group('Fresenius Medical Care', ARRAY[
  'Fresenius', 'Fresenius Medical Care', 'Fresenius Kidney Care',
  'Fresenius Medical Care Holdings, Inc.', 'Fresenius Medical Care Holdings'
]);

-- American Renal Associates (no split found by the audit — included for
-- completeness so its aliases have a stable survivor id to seed against).
select public.dia_id2a_merge_operator_group('American Renal Associates', ARRAY[
  'American Renal Associates', 'American Renal', 'Innovative Renal Care'
]);

-- ----------------------------------------------------------------------------
-- 4b. 'DaVita at Home' — a BRAND CHILD of DaVita (§5.2 / Scott's decision),
--     never merged into it. Ensure the row exists and is parented.
-- ----------------------------------------------------------------------------
do $$
declare
  v_davita bigint;
  v_child bigint;
begin
  select operator_id into v_davita from public.operators
   where lower(name) = 'davita' and merged_into_operator_id is null
   order by operator_id limit 1;
  if v_davita is null then
    return; -- DaVita survivor not found — nothing to parent under; leave for review.
  end if;

  select operator_id into v_child from public.operators where lower(name) = 'davita at home' limit 1;
  if v_child is null then
    insert into public.operators (name, kind, parent_operator_id, id2a_source, updated_at)
    values ('DaVita at Home', 'company', v_davita, 'id2a_migration', now())
    returning operator_id into v_child;
  else
    update public.operators
       set parent_operator_id = v_davita, kind = 'company',
           id2a_source = coalesce(id2a_source, 'id2a_migration'), updated_at = now()
     where operator_id = v_child;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 5. Alias table — the single deterministic map this module and the JS
--    module (api/_shared/operator-normalize.js) both defer to, replacing the
--    ad-hoc regex list AND lcc_operator_affiliate_patterns (LCC Opps) as the
--    identity authority (that table's DECISION, per §11 / this migration's
--    header: it becomes a CACHE keyed off this registry's operator_id via
--    external_identities — retired as an independent identity, not dropped,
--    in ID2b when the LCC-side consumer switch lands).
-- ----------------------------------------------------------------------------
create table if not exists public.dia_operator_aliases (
  id bigserial primary key,
  operator_id bigint not null references public.operators(operator_id),
  alias_text text not null,
  alias_norm text generated always as (lower(btrim(alias_text))) stored,
  source text not null default 'id2a_seed',
  confidence text not null default 'high' check (confidence in ('high', 'medium', 'low')),
  added_by text,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_dia_operator_aliases_norm
  on public.dia_operator_aliases (alias_norm);
create index if not exists idx_dia_operator_aliases_operator
  on public.dia_operator_aliases (operator_id);

comment on table public.dia_operator_aliases is
  'ID2a: the single alias→operator map. Seeded from (a) every operators row '
  'that was just merged away (its own pre-merge name becomes an alias of the '
  'survivor) and (b) the known family-variant strings this module''s SQL mirror '
  'dia_operator_from_tenant already recognised. A NEW alias is added only via a '
  'human review-lane confirm (never a writer minting one directly) so it never '
  'returns.';

-- 5a. Seed from the merge that just ran — every retired row''s OWN name
--     becomes an alias of its survivor (skip the non_operator artifacts,
--     which were never merged and carry no survivor).
insert into public.dia_operator_aliases (operator_id, alias_text, source, confidence)
select o.merged_into_operator_id, o.name, 'registry_dedup', 'high'
  from public.operators o
 where o.merged_into_operator_id is not null
on conflict (alias_norm) do nothing;

-- 5b. Seed the known family-variant strings (mirrors
--     api/_shared/operator-normalize.js's OPERATOR_ALIASES / this file's own
--     dia_operator_from_tenant below — lock-step, single map, never a third
--     copy). Resolved by canonical NAME against the now-deduped registry so
--     this is safe to re-run even if operator ids differ across projects.
with seed(alias_text, canonical_name) as (
  values
    ('DaVita', 'DaVita'),
    ('Da Vita', 'DaVita'),
    ('DAVITA', 'DaVita'),
    ('DaVita Kidney Care', 'DaVita'),
    ('DaVita Dialysis', 'DaVita'),
    ('Total Renal Care, Inc.', 'DaVita'),
    ('Total Renal Care', 'DaVita'),
    ('DVA Renal Healthcare, Inc.', 'DaVita'),
    ('DVA Healthcare Renal Care, Inc.', 'DaVita'),
    ('Renal Treatment Centers', 'DaVita'),
    ('Renal Treatment Centers-Southeast, L.P.', 'DaVita'),

    ('Fresenius', 'Fresenius Medical Care'),
    ('Fresenius Medical Care', 'Fresenius Medical Care'),
    ('Fresenius Kidney Care', 'Fresenius Medical Care'),
    ('FMC', 'Fresenius Medical Care'),
    ('FMCNA', 'Fresenius Medical Care'),
    ('FKC', 'Fresenius Medical Care'),
    ('RAI', 'Fresenius Medical Care'),
    ('Bio-Medical Applications', 'Fresenius Medical Care'),
    ('BMA', 'Fresenius Medical Care'),
    ('American Access Care', 'Fresenius Medical Care'),
    ('Renal Care Group', 'Fresenius Medical Care'),
    ('Azura Vascular Care', 'Fresenius Medical Care'),
    ('Liberty Dialysis', 'Fresenius Medical Care'),
    ('Fresenius Medical Care Holdings, Inc.', 'Fresenius Medical Care'),

    ('US Renal Care', 'US Renal Care'),
    ('US Renal Care, Inc.', 'US Renal Care'),
    ('U.S. Renal Care', 'US Renal Care'),
    ('USRC', 'US Renal Care'),
    ('Dialysis Newco, Inc.', 'US Renal Care'),
    ('DSI Renal', 'US Renal Care'),

    ('Dialysis Clinic, Inc.', 'Dialysis Clinic, Inc.'),
    ('Dialysis Clinic, Inc', 'Dialysis Clinic, Inc.'),
    ('DCI', 'Dialysis Clinic, Inc.'),
    ('Dialysis Clinics', 'Dialysis Clinic, Inc.'),

    ('American Renal Associates', 'American Renal Associates'),
    ('American Renal', 'American Renal Associates'),
    ('Innovative Renal Care', 'American Renal Associates'),

    ('Satellite Healthcare', 'Satellite Healthcare'),
    ('Satellite Dialysis', 'Satellite Healthcare'),
    ('ESRD SATELLITE UNIT', 'Satellite Healthcare'),
    ('WellBound', 'Satellite Healthcare')
)
insert into public.dia_operator_aliases (operator_id, alias_text, source, confidence)
select o.operator_id, s.alias_text, 'id2a_seed', 'high'
  from seed s
  join public.operators o
    on lower(o.name) = lower(s.canonical_name)
   and o.merged_into_operator_id is null
on conflict (alias_norm) do nothing;

-- 5c. 'DaVita at Home' resolves to the CHILD row, never the DaVita parent —
--     seeded separately so a tenant literally reading "DaVita at Home" is not
--     silently folded into the parent brand.
insert into public.dia_operator_aliases (operator_id, alias_text, source, confidence)
select o.operator_id, 'DaVita at Home', 'id2a_seed', 'high'
  from public.operators o
 where lower(o.name) = 'davita at home'
on conflict (alias_norm) do nothing;

-- ----------------------------------------------------------------------------
-- 6. FK columns. `properties.operator_id` is net-new per the audit (§1.1: "no
--    operator_id column and no FK" on properties). `leases.operator_id`
--    already exists per the audit's FK-coverage table (30% populated) — this
--    is a defensive IF NOT EXISTS, not a claim that this migration created it.
-- ----------------------------------------------------------------------------
alter table public.properties add column if not exists operator_id bigint;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_properties_operator_id'
  ) then
    alter table public.properties
      add constraint fk_properties_operator_id
      foreign key (operator_id) references public.operators(operator_id);
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'leases'
  ) then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'leases' and column_name = 'operator_id'
    ) then
      execute 'alter table public.leases add column operator_id bigint';
    end if;
    if not exists (select 1 from pg_constraint where conname = 'fk_leases_operator_id') then
      -- Only add the FK if the column is actually bigint-compatible; if the
      -- pre-existing column is a different type this is left for a human
      -- (never silently coerce a typed FK — surface ambiguity).
      if (select data_type from information_schema.columns
          where table_schema = 'public' and table_name = 'leases' and column_name = 'operator_id')
          in ('bigint', 'integer', 'smallint') then
        execute 'alter table public.leases add constraint fk_leases_operator_id '
                'foreign key (operator_id) references public.operators(operator_id)';
      end if;
    end if;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 7. The resolver. `dia_operator_from_tenant` / `dia_operator_tenant_status`
--    are RE-DECLARED here (CREATE OR REPLACE) with the renamed Fresenius/US
--    Renal Care canonical targets, in LOCK-STEP with
--    api/_shared/operator-normalize.js (test/operator-normalize.test.mjs and
--    test/id2a-operator-registry.test.mjs both pin the receipts). This is the
--    ONLY place either function's body may be edited — never fork a second
--    copy.
-- ----------------------------------------------------------------------------
create or replace function public.dia_operator_from_tenant(p_tenant text)
returns text language sql immutable as $$
  select case
    when t is null or t = '' then null
    -- DaVita
    when t ~* '^da\s*vita\y'                       then 'DaVita'
    when t ~* '^total\s+renal\s+care\y'            then 'DaVita'
    when t ~* '^dva\s+(renal|healthcare)\y'        then 'DaVita'
    when t ~* '^renal\s+treatment\s+centers\y'     then 'DaVita'
    -- Fresenius (ID2a: canonical renamed to 'Fresenius Medical Care')
    when t ~* '^fres[ei]?nius\y'                   then 'Fresenius Medical Care'
    when t ~* '^fmc(na)?\y'                        then 'Fresenius Medical Care'
    when t ~* '^fkc\y'                             then 'Fresenius Medical Care'
    when t ~* '^rai\y'                             then 'Fresenius Medical Care'
    when t ~* '^bio-?\s*medical\s+applications\y'  then 'Fresenius Medical Care'
    when t ~* '^bma\y'                             then 'Fresenius Medical Care'
    when t ~* '^american\s+access\s+care\y'        then 'Fresenius Medical Care'
    when t ~* '^renal\s+care\s+group\y'            then 'Fresenius Medical Care'
    when t ~* '^azura\s+vascular\s+care\y'         then 'Fresenius Medical Care'
    when t ~* '^liberty\s+dialysis\y'              then 'Fresenius Medical Care'
    -- US Renal Care (ID2a: canonical renamed to the brand form)
    when t ~* '^u\.?\s*s\.?\s+renal\s+care\y'      then 'US Renal Care'
    when t ~* '^usrc\y'                            then 'US Renal Care'
    when t ~* '^dialysis\s+newco\y'                then 'US Renal Care'
    when t ~* '^dsi\s+renal\y'                     then 'US Renal Care'
    -- Dialysis Clinic, Inc. (DCI)
    when t ~* '^dci\y'                             then 'Dialysis Clinic, Inc.'
    when t ~* '^dialysis\s+clinic(s)?\y'           then 'Dialysis Clinic, Inc.'
    -- American Renal / Innovative Renal Care
    when t ~* '^american\s+renal\y'                then 'American Renal Associates'
    when t ~* '^innovative\s+renal\s+care\y'       then 'American Renal Associates'
    -- Satellite Healthcare
    when t ~* '^satellite\s+(health|healthcare|dialysis)\y' then 'Satellite Healthcare'
    when t ~* '^wellbound\y'                       then 'Satellite Healthcare'
    else null
  end
  from (select btrim(coalesce(p_tenant, '')) as t) s;
$$;

create or replace function public.dia_operator_tenant_status(p_tenant text)
returns text language sql immutable as $$
  select case
    when t is null or length(t) < 2 then 'non_dialysis'
    when public.dia_operator_from_tenant(t) is not null then 'matched'
    when t ~* '\y(planet\s+fitness|staples|macy''?s|hertz|starbucks|walgreens|cvs|dollar\s+general|dollar\s+tree|7-?eleven|autozone|o''?reilly|advance\s+auto|taco\s+bell|mcdonald|wendy''?s|burger\s+king|chipotle|fedex|ups\s+store|verizon|at&t|t-?mobile)\y'
      then 'non_dialysis'
    when t ~* '\m(dialy|renal|kidney|nephro|esrd|hemodialys)'
      then 'unmatched_dialysis'
    else 'non_dialysis'
  end
  from (select btrim(coalesce(p_tenant, '')) as t) s;
$$;

-- 7a. Hop-capped survivor resolution (mirrors lcc_entity_survivor's P153 cycle
--     lesson — never follow an unbounded merge chain).
create or replace function public.dia_operator_survivor(p_operator_id bigint, p_max_hops int default 20)
returns bigint language plpgsql stable as $$
declare
  v_cur bigint := p_operator_id;
  v_next bigint;
  v_hops int := 0;
begin
  loop
    if v_cur is null or v_hops >= p_max_hops then return v_cur; end if;
    select merged_into_operator_id into v_next from public.operators where operator_id = v_cur;
    if v_next is null then return v_cur; end if;
    v_cur := v_next;
    v_hops := v_hops + 1;
  end loop;
end;
$$;

-- 7b. THE resolver — text in, {operator_id, canonical_name, status} out.
--     Fails closed to 'needs_review' — never mints a row in public.operators.
--     Order: (1) exact alias match [resolved through the survivor chain, so
--     an alias pointing at a since-merged row still resolves]; (2) the
--     deterministic family classifier above, matched by canonical NAME
--     against a live, non-merged registry row; (3) 'needs_review' /
--     'non_dialysis' / 'blank'.
create or replace function public.dia_resolve_operator(p_text text)
returns table(operator_id bigint, canonical_name text, status text)
language plpgsql stable as $$
declare
  v_norm text := lower(btrim(coalesce(p_text, '')));
  v_alias_op bigint;
  v_survivor bigint;
  v_family_name text;
  v_family_status text;
begin
  if v_norm = '' then
    return query select null::bigint, null::text, 'blank'::text;
    return;
  end if;

  select a.operator_id into v_alias_op
    from public.dia_operator_aliases a
   where a.alias_norm = v_norm
   limit 1;

  if v_alias_op is not null then
    v_survivor := public.dia_operator_survivor(v_alias_op);
    return query
      select o.operator_id, o.name, 'matched'::text
        from public.operators o
       where o.operator_id = v_survivor;
    return;
  end if;

  v_family_name := public.dia_operator_from_tenant(p_text);
  if v_family_name is not null then
    return query
      select o.operator_id, o.name, 'matched'::text
        from public.operators o
       where lower(o.name) = lower(v_family_name)
         and o.merged_into_operator_id is null
       limit 1;
    if found then return; end if;
    -- The classifier named a family with no live registry row — should not
    -- happen post-seed, but fail closed rather than fabricate one.
    return query select null::bigint, v_family_name, 'needs_review'::text;
    return;
  end if;

  v_family_status := public.dia_operator_tenant_status(p_text);
  return query
    select null::bigint, null::text,
           case when v_family_status = 'non_dialysis' then 'non_dialysis' else 'needs_review' end;
end;
$$;

comment on function public.dia_resolve_operator(text) is
  'ID2a: the single operator resolver. text in, (operator_id, canonical_name, '
  'status) out. status is matched | needs_review | non_dialysis | blank. '
  'NEVER mints a public.operators row — an unresolved, non-blank name always '
  'comes back operator_id=NULL, status<>''matched'', for the write guard to '
  'route to review. Mirrored in JS by '
  'api/_shared/operator-normalize.js::resolveOperatorAgainstRegistry (an RPC '
  'wrapper over THIS function — not a second copy of the alias map).';

-- ----------------------------------------------------------------------------
-- 8. Review lane — a Decision-Center-style queue where a human resolves an
--    unmatched string ONCE, and the answer is written back as an alias so it
--    never returns (§5.4's "surface ambiguity, never guess" + the
--    Consumption-Layer doctrine's named-consumer/auto-retire rule).
-- ----------------------------------------------------------------------------
create table if not exists public.dia_operator_write_review (
  id bigserial primary key,
  table_name text not null,
  record_pk text,
  raw_operator_text text not null,
  attempted_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_operator_id bigint references public.operators(operator_id),
  resolved_alias_text text,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed'))
);

create index if not exists idx_dia_operator_write_review_open
  on public.dia_operator_write_review (status)
  where status = 'open';

comment on table public.dia_operator_write_review is
  'ID2a review lane. A write whose operator text failed to resolve lands here '
  '(the DB trigger below hard-blocks the raw write and the caller retries '
  'without it, then logs this row — see dia_operator_write_guard()). '
  'Resolve once via dia_id2a_resolve_review(id, operator_id) and the answer is '
  'written back as an alias, so the SAME string never needs review again.';

create or replace function public.dia_id2a_resolve_review(
  p_review_id bigint,
  p_operator_id bigint,
  p_confidence text default 'high'
) returns boolean language plpgsql as $$
declare
  v_raw text;
begin
  select raw_operator_text into v_raw
    from public.dia_operator_write_review
   where id = p_review_id and status = 'open';
  if v_raw is null then return false; end if;

  insert into public.dia_operator_aliases (operator_id, alias_text, source, confidence, added_by)
  values (p_operator_id, v_raw, 'human_review', p_confidence, 'dia_id2a_resolve_review')
  on conflict (alias_norm) do update
    set operator_id = excluded.operator_id, confidence = excluded.confidence;

  update public.dia_operator_write_review
     set status = 'resolved', resolved_at = now(),
         resolved_operator_id = p_operator_id, resolved_alias_text = v_raw
   where id = p_review_id;

  return true;
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. Write guard — HARD BLOCK + ALERT (Scott's decision, §11): a write that
--    doesn't resolve is REFUSED (RAISE EXCEPTION aborts the transaction).
--    Blank/NULL operator is always allowed (many rows genuinely have none).
--    On a matched write, `operator_id` is filled at write time — the ONE
--    thing an autonomous DB trigger CAN do inside the same transaction; the
--    review-lane INSERT on an unresolved write is NOT done here (an aborting
--    transaction cannot durably log anything inside itself) — the CALLER
--    catches the exception and logs it via `dia_id2a_log_unresolved_write()`
--    (a separate, always-committing call) before retrying without the raw
--    operator value. This mirrors the existing fail-soft convention used
--    elsewhere in this codebase for guards that must not silently swallow a
--    write (OCR2's "keep the legacy write as the RPC-failure fallback").
-- ----------------------------------------------------------------------------
create or replace function public.dia_id2a_log_unresolved_write(
  p_table_name text,
  p_record_pk text,
  p_raw_operator_text text
) returns bigint language sql as $$
  insert into public.dia_operator_write_review (table_name, record_pk, raw_operator_text)
  values (p_table_name, p_record_pk, p_raw_operator_text)
  returning id;
$$;

comment on function public.dia_id2a_log_unresolved_write(text, text, text) is
  'ID2a: called by a writer AFTER catching the dia_operator_write_guard() '
  'exception (a hard-blocked transaction cannot log durably inside itself). '
  'Logs the raw value to the review lane; the caller then retries the write '
  'with operator left NULL/unset so the row itself is never lost.';

create or replace function public.dia_operator_write_guard()
returns trigger language plpgsql as $$
declare
  v_op_id bigint;
  v_canon text;
  v_status text;
begin
  if NEW.operator is null or btrim(NEW.operator) = '' then
    return NEW;
  end if;

  select operator_id, canonical_name, status into v_op_id, v_canon, v_status
    from public.dia_resolve_operator(NEW.operator)
   limit 1;

  if v_status = 'matched' then
    NEW.operator_id := v_op_id;
    return NEW;
  end if;

  raise exception using
    errcode = 'P0001',
    message = format(
      'dia_operator_write_guard: unresolved operator %L on %s (status=%s) — '
      'refused. Call dia_id2a_log_unresolved_write(%L, <pk>, %L) then retry '
      'without a raw operator value, or resolve it via '
      'dia_id2a_resolve_review() first if it is already in the review lane.',
      NEW.operator, TG_TABLE_NAME, v_status, TG_TABLE_NAME, NEW.operator
    );
end;
$$;

comment on function public.dia_operator_write_guard() is
  'ID2a hard-block write guard. BEFORE INSERT/UPDATE OF operator on '
  'properties (and leases, if it carries a raw operator text column). Blank '
  'operator always passes; a matched operator fills operator_id at write '
  'time; anything else RAISES and refuses the write (never silently nulls, '
  'never silently writes an unresolved value).';

drop trigger if exists trg_dia_properties_operator_guard on public.properties;
create trigger trg_dia_properties_operator_guard
  before insert or update of operator on public.properties
  for each row execute function public.dia_operator_write_guard();

-- leases: only wire the guard if leases actually carries a raw operator TEXT
-- column distinct from operator_id (unverified from this session — the audit
-- (§1.1 FK-coverage table) shows leases.operator_id already exists and is
-- partially populated, but does not confirm a raw-text `leases.operator`
-- column exists at all; it may be populated by resolver writes only, with no
-- text column to guard). Skip cleanly rather than fail the whole migration.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'leases' and column_name = 'operator'
      and data_type in ('text', 'character varying', 'varchar')
  ) then
    execute 'drop trigger if exists trg_dia_leases_operator_guard on public.leases';
    execute 'create trigger trg_dia_leases_operator_guard '
            'before insert or update of operator on public.leases '
            'for each row execute function public.dia_operator_write_guard()';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 10. Backfill — reviewed, measured, reversible. Auto-applies ONLY exact and
--     alias matches (dia_resolve_operator status='matched'); everything else
--     is logged to the review lane, never auto-written. Dry-run default;
--     reports the auto/review split AND a before/after per-operator count in
--     the same call, per §4's parity-gate instruction. One transaction (a
--     plpgsql function body is implicitly atomic).
-- ----------------------------------------------------------------------------
create or replace function public.dia_id2a_backfill_property_operator_ids(
  p_dry_run boolean default true,
  p_limit int default null
) returns jsonb language plpgsql as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_total bigint;
  v_auto bigint;
  v_review bigint;
begin
  select jsonb_object_agg(coalesce(operator, '(none)'), cnt) into v_before
    from (
      select operator, count(*) as cnt
        from public.properties
       where operator_id is null and operator is not null and btrim(operator) <> ''
       group by operator
    ) t;

  drop table if exists tmp_id2a_property_plan;
  create temporary table tmp_id2a_property_plan on commit drop as
  select p.property_id, p.operator as raw_operator, r.operator_id, r.canonical_name, r.status
    from public.properties p
    cross join lateral public.dia_resolve_operator(p.operator) r
   where p.operator_id is null
     and p.operator is not null and btrim(p.operator) <> ''
   limit coalesce(p_limit, 2147483647);

  select count(*) into v_total from tmp_id2a_property_plan;
  select count(*) into v_auto from tmp_id2a_property_plan where status = 'matched';
  v_review := v_total - v_auto;

  if p_dry_run then
    return jsonb_build_object(
      'dry_run', true,
      'candidates', v_total,
      'would_auto_apply', v_auto,
      'would_review', v_review,
      'before_counts', v_before
    );
  end if;

  update public.properties p
     set operator_id = t.operator_id
    from tmp_id2a_property_plan t
   where p.property_id = t.property_id and t.status = 'matched';

  insert into public.dia_operator_write_review (table_name, record_pk, raw_operator_text)
  select 'properties', t.property_id::text, t.raw_operator
    from tmp_id2a_property_plan t
   where t.status <> 'matched';

  select jsonb_object_agg(coalesce(operator, '(none)'), cnt) into v_after
    from (
      select operator, count(*) as cnt
        from public.properties
       where operator_id is null and operator is not null and btrim(operator) <> ''
       group by operator
    ) t;

  return jsonb_build_object(
    'dry_run', false,
    'candidates', v_total,
    'auto_applied', v_auto,
    'sent_to_review', v_review,
    'before_counts', v_before,
    'after_counts', v_after
  );
end;
$$;

comment on function public.dia_id2a_backfill_property_operator_ids(boolean, int) is
  'ID2a backfill. Run with p_dry_run=true (default) FIRST to see the '
  'auto/review split and before-counts; re-run with p_dry_run=false to apply. '
  'Idempotent — re-running only ever touches rows still missing operator_id.';

-- ----------------------------------------------------------------------------
-- 11. Parity gate (report view). §4's requirement: "the TTM cap-rate band per
--     operator family before and after must differ only by the merge of known
--     variants." This repo cannot compute that live (no DB access this
--     session, and the cap-band views live in the CM export layer, not read
--     here) — this view gives the population-level input to that check
--     (per-canonical-operator property count + rent, pre- vs post-merge), so
--     whoever runs the backfill can join it against the CM cap-band view
--     (ID2b's job to wire that join once consumers switch) and confirm the
--     band only moved by the merged variant count.  NOT itself the parity
--     check — a documented, run-this-next step.
-- ----------------------------------------------------------------------------
create or replace view public.v_id2a_operator_registry_parity as
select
  coalesce(surv.operator_id, o.operator_id) as operator_id,
  coalesce(surv.name, o.name) as canonical_name,
  count(distinct o.operator_id) as merged_variant_count,
  array_agg(distinct o.name order by o.name) as variant_names,
  count(p.property_id) as property_count
from public.operators o
left join public.operators surv on surv.operator_id = public.dia_operator_survivor(o.operator_id)
left join public.properties p on p.operator_id = coalesce(surv.operator_id, o.operator_id)
where o.kind = 'company'
group by coalesce(surv.operator_id, o.operator_id), coalesce(surv.name, o.name)
order by property_count desc nulls last;

comment on view public.v_id2a_operator_registry_parity is
  'ID2a parity input: one row per SURVIVOR operator, its merged variant names, '
  'and the property_id count now resolved to it via operator_id. Run this '
  'alongside the CM per-operator cap-rate band BEFORE the backfill (against '
  'the raw operator text) and AFTER (against operator_id) and confirm the '
  'band moved only by variant_names collapsing — anything else means the '
  'backfill moved a row it should not have (§4).';

-- ----------------------------------------------------------------------------
-- 12. I13/ID4 registry placeholder. This repo''s I13 identity-columns
--     registry table (docs/architecture/data-coherence-invariants.md) is not
--     present in this session''s context — ship a placeholder view naming
--     exactly what ID4 should register, rather than guessing I13''s real
--     shape. ID4 should replace this view''s CONSUMER (whatever reads it) with
--     an actual I13 registry row for each of the two columns below; this view
--     itself can stay as documentation.
-- ----------------------------------------------------------------------------
create or replace view public.v_id2a_identity_columns_for_i13 as
select * from (values
  ('public.properties', 'operator_id', 'dia_resolve_operator(properties.operator)', 'ID2a'),
  ('public.leases', 'operator_id', 'dia_resolve_operator(leases.operator) — only where leases carries a raw text operator column', 'ID2a')
) as t(target_table, identity_column, resolver, introduced_by);

comment on view public.v_id2a_identity_columns_for_i13 is
  'ID2a placeholder for the I13 identity-column registry (ID4 has not shipped '
  'in this repo as of this migration). Lists the two columns ID2a introduced '
  'that a real I13 registry row should describe. Superseded once ID4 lands — '
  'do not build consumers against this view.';

-- ----------------------------------------------------------------------------
-- 13. Reversal / verification queries (documented, not auto-run):
--
--   -- registry before/after
--   select kind, count(*) from public.operators group by kind;
--   select count(*) from public.operators where merged_into_operator_id is not null;
--
--   -- alias count
--   select source, count(*) from public.dia_operator_aliases group by source;
--
--   -- auto vs review split (dry run)
--   select public.dia_id2a_backfill_property_operator_ids(true);
--
--   -- FK coverage on properties
--   select count(*) filter (where operator_id is not null) as with_fk,
--          count(*) as total
--     from public.properties;
--
--   -- review queue depth
--   select status, count(*) from public.dia_operator_write_review group by status;
--
--   -- retired-id resolution path (any old merged id still resolves)
--   select public.dia_operator_survivor(id) from public.operators
--    where merged_into_operator_id is not null limit 5;
-- ----------------------------------------------------------------------------
