-- ============================================================================
-- 20260729150000_users_display_name_selfheal_trigger.sql   (OPS xengecqvemvfknjvbvrq)
-- Applied live 2026-07-29. Self-healing backstop against the "everyone is Scott Briggs"
-- users-registry pollution (root cause: api/_shared/intake-om-pipeline.js ~L265 stamps the
-- caller token's name onto rows keyed by other emails). If a row is inserted/updated with the
-- hardcoded literal "Scott Briggs" but its email is NOT one of Scott's aliases, rewrite
-- display_name to a name derived from the email. Narrow by design — only that one known-bad
-- literal is touched; all other names pass through. Works regardless of which writer (api, edge
-- fn, or PA flow) creates the row.
-- ============================================================================
create or replace function public.lcc_users_normalize_display_name()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if NEW.display_name = 'Scott Briggs'
     and NEW.email is not null
     and NEW.email not ilike '%sabriggs%'
     and lower(NEW.email) not in ('teambriggs@northmarq.com','northmarqlistings@rcm1.com')
     and NEW.id <> 'b0000000-0000-0000-0000-000000000001'::uuid then
    NEW.display_name := nullif(initcap(replace(replace(split_part(NEW.email,'@',1),'.',' '),'_',' ')), '');
  end if;
  return NEW;
end $$;

drop trigger if exists trg_users_normalize_display_name on public.users;
create trigger trg_users_normalize_display_name
before insert or update on public.users
for each row execute function public.lcc_users_normalize_display_name();
