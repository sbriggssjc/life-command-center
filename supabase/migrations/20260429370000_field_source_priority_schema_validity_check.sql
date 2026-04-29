-- Schema-validity check for field_source_priority (2026-04-29).
--
-- Catches a class of bug where rules are registered for (target_table,
-- field_name) tuples whose column doesn't actually exist on the target
-- table. Surfaced repeatedly during the 2026-04-29 audit:
--   - dia.properties.land_acres (column is land_area on dia)
--   - dia.contacts.{email,phone}    (columns are contact_email/contact_phone)
--   - gov.contacts.{contact_email,contact_name}   (columns are email/name)
--   - gov.available_listings.{initial_price,last_price,
--                             current_cap_rate,initial_cap_rate}
--                              (columns are asking_price/asking_cap_rate/
--                               asking_price_psf)
-- All of those rules silently produced zero field_provenance writes
-- because the underlying column doesn't exist.
--
-- Approach:
-- 1. Cache table `domain_table_columns` mirrors information_schema.columns
--    from each domain DB (dia, gov), keyed by the qualified table name
--    used in field_source_priority (e.g. 'dia.properties').
-- 2. View `v_field_source_priority_invalid_columns` left-joins
--    field_source_priority against the cache; any rule with no matching
--    column row is a registration typo.
-- 3. Cache refresh is driven by a separate GH Actions workflow that
--    calls `list_public_columns()` on each domain DB (RPCs added in
--    matching dia/gov migrations) and POSTs the result to LCC Opps.
--    Cron-based refresh via pg_net would also work — we go with GH
--    Actions for symmetry with the address-normalize-drift-check
--    pattern (PR #495).

create table if not exists public.domain_table_columns (
  target_table   text        not null,   -- 'dia.properties' / 'gov.contacts'
  column_name    text        not null,
  data_type      text,
  recorded_at    timestamptz not null default now(),
  primary key (target_table, column_name)
);

comment on table public.domain_table_columns is
  'Cache of public-schema column names from each domain DB (dia + gov). Refreshed by a daily GH workflow that calls list_public_columns() on each domain DB. Used by v_field_source_priority_invalid_columns to surface registration typos.';

create or replace view public.v_field_source_priority_invalid_columns as
with cached_tables as (
  -- Tables we've actually cached. Without this guard, an empty or
  -- partially-refreshed cache makes every rule look invalid because
  -- NOT EXISTS evaluates true on an empty cache.
  select distinct target_table
    from public.domain_table_columns
), domain_rules as (
  select fsp.*
    from public.field_source_priority fsp
    join cached_tables ct using (target_table)
   where fsp.target_table ~ '^(dia|gov)\.'
)
select
  r.target_table,
  r.field_name,
  r.source,
  r.priority,
  r.enforce_mode,
  r.notes,
  r.updated_at,
  -- Helpful hint: list close-named columns on the same table so the fix
  -- is obvious from the audit row alone.
  ( select string_agg(c.column_name, ', ' order by c.column_name)
      from public.domain_table_columns c
     where c.target_table = r.target_table
       and (
         c.column_name ilike '%' || r.field_name || '%'
         or r.field_name ilike '%' || c.column_name || '%'
       )
       and c.column_name <> r.field_name
  ) as nearby_columns
from domain_rules r
where not exists (
  select 1 from public.domain_table_columns c
   where c.target_table = r.target_table
     and c.column_name  = r.field_name
);

comment on view public.v_field_source_priority_invalid_columns is
  'field_source_priority rules pointing at columns that do not exist on the target table. Refreshes when domain_table_columns is reseeded. Non-empty result = registration typo; check the nearby_columns hint for the likely correct field_name. Should be empty under healthy operation.';

-- Refresh RPC. Takes a domain prefix ('dia' or 'gov') and an array of
-- {table_name, column_name, data_type} rows; replaces all cache entries
-- for tables in that domain. The workflow calls this once per domain
-- DB after pulling list_public_columns() from each.
create or replace function public.refresh_domain_table_columns(
  p_domain  text,             -- 'dia' or 'gov'
  p_columns jsonb             -- jsonb array of {table_name,column_name,data_type}
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_prefix text;
begin
  if p_domain not in ('dia', 'gov') then
    raise exception 'refresh_domain_table_columns: domain must be ''dia'' or ''gov'', got %', p_domain;
  end if;
  if jsonb_typeof(p_columns) is distinct from 'array' then
    raise exception 'refresh_domain_table_columns: p_columns must be a jsonb array';
  end if;

  v_prefix := p_domain || '.';

  -- Atomic replace: drop the domain's old rows, insert the fresh ones.
  delete from public.domain_table_columns where target_table like v_prefix || '%';

  insert into public.domain_table_columns (target_table, column_name, data_type)
  select v_prefix || (e->>'table_name'),
         e->>'column_name',
         e->>'data_type'
    from jsonb_array_elements(p_columns) e
  on conflict (target_table, column_name) do update
    set data_type   = excluded.data_type,
        recorded_at = now();

  get diagnostics v_count = row_count;
  return jsonb_build_object(
    'domain', p_domain,
    'rows_inserted', v_count,
    'refreshed_at', now()
  );
end;
$$;

revoke all on function public.refresh_domain_table_columns(text, jsonb) from public;
-- service_role only — anon/authenticated should not be able to overwrite
-- the cache. The GH Actions workflow uses the service_role key.
grant execute on function public.refresh_domain_table_columns(text, jsonb) to service_role;

comment on function public.refresh_domain_table_columns(text, jsonb) is
  'Atomically replaces domain_table_columns entries for one domain (''dia'' or ''gov''). Called by the daily field-source-priority-schema-validity GH workflow after pulling list_public_columns() from the matching Supabase project.';
