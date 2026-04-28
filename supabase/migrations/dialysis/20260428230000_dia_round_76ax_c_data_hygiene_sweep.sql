-- ============================================================================
-- Round 76ax-C — Dialysis data_hygiene_sweep function + daily cron
--
-- Promotes one-shot Round 76av/76aw migrations into recurring idempotent
-- self-healing functions. Runs daily at 3:00 AM. Logs results to
-- lcc_health_alerts so the daily briefing surfaces what was auto-fixed.
--
-- Each pass is idempotent — safe to re-run. Touches existing rows only
-- when a clearly-better value is available; never invents data.
--
-- Apply on dialysis project (zqzrriwuavgrquhisnoa).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_data_hygiene_sweep()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  result jsonb := '{}'::jsonb;
  n_owner_backfill int := 0;
  n_dedup_sales int := 0;
  n_supersede_leases int := 0;
  n_close_listings int := 0;
  n_oh_severed int := 0;
  v_run_id uuid := gen_random_uuid();
BEGIN

  -- 1. Backfill recorded_owner_id via name match (Round 76aw logic)
  WITH props_holes AS (
    SELECT p.property_id FROM public.properties p
    WHERE p.recorded_owner_id IS NULL
      AND EXISTS (SELECT 1 FROM public.sales_transactions s WHERE s.property_id = p.property_id)
  ),
  candidate AS (
    SELECT DISTINCT ON (s.property_id) s.property_id, ro.recorded_owner_id
    FROM props_holes ph
    JOIN public.sales_transactions s ON s.property_id = ph.property_id
    JOIN public.recorded_owners ro
      ON normalize_entity_name(ro.name) = normalize_entity_name(
           COALESCE(NULLIF(s.recorded_owner_name,''), NULLIF(s.buyer_name,'')))
    WHERE COALESCE(s.recorded_owner_name, s.buyer_name) IS NOT NULL
    ORDER BY s.property_id, s.sale_date DESC NULLS LAST, s.sale_id DESC
  )
  UPDATE public.properties p SET recorded_owner_id = c.recorded_owner_id
    FROM candidate c WHERE p.property_id = c.property_id;
  GET DIAGNOSTICS n_owner_backfill = ROW_COUNT;

  -- 2. Bare-duplicate-sales dedup (Round 76av logic)
  WITH dup_groups AS (
    SELECT property_id, sale_date FROM public.sales_transactions
    WHERE sale_date IS NOT NULL AND property_id IS NOT NULL
    GROUP BY 1, 2 HAVING COUNT(*) > 1
  ),
  classified AS (
    SELECT dg.property_id, dg.sale_date,
      (ARRAY_AGG(st.sale_id ORDER BY st.sale_id) FILTER (
         WHERE st.buyer_name IS NOT NULL OR st.seller_name IS NOT NULL))[1] AS keep_id,
      ARRAY_AGG(st.sale_id ORDER BY st.sale_id) FILTER (
         WHERE st.data_source = 'historical_csv_import' AND st.buyer_name IS NULL) AS bare_ids
    FROM dup_groups dg
    JOIN public.sales_transactions st USING (property_id, sale_date)
    GROUP BY dg.property_id, dg.sale_date
  ),
  mapping AS (
    SELECT keep_id, UNNEST(bare_ids) AS bare_id FROM classified
    WHERE keep_id IS NOT NULL AND bare_ids IS NOT NULL
  )
  DELETE FROM public.sales_transactions
   WHERE sale_id IN (SELECT bare_id FROM mapping);
  GET DIAGNOSTICS n_dedup_sales = ROW_COUNT;

  -- 3. Multi-active-lease supersede (Round 76av logic)
  WITH ranked AS (
    SELECT lease_id, property_id,
      ROW_NUMBER() OVER (
        PARTITION BY property_id
        ORDER BY (lease_start IS NULL),
                 lease_start DESC NULLS LAST,
                 annual_rent DESC NULLS LAST,
                 lease_id DESC
      ) AS rn
    FROM public.leases WHERE is_active = TRUE
  )
  UPDATE public.leases l
     SET status = 'superseded', is_active = FALSE, superseded_at = NOW()
    FROM ranked r WHERE l.lease_id = r.lease_id AND r.rn > 1;
  GET DIAGNOSTICS n_supersede_leases = ROW_COUNT;

  -- 4. Close listings whose property has a sale on/after listing date
  UPDATE public.available_listings al
     SET status = 'Sold', is_active = FALSE,
         off_market_date = COALESCE(al.off_market_date, s.sale_date)
   FROM public.sales_transactions s
   WHERE s.property_id = al.property_id
     AND al.status NOT IN ('Sold','Withdrawn','Expired')
     AND al.is_active = TRUE
     AND s.sale_date >= COALESCE(al.listing_date, '1970-01-01'::date);
  GET DIAGNOSTICS n_close_listings = ROW_COUNT;

  -- 5. Sever ownership_history rows pointing at deleted/missing sales
  UPDATE public.ownership_history oh SET sale_id = NULL
   WHERE oh.sale_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.sales_transactions st WHERE st.sale_id = oh.sale_id);
  GET DIAGNOSTICS n_oh_severed = ROW_COUNT;

  result := jsonb_build_object(
    'run_id', v_run_id,
    'owner_backfill', n_owner_backfill,
    'dedup_sales', n_dedup_sales,
    'supersede_leases', n_supersede_leases,
    'close_listings', n_close_listings,
    'oh_severed', n_oh_severed
  );

  IF (n_owner_backfill + n_dedup_sales + n_supersede_leases + n_close_listings + n_oh_severed) > 0 THEN
    INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details, resolved_at, resolved_note)
    VALUES ('data_hygiene_sweep', 'dia',
            'info',
            format('dia hygiene sweep auto-corrected %s rows',
                   n_owner_backfill + n_dedup_sales + n_supersede_leases + n_close_listings + n_oh_severed),
            result,
            NOW(),
            'Auto-resolved on completion');
  END IF;

  RETURN result;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    BEGIN PERFORM cron.unschedule('dia-data-hygiene-sweep'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule('dia-data-hygiene-sweep', '0 3 * * *',
                          'SELECT public.lcc_data_hygiene_sweep();');
  END IF;
END $$;
