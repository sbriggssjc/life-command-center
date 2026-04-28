-- ============================================================================
-- Round 76ax-C — Government data_hygiene_sweep function + daily cron
-- Adapts dia 76ax-C for gov columns (buyer/seller, no is_active, etc).
-- Runs daily at 3:30 AM (offset from dia to spread load).
--
-- Apply on government project (scknotsqkcheojiaewwh).
-- Prerequisite: gov 76au cron-health-monitor (creates lcc_health_alerts).
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

  WITH props_holes AS (
    SELECT p.property_id FROM public.properties p
    WHERE p.recorded_owner_id IS NULL
      AND EXISTS (SELECT 1 FROM public.sales_transactions s WHERE s.property_id = p.property_id)
  ),
  candidate AS (
    SELECT DISTINCT ON (s.property_id) s.property_id, ro.recorded_owner_id
    FROM props_holes ph
    JOIN public.sales_transactions s ON s.property_id = ph.property_id
    JOIN public.recorded_owners ro ON normalize_entity_name(ro.name) = normalize_entity_name(s.buyer)
    WHERE s.buyer IS NOT NULL AND TRIM(s.buyer) <> ''
    ORDER BY s.property_id, s.sale_date DESC NULLS LAST, s.sale_id::text DESC
  )
  UPDATE public.properties p SET recorded_owner_id = c.recorded_owner_id
    FROM candidate c WHERE p.property_id = c.property_id;
  GET DIAGNOSTICS n_owner_backfill = ROW_COUNT;

  WITH dup_groups AS (
    SELECT property_id, sale_date FROM public.sales_transactions
    WHERE sale_date IS NOT NULL AND property_id IS NOT NULL
    GROUP BY 1, 2 HAVING COUNT(*) > 1
  ),
  classified AS (
    SELECT dg.property_id, dg.sale_date,
      (ARRAY_AGG(st.sale_id::text ORDER BY st.sale_id::text) FILTER (
         WHERE st.buyer IS NOT NULL OR st.seller IS NOT NULL OR st.sold_price IS NOT NULL))[1] AS keep_id,
      ARRAY_AGG(st.sale_id::text ORDER BY st.sale_id::text) FILTER (
         WHERE (st.buyer IS NULL AND st.seller IS NULL AND st.sold_price IS NULL)
            OR st.data_source IN ('comps_import','historical_csv_import')) AS bare_ids
    FROM dup_groups dg
    JOIN public.sales_transactions st USING (property_id, sale_date)
    GROUP BY dg.property_id, dg.sale_date
  ),
  mapping AS (
    SELECT keep_id, UNNEST(bare_ids) AS bare_id FROM classified
    WHERE keep_id IS NOT NULL AND bare_ids IS NOT NULL AND keep_id <> ALL(bare_ids)
  )
  DELETE FROM public.sales_transactions
   WHERE sale_id::text IN (SELECT bare_id FROM mapping);
  GET DIAGNOSTICS n_dedup_sales = ROW_COUNT;

  WITH ranked AS (
    SELECT lease_id, property_id,
      ROW_NUMBER() OVER (
        PARTITION BY property_id
        ORDER BY
          (commencement_date IS NULL),
          commencement_date DESC NULLS LAST,
          (CASE WHEN expiration_date IS NULL OR expiration_date >= CURRENT_DATE THEN 0 ELSE 1 END),
          annual_rent DESC NULLS LAST,
          lease_id::text DESC
      ) AS rn,
      COUNT(*) FILTER (WHERE expiration_date IS NULL OR expiration_date >= CURRENT_DATE)
        OVER (PARTITION BY property_id) AS truly_current_count
    FROM public.leases WHERE superseded_at IS NULL
  )
  UPDATE public.leases l
     SET superseded_at = NOW()
    FROM ranked r
   WHERE l.lease_id = r.lease_id
     AND r.rn > 1
     AND r.truly_current_count <= 1;
  GET DIAGNOSTICS n_supersede_leases = ROW_COUNT;

  UPDATE public.ownership_history oh SET matched_sale_id = NULL
   WHERE oh.matched_sale_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.sales_transactions st WHERE st.sale_id = oh.matched_sale_id);
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
    VALUES ('data_hygiene_sweep', 'gov',
            'info',
            format('gov hygiene sweep auto-corrected %s rows',
                   n_owner_backfill + n_dedup_sales + n_supersede_leases + n_close_listings + n_oh_severed),
            result, NOW(), 'Auto-resolved on completion');
  END IF;

  RETURN result;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    BEGIN PERFORM cron.unschedule('gov-data-hygiene-sweep'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule('gov-data-hygiene-sweep', '30 3 * * *',
                          'SELECT public.lcc_data_hygiene_sweep();');
  END IF;
END $$;
