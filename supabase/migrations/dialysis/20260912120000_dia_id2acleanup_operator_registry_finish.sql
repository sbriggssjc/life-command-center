-- ============================================================================
-- ID2a-cleanup — finish the operator registry: merge duplicates, parent
-- subsidiaries, seed aliases from the registry itself, route classifications
-- out of the human review queue, and guard the gap that let junk rows survive
-- inside kind='company'.
--
-- Follow-on to supabase/migrations/dialysis/20260911200000_dia_id2a_operator_registry.sql
-- (+ 200100 type-cast fix, + 200200 multitenant/parity fix). Full design:
-- docs/audits/ID1_OPERATOR_IDENTITY_AUDIT_2026-09.md §5/§11,
-- docs/audits/ID4_IDENTITY_INTEGRITY_BASELINE_2026-09.md,
-- docs/os/PLANNED-BACKLOG.md §P0d rows ID2a / ID2a-cleanup / ID2b / ID3i.
--
-- Applies to Dialysis_DB (zqzrriwuavgrquhisnoa). Same discipline as ID2a:
-- fill-blanks only, conservative/unambiguous matching, provenance-tagged,
-- reversible (retire/reclassify, never delete), idempotent, dry-run-able.
--
-- LIVE-MEASURED immediately before this migration (2026-09-12, via
-- mcp__Supabase__execute_sql against zqzrriwuavgrquhisnoa — not predicted):
--   operators kind split: company 59 / category 4 / non_operator 2 / payer 2
--     (unchanged from ID2a's own report — confirms nothing has drifted).
--   dia_operator_aliases: 42 rows (39 id2a_seed + 3 registry_dedup).
--   dia_operator_write_review: 1,020 open / 0 resolved / 0 dismissed.
--   properties: 11,804 total, 9,307 with operator_id, 10,327 with non-blank
--     raw `operator` text (10,327 - 9,307 = 1,020 — matches the review queue
--     exactly; the two numbers are the same population read two ways).
--   Two BYTE-IDENTICAL duplicate rows found that ID2a's exact-string-array
--     merge did not catch, because the stored spelling lacks the punctuation
--     the merge array listed: 'Us Renal Care Inc' (operator_id 2 AND 57 —
--     TWO rows sharing that exact name, itself a pre-existing duplicate) and
--     'Dialysis Clinic Inc' (operator_id 3). All three carry 0 properties.
--
-- REVERSAL:
--   -- undo the review-queue classification closures
--   update public.dia_operator_write_review
--      set status = 'open', resolved_at = null, resolution_note = null
--    where resolution_note like 'id2a-cleanup:%';
--   -- undo the alias seed
--   delete from public.dia_operator_aliases where source in
--     ('registry_seed_own_name', 'registry_seed_dba');
--   -- undo the merges/parenting/reclassification done in step 4/5 below
--   -- (each UPDATE only ever set id2a_source = 'id2a_cleanup_migration' —
--   -- filter on that to find every row this file touched):
--   select operator_id, name, kind, parent_operator_id, merged_into_operator_id
--     from public.operators where id2a_source = 'id2a_cleanup_migration';
--   -- (revert kind/parent_operator_id/merged_into_operator_id by hand per
--   -- row using the values recorded in id2a_note before applying any undo —
--   -- this migration does not auto-snapshot pre-images because every change
--   -- here is additive-metadata-only, never a value clobber of curated data)
--   alter table public.dia_operator_write_review drop column if exists resolution_note;
--   alter table public.properties drop column if exists operator_class;
--   drop view if exists public.v_dia_operator_orphan_registry_gap;
--   drop function if exists public.dia_id2a_seed_registry_aliases(boolean);
--   alter table public.operators drop constraint if exists chk_operators_kind;
--   alter table public.operators add constraint chk_operators_kind
--     check (kind in ('company', 'category', 'payer', 'non_operator'));
--     -- (only safe once every 'junk'-kind row above is reclassified back)
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'operators'
  ) then
    raise exception 'ID2a-cleanup: public.operators does not exist on this project — wrong target DB?';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 0. Widen the kind vocabulary to include 'junk' — a row that was minted by a
--    capture defect (a person's name, a "C/O <hospital>" fragment, a retail
--    brand) and is not, and never was, a dialysis operator. Distinct from
--    'non_operator' (ID2a's multi-tenant piped-string artifacts, ID3i's to
--    restructure) — a junk row has no restructuring target at all.
-- ----------------------------------------------------------------------------
alter table public.operators drop constraint if exists chk_operators_kind;
alter table public.operators
  add constraint chk_operators_kind
  check (kind in ('company', 'category', 'payer', 'non_operator', 'junk'));

comment on column public.operators.kind is
  'ID2a/ID2a-cleanup: company = a real dialysis operator; category = a '
  'classification value (None/Other/Independent/State Owned) that was minted '
  'as a row instead of living on the property; payer = a non-operator payer '
  'entity (UnitedHealthcare, Kaiser Permanente); non_operator = a multi-tenant '
  'capture artifact (ID3i), retired here and never merged into anything; '
  'junk = a capture-defect row (a person''s name, a C/O/D-B-A fragment) with '
  'no operator identity at all — retired here, never merged, never deleted.';

-- ----------------------------------------------------------------------------
-- 1. Dedup the two byte-identical-name duplicates the ID2a merge array missed
--    (stored spelling has no comma/period; the merge array required one).
--    Reuses ID2a's own generic merge function — idempotent, retire-not-delete.
-- ----------------------------------------------------------------------------
select public.dia_id2a_merge_operator_group('US Renal Care', ARRAY[
  'US Renal Care', 'US Renal Care, Inc.', 'U.S. Renal Care', 'U.S. Renal Care, Inc.',
  'Us Renal Care Inc'
]);

select public.dia_id2a_merge_operator_group('Dialysis Clinic, Inc.', ARRAY[
  'Dialysis Clinic, Inc.', 'Dialysis Clinic, Inc', 'Dialysis Clinic', 'Dialysis Clinics',
  'Dialysis Clinic Inc'
]);

-- Every retired row's own (pre-merge) name becomes an alias of its survivor —
-- same seed statement ID2a ran, re-run here so the two newly-merged rows
-- above get the same treatment. Idempotent (unique index on alias_norm).
insert into public.dia_operator_aliases (operator_id, alias_text, source, confidence)
select o.merged_into_operator_id, o.name, 'registry_dedup', 'high'
  from public.operators o
 where o.merged_into_operator_id is not null
on conflict (alias_norm) do nothing;

-- ----------------------------------------------------------------------------
-- 2. Parent, don't merge — legal subsidiaries stay their own credit identity
--    (the guarantor lesson: a subsidiary's legal name is a fact a lease/loan
--    can name directly, distinct from its parent's).
-- ----------------------------------------------------------------------------
do $$
declare
  v_fmc bigint;
  v_dci bigint;
begin
  select operator_id into v_fmc from public.operators
   where lower(name) = 'fresenius medical care' and merged_into_operator_id is null
   order by operator_id limit 1;
  select operator_id into v_dci from public.operators
   where lower(name) = 'dialysis clinic, inc.' and merged_into_operator_id is null
   order by operator_id limit 1;

  if v_fmc is not null then
    update public.operators
       set parent_operator_id = v_fmc,
           id2a_source = 'id2a_cleanup_migration',
           id2a_note = format('ID2a-cleanup: Fresenius Medical Care subsidiary — '
                               'parented under operator %s, never merged (legal '
                               'identity is a distinct credit fact).', v_fmc),
           updated_at = now()
     where name in ('BMA Quincy', 'BMA OF NORTH CHARLOTTE INC', 'KNICKERBOCKER DIALYSIS, INC')
       and merged_into_operator_id is null
       and (parent_operator_id is null or parent_operator_id <> v_fmc);
  end if;

  if v_dci is not null then
    update public.operators
       set parent_operator_id = v_dci,
           id2a_source = 'id2a_cleanup_migration',
           id2a_note = format('ID2a-cleanup: Dialysis Clinic, Inc. subsidiary — '
                               'parented under operator %s, never merged.', v_dci),
           updated_at = now()
     where name = 'DCI East Gainesville'
       and merged_into_operator_id is null
       and (parent_operator_id is null or parent_operator_id <> v_dci);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3. Reclassify person/junk rows — exact-name match only (never a pattern
--    that could catch a real operator), all measured live at 0 properties.
--    Six named explicitly by the audit (Family Video, Robert Young,
--    Cheryl Ann Cunnings, FERNANDO RAUDALES, C/O ST. FRANCIS HOSPITAL,
--    D/B/A PERRY DIALYSIS CENTER) plus three of the SAME shape found reading
--    the full live registry (a bare person name, or a C/O prefix): Jordan
--    Nelson, Nduka Ossai, C/O JOSEPH MARCANTONIO KIDNEY CENTER.
-- ----------------------------------------------------------------------------
update public.operators
   set kind = 'junk',
       id2a_source = 'id2a_cleanup_migration',
       id2a_note = 'ID2a-cleanup: capture-defect row (person name / C-O / D-B-A '
                    'fragment / non-dialysis retail brand), not an operator '
                    'identity. Retired here, never merged, never deleted.',
       updated_at = now()
 where name in (
   'Family Video',
   'Robert Young',
   'Cheryl Ann Cunnings',
   'FERNANDO RAUDALES',
   'C/O ST. FRANCIS HOSPITAL',
   'D/B/A PERRY DIALYSIS CENTER',
   'C/O JOSEPH MARCANTONIO KIDNEY CENTER',
   'Jordan Nelson',
   'Nduka Ossai'
 )
   and kind = 'company';

-- ----------------------------------------------------------------------------
-- 4. Registry alias seed — every remaining live (non-merged, non-junk,
--    non-category, non-payer) company row's OWN name, plus its dba_names,
--    becomes an exact-match alias. This is what actually shrinks the review
--    queue: `dia_resolve_operator` only ever knew the 6 hardcoded families;
--    every OTHER registered operator (Northwest Kidney Centers, Wake Forest
--    University, Atlantis Healthcare Group, Sanford Health, ...) had no
--    alias at all for its own literal name, so a property whose raw
--    `operator` text WAS that exact registered name still failed to resolve
--    and was hard-blocked into the review queue.
--
--    Exact-match only (never fuzzy) — the doctrine this whole file is built
--    on. `dba_names` are individual clinic-level DBA strings (a CMS-derived
--    facility list, not operator-family aliases), so seeding them can only
--    ever help a write whose raw operator text happens to equal one
--    byte-for-byte; it can never mis-resolve a different real company,
--    because the unique index on alias_norm means the FIRST claimant to a
--    given exact string wins and every later on-conflict is a no-op (never
--    an overwrite of an existing mapping).
--
--    Wrapped in a re-runnable function (never a one-shot DO block) so a
--    human adding a new company row by hand can call this again instead of
--    hand-writing an alias INSERT.
-- ----------------------------------------------------------------------------
create or replace function public.dia_id2a_seed_registry_aliases(p_dry_run boolean default true)
returns jsonb language plpgsql as $$
declare
  v_before_review int;
  v_would_seed_own int;
  v_would_seed_dba int;
  v_seeded_own int := 0;
  v_seeded_dba int := 0;
begin
  select count(*) into v_before_review
    from public.dia_operator_write_review where status = 'open';

  select count(*) into v_would_seed_own
    from public.operators o
   where o.kind = 'company'
     and o.merged_into_operator_id is null
     and not exists (
       select 1 from public.dia_operator_aliases a
        where a.alias_norm = lower(btrim(o.name))
     );

  select count(*) into v_would_seed_dba
    from public.operators o
   cross join lateral unnest(coalesce(o.dba_names, array[]::text[])) as d(dba)
   where o.kind = 'company'
     and o.merged_into_operator_id is null
     and btrim(d.dba) <> ''
     and not exists (
       select 1 from public.dia_operator_aliases a
        where a.alias_norm = lower(btrim(d.dba))
     );

  if p_dry_run then
    return jsonb_build_object(
      'dry_run', true,
      'open_review_rows', v_before_review,
      'would_seed_own_name', v_would_seed_own,
      'would_seed_dba_names', v_would_seed_dba
    );
  end if;

  with ins as (
    insert into public.dia_operator_aliases (operator_id, alias_text, source, confidence)
    select o.operator_id, o.name, 'registry_seed_own_name', 'high'
      from public.operators o
     where o.kind = 'company'
       and o.merged_into_operator_id is null
    on conflict (alias_norm) do nothing
    returning 1
  )
  select count(*) into v_seeded_own from ins;

  with ins as (
    insert into public.dia_operator_aliases (operator_id, alias_text, source, confidence)
    select o.operator_id, d.dba, 'registry_seed_dba', 'high'
      from public.operators o
     cross join lateral unnest(coalesce(o.dba_names, array[]::text[])) as d(dba)
     where o.kind = 'company'
       and o.merged_into_operator_id is null
       and btrim(d.dba) <> ''
    on conflict (alias_norm) do nothing
    returning 1
  )
  select count(*) into v_seeded_dba from ins;

  return jsonb_build_object(
    'dry_run', false,
    'open_review_rows_before', v_before_review,
    'seeded_own_name', v_seeded_own,
    'seeded_dba_names', v_seeded_dba
  );
end;
$$;

comment on function public.dia_id2a_seed_registry_aliases(boolean) is
  'ID2a-cleanup: seeds an alias for every live company operator''s own name '
  'plus its dba_names. Idempotent (on-conflict-do-nothing against the unique '
  'alias_norm index) — safe to re-run after adding a new operator row by hand.';

-- Apply the seed now (this migration''s whole point).
select public.dia_id2a_seed_registry_aliases(false);

-- ----------------------------------------------------------------------------
-- 5. Categories/payers/non_operator rows are CLASSIFICATIONS, not operators —
--    they must never occupy a human review-queue slot. `operator_class` is a
--    NEW, additive column on properties (nothing reads it yet — this is not
--    the ID2b consumer switch); the write guard is extended to short-circuit
--    on a category/payer/non_operator name BEFORE the hard-block raise, and
--    the review queue is swept once for rows already logged under one of
--    these names.
-- ----------------------------------------------------------------------------
alter table public.properties add column if not exists operator_class text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_properties_operator_class') then
    alter table public.properties
      add constraint chk_properties_operator_class
      check (operator_class is null or operator_class in ('category', 'payer', 'non_operator'));
  end if;
end $$;

comment on column public.properties.operator_class is
  'ID2a-cleanup: set (never alongside operator_id) when the raw operator text '
  'names a classification value (Independent/Other/State Owned/None), a payer '
  '(UnitedHealthcare/Kaiser Permanente — filed for a dedicated payer column, '
  'not built here, see PLANNED-BACKLOG ID2c), or an ID3i multi-tenant piped '
  'artifact — never a real operator identity. No consumer reads this column '
  'yet; it exists so the write guard has somewhere honest to put these rows '
  'instead of hard-blocking them.';

create or replace function public.dia_operator_write_guard()
returns trigger language plpgsql as $$
declare
  v_op_id bigint;
  v_canon text;
  v_status text;
  v_class_kind text;
begin
  if NEW.operator is null or btrim(NEW.operator) = '' then
    return NEW;
  end if;

  -- ID2a-cleanup: a classification/payer/non_operator name is never an
  -- unresolved operator — route it to operator_class and pass the write
  -- through, before the hard-block check below ever runs.
  select o.kind into v_class_kind
    from public.operators o
   where lower(o.name) = lower(btrim(NEW.operator))
     and o.merged_into_operator_id is null
     and o.kind in ('category', 'payer', 'non_operator')
   limit 1;

  if v_class_kind is not null then
    -- operator_class is a properties-only column (leases carries no such
    -- field) — set it only on the table that has it, never blind-assign
    -- NEW.operator_class, which would raise "record NEW has no field
    -- operator_class" the instant this same guard fires on leases.
    if TG_TABLE_NAME = 'properties' then
      NEW.operator_class := v_class_kind;
    end if;
    NEW.operator_id := null;
    return NEW;
  end if;

  select operator_id, canonical_name, status into v_op_id, v_canon, v_status
    from public.dia_resolve_operator(NEW.operator)
   limit 1;

  if v_status = 'matched' then
    NEW.operator_id := v_op_id;
    if TG_TABLE_NAME = 'properties' then
      NEW.operator_class := null;
    end if;
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
  'ID2a/ID2a-cleanup hard-block write guard. BEFORE INSERT/UPDATE OF operator '
  'on properties (and leases, if it carries a raw operator text column). '
  'Blank operator always passes; a category/payer/non_operator name sets '
  'operator_class and passes; a matched operator fills operator_id and passes; '
  'anything else RAISES and refuses the write.';

-- Add resolution_note so a classification closure is distinguishable from a
-- genuine alias resolution (resolved_alias_text keeps meaning "the alias
-- text an alias row now carries").
alter table public.dia_operator_write_review add column if not exists resolution_note text;

-- Close every OPEN review row whose raw text is a registered
-- category/payer/non_operator name — it was never an unresolved operator.
update public.dia_operator_write_review r
   set status = 'dismissed',
       resolved_at = now(),
       resolution_note = format(
         'id2a-cleanup: classification value (kind=%s) — not an operator, '
         'routed via properties.operator_class on the next write, never '
         'auto-retried here.', o.kind
       )
  from public.operators o
 where r.status = 'open'
   and lower(o.name) = lower(btrim(r.raw_operator_text))
   and o.merged_into_operator_id is null
   and o.kind in ('category', 'payer', 'non_operator');

-- 5b. Backfill operator_class on the properties ALREADY carrying one of these
--     names — the write guard above only ever sets it going forward, on a
--     future INSERT/UPDATE OF operator. Without this, the review queue is
--     fixed but the underlying rows still read operator_class IS NULL /
--     operator_id IS NULL, indistinguishable from "never classified".
update public.properties p
   set operator_class = o.kind
  from public.operators o
 where p.operator_class is null
   and p.operator_id is null
   and p.operator is not null and btrim(p.operator) <> ''
   and lower(o.name) = lower(btrim(p.operator))
   and o.merged_into_operator_id is null
   and o.kind in ('category', 'payer', 'non_operator');

-- ----------------------------------------------------------------------------
-- 6. Apply the newly-seeded aliases (step 4) directly to `properties` — a
--    DIRECT update, deliberately NOT a re-invocation of
--    dia_id2a_backfill_property_operator_ids(). That function unconditionally
--    INSERTs a fresh dia_operator_write_review row for every non-matched
--    property it scans, and (table_name, record_pk, raw_operator_text) has no
--    uniqueness constraint — re-running it here would duplicate a review row
--    for every one of the ~71 genuinely-still-unresolved names (each already
--    logged once, pre-migration), which is exactly the kind of silent
--    "throughput" inflation this repo's doctrine (P159a) warns never to
--    create. A direct, matched-only UPDATE cannot duplicate anything.
-- ----------------------------------------------------------------------------
-- Postgres will not let a plain UPDATE ... FROM LATERAL correlate the
-- function's argument back to the row being updated (42P10) — so the
-- resolution is computed in a CTE (reading `properties` as an ordinary FROM
-- item, where CROSS JOIN LATERAL is unrestricted, exactly ID2a's own
-- backfill-function pattern) and the UPDATE joins to that CTE by PK.
with resolved as (
  select p.property_id, res.operator_id
    from public.properties p
    cross join lateral public.dia_resolve_operator(p.operator) as res
   where p.operator_id is null
     and p.operator is not null and btrim(p.operator) <> ''
     and res.status = 'matched'
)
update public.properties p
   set operator_id = resolved.operator_id
  from resolved
 where p.property_id = resolved.property_id;

-- Close the now-resolved review rows (both the seeded own-name matches and
-- any dba_names match) by direct status update — never re-inserting an
-- alias (already present from step 4) and never duplicating a review row.
with resolved as (
  select r.id, res.operator_id
    from public.dia_operator_write_review r
    cross join lateral public.dia_resolve_operator(r.raw_operator_text) as res
   where r.status = 'open'
     and res.status = 'matched'
)
update public.dia_operator_write_review r
   set status = 'resolved',
       resolved_at = now(),
       resolved_operator_id = resolved.operator_id,
       resolved_alias_text = r.raw_operator_text,
       resolution_note = 'id2a-cleanup: resolved via a registry_seed_own_name '
                          'or registry_seed_dba alias seeded in step 4'
  from resolved
 where r.id = resolved.id;

-- ----------------------------------------------------------------------------
-- 7. Orphan-company detector — the guard for the gap that let 9 person/junk
--    rows and 4 subsidiaries sit unnoticed in kind='company' for a month.
--    A row shaped exactly like those (no alias, no properties, no parent)
--    is now IMPOSSIBLE for anything this migration already classified
--    (every surviving company row got an own-name alias in step 4), so this
--    view reads empty today and exists to catch the NEXT hand-inserted row
--    that bypasses dia_id2a_seed_registry_aliases().
-- ----------------------------------------------------------------------------
create or replace view public.v_dia_operator_orphan_registry_gap as
select o.operator_id, o.name, o.id2a_source, o.updated_at
  from public.operators o
 where o.kind = 'company'
   and o.merged_into_operator_id is null
   and o.parent_operator_id is null
   and not exists (select 1 from public.dia_operator_aliases a where a.operator_id = o.operator_id)
   and not exists (select 1 from public.properties p where p.operator_id = o.operator_id)
 order by o.name;

comment on view public.v_dia_operator_orphan_registry_gap is
  'ID2a-cleanup gap guard: a kind=company operator row with no alias, no '
  'properties, and no parent — the exact shape every junk/subsidiary row '
  'this migration cleaned up had. Must read 0 rows immediately after this '
  'migration (every live company row got an own-name alias in step 4); any '
  'row appearing later was added by hand without calling '
  'dia_id2a_seed_registry_aliases() first. Feeds the ID3a-class detector '
  '(ID4 decision: prove on one class, generalize once proven).';

-- ----------------------------------------------------------------------------
-- 8. Reversal / verification queries (documented, not auto-run):
--
--   -- registry state
--   select kind, count(*) from public.operators group by kind;
--
--   -- alias count by source
--   select source, count(*) from public.dia_operator_aliases group by source;
--
--   -- review queue depth + the classification split
--   select status, count(*) from public.dia_operator_write_review group by status;
--   select resolution_note is not null as classification_closed, count(*)
--     from public.dia_operator_write_review where status = 'dismissed' group by 1;
--
--   -- orphan-company gap (must be 0 immediately after this migration)
--   select * from public.v_dia_operator_orphan_registry_gap;
--
--   -- parity (per ID2a's own view) — property counts per canonical operator
--   -- must move ONLY by the two merges in step 1 above; everything else in
--   -- this file is additive metadata (parenting/reclassification/aliases)
--   -- that cannot move a property_id's operator_id.
--   select * from public.v_id2a_operator_registry_parity order by property_count desc;
-- ----------------------------------------------------------------------------
