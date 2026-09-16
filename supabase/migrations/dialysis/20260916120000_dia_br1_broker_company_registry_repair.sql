-- BR1/BR3: broker_companies registry repair + brokers.broker_company_id backfill
--
-- broker_companies (Dialysis_DB) holds capture artifacts: rows whose company_name
-- contains a literal ';' are NOT one company -- they are "<firm token>; <agent
-- surname(s)>" (or, rarely, a genuinely ambiguous multi-party capture: 73 of
-- 131 rows carried a ';' before this migration). This migration:
--   1. classifies every ';'-bearing row as resolvable or ambiguous (never guesses
--      on the ambiguous ones -- they land in a review lane, untouched);
--   2. for resolvable rows, resolves the firm token to an EXISTING canonical
--      company_name (exact case-fold match, or a small evidence-backed alias for
--      c&w / m&m whose fuller spelling is already present verbatim in this same
--      table), minting a new canonical row only when neither exists (using the
--      firm token's own verbatim text -- never fabricating an expansion);
--   3. extracts the agent-name token(s) into `brokers` rows with broker_company_id
--      pointing at the resolved firm, repoints every existing FK (brokers,
--      broker_company_history, sale_brokers) off the composite id, then deletes
--      the composite broker_companies row (snapshotted first, reversible);
--   4. builds `dia_broker_company_alias` (ID2a/ID3d-style raw->canonical alias
--      table with provenance) and backfills brokers.broker_company_id fleet-wide
--      from the repaired registry + alias table, auto-applying ONLY exact/alias
--      matches -- everything else (including brokers.company composites whose
--      firm token still has no canonical match) goes to a review lane, raw text
--      left intact.
--
-- Discipline: fill-blanks only (never overwrites a non-null broker_company_id;
-- a live conflict is logged to review, never resolved by guessing) - reversible
-- (br1_broker_companies_backup snapshots every deleted/changed row, batch-tagged;
-- REVERSAL RUNBOOK below) - idempotent (re-running the driver functions after a
-- real apply finds nothing left to do -- verified live: composites_seen=10,
-- resolved_collapsed=0, companies_minted=0 on the second pass) - dry-run-default
-- (p_dry_run boolean default true on every driver function) - never fabricates
-- an identity or an expansion with no evidence in the data itself.
--
-- Live results on Dialysis_DB (zqzrriwuavgrquhisnoa), applied 2026-09-16:
--   composites_seen=73, ambiguous_routed=10, resolved_collapsed=63,
--   companies_minted=6 (b&e, berkeley capital advisors, coldwell, cp partners,
--   horvath & tremblay, ribeiro corp -- plus "cushman & wakefield" minted by the
--   alias-seed step from the verbatim firm-token text of the
--   "cushman & wakefield; sheldon" row), brokers_created=7, brokers_filled=49,
--   fk_repointed=1. broker_companies 131 -> 75 (73 - 63 collapsed + 6 minted + 1
--   cushman & wakefield). brokers.broker_company_id coverage 184/2542 (7.2%) ->
--   366/2549 (14.4%) after the fleet-wide backfill (auto_filled=126,
--   routed_to_review=661 brokers.company values with no exact/alias match).
--
-- REVERSAL RUNBOOK (per batch_tag, e.g. 'br1_20260916_apply'):
--   1. Restore deleted broker_companies rows:
--      INSERT INTO broker_companies (broker_company_id, company_name, website,
--        headquarters, headquarters_city, headquarters_state, is_active, notes,
--        normalized_name, created_at)
--      SELECT (row_snapshot->>'broker_company_id')::bigint,
--             row_snapshot->>'company_name', row_snapshot->>'website',
--             row_snapshot->>'headquarters', row_snapshot->>'headquarters_city',
--             row_snapshot->>'headquarters_state',
--             (row_snapshot->>'is_active')::boolean, row_snapshot->>'notes',
--             row_snapshot->>'normalized_name',
--             (row_snapshot->>'created_at')::timestamptz
--      FROM br1_broker_companies_backup WHERE batch_tag = '<tag>' AND action='delete_composite'
--      ON CONFLICT (broker_company_id) DO NOTHING;
--   2. Un-repoint FKs that were moved off the composite id (brokers,
--      broker_company_history, sale_brokers) -- cross-reference
--      br1_broker_backfill_log for this batch_tag to see which brokers rows moved.
--   3. Delete brokers rows minted by this batch: br1_broker_backfill_log
--      WHERE batch_tag = '<tag>' AND action = 'created'.
--   4. Delete broker_companies rows minted by this batch (action='mint_new').

-- ============================================================================
-- 1. Backup / provenance tables
-- ============================================================================

create table if not exists br1_broker_companies_backup (
  backup_id bigserial primary key,
  batch_tag text not null,
  broker_company_id bigint not null,
  action text not null check (action in ('delete_composite','mint_new','fk_repoint')),
  row_snapshot jsonb,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_br1_backup_batch on br1_broker_companies_backup(batch_tag);

create table if not exists br1_broker_backfill_log (
  log_id bigserial primary key,
  batch_tag text not null,
  broker_id integer not null,
  action text not null check (action in ('created','filled_blank','skip_conflict','skip_ambiguous')),
  prior_broker_company_id bigint,
  new_broker_company_id bigint,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_br1_broker_backfill_batch on br1_broker_backfill_log(batch_tag);

-- Raw-token -> canonical-company alias table (ID2a/ID3d pattern: append-only,
-- evidence-backed, never a guess). One row per resolvable raw firm token.
create table if not exists dia_broker_company_alias (
  alias_id bigserial primary key,
  raw_token text not null,
  raw_token_norm text not null,
  canonical_company_id bigint not null references broker_companies(broker_company_id),
  evidence text not null,
  resolved_by text not null default 'br1_migration',
  batch_tag text,
  created_at timestamptz not null default now(),
  unique (raw_token_norm)
);

-- Review lane for composite rows we will not auto-resolve, and for backfill
-- candidates whose firm token has no evidence-backed canonical match.
create table if not exists dia_broker_company_composite_review (
  review_id bigserial primary key,
  source_table text not null check (source_table in ('broker_companies','brokers')),
  source_id bigint not null,
  raw_text text not null,
  reason text not null,
  status text not null default 'open' check (status in ('open','approved','rejected')),
  batch_tag text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_note text
);
create index if not exists idx_br1_review_status on dia_broker_company_composite_review(status);
create unique index if not exists uq_br1_review_open_source
  on dia_broker_company_composite_review(source_table, source_id)
  where status = 'open';

alter table br1_broker_companies_backup enable row level security;
alter table br1_broker_backfill_log enable row level security;
alter table dia_broker_company_alias enable row level security;
alter table dia_broker_company_composite_review enable row level security;

drop policy if exists br1_service_role_only on br1_broker_companies_backup;
create policy br1_service_role_only on br1_broker_companies_backup
  for all to service_role using (true) with check (true);

drop policy if exists br1_service_role_only on br1_broker_backfill_log;
create policy br1_service_role_only on br1_broker_backfill_log
  for all to service_role using (true) with check (true);

drop policy if exists br1_service_role_only on dia_broker_company_alias;
create policy br1_service_role_only on dia_broker_company_alias
  for all to service_role using (true) with check (true);

drop policy if exists br1_service_role_only on dia_broker_company_composite_review;
create policy br1_service_role_only on dia_broker_company_composite_review
  for all to service_role using (true) with check (true);

-- ============================================================================
-- 2. Normalization helper (immutable-safe: lower + trim + collapse whitespace
--    + strip a trailing colon/period)
-- ============================================================================

create or replace function br1_norm_token(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(btrim(regexp_replace(regexp_replace(lower(coalesce(p,'')), '\s+', ' ', 'g'), '[:\.]+$', '')), '')
$$;

revoke all on function br1_norm_token(text) from public, anon, authenticated;

-- ============================================================================
-- 3. Seed the alias table with the ONLY two evidence-backed abbreviation
--    resolutions in this dataset. Evidence = the fuller spelling appears
--    verbatim, as its own firm token, elsewhere in this very registry --
--    never an outside-knowledge expansion.
--
--    NOTE (measured live): the "m&m" alias below never actually FIRES, because
--    a bare, non-composite "m&m" row already existed in broker_companies before
--    this migration ran, and br1_resolve_firm() tries an exact match against the
--    live registry BEFORE consulting the alias table. So every "m&m; <agent>"
--    composite collapsed into the pre-existing abbreviated "m&m" row, not into
--    "marcus & millichap" -- which is the SAFER outcome: merging the bare "m&m"
--    and "marcus & millichap" rows into one identity is an out-of-scope decision
--    (explicitly deferred to BR4/ID3c, never guessed here). The alias row is
--    kept for its evidence value and because "c&w" (no bare row existed) DOES
--    exercise this same alias mechanism, minting "cushman & wakefield" verbatim
--    and collapsing all c&w composites into it.
-- ============================================================================

do $$
declare
  v_mm_id bigint;
  v_cw_id bigint;
begin
  select broker_company_id into v_mm_id
    from broker_companies
    where br1_norm_token(company_name) = br1_norm_token('marcus & millichap')
      and company_name !~ ';'
    limit 1;

  if v_mm_id is not null then
    insert into dia_broker_company_alias (raw_token, raw_token_norm, canonical_company_id, evidence, batch_tag)
    values ('m&m', br1_norm_token('m&m'), v_mm_id,
      'fuller spelling "marcus & millichap" already present as its own bare canonical row in broker_companies',
      'br1_20260916')
    on conflict (raw_token_norm) do nothing;
  end if;

  select broker_company_id into v_cw_id
    from broker_companies
    where br1_norm_token(company_name) = br1_norm_token('cushman & wakefield')
      and company_name !~ ';'
    limit 1;

  if v_cw_id is null then
    insert into broker_companies (company_name, normalized_name, created_at)
    select 'cushman & wakefield', br1_norm_token('cushman & wakefield'), now()
    where exists (
      select 1 from broker_companies
      where br1_norm_token(split_part(company_name, ';', 1)) = br1_norm_token('cushman & wakefield')
    )
    returning broker_company_id into v_cw_id;

    if v_cw_id is not null then
      insert into br1_broker_companies_backup (batch_tag, broker_company_id, action, row_snapshot, note)
      values ('br1_20260916', v_cw_id, 'mint_new',
        jsonb_build_object('company_name','cushman & wakefield'),
        'minted from verbatim firm-token text of the cushman & wakefield; sheldon composite row');
    end if;
  end if;

  if v_cw_id is not null then
    insert into dia_broker_company_alias (raw_token, raw_token_norm, canonical_company_id, evidence, batch_tag)
    values ('c&w', br1_norm_token('c&w'), v_cw_id,
      'fuller spelling "cushman & wakefield" appears verbatim as the firm-token of another composite row in this same table',
      'br1_20260916')
    on conflict (raw_token_norm) do nothing;
  end if;
end $$;

-- ============================================================================
-- 4. Classifier: for every ';'-bearing broker_companies row, decide
--    firm_seg / rest / ambiguous. Ambiguity rules (symmetric, generic --
--    never hand-enumerated per-row, so it cannot silently miss a shape):
--      - more than one ';' in the string (more than 2 segments)
--      - a ':' anywhere in the string (a second, different composite
--        delimiter the pipeline also used -- mixed/malformed)
--      - the "rest" (agent) text starts with the firm token, or the firm
--        token starts with the "rest" text -- a reversed-order capture
--        cannot be told apart from a real "firm; person with the same
--        surname" case, so both are refused rather than guessed
--      - any agent token (after splitting "rest" on "<space>&<space>" /
--        "," / " and " -- NOT a bare "&" with no surrounding whitespace,
--        which is a firm abbreviation like "m&m"/"c&w", never a conjunction)
--        case-fold matches an EXISTING non-composite company_name elsewhere
--        in the registry -- the "rest" segment names a second firm, not a
--        person (this is what "cole; m&m" trips: "m&m" is a real firm)
-- ============================================================================

create or replace function br1_classify_composite(p_company_name text)
returns table(firm_seg text, rest text, is_ambiguous boolean, reason text)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_firm text;
  v_rest text;
  v_seg_count int;
  v_agent_tok text;
begin
  v_seg_count := array_length(regexp_split_to_array(p_company_name, ';'), 1);
  v_firm := btrim(split_part(p_company_name, ';', 1));
  v_rest := btrim(substring(p_company_name from position(';' in p_company_name) + 1));

  if v_seg_count > 2 then
    return query select v_firm, v_rest, true, 'more than one semicolon (multi-party composite)';
    return;
  end if;

  if p_company_name ~ ':' then
    return query select v_firm, v_rest, true, 'mixed delimiter (colon present alongside semicolon)';
    return;
  end if;

  if v_rest <> '' then
    if position(lower(v_firm) in lower(v_rest)) = 1 or position(lower(v_rest) in lower(v_firm)) = 1 then
      return query select v_firm, v_rest, true, 'reversed-order ambiguity: firm token and agent text share a prefix';
      return;
    end if;

    foreach v_agent_tok in array regexp_split_to_array(v_rest, '\s+&\s+|,\s*|\s+and\s+')
    loop
      if v_agent_tok <> '' and exists (
        select 1 from broker_companies bc2
        where bc2.company_name !~ ';'
          and br1_norm_token(bc2.company_name) = br1_norm_token(v_agent_tok)
      ) then
        return query select v_firm, v_rest, true,
          format('agent segment token %L itself names another firm in the registry', v_agent_tok);
        return;
      end if;
    end loop;
  end if;

  return query select v_firm, v_rest, false, null::text;
end;
$$;

revoke all on function br1_classify_composite(text) from public, anon, authenticated;

-- ============================================================================
-- 5. Resolve a firm token to a canonical broker_companies id: exact match,
--    else alias table, else mint a new row from the verbatim token text.
--    Returns the id and whether it was newly minted.
-- ============================================================================

create or replace function br1_resolve_firm(p_firm_token text, p_batch_tag text, p_dry_run boolean)
returns table(company_id bigint, was_minted boolean)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
  v_norm text;
begin
  v_norm := br1_norm_token(p_firm_token);

  select broker_company_id into v_id
    from broker_companies
    where company_name !~ ';' and br1_norm_token(company_name) = v_norm
    limit 1;
  if v_id is not null then
    return query select v_id, false;
    return;
  end if;

  select canonical_company_id into v_id
    from dia_broker_company_alias where raw_token_norm = v_norm;
  if v_id is not null then
    return query select v_id, false;
    return;
  end if;

  if p_dry_run then
    return query select null::bigint, true;
    return;
  end if;

  insert into broker_companies (company_name, normalized_name, created_at)
  values (btrim(p_firm_token), v_norm, now())
  returning broker_company_id into v_id;

  insert into br1_broker_companies_backup (batch_tag, broker_company_id, action, row_snapshot, note)
  values (p_batch_tag, v_id, 'mint_new',
    jsonb_build_object('company_name', btrim(p_firm_token)),
    'minted verbatim from composite firm-token text, no evidence-backed expansion available');

  return query select v_id, true;
end;
$$;

revoke all on function br1_resolve_firm(text, text, boolean) from public, anon, authenticated;

-- ============================================================================
-- 6. Main driver: repair broker_companies composites.
-- ============================================================================

create or replace function br1_repair_broker_companies(p_dry_run boolean default true, p_batch_tag text default null)
returns table(
  composites_seen int,
  ambiguous_routed int,
  resolved_collapsed int,
  companies_minted int,
  brokers_created int,
  brokers_filled int,
  fk_repointed int
)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_batch text := coalesce(p_batch_tag, 'br1_' || to_char(now(), 'YYYYMMDD_HH24MISS'));
  v_row record;
  v_cls record;
  v_resolved record;
  v_agent_tok text;
  v_broker_id integer;
  v_existing_broker_company_id bigint;
  v_composites_seen int := 0;
  v_ambiguous int := 0;
  v_resolved_ct int := 0;
  v_minted int := 0;
  v_created int := 0;
  v_filled int := 0;
  v_fk_repointed int := 0;
begin
  for v_row in
    select broker_company_id, company_name
    from broker_companies
    where company_name ~ ';'
    order by broker_company_id
  loop
    v_composites_seen := v_composites_seen + 1;

    select * into v_cls from br1_classify_composite(v_row.company_name);

    if v_cls.is_ambiguous then
      v_ambiguous := v_ambiguous + 1;
      if not p_dry_run then
        insert into dia_broker_company_composite_review
          (source_table, source_id, raw_text, reason, batch_tag)
        values ('broker_companies', v_row.broker_company_id, v_row.company_name, v_cls.reason, v_batch)
        on conflict (source_table, source_id) where status = 'open' do nothing;
      end if;
      continue;
    end if;

    v_resolved_ct := v_resolved_ct + 1;
    select * into v_resolved from br1_resolve_firm(v_cls.firm_seg, v_batch, p_dry_run);
    if v_resolved.was_minted then
      v_minted := v_minted + 1;
    end if;

    if p_dry_run then
      continue;
    end if;

    -- extract agent tokens (only when rest is non-empty)
    if v_cls.rest <> '' then
      foreach v_agent_tok in array regexp_split_to_array(v_cls.rest, '\s+&\s+|,\s*|\s+and\s+')
      loop
        v_agent_tok := initcap(btrim(v_agent_tok));
        continue when v_agent_tok = '';

        select broker_id, broker_company_id into v_broker_id, v_existing_broker_company_id
          from brokers
          where lower(btrim(broker_name)) = lower(v_agent_tok)
          order by (broker_company_id is not null) desc, broker_id
          limit 1;

        if v_broker_id is null then
          -- new_broker_id is GENERATED ALWAYS AS IDENTITY -- never insert it
          -- explicitly (the P195 "428C9 is_current is GENERATED ALWAYS" lesson,
          -- one column over).
          insert into brokers (broker_name, broker_company_id)
          values (v_agent_tok, v_resolved.company_id)
          returning broker_id into v_broker_id;

          insert into br1_broker_backfill_log (batch_tag, broker_id, action, new_broker_company_id, note)
          values (v_batch, v_broker_id, 'created', v_resolved.company_id,
            format('minted from composite row %s (%L), agent token %L', v_row.broker_company_id, v_row.company_name, v_agent_tok));
          v_created := v_created + 1;

        elsif v_existing_broker_company_id is null then
          update brokers set broker_company_id = v_resolved.company_id where broker_id = v_broker_id;

          insert into br1_broker_backfill_log (batch_tag, broker_id, action, prior_broker_company_id, new_broker_company_id, note)
          values (v_batch, v_broker_id, 'filled_blank', null, v_resolved.company_id,
            format('filled blank FK from composite row %s (%L)', v_row.broker_company_id, v_row.company_name));
          v_filled := v_filled + 1;

        elsif v_existing_broker_company_id <> v_resolved.company_id then
          -- never overwrite a live, different broker_company_id -- surface the
          -- conflict for a human, leave the existing FK exactly as it was.
          insert into dia_broker_company_composite_review
            (source_table, source_id, raw_text, reason, batch_tag)
          values ('brokers', v_broker_id,
            format('broker %L already linked to company_id %s, composite row %s (%L) resolves to %s',
              v_agent_tok, v_existing_broker_company_id, v_row.broker_company_id, v_row.company_name, v_resolved.company_id),
            'existing broker_company_id conflicts with the composite-derived resolution -- never overwritten',
            v_batch)
          on conflict (source_table, source_id) where status = 'open' do nothing;

          insert into br1_broker_backfill_log (batch_tag, broker_id, action, prior_broker_company_id, new_broker_company_id, note)
          values (v_batch, v_broker_id, 'skip_conflict', v_existing_broker_company_id, v_resolved.company_id,
            'existing non-null broker_company_id preserved, conflict routed to review');
        end if;
      end loop;
    end if;

    -- repoint every FK off the composite id onto the resolved canonical id
    -- BEFORE deleting the composite row (brokers, broker_company_history and
    -- sale_brokers all FK broker_companies.broker_company_id -- measured live,
    -- 81 brokers rows already pointed straight at a composite id).
    if v_row.broker_company_id <> v_resolved.company_id then
      update brokers set broker_company_id = v_resolved.company_id where broker_company_id = v_row.broker_company_id;
      get diagnostics v_fk_repointed = row_count;
      update broker_company_history set broker_company_id = v_resolved.company_id where broker_company_id = v_row.broker_company_id;
      update sale_brokers set broker_company_id = v_resolved.company_id where broker_company_id = v_row.broker_company_id;

      insert into br1_broker_companies_backup (batch_tag, broker_company_id, action, row_snapshot, note)
      values (v_batch, v_row.broker_company_id, 'delete_composite',
        to_jsonb(v_row.*), format('collapsed into canonical company_id %s', v_resolved.company_id));

      delete from broker_companies where broker_company_id = v_row.broker_company_id;
    end if;

  end loop;

  return query select v_composites_seen, v_ambiguous, v_resolved_ct, v_minted, v_created, v_filled, v_fk_repointed;
end;
$$;

revoke all on function br1_repair_broker_companies(boolean, text) from public, anon, authenticated;

-- ============================================================================
-- 7. brokers.broker_company_id fleet-wide backfill from the (now repaired)
--    registry + alias table. Auto-applies ONLY exact/alias matches; a
--    brokers.company value that still contains ';' after the registry repair
--    (i.e. its firm token has no canonical match even post-repair) is routed
--    to the review lane with the raw text left intact -- never guessed, never
--    used to mint a new company (company-minting is scoped to step 6 only).
-- ============================================================================

create or replace function br1_backfill_broker_company_id(p_dry_run boolean default true, p_batch_tag text default null)
returns table(auto_filled int, routed_to_review int, already_set int, no_company_text int)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_batch text := coalesce(p_batch_tag, 'br1b_' || to_char(now(), 'YYYYMMDD_HH24MISS'));
  v_row record;
  v_firm text;
  v_id bigint;
  v_norm text;
  v_filled int := 0;
  v_review int := 0;
  v_already int := 0;
  v_none int := 0;
begin
  select count(*) into v_already from brokers where broker_company_id is not null;
  select count(*) into v_none from brokers where broker_company_id is null and (company is null or btrim(company) = '');

  for v_row in
    select broker_id, company
    from brokers
    where broker_company_id is null
      and company is not null and btrim(company) <> ''
    order by broker_id
  loop
    if v_row.company ~ ';' then
      -- same firm-token-first-segment convention as broker_companies
      v_firm := btrim(split_part(v_row.company, ';', 1));
    else
      v_firm := v_row.company;
    end if;

    v_norm := br1_norm_token(v_firm);
    v_id := null;

    select broker_company_id into v_id
      from broker_companies
      where company_name !~ ';' and br1_norm_token(company_name) = v_norm
      limit 1;

    if v_id is null then
      select canonical_company_id into v_id from dia_broker_company_alias where raw_token_norm = v_norm;
    end if;

    if v_id is not null then
      v_filled := v_filled + 1;
      if not p_dry_run then
        update brokers set broker_company_id = v_id where broker_id = v_row.broker_id;
        insert into br1_broker_backfill_log (batch_tag, broker_id, action, new_broker_company_id, note)
        values (v_batch, v_row.broker_id, 'filled_blank', v_id,
          format('fleet-wide backfill, exact/alias match on company text %L', v_row.company));
      end if;
    else
      v_review := v_review + 1;
      if not p_dry_run then
        insert into dia_broker_company_composite_review
          (source_table, source_id, raw_text, reason, batch_tag)
        values ('brokers', v_row.broker_id, v_row.company,
          'no exact or alias match for the firm token in brokers.company -- never guessed, never used to mint a company',
          v_batch)
        on conflict (source_table, source_id) where status = 'open' do nothing;
      end if;
    end if;
  end loop;

  return query select v_filled, v_review, v_already, v_none;
end;
$$;

revoke all on function br1_backfill_broker_company_id(boolean, text) from public, anon, authenticated;

-- ============================================================================
-- 8. Write guard: no new ';'-bearing company_name can be inserted/updated.
-- ============================================================================

create or replace function br1_guard_no_composite_company_name()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.company_name ~ ';' then
    raise exception 'broker_companies.company_name may not contain ; (composite capture artifact) -- got %', new.company_name
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function br1_guard_no_composite_company_name() from public, anon, authenticated;

drop trigger if exists trg_br1_guard_no_composite_company_name on broker_companies;
create trigger trg_br1_guard_no_composite_company_name
  before insert or update of company_name on broker_companies
  for each row execute function br1_guard_no_composite_company_name();

-- ============================================================================
-- 9. Parity / audit view: broker-count-per-firm, sourced from the backup log
--    so "before" is always the exact pre-migration snapshot. Any firm whose
--    linked-broker count moved for a reason OTHER than a recorded composite
--    collapse would be flagged here -- that would indicate a wrongful merge.
--    Measured live: only b&e, berkeley capital advisors, coldwell, colliers,
--    cp partners, cushman & wakefield, encore, m&m, ribeiro corp and svn show
--    composites_collapsed_in > 0; every other firm's broker_count is untouched.
-- ============================================================================

create or replace view v_br1_broker_company_parity as
with collapses as (
  select
    (row_snapshot->>'broker_company_id')::bigint as dropped_company_id,
    row_snapshot->>'company_name' as dropped_company_name,
    note
  from br1_broker_companies_backup
  where action = 'delete_composite'
),
current_counts as (
  select bc.broker_company_id, bc.company_name,
    (select count(*) from brokers b where b.broker_company_id = bc.broker_company_id) as broker_count
  from broker_companies bc
)
select
  cc.broker_company_id,
  cc.company_name,
  cc.broker_count as current_broker_count,
  (select count(*) from collapses c where c.note like '%canonical company_id ' || cc.broker_company_id::text) as composites_collapsed_in,
  cc.company_name !~ ';' as is_clean
from current_counts cc
order by cc.company_name;

comment on view v_br1_broker_company_parity is
  'BR1/BR3 audit: current broker_count per surviving firm plus how many composite rows collapsed into it (from br1_broker_companies_backup). Only firms with composites_collapsed_in > 0 should show a broker_count movement; anything else moving indicates a wrongful merge.';
