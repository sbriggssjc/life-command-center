-- Round 74b: sf_*_staging duplication disk-safety fix (applied live 2026-06-08).
-- The SF->LCC object-sync upserts on (sf_id, source_system, import_batch); since
-- import_batch changes every hourly run, the conflict key never matches across
-- runs and each run INSERTs a fresh row -> 40-208x duplication (dia deal 7,222
-- rows / 142 distinct; gov 2,747 / 66). This is the sf_sync_log-precedent
-- mitigation: one-time dedup + a bounded prune cron + autovacuum hardening.
-- PERMANENT FIX (separate, coordinated): drop import_batch from the edge-fn
-- conflict key (api/_shared ... supabase/functions/intake-salesforce/index.ts
-- on_conflict) + swap uq_sf_*_staging_dedup to (sf_id, source_system). See
-- docs/architecture/salesforce_nm_authoritative_sync.md section 3.6.

CREATE OR REPLACE FUNCTION public.sf_staging_dedup_prune()
RETURNS TABLE(staging_table text, deleted bigint)
LANGUAGE plpgsql AS $fn$
DECLARE
  pairs text[][] := ARRAY[
    ARRAY['sf_deal_staging','sf_deal_id'],
    ARRAY['sf_property_staging','sf_property_id'],
    ARRAY['sf_comp_staging','sf_comp_id'],
    ARRAY['sf_listing_staging','sf_listing_id']
  ];
  i int; tbl text; idc text; del bigint;
BEGIN
  FOR i IN 1..array_length(pairs,1) LOOP
    tbl := pairs[i][1]; idc := pairs[i][2];
    IF to_regclass('public.'||tbl) IS NULL THEN CONTINUE; END IF;
    EXECUTE format($f$
      DELETE FROM public.%1$I a USING (
        SELECT staging_id,
               row_number() OVER (PARTITION BY %2$I, source_system
                 ORDER BY sf_last_modified DESC NULLS LAST, staging_id DESC) AS rn
        FROM public.%1$I WHERE %2$I IS NOT NULL
      ) b
      WHERE a.staging_id = b.staging_id AND b.rn > 1
    $f$, tbl, idc);
    GET DIAGNOSTICS del = ROW_COUNT;
    staging_table := tbl; deleted := del; RETURN NEXT;
  END LOOP;
END $fn$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sf_deal_staging','sf_property_staging','sf_comp_staging','sf_listing_staging'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I SET (autovacuum_vacuum_scale_factor=0.05, autovacuum_analyze_scale_factor=0.05)', t);
    END IF;
  END LOOP;
END $$;

SELECT cron.unschedule('sf-staging-dedup-prune')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='sf-staging-dedup-prune');
SELECT cron.schedule('sf-staging-dedup-prune','17 * * * *',
  $$SELECT public.sf_staging_dedup_prune()$$);

-- One-time reclaim (re-run-safe; the cron repeats it hourly):
SELECT * FROM public.sf_staging_dedup_prune();
