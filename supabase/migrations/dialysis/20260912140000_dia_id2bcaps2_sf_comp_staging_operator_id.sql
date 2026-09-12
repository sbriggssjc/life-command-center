-- ============================================================================
-- ID2b-caps-2 — sf_comp_staging (Salesforce-staged closed comps, Team
-- Briggs' own deals) has no `properties` join, so ID2b-caps' rpc_query_comps
-- change could never resolve an operator_id for that arm — it always fell
-- through to `null`. Measured live by Cowork against deployed build
-- `c5fc261f`: sf_comp_staging carries 196 rows spelled `DaVita Dialysis` and
-- 179 spelled `Fresenius Medical Care`, EXACT matches of registered aliases
-- (`dia_operator_aliases.alias_norm`) already mapping to operator_id 4
-- (DaVita) and 5 (Fresenius Medical Care) respectively. Because the RPC's
-- text fallback never consulted the alias table for this arm, those 375
-- rows minted a SECOND, text-keyed band under the identical canonical
-- label the id-keyed band already carries — the "two bands, one name"
-- symptom this unit closes.
--
-- FIX AT THE SOURCE OF RECORD (CLAUDE.md doctrine): sf_comp_staging.tenant
-- IS the raw fact for this row (the table has no property FK to inherit an
-- operator_id from), so it gets the SAME treatment ID2a already gave
-- properties.operator — a first-class `operator_id` column, resolved
-- through the ONE existing resolver (`dia_resolve_operator`, ID2a §7b), never
-- a second alias map or a second classifier. This is deliberately option
-- (b) from the ID2b-caps-2 prompt, not a query-time resolve inside
-- rpc_query_comps alone: `sf_comp_staging.tenant` is the only place this
-- fact can live (there is no properties row to hang it off), and a future
-- consumer of this table (there is none in this repo today -- checked:
-- `grep -rn "sf_comp_staging" api/ mcp/` shows only linkage-key selects in
-- entities-handler.js and om-comp-resolver.js, neither reads `.tenant`)
-- should not have to re-derive the same fact a second way.
--
-- Deliberately LIGHTER than the properties precedent in one respect: no
-- hard-block write-guard trigger. properties.operator is written only from
-- inside this repo's own JS/SQL, so `dia_operator_write_guard()` raising on
-- an unresolved write is safe. sf_comp_staging is fed by the Salesforce
-- sync pipeline in the separate Dialysis repo (`sf_object_sync.py`,
-- untouched by this session) — a hard block here could either fail that
-- external writer's upserts outright or, if it silently retries, spam
-- `dia_operator_write_review` once per sync cycle for the same unresolved
-- tenant. The trigger below is FILL-BLANKS ONLY (never raises, never
-- overwrites an existing operator_id) and de-dupes its own review-lane
-- writes so a repeatedly-synced unresolved row logs once, not every sync.
--
-- Discipline: additive (nullable FK column) · fill-blanks only (trigger
-- never touches a non-null operator_id, backfill only ever targets NULL
-- rows) · conservative (routes through dia_resolve_operator's own
-- exact-alias-then-family-classifier order, same as every other caller —
-- no new matching logic) · reversible (drop column/trigger/function) ·
-- idempotent (backfill re-run only touches rows still missing operator_id;
-- trigger re-fires harmlessly on an unchanged tenant since operator_id is
-- already set) · dry-run-able (`dia_id2acleanup2_backfill_sf_comp_staging_
-- operator_ids(true)` is the default).
--
-- REVERSAL:
--   drop trigger if exists trg_dia_sf_comp_staging_operator_fill on public.sf_comp_staging;
--   drop function if exists public.dia_sf_comp_staging_operator_fill();
--   drop function if exists public.dia_id2acleanup2_backfill_sf_comp_staging_operator_ids(boolean, int);
--   alter table public.sf_comp_staging drop column if exists operator_id;
--   -- review rows this unit logged carry table_name='sf_comp_staging' and can
--   -- be identified (never deleted -- retire-not-delete) via:
--   select * from public.dia_operator_write_review where table_name = 'sf_comp_staging';
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'sf_comp_staging'
  ) then
    raise exception 'ID2b-caps-2: public.sf_comp_staging does not exist on this project — wrong target DB?';
  end if;
  if not exists (
    select 1 from information_schema.routines
    where routine_schema = 'public' and routine_name = 'dia_resolve_operator'
  ) then
    raise exception 'ID2b-caps-2: public.dia_resolve_operator() is missing — apply the ID2a operator registry migrations first.';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1. Additive column. Nullable, FK'd to the same registry every other
--    operator_id column points at.
-- ----------------------------------------------------------------------------
alter table public.sf_comp_staging
  add column if not exists operator_id bigint references public.operators(operator_id);

comment on column public.sf_comp_staging.operator_id is
  'ID2b-caps-2: canonical operator, resolved from `tenant` via the ONE '
  'ID2a resolver (dia_resolve_operator). Filled at write time by '
  'trg_dia_sf_comp_staging_operator_fill (fill-blanks only -- never '
  'overwrites a value already set) and backfillable via '
  'dia_id2acleanup2_backfill_sf_comp_staging_operator_ids(). NULL means '
  'either no tenant text, or a tenant string not yet in the registry -- '
  'check dia_operator_write_review (table_name=''sf_comp_staging'') for the '
  'open ones, NEVER re-derive a second resolver for this table.';

-- ----------------------------------------------------------------------------
-- 2. Fill-blanks trigger. Fires on INSERT and on UPDATE OF tenant so a
--    later-corrected tenant string is re-resolved, but NEVER touches a row
--    whose operator_id is already set (fill-blanks doctrine) and NEVER
--    raises (unlike dia_operator_write_guard() -- see the header for why).
--    An unresolved, non-blank tenant is logged to the shared review lane,
--    de-duplicated against any already-open row for the SAME (table,
--    record_pk, raw text) so a row re-touched by every Salesforce sync
--    cycle logs once, not once per sync.
-- ----------------------------------------------------------------------------
create or replace function public.dia_sf_comp_staging_operator_fill()
returns trigger language plpgsql as $$
declare
  v_op_id bigint;
  v_canon text;
  v_status text;
begin
  if NEW.operator_id is not null then
    return NEW; -- fill-blanks only -- never overwrite a curated/already-resolved value
  end if;
  if NEW.tenant is null or btrim(NEW.tenant) = '' then
    return NEW;
  end if;

  select operator_id, canonical_name, status into v_op_id, v_canon, v_status
    from public.dia_resolve_operator(NEW.tenant)
   limit 1;

  if v_status = 'matched' then
    NEW.operator_id := v_op_id;
    return NEW;
  end if;

  -- Unresolved (needs_review / non_dialysis / blank-status-but-non-blank-
  -- text) -- log once, never raise, never guess. De-duped on
  -- (table_name, record_pk, raw_operator_text, status='open') so a repeated
  -- sync of the same unresolved row does not spam the review lane.
  if not exists (
    select 1 from public.dia_operator_write_review r
     where r.table_name = 'sf_comp_staging'
       and r.record_pk = NEW.staging_id::text
       and r.raw_operator_text = NEW.tenant
       and r.status = 'open'
  ) then
    perform public.dia_id2a_log_unresolved_write('sf_comp_staging', NEW.staging_id::text, NEW.tenant);
  end if;

  return NEW;
end;
$$;

comment on function public.dia_sf_comp_staging_operator_fill() is
  'ID2b-caps-2: BEFORE INSERT/UPDATE OF tenant on sf_comp_staging. '
  'Fill-blanks resolve of `tenant` -> `operator_id` via the single ID2a '
  'resolver (dia_resolve_operator). Never raises (unlike '
  'dia_operator_write_guard on properties/leases -- sf_comp_staging is fed '
  'by an external Salesforce sync this repo does not control) and never '
  'overwrites an already-set operator_id. Logs an unresolved, non-blank '
  'tenant to dia_operator_write_review exactly once per (row, raw text).';

drop trigger if exists trg_dia_sf_comp_staging_operator_fill on public.sf_comp_staging;
create trigger trg_dia_sf_comp_staging_operator_fill
  before insert or update of tenant on public.sf_comp_staging
  for each row execute function public.dia_sf_comp_staging_operator_fill();

-- ----------------------------------------------------------------------------
-- 3. Backfill for existing rows -- same shape as
--    dia_id2a_backfill_property_operator_ids(): dry-run default, auto-applies
--    ONLY exact/alias matches (status='matched'), everything else logged to
--    the review lane, never auto-written, never guessed. Idempotent (only
--    ever targets rows still missing operator_id).
-- ----------------------------------------------------------------------------
create or replace function public.dia_id2acleanup2_backfill_sf_comp_staging_operator_ids(
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
  select jsonb_object_agg(coalesce(tenant, '(none)'), cnt) into v_before
    from (
      select tenant, count(*) as cnt
        from public.sf_comp_staging
       where operator_id is null and tenant is not null and btrim(tenant) <> ''
       group by tenant
       order by count(*) desc
       limit 50
    ) t;

  drop table if exists tmp_id2bcaps2_sf_comp_plan;
  create temporary table tmp_id2bcaps2_sf_comp_plan on commit drop as
  select st.staging_id, st.tenant as raw_tenant, r.operator_id, r.canonical_name, r.status
    from public.sf_comp_staging st
    cross join lateral public.dia_resolve_operator(st.tenant) r
   where st.operator_id is null
     and st.tenant is not null and btrim(st.tenant) <> ''
   limit coalesce(p_limit, 2147483647);

  select count(*) into v_total from tmp_id2bcaps2_sf_comp_plan;
  select count(*) into v_auto from tmp_id2bcaps2_sf_comp_plan where status = 'matched';
  v_review := v_total - v_auto;

  if p_dry_run then
    return jsonb_build_object(
      'dry_run', true,
      'candidates', v_total,
      'would_auto_apply', v_auto,
      'would_review', v_review,
      'before_counts_top50', v_before
    );
  end if;

  update public.sf_comp_staging st
     set operator_id = t.operator_id
    from tmp_id2bcaps2_sf_comp_plan t
   where st.staging_id = t.staging_id and t.status = 'matched';

  insert into public.dia_operator_write_review (table_name, record_pk, raw_operator_text)
  select 'sf_comp_staging', t.staging_id::text, t.raw_tenant
    from tmp_id2bcaps2_sf_comp_plan t
   where t.status <> 'matched'
     and not exists (
       select 1 from public.dia_operator_write_review r
        where r.table_name = 'sf_comp_staging'
          and r.record_pk = t.staging_id::text
          and r.raw_operator_text = t.raw_tenant
          and r.status = 'open'
     );

  select jsonb_object_agg(coalesce(tenant, '(none)'), cnt) into v_after
    from (
      select tenant, count(*) as cnt
        from public.sf_comp_staging
       where operator_id is null and tenant is not null and btrim(tenant) <> ''
       group by tenant
       order by count(*) desc
       limit 50
    ) t;

  return jsonb_build_object(
    'dry_run', false,
    'candidates', v_total,
    'auto_applied', v_auto,
    'sent_to_review', v_review,
    'before_counts_top50', v_before,
    'after_counts_top50', v_after
  );
end;
$$;

comment on function public.dia_id2acleanup2_backfill_sf_comp_staging_operator_ids(boolean, int) is
  'ID2b-caps-2 backfill for sf_comp_staging.operator_id. Run with '
  'p_dry_run=true (default) FIRST; re-run with p_dry_run=false to apply. '
  'Idempotent -- re-running only ever touches rows still missing '
  'operator_id. Mirrors dia_id2a_backfill_property_operator_ids exactly.';

-- Suggested first real run, after reviewing the dry-run output:
--   select public.dia_id2acleanup2_backfill_sf_comp_staging_operator_ids(true);
--   select public.dia_id2acleanup2_backfill_sf_comp_staging_operator_ids(false);
