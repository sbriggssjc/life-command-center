-- RECON3 — measure + (dry-run-default) repair Salesforce record ids that were
-- written into NAME fields instead of being resolved to the record's real
-- Name first. Dialysis_DB (zqzrriwuavgrquhisnoa).
--
-- CONTEXT. Filed 2026-09-22 against property_id 27266 (175 Righter Rd,
-- Succasunna NJ, DaVita) — a Salesforce Account ID ("001…", 18 chars) was
-- found stored as a buyer/owner NAME on that property's records. The JS-side
-- write-path fix (a shared resolve-or-drop guard,
-- api/_shared/sf-account-name-resolver.js, wired into ensureEntityLink() and
-- sidebar-pipeline.js's isJunkSalesParty()) stops the defect going forward.
-- This migration is the measurement + repair half for what ALREADY landed.
--
-- ⚠️ NOT APPLIED LIVE. This session has no egress to Supabase (sandboxed, no
-- DB access) — see docs/claude-code/STATUS.md / the RECON3 handoff note for
-- who runs this and when. Written to the same dry-run-default / provenance /
-- reversible / idempotent contract every other migration in this directory
-- follows (see e.g. 20261010120000_dia_ownergap2_owner_resolution_ledger.sql)
-- so it is ready to run as-is once someone with live access reviews it.
--
-- SCOPE. dia (Dialysis_DB) ONLY. Per this repo's CLAUDE.md ownership table
-- ("🗄️ ONE REPO OWNS EACH DATABASE'S OBJECTS", Scott 2026-09-12), the
-- government database's schema is owned by the government-lease repo — a
-- parallel migration for gov.recorded_owners / gov.sales_transactions (which
-- may carry the identical defect; RECON3 named property 27266 on Dialysis_DB
-- specifically, so gov was never measured here) must be filed THERE, not in
-- this repo. This migration's detector function is written so the gov
-- equivalent can copy its SQL body verbatim onto gov's schema names.
--
-- WHAT COUNTS AS "AN SF ID SHAPE". A real 15/18-char Salesforce record id is
-- pure base62 (alphanumeric, no spaces/punctuation) with a recognized 3-char
-- key prefix (001=Account, 003=Contact, 00Q=Lead, 006=Opportunity,
-- 005=User) — mirrors api/_shared/sf-id.js::classifySfId /
-- api/_shared/sf-account-name-resolver.js::looksLikeRawSalesforceId. A plain
-- length check alone is NOT enough: "DaVita Kidney Care" is coincidentally
-- 18 characters, so the detector below requires alphanumeric-only AND a
-- recognized prefix, same as the JS guard (caught by that guard's own test
-- suite before this migration was written).
--
-- FIELDS MEASURED (per the RECON3 prompt): recorded_owners.name,
-- recorded_owners.normalized_name (dia's canonical-name analogue — dia has
-- no separate `canonical_name` column on recorded_owners; see the schema
-- note in `dia_ownergap2_resolution_log`'s header for the same distinction),
-- sales_transactions.buyer_name, sales_transactions.seller_name.
-- true_owners.name is measured too (dia's other owner-name-bearing table,
-- and the one `sidebar-pipeline.js` writes most directly from SF-linked
-- flows) — not named in the prompt but the identical write-path risk.
--
-- DISCIPLINE: fill-blanks-only is not applicable here (a repair must REMOVE
-- an opaque id, not add anything) — instead: never overwrite with a guess,
-- snapshot-before-clear (reversible), provenance-tagged (batch_tag), dry-run
-- default, idempotent (re-run over already-repaired rows is a no-op).
--
-- REVERSAL RUNBOOK:
--   select * from dia_recon3_restore_sf_id_names('<batch_tag>');
--   -- Restores every row this batch cleared, from the backup table, and
--   -- marks the backup rows restored. Never deletes the backup.
--   -- To remove the lane entirely:
--   --   drop function dia_recon3_restore_sf_id_names(text);
--   --   drop function dia_recon3_clear_sf_id_names(boolean, text, int);
--   --   drop view v_dia_recon3_sf_id_as_name;
--   --   drop table dia_recon3_sf_id_name_backup;
-- ============================================================================

-- ── 1. The shape detector (SQL mirror of the JS guard) ──────────────────────
create or replace function dia_recon3_looks_like_sf_id(p_value text)
returns boolean
language sql
immutable
as $$
  select p_value is not null
    and p_value ~ '^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$'
    and length(p_value) in (15, 18)
    and left(p_value, 3) in ('001', '003', '00Q', '006', '005');
$$;

comment on function dia_recon3_looks_like_sf_id(text) is
  'RECON3: true when p_value is shaped like a raw Salesforce record id '
  '(15/18-char base62, recognized key prefix). Mirrors '
  'api/_shared/sf-account-name-resolver.js::looksLikeRawSalesforceId. '
  'A shape match, not a liveness check — does not confirm the id resolves '
  'to anything in Salesforce or in LCC.';

-- ── 2. Blast-radius measurement view — read-only, safe to run any time ──────
create or replace view v_dia_recon3_sf_id_as_name as
  select 'recorded_owners' as table_name, 'name' as field_name,
         recorded_owner_id::text as record_pk, name as bad_value
    from recorded_owners
   where dia_recon3_looks_like_sf_id(name)
  union all
  select 'recorded_owners', 'normalized_name',
         recorded_owner_id::text, normalized_name
    from recorded_owners
   where dia_recon3_looks_like_sf_id(normalized_name)
  union all
  select 'true_owners', 'name',
         true_owner_id::text, name
    from true_owners
   where dia_recon3_looks_like_sf_id(name)
  union all
  select 'sales_transactions', 'buyer_name',
         sale_id::text, buyer_name
    from sales_transactions
   where dia_recon3_looks_like_sf_id(buyer_name)
  union all
  select 'sales_transactions', 'seller_name',
         sale_id::text, seller_name
    from sales_transactions
   where dia_recon3_looks_like_sf_id(seller_name);

comment on view v_dia_recon3_sf_id_as_name is
  'RECON3 blast-radius measurement: every recorded_owners/true_owners/'
  'sales_transactions name-field value shaped like a raw Salesforce record '
  'id. Read-only. SELECT count(*) FROM v_dia_recon3_sf_id_as_name GROUP BY '
  'table_name, field_name; before running the backfill, to know the size '
  'BEFORE acting on it (this file makes no claim about the count — it was '
  'never measured live from this sandbox).';

-- ── 3. Reversible backup table ───────────────────────────────────────────────
create table if not exists dia_recon3_sf_id_name_backup (
  id            bigserial primary key,
  batch_tag     text        not null,
  table_name    text        not null,
  field_name    text        not null,
  record_pk     text        not null,
  prior_value   text        not null,
  cleared_at    timestamptz not null default now(),
  restored_at   timestamptz
);

create index if not exists idx_dia_recon3_backup_batch
  on dia_recon3_sf_id_name_backup (batch_tag)
  where restored_at is null;

comment on table dia_recon3_sf_id_name_backup is
  'RECON3: snapshot of every name-field value dia_recon3_clear_sf_id_names() '
  'cleared, so it can be restored via dia_recon3_restore_sf_id_names(). '
  'Never auto-pruned.';

-- ── 4. The repair function — dry-run default, idempotent ────────────────────
-- Never guesses a real name. It only ever NULLs the field (records the
-- pre-clear value in the backup table first), leaving the name blank for a
-- human/downstream resolver to fill properly — mirrors the JS write-time
-- guard's "resolve or drop, never write the opaque id" behavior.
create or replace function dia_recon3_clear_sf_id_names(
  p_dry_run  boolean default true,
  p_batch_tag text   default null,
  p_limit    int     default null
)
returns table (
  table_name  text,
  field_name  text,
  record_pk   text,
  prior_value text,
  would_clear boolean
)
language plpgsql
as $$
declare
  v_batch text := coalesce(p_batch_tag, 'recon3_' || to_char(now(), 'YYYYMMDD_HH24MISS'));
  v_row record;
  v_count int := 0;
begin
  for v_row in
    select * from v_dia_recon3_sf_id_as_name
    order by table_name, field_name, record_pk
    limit p_limit
  loop
    if p_limit is not null and v_count >= p_limit then
      exit;
    end if;
    v_count := v_count + 1;

    table_name  := v_row.table_name;
    field_name  := v_row.field_name;
    record_pk   := v_row.record_pk;
    prior_value := v_row.bad_value;
    would_clear := not p_dry_run;
    return next;

    if not p_dry_run then
      insert into dia_recon3_sf_id_name_backup
        (batch_tag, table_name, field_name, record_pk, prior_value)
      values (v_batch, v_row.table_name, v_row.field_name, v_row.record_pk, v_row.bad_value);

      if v_row.table_name = 'recorded_owners' and v_row.field_name = 'name' then
        update recorded_owners set name = null
         where recorded_owner_id = v_row.record_pk::uuid
           and dia_recon3_looks_like_sf_id(name); -- idempotency guard
      elsif v_row.table_name = 'recorded_owners' and v_row.field_name = 'normalized_name' then
        update recorded_owners set normalized_name = null
         where recorded_owner_id = v_row.record_pk::uuid
           and dia_recon3_looks_like_sf_id(normalized_name);
      elsif v_row.table_name = 'true_owners' and v_row.field_name = 'name' then
        update true_owners set name = null
         where true_owner_id = v_row.record_pk::uuid
           and dia_recon3_looks_like_sf_id(name);
      elsif v_row.table_name = 'sales_transactions' and v_row.field_name = 'buyer_name' then
        update sales_transactions set buyer_name = null
         where sale_id = v_row.record_pk::bigint
           and dia_recon3_looks_like_sf_id(buyer_name);
      elsif v_row.table_name = 'sales_transactions' and v_row.field_name = 'seller_name' then
        update sales_transactions set seller_name = null
         where sale_id = v_row.record_pk::bigint
           and dia_recon3_looks_like_sf_id(seller_name);
      end if;
    end if;
  end loop;

  return;
end;
$$;

comment on function dia_recon3_clear_sf_id_names(boolean, text, int) is
  'RECON3: dry-run-default (p_dry_run=true) repair. Clears (never guesses a '
  'replacement for) any recorded_owners.{name,normalized_name} / '
  'true_owners.name / sales_transactions.{buyer_name,seller_name} value '
  'shaped like a raw Salesforce record id, snapshotting the prior value to '
  'dia_recon3_sf_id_name_backup first. Idempotent: a row already cleared no '
  'longer matches the detector and is not touched again. '
  'Call with p_dry_run=false to actually write; review the returned rows '
  'first.';

-- ── 5. Reversal ───────────────────────────────────────────────────────────
create or replace function dia_recon3_restore_sf_id_names(p_batch_tag text)
returns table (
  table_name  text,
  field_name  text,
  record_pk   text,
  restored    boolean
)
language plpgsql
as $$
declare
  v_row record;
begin
  for v_row in
    select * from dia_recon3_sf_id_name_backup
     where batch_tag = p_batch_tag and restored_at is null
  loop
    table_name := v_row.table_name;
    field_name := v_row.field_name;
    record_pk  := v_row.record_pk;
    restored   := false;

    if v_row.table_name = 'recorded_owners' and v_row.field_name = 'name' then
      update recorded_owners set name = v_row.prior_value
       where recorded_owner_id = v_row.record_pk::uuid and name is null;
      get diagnostics restored = row_count;
    elsif v_row.table_name = 'recorded_owners' and v_row.field_name = 'normalized_name' then
      update recorded_owners set normalized_name = v_row.prior_value
       where recorded_owner_id = v_row.record_pk::uuid and normalized_name is null;
      get diagnostics restored = row_count;
    elsif v_row.table_name = 'true_owners' and v_row.field_name = 'name' then
      update true_owners set name = v_row.prior_value
       where true_owner_id = v_row.record_pk::uuid and name is null;
      get diagnostics restored = row_count;
    elsif v_row.table_name = 'sales_transactions' and v_row.field_name = 'buyer_name' then
      update sales_transactions set buyer_name = v_row.prior_value
       where sale_id = v_row.record_pk::bigint and buyer_name is null;
      get diagnostics restored = row_count;
    elsif v_row.table_name = 'sales_transactions' and v_row.field_name = 'seller_name' then
      update sales_transactions set seller_name = v_row.prior_value
       where sale_id = v_row.record_pk::bigint and seller_name is null;
      get diagnostics restored = row_count;
    end if;

    update dia_recon3_sf_id_name_backup
       set restored_at = now()
     where id = v_row.id and restored = true;

    return next;
  end loop;

  return;
end;
$$;

comment on function dia_recon3_restore_sf_id_names(text) is
  'RECON3 reversal: restores every row batch p_batch_tag cleared, from the '
  'backup table, ONLY where the field is still null (never overwrites a '
  'value that changed since the clear). Marks the backup row restored (not '
  'deleted) so a re-run is idempotent.';

-- ── 6. Provenance / privileges ───────────────────────────────────────────────
-- SEC1-definer-default: these are plain (non-SECURITY DEFINER) functions
-- running as the calling role, so no anon-grant stanza is required — they
-- carry whatever privileges the caller already has on the underlying tables.
