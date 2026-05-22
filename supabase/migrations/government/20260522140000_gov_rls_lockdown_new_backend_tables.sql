-- 2026-05-22 — Enable RLS on gov backend tables created since the 2026-05-11
-- Supabase advisor baseline (flagged ERROR rls_disabled_in_public). anon held
-- default GRANT ALL on them; all real writers are service_role (edge functions)
-- or postgres (pg_cron), both BYPASSRLS, so backend paths are unaffected.
-- Policy mirrors existing data tables: service_role ALL + authenticated SELECT.
-- Applied live via Supabase migration gov_rls_lockdown_new_backend_tables.
DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'deed_propagation_log','dq5_owner_merge_log','dq5_owner_merge_map','dq5_true_owner_merge_map',
    'dq7_property_merge_log','dq7_property_merge_map','gsa_owner_backfill_log','owner_unification_review_queue',
    'ownership_coverage_history','parcel_owner_xref','property_metadata_backfill_queue','provenance_event_log',
    'sf_comp_staging','sf_deal_staging','sf_files','sf_listing_staging','sf_property_staging'
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