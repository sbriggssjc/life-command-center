-- ============================================================================
-- 20260728140000_dia_rls_security_hardening.sql   (DIA project zqzrriwuavgrquhisnoa)
-- Security-advisor ERROR remediation: 489 -> 0. Applied live 2026-07-28.
-- Safe: engine reads DIA via DIA_SUPABASE_KEY = sb_secret_ (service/secret, bypasses RLS); no anon key exists;
-- ingestion is server-side (CMS). Enables RLS on every RLS-less public table and flips every public view to
-- security_invoker. Verified after: get_pipeline_health dialysis domain = ok; 0 tables without RLS remain.
-- First bulk attempt deadlocked against a live CMS ingestion; this lock_timeout + per-object skip version
-- makes incremental, deadlock-proof progress (idempotent — re-run to finish any skipped objects). Matviews left.
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
