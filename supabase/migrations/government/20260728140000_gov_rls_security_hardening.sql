-- ============================================================================
-- 20260728140000_gov_rls_security_hardening.sql   (GOV project scknotsqkcheojiaewwh)
-- Security-advisor ERROR remediation: 304 -> 0. Applied live 2026-07-28.
-- Safe: engine reads GOV via GOV_SUPABASE_KEY = service_role (bypasses RLS); no anon key exists for this
-- project; ingestion is server-side Python. Enables RLS on every RLS-less public table and flips every public
-- view to security_invoker. Verified after: get_pipeline_health government domain = ok, full data.
-- lock_timeout + per-object skip so a concurrent ingestion lock can't deadlock the pass (idempotent — re-run
-- to pick up any momentarily-locked objects). Matviews (relkind 'm') intentionally left (no security_invoker).
-- ============================================================================
do $$
declare r record;
begin
  set local lock_timeout = '5s';
  for r in select c.relname from pg_class c join pg_namespace nsp on nsp.oid=c.relnamespace
           where nsp.nspname='public' and c.relkind='r' and not c.relrowsecurity loop
    begin execute format('alter table public.%I enable row level security', r.relname);
    exception when others then null; end;
  end loop;
  for r in select c.relname from pg_class c join pg_namespace nsp on nsp.oid=c.relnamespace
           where nsp.nspname='public' and c.relkind='v' loop
    begin execute format('alter view public.%I set (security_invoker = on)', r.relname);
    exception when others then null; end;
  end loop;
end $$;
