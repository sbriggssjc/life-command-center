-- 2026-05-22 — Enable RLS on LCC Opps backend tables created since the
-- 2026-05-11 Supabase advisor baseline (flagged ERROR rls_disabled_in_public).
-- All are written server-side via the LCC API's service_role connection
-- (e.g. client_errors via opsQuery in api/admin.js) or edge functions
-- (sf_sync_log) — never directly from the browser. service_role + postgres
-- BYPASSRLS, so backend paths are unaffected; anon loses its default GRANT ALL.
-- Applied live via Supabase migration lcc_rls_lockdown_new_backend_tables.
DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'client_errors','field_provenance_resolutions','ingest_write_failures',
    'sales_parser_diagnostics','sf_sync_log','template_health_history'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE n.nspname='public' AND c.relname=t AND c.relkind='r') THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_service_role_all', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t||'_service_role_all', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_authenticated_read', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t||'_authenticated_read', t);
    END IF;
  END LOOP;
END $$;