-- LEASEJUNK1 — OM / CoStar table-header text landing in leases.tenant.
--
-- Found on property 29671 (311 140th St S, Tacoma WA): four lease rows whose `tenant` is the
-- column header / summary label of a tenants table, not a tenant — "Type", "Shopping Center",
-- "Strip Center", "Avail. Spaces". One of them (lease_id 18398, "Avail. Spaces") was
-- is_active = true and status = 'active', i.e. rendering as the property's live tenant.
--
-- ⚠️ MECHANISM (measured, not assumed). The rows are tagged data_source='email_intake', but the
-- OM extraction behind them is clean — every Tacoma staged_intake_extractions snapshot carries
-- tenant_name = "Total Renal Care, Inc (dba DaVita)". The header strings came from the ENTITY's
-- metadata.tenants[] array, which the Chrome extension fills from CoStar's Tenants panel; that
-- parse interleaves the panel's headers ("Type"), summary rows ("Total Avail", "Asking") and
-- cell values ("Chain", "Yes") with real tenants (live examples in entities.metadata today).
-- The OM promote (api/intake.js) MERGES into that entity's metadata and sets
-- _intake_promoted=true, so sidebar-pipeline.js upsertDomainLeases iterated the stale CoStar
-- tenants[] and stamped every row 'email_intake'. The shared lease/rent/date values (2012-01-01 /
-- 2029-02-28 / $31.69 psf) are the property-level metadata fallbacks, which is why all four
-- rows carry the real DaVita lease's term. The writer is upsertDomainLeases; its isJunkTenant()
-- guard did not know these strings. The JS guard is fixed in the same change.
--
-- Fleet-wide size (2026-09-22, dia zqzrriwuavgrquhisnoa, exact normalized match on the list in
-- §1): 25 distinct values / 56 rows / 25 properties / 1 active. 41 of the 56 are costar_sidebar,
-- 4 email_intake (Tacoma), and 15 were already superseded. A broader "<= 2 tokens and no
-- operator name" heuristic matches 189 rows / 14 active, but that population is dominated by
-- REAL retail tenants (Subway, Publix, AutoZone, Dollar Tree) and is NOT touched here.
-- ⚠️ The existing JS isJunkTenant() was NOT used to size or quarantine: run over all 3,391
-- distinct tenant values it also flags real clinics ("Renal Treatment Centers Southeast, LP",
-- "Davita Jersey City Grand Home At Home"), so it is a write-time filter, not a backfill key.
--
-- Rent-box exposure checked: only the 4 Tacoma rows carry lease_start + rent_per_sf, and all 4
-- are byte-identical (lease_start, leased_area, rent_per_sf) to the real DaVita lease on the same
-- property, which cm_dialysis_rent_box_q collapses via SELECT DISTINCT — no CM book value moves.
--
-- Discipline (the OWNERGAP1 pattern): quarantine, never delete. Each row keeps its tenant text;
-- it gains data_quality_flag = 'om_table_header_tenant', is_active = false and
-- status = 'quarantined_header_tenant' (so both "is it active" tests the app uses fail), with
-- the prior is_active/status/flag logged. Idempotent (a flagged row is never re-logged).
--
-- REVERSAL RUNBOOK:
--   select * from dia_leasejunk1_restore_quarantine('leasejunk1_20260922');
--   -- restores is_active / status / data_quality_flag from the log for that batch and stamps
--   -- restored_at, so a second call is a no-op. The write guard (§4) would re-flag a restored
--   -- row on its next tenant/status/is_active write (the restore itself bypasses it via a
--   -- transaction-local setting); to remove it:
--   --   drop trigger dia_leasejunk1_header_tenant_guard_biu on leases;

-- ── 1. The single detector. Exact match after normalization, never a substring. ─────────────
-- Normalization: trim, lower, collapse whitespace, drop trailing ':' / '.'. Internal punctuation
-- is kept, so "Avail. Spaces" normalizes to "avail. spaces" and "Tenant:" to "tenant".
-- The list is mirrored byte-for-byte by OM_TABLE_HEADER_TENANTS in
-- api/_handlers/sidebar-pipeline.js; test/leasejunk1-header-tenant-guard.test.mjs fails if the
-- two lists drift. Edit both together.
create or replace function dia_normalize_header_candidate(p_value text)
returns text
language sql
immutable
as $$
  select regexp_replace(regexp_replace(lower(btrim(p_value)), '\s+', ' ', 'g'), '[:.\s]+$', '')
$$;

create or replace function dia_is_om_table_header_tenant(p_value text)
returns boolean
language sql
immutable
as $$
  select p_value is not null
     and dia_normalize_header_candidate(p_value) = any (array[
       -- rent-roll / tenant-table column headers
       'type', 'tenant', 'tenant name', 'tenants', 'suite', 'unit', 'sq ft', 'sq. ft', 'sf', 'rsf',
       'size', 'rent', 'annual rent', 'monthly rent', 'base rent', 'rent/sf', 'rent psf', 'term',
       'lease term', 'lease start', 'lease end', 'lease expiration', 'lease exp', 'commencement',
       'expiration', 'notes', 'comments', 'options', 'renewal options', 'increases', 'escalations',
       '% of gla', 'pro rata share', 'lease type', 'avail. spaces', 'avail spaces', 'available spaces',
       -- CoStar panel headers / summary rows / section labels
       'shopping center', 'strip center', 'total avail', 'office/med avail', 'office/ret avail',
       'retail avail', 'asking', 'anchor', 'anchors', 'sale highlights', 'sale broker',
       'recorded owner', 'property contacts', 'store type', 'analytics', 'starting', 'financials',
       'loan', 'about the architect', 'public transportation', 'commuter rail', 'services',
       -- lease-type cell values read as a tenant
       'triple net', 'double net', 'absolute net', 'full service', 'modified gross', 'cam', 'nnn'
     ]::text[])
$$;

comment on function dia_is_om_table_header_tenant(text) is
  'LEASEJUNK1: true when a leases.tenant value is an OM rent-roll / CoStar tenants-table header, '
  'summary label or lease-type cell value (exact match after normalization). Single SQL detector; '
  'mirrored by OM_TABLE_HEADER_TENANTS in api/_handlers/sidebar-pipeline.js.';

-- ── 2. Additive flag column (same name/convention as facility_patient_counts). ──────────────
alter table leases add column if not exists data_quality_flag text;
comment on column leases.data_quality_flag is
  'Quarantine marker. NULL = clean. ''om_table_header_tenant'' (LEASEJUNK1) = tenant is table '
  'header text; row is kept for audit, forced inactive, and excluded by app readers.';

-- ── 3. Reversible quarantine log. ──────────────────────────────────────────────────────────
create table if not exists dia_leasejunk1_quarantine_log (
  id              bigserial primary key,
  batch_tag       text        not null,
  lease_id        bigint      not null,
  property_id     bigint,
  tenant          text,
  prior_is_active boolean,
  prior_status    text,
  prior_flag      text,
  quarantined_at  timestamptz not null default now(),
  restored_at     timestamptz
);
create unique index if not exists ux_dia_leasejunk1_log_open
  on dia_leasejunk1_quarantine_log (lease_id) where restored_at is null;

-- ── 4. Write-time guard: no writer (JS, Python, SQL) can land an ACTIVE header tenant. ──────
-- Flags and deactivates; never raises, so one junk row cannot abort an ingestion batch. Named to
-- sort before dia_reject_dateless_active_lease so it runs first among BEFORE triggers.
create or replace function dia_leasejunk1_header_tenant_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- dia_leasejunk1_restore_quarantine sets this for its own transaction only.
  if current_setting('dia.leasejunk1_restoring', true) = 'on' then
    return new;
  end if;
  if dia_is_om_table_header_tenant(new.tenant) then
    new.data_quality_flag := 'om_table_header_tenant';
    new.is_active := false;
    new.status := 'quarantined_header_tenant';
  end if;
  return new;
end;
$$;

drop trigger if exists dia_leasejunk1_header_tenant_guard_biu on leases;
create trigger dia_leasejunk1_header_tenant_guard_biu
  before insert or update of tenant, is_active, status on leases
  for each row execute function dia_leasejunk1_header_tenant_guard();

-- ── 5. Keep a flagged row from filling a blank properties.tenant. ──────────────────────────
-- Body is the deployed definition (read 2026-09-22) plus the one early return.
create or replace function public.trg_leases_propagate_tenant_to_property()
returns trigger
language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  if new.property_id is null then return new; end if;
  -- LEASEJUNK1: a quarantined header-text tenant must never become the property's tenant.
  if new.data_quality_flag is not null then return new; end if;

  update public.properties p
  set
    tenant   = coalesce(p.tenant,   nullif(btrim(new.tenant), '')),
    operator = coalesce(p.operator, nullif(btrim(new.operator), ''))
  where p.property_id = new.property_id
    and (
      (p.tenant   is null and new.tenant   is not null and btrim(new.tenant)   <> '') or
      (p.operator is null and new.operator is not null and btrim(new.operator) <> '')
    );
  return new;
end;
$function$;

-- ── 6. Backfill: log, then quarantine (the guard trigger sets the three columns). ───────────
insert into dia_leasejunk1_quarantine_log
  (batch_tag, lease_id, property_id, tenant, prior_is_active, prior_status, prior_flag)
select 'leasejunk1_20260922', l.lease_id, l.property_id, l.tenant, l.is_active, l.status, l.data_quality_flag
from leases l
where dia_is_om_table_header_tenant(l.tenant)
  and l.data_quality_flag is distinct from 'om_table_header_tenant'
on conflict do nothing;

update leases l
set status = 'quarantined_header_tenant',
    is_active = false,
    data_quality_flag = 'om_table_header_tenant'
where dia_is_om_table_header_tenant(l.tenant)
  and l.data_quality_flag is distinct from 'om_table_header_tenant';

-- ── 7. Restore. ─────────────────────────────────────────────────────────────────────────────
create or replace function dia_leasejunk1_restore_quarantine(p_batch_tag text)
returns table (lease_id bigint, restored boolean)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  -- The guard would immediately re-flag a restored row; bypass it for this transaction only.
  perform set_config('dia.leasejunk1_restoring', 'on', true);
  return query
  with r as (
    update leases l
    set is_active = g.prior_is_active,
        status = g.prior_status,
        data_quality_flag = g.prior_flag
    from dia_leasejunk1_quarantine_log g
    where g.batch_tag = p_batch_tag and g.restored_at is null and g.lease_id = l.lease_id
    returning l.lease_id
  ), m as (
    update dia_leasejunk1_quarantine_log g set restored_at = now()
    from r where g.lease_id = r.lease_id and g.batch_tag = p_batch_tag and g.restored_at is null
    returning g.lease_id
  )
  select m.lease_id, true from m;
  perform set_config('dia.leasejunk1_restoring', 'off', true);
end;
$$;

revoke all on function dia_leasejunk1_restore_quarantine(text) from public, anon, authenticated;
revoke all on table dia_leasejunk1_quarantine_log from anon, authenticated;
alter table dia_leasejunk1_quarantine_log enable row level security;

do $$
begin
  if has_function_privilege('anon', 'dia_leasejunk1_restore_quarantine(text)', 'execute')
     or has_function_privilege('authenticated', 'dia_leasejunk1_restore_quarantine(text)', 'execute') then
    raise exception 'LEASEJUNK1: restore function still executable by anon/authenticated';
  end if;
end $$;
