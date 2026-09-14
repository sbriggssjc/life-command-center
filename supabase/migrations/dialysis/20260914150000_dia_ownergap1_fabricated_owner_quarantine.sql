-- OWNERGAP1 Unit 1 — reversible containment for fabricated public-record owner names.
--
-- Found while sizing PDR2-noowner (docs/os/PLANNED-BACKLOG.md OWNERGAP1): the public-record
-- ingest producer's gpt-4o extraction leg has, on this evidence, been returning template
-- placeholder company names ("XYZ Dialysis Centers Inc.", "ABC Properties LLC", ...) instead
-- of a real owner when it has nothing to report, and the literal string "Unknown" wherever it
-- cannot state a mailing owner. The producer itself is `src/public_record_ingest.py` in the
-- SIBLING `Dialysis` repo (Python) — NOT `api/_handlers/sidebar-pipeline.js` in this repo, which
-- was the originally-suspected writer and does not touch `mailing_owner`/`entity_name` at all
-- (see the OWNERGAP1 report). This session has read-only access to the Dialysis repo, so the
-- prompt-template fix belongs there (filed OWNERGAP1-producer, life-command-center backlog).
-- This migration is the containment that IS in scope from this repo: a DB-level guard that
-- (a) quarantines every existing contaminated value found, reversibly, and (b) stops any FUTURE
-- write of the same shape from ever reaching a column the app or a reconciler treats as a real
-- owner -- regardless of which process writes it.
--
-- Measured contamination, all four tables that can carry an owner-shaped free-text name coming
-- out of this producer (not just the two the originating investigation named):
--   tax_records.mailing_owner            228 fabricated (XYZ/ABC...) + 142 literal 'Unknown'
--   entity_registry_records.entity_name  221 fabricated
--   recorded_owners.name                  12 fabricated (UNIQUE(name) -- 0 properties reference them)
--   true_owners.name                      10 fabricated (UNIQUE(name) -- 0 properties reference them)
-- None of the 22 recorded_owners/true_owners rows named "XYZ .../ABC ..." are referenced by any
-- property today (verified 0 across both tables) -- but they sit in the exact tables a
-- name-match reconciler reads as ground truth, so leaving them unflagged is a live landmine, not
-- a historical curiosity. Nothing under `properties` (recorded_owner_id / true_owner_id /
-- recorded_owner_name / true_owner_name / tax_mailing_owner / owner_parent_entity /
-- owner_registered_agent / assessed_owner) carries any of these fabricated names today (verified
-- 0 across all of them) -- this migration keeps it that way with a write-time guard on the
-- FABRICATED rows specifically, and writes NOTHING to any `properties` column.
--
-- ⚠️ One exception, found and scoped out deliberately (see §7): the detector also matches the
-- literal string "Unknown" as a NAME (not just "XYZ .../ABC ..." fabrication), and one
-- recorded_owners row named exactly "Unknown" IS already referenced by 23 real properties. That
-- is a genuine in-use sentinel, not gpt-4o template fabrication, and severing it is out of scope
-- for a migration about stopping fabrication -- see §7 for the reasoning and the guard's exact
-- boundary (`fabrication_quarantine_reason = 'fabricated_placeholder'` only, never
-- `'unstated_placeholder'`).
--
-- Discipline: reversible (every quarantined/flagged value is logged with its original value and
-- can be restored via dia_ownergap1_restore_quarantine); never hard-delete; never guess a real
-- owner in a fabricated one's place; fill-blanks (a guarded write becomes NULL/flagged, never a
-- substituted name); idempotent (partial unique index on the log; re-running touches 0 rows).
--
-- REVERSAL RUNBOOK:
--   select * from dia_ownergap1_restore_quarantine('ownergap1_20260914');
--   -- restores tax_records.mailing_owner from the log and clears the flag columns on the other
--   -- three tables for every row quarantined under that batch_tag, then marks the log rows
--   -- restored_at = now() so a second call is a no-op.
--   -- To remove the write-time guards entirely:
--   --   drop trigger trg_dia_ownergap1_tax_mailing_owner_guard on tax_records;
--   --   drop trigger trg_dia_ownergap1_entity_name_guard on entity_registry_records;
--   --   drop trigger trg_dia_ownergap1_recorded_owner_name_guard on recorded_owners;
--   --   drop trigger trg_dia_ownergap1_true_owner_name_guard on true_owners;
--   --   drop trigger trg_dia_ownergap1_property_owner_link_guard on properties;

-- ── 1. The single detector. One owner, reused by every trigger and by the backfill. ──────────
create or replace function dia_is_fabricated_placeholder_owner(p_value text)
returns boolean
language sql
immutable
as $$
  select p_value is not null
     and btrim(p_value) <> ''
     and (
       -- The exact shape observed in production: "XYZ ..." / "ABC ..." as a bare template
       -- placeholder company name. No real dialysis-adjacent LLC/Trust/Corp in this dataset
       -- (or in recorded_owners/true_owners/parcel_records/deed_records, checked) is named
       -- this way -- verified against the full live population before shipping this pattern.
       btrim(p_value) ~* '^(XYZ|ABC)\s'
       -- "Unknown" is a placeholder written as if it were a fact (CLAUDE.md P180), not a name.
       or lower(btrim(p_value)) = 'unknown'
     )
$$;

comment on function dia_is_fabricated_placeholder_owner(text) is
  'OWNERGAP1: true when a captured owner-shaped string is a known template placeholder '
  '("XYZ ..."/"ABC ...") or the literal "Unknown" written as if it were a name. '
  'Single detector -- every quarantine trigger and the backfill call this, never a local copy.';

-- ── 2. The quarantine log. One shared table across all four source tables. ───────────────────
create table if not exists dia_ownergap1_fabrication_quarantine (
  id                bigserial primary key,
  source_table      text not null,
  source_pk         text not null,
  field_name        text not null,
  quarantined_value text,
  quarantine_reason text not null check (quarantine_reason in ('fabricated_placeholder', 'unstated_placeholder')),
  batch_tag         text not null,
  quarantined_at    timestamptz not null default now(),
  restored_at       timestamptz
);

comment on table dia_ownergap1_fabrication_quarantine is
  'OWNERGAP1: reversible audit log of every owner-shaped value quarantined as a fabricated '
  'placeholder or an unstated "Unknown". Never hard-deletes the original value -- '
  'quarantined_value carries it, restored_at proves whether it was put back.';

-- Idempotency: a re-run of the backfill, or the same producer retry hitting the same row,
-- must not log the same (table, row, field) twice while it is still quarantined.
create unique index if not exists uq_dia_ownergap1_quarantine_open
  on dia_ownergap1_fabrication_quarantine (source_table, source_pk, field_name)
  where restored_at is null;

-- ── 3. Logging helper. ────────────────────────────────────────────────────────────────────────
create or replace function dia_ownergap1_log_quarantine(
  p_source_table text,
  p_source_pk    text,
  p_field_name   text,
  p_value        text,
  p_batch_tag    text
) returns void
language plpgsql
as $$
declare
  v_reason text;
begin
  if p_value is null or btrim(p_value) = '' then
    return;
  end if;
  if btrim(p_value) ~* '^(XYZ|ABC)\s' then
    v_reason := 'fabricated_placeholder';
  elsif lower(btrim(p_value)) = 'unknown' then
    v_reason := 'unstated_placeholder';
  else
    return; -- not a value this guard recognises; never quarantine on a guess
  end if;

  insert into dia_ownergap1_fabrication_quarantine
    (source_table, source_pk, field_name, quarantined_value, quarantine_reason, batch_tag)
  values
    (p_source_table, p_source_pk, p_field_name, p_value, v_reason, p_batch_tag)
  on conflict (source_table, source_pk, field_name) where restored_at is null
    do nothing;
end;
$$;

-- ── 4. tax_records.mailing_owner — DESTRUCTIVE-LOOKING BUT REVERSIBLE: nulled, not deleted. ───
-- This is the field the originating investigation named and the one a future owner-recovery
-- read would actually consult, so it is the one field in this migration where the contaminated
-- value is removed from the live column (never from the log, and never from raw_payload, which
-- this migration does not touch).
alter table tax_records
  add column if not exists fabrication_quarantined_at timestamptz,
  add column if not exists fabrication_quarantine_reason text;

with backfill as (
  select id, mailing_owner
  from tax_records
  where dia_is_fabricated_placeholder_owner(mailing_owner)
)
select dia_ownergap1_log_quarantine('tax_records', id::text, 'mailing_owner', mailing_owner, 'ownergap1_20260914')
from backfill;

update tax_records
set mailing_owner = null,
    fabrication_quarantined_at = now(),
    fabrication_quarantine_reason = case
      when dia_is_fabricated_placeholder_owner(mailing_owner) and lower(btrim(mailing_owner)) <> 'unknown'
        then 'fabricated_placeholder'
      else 'unstated_placeholder'
    end
where dia_is_fabricated_placeholder_owner(mailing_owner);

-- Write-time guard: any future INSERT/UPDATE that would land a fabricated/"Unknown" mailing
-- owner is caught before the value ever reaches the column, whichever process writes it.
create or replace function dia_ownergap1_tax_mailing_owner_guard()
returns trigger
language plpgsql
as $$
begin
  if dia_is_fabricated_placeholder_owner(new.mailing_owner) then
    perform dia_ownergap1_log_quarantine('tax_records', new.id::text, 'mailing_owner',
                                          new.mailing_owner, 'ownergap1_live_guard');
    new.fabrication_quarantined_at := now();
    new.fabrication_quarantine_reason := case
      when lower(btrim(new.mailing_owner)) = 'unknown' then 'unstated_placeholder'
      else 'fabricated_placeholder'
    end;
    new.mailing_owner := null; -- fill-blanks: never write a name we know is not real
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dia_ownergap1_tax_mailing_owner_guard on tax_records;
create trigger trg_dia_ownergap1_tax_mailing_owner_guard
  before insert or update of mailing_owner on tax_records
  for each row execute function dia_ownergap1_tax_mailing_owner_guard();

-- ── 5. entity_registry_records.entity_name — FLAG ONLY, never nulled. ────────────────────────
-- entity_name is the row's own identity, not a fill-blanks field on a container row the way
-- tax_records.mailing_owner is -- nulling it would destroy the row's meaning rather than
-- correct one field of it. Every consumer this repo has must instead check the flag; the raw
-- value stays in place (and in the log) for audit.
alter table entity_registry_records
  add column if not exists fabrication_quarantined_at timestamptz,
  add column if not exists fabrication_quarantine_reason text;

with backfill as (
  select id, entity_name
  from entity_registry_records
  where dia_is_fabricated_placeholder_owner(entity_name)
)
select dia_ownergap1_log_quarantine('entity_registry_records', id::text, 'entity_name', entity_name, 'ownergap1_20260914')
from backfill;

update entity_registry_records
set fabrication_quarantined_at = now(),
    fabrication_quarantine_reason = case
      when lower(btrim(entity_name)) = 'unknown' then 'unstated_placeholder'
      else 'fabricated_placeholder'
    end
where dia_is_fabricated_placeholder_owner(entity_name);

create or replace function dia_ownergap1_entity_name_guard()
returns trigger
language plpgsql
as $$
begin
  if dia_is_fabricated_placeholder_owner(new.entity_name) then
    perform dia_ownergap1_log_quarantine('entity_registry_records', new.id::text, 'entity_name',
                                          new.entity_name, 'ownergap1_live_guard');
    new.fabrication_quarantined_at := now();
    new.fabrication_quarantine_reason := case
      when lower(btrim(new.entity_name)) = 'unknown' then 'unstated_placeholder'
      else 'fabricated_placeholder'
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dia_ownergap1_entity_name_guard on entity_registry_records;
create trigger trg_dia_ownergap1_entity_name_guard
  before insert or update of entity_name on entity_registry_records
  for each row execute function dia_ownergap1_entity_name_guard();

-- ── 6. recorded_owners.name / true_owners.name — FLAG ONLY, same reasoning as §5. ────────────
-- These are the curated owner tables `properties.recorded_owner_id`/`true_owner_id` point at.
-- 0 properties reference any of the contaminated rows today (verified) -- flagging them keeps
-- it that way even if a future name-match reconciler would otherwise treat "XYZ Dialysis
-- Centers Inc." as a legitimate, mergeable owner entity.
alter table recorded_owners
  add column if not exists fabrication_quarantined_at timestamptz,
  add column if not exists fabrication_quarantine_reason text;
alter table true_owners
  add column if not exists fabrication_quarantined_at timestamptz,
  add column if not exists fabrication_quarantine_reason text;

with backfill as (
  select recorded_owner_id as pk, name from recorded_owners where dia_is_fabricated_placeholder_owner(name)
)
select dia_ownergap1_log_quarantine('recorded_owners', pk::text, 'name', name, 'ownergap1_20260914')
from backfill;

update recorded_owners
set fabrication_quarantined_at = now(),
    fabrication_quarantine_reason = case
      when lower(btrim(name)) = 'unknown' then 'unstated_placeholder'
      else 'fabricated_placeholder'
    end
where dia_is_fabricated_placeholder_owner(name);

with backfill as (
  select true_owner_id as pk, name from true_owners where dia_is_fabricated_placeholder_owner(name)
)
select dia_ownergap1_log_quarantine('true_owners', pk::text, 'name', name, 'ownergap1_20260914')
from backfill;

update true_owners
set fabrication_quarantined_at = now(),
    fabrication_quarantine_reason = case
      when lower(btrim(name)) = 'unknown' then 'unstated_placeholder'
      else 'fabricated_placeholder'
    end
where dia_is_fabricated_placeholder_owner(name);

create or replace function dia_ownergap1_recorded_owner_name_guard()
returns trigger
language plpgsql
as $$
begin
  if dia_is_fabricated_placeholder_owner(new.name) then
    perform dia_ownergap1_log_quarantine('recorded_owners', new.recorded_owner_id::text, 'name',
                                          new.name, 'ownergap1_live_guard');
    new.fabrication_quarantined_at := now();
    new.fabrication_quarantine_reason := case
      when lower(btrim(new.name)) = 'unknown' then 'unstated_placeholder'
      else 'fabricated_placeholder'
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dia_ownergap1_recorded_owner_name_guard on recorded_owners;
create trigger trg_dia_ownergap1_recorded_owner_name_guard
  before insert or update of name on recorded_owners
  for each row execute function dia_ownergap1_recorded_owner_name_guard();

create or replace function dia_ownergap1_true_owner_name_guard()
returns trigger
language plpgsql
as $$
begin
  if dia_is_fabricated_placeholder_owner(new.name) then
    perform dia_ownergap1_log_quarantine('true_owners', new.true_owner_id::text, 'name',
                                          new.name, 'ownergap1_live_guard');
    new.fabrication_quarantined_at := now();
    new.fabrication_quarantine_reason := case
      when lower(btrim(new.name)) = 'unknown' then 'unstated_placeholder'
      else 'fabricated_placeholder'
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dia_ownergap1_true_owner_name_guard on true_owners;
create trigger trg_dia_ownergap1_true_owner_name_guard
  before insert or update of name on true_owners
  for each row execute function dia_ownergap1_true_owner_name_guard();

-- ── 7. properties link guard — the loophole closer. ───────────────────────────────────────────
-- Even with §6's flags in place, nothing stopped a future write from setting
-- properties.recorded_owner_id / true_owner_id to a row that carries the flag. This is the one
-- place the migration touches `properties`, and it never assigns a name -- it only refuses to
-- let a `properties` owner FK point at a row already known to be a FABRICATED placeholder,
-- falling back to NULL (render "owner unknown", never a guessed name).
--
-- ⚠️ SCOPED TO reason = 'fabricated_placeholder' ONLY, not 'unstated_placeholder'. Discovered
-- live while verifying this migration: the single recorded_owners row literally named "Unknown"
-- IS referenced by 23 real properties today (the true_owners "Unknown" row and every XYZ/ABC
-- row on both tables have 0 references, exactly as expected). That "Unknown" row is a real,
-- already-in-use sentinel some other process wrote, not gpt-4o template fabrication -- severing
-- 23 live property links as a side effect of a migration about STOPPING FABRICATION would be
-- exactly the undisclosed blast-radius mistake this repo's playbook warns about repeatedly, and
-- is out of OWNERGAP1's scope ("don't backfill recorded_owner_id/true_owner_id from this
-- investigation"). Those 23 keep their existing link untouched; the "Unknown" row itself still
-- carries the flag columns from §6, so any future *display/consumption* code can choose to
-- render it as "owner unknown" without this migration deciding that for it.
create or replace function dia_ownergap1_property_owner_link_guard()
returns trigger
language plpgsql
as $$
declare
  v_recorded_reason text;
  v_true_reason text;
begin
  if new.recorded_owner_id is not null then
    select fabrication_quarantine_reason into v_recorded_reason
    from recorded_owners where recorded_owner_id = new.recorded_owner_id;
    if v_recorded_reason = 'fabricated_placeholder' then
      new.recorded_owner_id := null;
    end if;
  end if;
  if new.true_owner_id is not null then
    select fabrication_quarantine_reason into v_true_reason
    from true_owners where true_owner_id = new.true_owner_id;
    if v_true_reason = 'fabricated_placeholder' then
      new.true_owner_id := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dia_ownergap1_property_owner_link_guard on properties;
create trigger trg_dia_ownergap1_property_owner_link_guard
  before insert or update of recorded_owner_id, true_owner_id on properties
  for each row execute function dia_ownergap1_property_owner_link_guard();

-- ── 8. Reversal. ───────────────────────────────────────────────────────────────────────────────
create or replace function dia_ownergap1_restore_quarantine(p_batch_tag text)
returns table(restored_count integer)
language plpgsql
as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select * from dia_ownergap1_fabrication_quarantine
    where batch_tag = p_batch_tag and restored_at is null
  loop
    if r.source_table = 'tax_records' then
      update tax_records
      set mailing_owner = r.quarantined_value,
          fabrication_quarantined_at = null,
          fabrication_quarantine_reason = null
      where id::text = r.source_pk;
    elsif r.source_table = 'entity_registry_records' then
      update entity_registry_records
      set fabrication_quarantined_at = null,
          fabrication_quarantine_reason = null
      where id::text = r.source_pk;
    elsif r.source_table = 'recorded_owners' then
      update recorded_owners
      set fabrication_quarantined_at = null,
          fabrication_quarantine_reason = null
      where recorded_owner_id::text = r.source_pk;
    elsif r.source_table = 'true_owners' then
      update true_owners
      set fabrication_quarantined_at = null,
          fabrication_quarantine_reason = null
      where true_owner_id::text = r.source_pk;
    end if;

    update dia_ownergap1_fabrication_quarantine
    set restored_at = now()
    where id = r.id;

    v_count := v_count + 1;
  end loop;

  return query select v_count;
end;
$$;

comment on function dia_ownergap1_restore_quarantine(text) is
  'OWNERGAP1: reverse a quarantine batch -- restores tax_records.mailing_owner and clears the '
  'flag columns on entity_registry_records/recorded_owners/true_owners for every row logged '
  'under batch_tag, then marks the log rows restored_at so a second call is a no-op.';

notify pgrst, 'reload schema';
