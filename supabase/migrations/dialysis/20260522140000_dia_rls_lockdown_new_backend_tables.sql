-- 2026-05-22 — Enable RLS on dia backend tables created since the 2026-05-11
-- Supabase advisor baseline (flagged ERROR rls_disabled_in_public). Includes
-- merge logs, *_purged_* backup snapshots, SF staging, provenance/coverage,
-- backfill queues. All writers are service_role (edge functions / LCC server)
-- or postgres (pg_cron), both BYPASSRLS, so backend paths are unaffected.
-- Policy mirrors existing data tables: service_role ALL + authenticated SELECT.
-- Applied live via Supabase migration dia_rls_lockdown_new_backend_tables.
DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'contacts_purged_20260513','dq5_owner_merge_log','dq5_owner_merge_map','dq5_true_owner_merge_map',
    'dq7_office_misaddress_queue','dq7_property_merge_map','owner_canonical_patterns','ownership_coverage_history',
    'ownership_history_purged_20260513','property_metadata_backfill_queue','provenance_event_log',
    'recorded_owners_purged_20260513','sf_comp_staging','sf_deal_staging','sf_files','sf_listing_staging',
    'sf_property_staging','sf_sync_log','true_owners_purged_20260513'
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