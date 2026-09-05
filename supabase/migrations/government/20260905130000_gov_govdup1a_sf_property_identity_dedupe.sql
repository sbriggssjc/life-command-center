-- ===========================================================================
-- GOVDUP1-a — the SF auto-create fan-out: a dedupe key on sf_property_id
-- gov (scknotsqkcheojiaewwh).  Applied live 2026-09-05.
--
-- THE WRITER, NAMED (GOVDUP1 recorded "producer NOT FOUND"):
--   Supabase edge function `intake-salesforce`, DEPLOYED VERSION 23
--   (PAYLOAD_VERSION "sf-2026-05-v8") on the **Dialysis_DB** project
--   zqzrriwuavgrquhisnoa -- NOT on gov, NOT on LCC Opps.
--   Path: handleCrawlComplete/handleLinkAll -> linkProbe(autoCreate=true)
--         -> autoCreateProperty()  [POST gov /rest/v1/properties]
--         -> logPendingUpdate()    [the '_new_property' advisory row]
--
--   It was invisible to every previous search because the COMMITTED source in
--   this repo (supabase/functions/intake-salesforce/index.ts, "sf-2026-05-v1")
--   contains NO auto-create path at all -- zero occurrences of
--   autoCreateProperty/auto_create.  GOVDUP1 read the repo file, correctly
--   concluded "no INSERT path into gov.properties", and was reading a
--   different program from the one that runs.  P194, exactly: the deployed
--   artifact is the writer and the repo is not a record of it.
--
-- THE DEFECT (the existing dedupe key is the bug, per the brief):
--   uq_sf_property_staging_dedup = (sf_property_id, source_system, import_batch)
--   `import_batch` is 'crawl_<ISO utcNow>' -- a NEW value every hourly crawl
--   (7-digit fractional seconds: a Power Automate timestamp, not Node's).
--   So the upsert can never collide across crawls: every hour the same SF
--   property lands as a FRESH staging row with linked_property_id NULL,
--   linkProbe selects on `linked_property_id=is.null`, the address match
--   fails, and autoCreateProperty mints ANOTHER gov property.
--   Measured 2026-09-05: 808 gov properties from 125 SF properties; 53 of
--   those fanned out into 736 rows (6.5x).
--
-- WHY THIS FIX AND NOT THE TWO ALTERNATIVES (brief §3):
--   Option 1 (unique index on the identity) was the preferred option and is
--   NOT AVAILABLE: gov.properties carries no SF identity column (measured --
--   the only 'sf' columns are sf_leased/gross_rent_psf/noi_psf/in_sfha), and
--   autoCreateProperty's INSERT payload (buildPropertyInsert) sends address/
--   city/state/zip/year_built/rba/agency/county and NOTHING that identifies
--   Salesforce.  A unique index on a column no writer populates is inert.
--   Populating it requires changing the writer -- and the writer is a drifted
--   deployment whose source is not in this repo, so redeploying it from `main`
--   would DELETE the auto-create feature and every other unmerged v2..v8
--   change.  That is a bigger, unreviewed blast radius than the defect.
--   Option 2 (lookup before insert keyed on sf_property_id) is correct, and is
--   what this migration implements -- but placed in the DATABASE rather than
--   in the caller, so it is writer-agnostic (P177: a trigger also covers SQL
--   writers, PA flows and the next producer, and cannot be bypassed).
--   The lookup point is `sf_property_staging` BEFORE INSERT, because that is
--   strictly AHEAD of the mint: pre-filling linked_property_id makes the row
--   fail linkProbe's own `linked_property_id=is.null` selection, so
--   autoCreateProperty is never reached.  Keying on sf_property_id and never
--   on the address is the whole point -- the address is exactly what varies
--   ('700 technology dr'/Charleston vs '700 Technology Dr'/South Charleston).
--
-- REVERSAL RUNBOOK:
--   drop trigger if exists trg_gov_sf_staging_identity_dedupe on public.sf_property_staging;
--   drop trigger if exists trg_gov_sf_staging_identity_record on public.sf_property_staging;
--   drop trigger if exists trg_gov_pending_new_property_identity on public.pending_updates;
--   drop function if exists public.gov_sf_staging_identity_dedupe();
--   drop function if exists public.gov_sf_staging_identity_record();
--   drop function if exists public.gov_pending_new_property_identity();
--   drop function if exists public.gov_sf_identity_record(text, bigint, text);
--   drop table if exists public.gov_sf_property_identity;
--   (and re-apply the pre-GOVDUP1-a body of expire_orphan_pending_updates,
--    which is unchanged except for the added archived-parent arm.)
-- ===========================================================================

-- ── 1. the durable identity map ────────────────────────────────────────────
-- One row per Salesforce Property__c id -> the canonical gov property.
-- Durable BECAUSE sf_property_staging is pruned (sf_staging_dedup_prune leaves
-- ~216 rows), so "look at the previous staging row" is not a key that survives.
create table if not exists public.gov_sf_property_identity (
  sf_property_id text primary key,
  property_id    bigint not null references public.properties(property_id) on delete cascade,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  source         text not null default 'govdup1a'
);

comment on table public.gov_sf_property_identity is
  'GOVDUP1-a: sf_property_id -> canonical gov property_id. The dedupe key for the '
  'Salesforce auto-create path (intake-salesforce v8 on Dialysis_DB). Keyed on the '
  'SF identity, never on the address -- the address is what varies.';

-- ── 2. single owner of "record this identity" (fill-blanks) ────────────────
create or replace function public.gov_sf_identity_record(
  p_sf_property_id text,
  p_property_id    bigint,
  p_source         text default 'govdup1a'
) returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if p_sf_property_id is null or btrim(p_sf_property_id) = '' or p_property_id is null then
    return;
  end if;
  -- FILL-BLANKS: the first identity recorded wins. Never re-point an existing
  -- mapping at a newer mint -- that is precisely how a fan-out would rotate its
  -- own canonical row and defeat the dedupe.
  insert into public.gov_sf_property_identity (sf_property_id, property_id, source)
  values (btrim(p_sf_property_id), p_property_id, p_source)
  on conflict (sf_property_id) do update
    set last_seen_at = now()
  where public.gov_sf_property_identity.property_id = excluded.property_id;
exception when others then
  -- fail-soft: an identity bookkeeping failure must never abort an ingest.
  null;
end;
$fn$;

revoke all on function public.gov_sf_identity_record(text, bigint, text) from public, anon, authenticated;
grant execute on function public.gov_sf_identity_record(text, bigint, text) to service_role;

-- ── 3. BACKFILL from the 808 advisory rows already on file ────────────────
-- Prefer a LIVE property; among ties take the earliest property_id (the first
-- mint, i.e. the one the later rows are duplicates OF).
insert into public.gov_sf_property_identity (sf_property_id, property_id, source)
select sf_id, property_id, 'govdup1a_backfill'
from (
  select distinct on (pu.source_context->>'sf_property_id')
         pu.source_context->>'sf_property_id' as sf_id,
         pu.property_id
    from public.pending_updates pu
    join public.properties p on p.property_id = pu.property_id
   where pu.field_name = '_new_property'
     and pu.property_id is not null
     and nullif(btrim(coalesce(pu.source_context->>'sf_property_id','')), '') is not null
   order by pu.source_context->>'sf_property_id',
            (coalesce(p.status,'') = 'archived') asc,   -- live first
            pu.property_id asc                           -- then earliest mint
) s
on conflict (sf_property_id) do nothing;

-- ── 4. THE DEDUPE: pre-link a staging row whose SF identity we already hold ─
create or replace function public.gov_sf_staging_identity_dedupe()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_pid bigint;
begin
  if new.linked_property_id is not null then
    return new;              -- already linked; nothing to decide
  end if;
  if new.sf_property_id is null or btrim(new.sf_property_id) = '' then
    return new;
  end if;

  select i.property_id into v_pid
    from public.gov_sf_property_identity i
   where i.sf_property_id = btrim(new.sf_property_id);

  if v_pid is null then
    return new;              -- genuinely new SF property: let it mint once
  end if;

  -- We have already minted a gov property for this Salesforce property.
  -- Pre-link so the auto-create path's own selection
  -- (`linked_property_id=is.null`) no longer sees this row.
  new.linked_property_id := v_pid;
  new.match_method       := 'sf_identity_dedupe';
  new.match_confidence   := 1.0;
  new.process_status     := 'linked';
  new.processed          := true;
  new.processed_at       := now();
  new.process_notes      := 'GOVDUP1-a: deduped on sf_property_id -> existing gov property '
                            || v_pid || ' (no new property minted)';
  return new;
end;
$fn$;

revoke all on function public.gov_sf_staging_identity_dedupe() from public, anon, authenticated;

drop trigger if exists trg_gov_sf_staging_identity_dedupe on public.sf_property_staging;
create trigger trg_gov_sf_staging_identity_dedupe
  before insert on public.sf_property_staging
  for each row execute function public.gov_sf_staging_identity_dedupe();

-- ── 5. keep the map current, from whichever writer links the row ───────────
create or replace function public.gov_sf_staging_identity_record()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if new.linked_property_id is not null then
    perform public.gov_sf_identity_record(new.sf_property_id, new.linked_property_id, 'sf_property_staging');
  end if;
  return null;
end;
$fn$;

revoke all on function public.gov_sf_staging_identity_record() from public, anon, authenticated;

drop trigger if exists trg_gov_sf_staging_identity_record on public.sf_property_staging;
create trigger trg_gov_sf_staging_identity_record
  after insert or update of linked_property_id on public.sf_property_staging
  for each row execute function public.gov_sf_staging_identity_record();

-- ── 6. belt-and-braces: the advisory row also carries the identity ─────────
-- autoCreateProperty PATCHes the staging row and separately POSTs the
-- '_new_property' advisory. If the staging PATCH fails (the deployed code
-- counts that as `patch_failed` and carries on), the advisory row is the only
-- surviving statement of "this SF property now has this gov property", so the
-- map learns from it too.
create or replace function public.gov_pending_new_property_identity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if new.field_name = '_new_property' and new.property_id is not null then
    perform public.gov_sf_identity_record(
      new.source_context->>'sf_property_id', new.property_id, 'pending_updates');
  end if;
  return null;
end;
$fn$;

revoke all on function public.gov_pending_new_property_identity() from public, anon, authenticated;

drop trigger if exists trg_gov_pending_new_property_identity on public.pending_updates;
create trigger trg_gov_pending_new_property_identity
  after insert on public.pending_updates
  for each row execute function public.gov_pending_new_property_identity();

-- ── 7. the auto-retire arm the husk cleanup needed (GOVDUP1-c, durable) ────
-- expire_orphan_pending_updates only ever resolved a `properties` advisory when
-- the property row DID NOT EXIST. GOVDUP1's retire ARCHIVED the parent -- the
-- row still exists -- so the sweep could never fire and 154 advisories sat
-- 'pending' forever against retired properties. This is the standing
-- auto-retire question (P182): what event sets this state false, and does
-- anything ever fire it? Now something does.
-- Measured before widening: the archived-parent population is 154 rows and
-- 100% field_name='_new_property' -- no other lane is swept in by this arm.
create or replace function public.expire_orphan_pending_updates()
 returns TABLE(table_name text, resolved integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_listings int;
  v_sales int;
  v_props int;
  v_props_archived int;
  v_leads int;
  v_sam int;
begin
  with x as (
    update public.pending_updates pu
       set status = 'auto_resolved', resolved_by = 'expire_orphan_pending_updates', resolved_at = now()
     where pu.status = 'pending' and pu.table_name = 'available_listings'
       and not exists (select 1 from public.available_listings al where al.listing_id::text = pu.record_id)
    returning 1
  ) select count(*) into v_listings from x;

  with x as (
    update public.pending_updates pu
       set status = 'auto_resolved', resolved_by = 'expire_orphan_pending_updates', resolved_at = now()
     where pu.status = 'pending' and pu.table_name = 'sales_transactions'
       and not exists (select 1 from public.sales_transactions st where st.sale_id::text = pu.record_id)
    returning 1
  ) select count(*) into v_sales from x;

  with x as (
    update public.pending_updates pu
       set status = 'auto_resolved', resolved_by = 'expire_orphan_pending_updates', resolved_at = now()
     where pu.status = 'pending' and pu.table_name = 'properties'
       and not exists (select 1 from public.properties p where p.property_id::text = pu.record_id)
    returning 1
  ) select count(*) into v_props from x;

  -- GOVDUP1-a: parent exists but has been RETIRED. The advisory ("verify this
  -- auto-created property") is moot once the property is archived. Reversible:
  -- flip status back to 'pending' keyed on resolved_by.
  with x as (
    update public.pending_updates pu
       set status = 'auto_resolved',
           resolved_by = 'expire_orphan_pending_updates:archived_parent',
           resolved_at = now(),
           resolution_notes = coalesce(pu.resolution_notes,
             'parent property archived; advisory retired by expire_orphan_pending_updates')
     where pu.status = 'pending' and pu.table_name = 'properties'
       and exists (select 1 from public.properties p
                    where p.property_id = pu.property_id and p.status = 'archived')
    returning 1
  ) select count(*) into v_props_archived from x;

  with x as (
    update public.pending_updates pu
       set status = 'auto_resolved', resolved_by = 'expire_orphan_pending_updates', resolved_at = now()
     where pu.status = 'pending' and pu.table_name = 'prospect_leads'
       and not exists (select 1 from public.prospect_leads pl where pl.lead_id::text = pu.record_id)
    returning 1
  ) select count(*) into v_leads from x;

  with x as (
    update public.pending_updates pu
       set status = 'auto_resolved', resolved_by = 'expire_orphan_pending_updates', resolved_at = now()
     where pu.status = 'pending' and pu.table_name = 'sam_lease_opportunities'
       and not exists (select 1 from public.sam_lease_opportunities slo where slo.opportunity_id::text = pu.record_id)
    returning 1
  ) select count(*) into v_sam from x;

  return query
  select 'available_listings'::text, v_listings union all
  select 'sales_transactions', v_sales union all
  select 'properties', v_props union all
  select 'properties_archived_parent', v_props_archived union all
  select 'prospect_leads', v_leads union all
  select 'sam_lease_opportunities', v_sam;
end;
$function$;

-- ── 8. the standing detector ───────────────────────────────────────────────
create or replace view public.v_gov_sf_property_fanout as
select m.sf_property_id,
       count(*)                                                              as gov_rows_minted,
       count(*) filter (where coalesce(p.status,'') <> 'archived')            as gov_rows_live,
       min(p.created_at)                                                     as first_mint_at,
       max(p.created_at)                                                     as last_mint_at,
       (select i.property_id from public.gov_sf_property_identity i
         where i.sf_property_id = m.sf_property_id)                          as canonical_property_id
  from (select distinct pu.source_context->>'sf_property_id' as sf_property_id,
                        pu.property_id
          from public.pending_updates pu
         where pu.field_name = '_new_property' and pu.property_id is not null) m
  join public.properties p on p.property_id = m.property_id
 group by m.sf_property_id;

comment on view public.v_gov_sf_property_fanout is
  'GOVDUP1-a verification surface. `gov_rows_live > 1` must be 0 -- one Salesforce '
  'property must never have more than one live gov property. Read gov_rows_live, '
  'never gov_rows_minted (the 808 historical mints are history, not a backlog).';

-- ── 9. SEC1-definer-default: ASSERT the revokes, never read them off the
--    REVOKE you just wrote. All four functions above are SECURITY DEFINER.
--    Note the two trigger functions are `returns trigger` and so are not
--    PostgREST-callable at all -- the revoke is defence in depth, and the
--    assertion is what proves it rather than the statement that requested it.
do $$
declare
  v_fn text;
  v_role text;
begin
  foreach v_fn in array array[
    'public.gov_sf_identity_record(text, bigint, text)',
    'public.gov_sf_staging_identity_dedupe()',
    'public.gov_sf_staging_identity_record()',
    'public.gov_pending_new_property_identity()'
  ] loop
    foreach v_role in array array['public','anon','authenticated'] loop
      if has_function_privilege(v_role, v_fn, 'EXECUTE') then
        raise exception
          'GOVDUP1-a: % is still EXECUTE-able by % after the revoke', v_fn, v_role;
      end if;
    end loop;
  end loop;

  -- positive control: the revoke must not have locked out the writer role too.
  if not has_function_privilege('service_role',
        'public.gov_sf_identity_record(text, bigint, text)', 'EXECUTE') then
    raise exception 'GOVDUP1-a: service_role lost EXECUTE on gov_sf_identity_record';
  end if;
end $$;
