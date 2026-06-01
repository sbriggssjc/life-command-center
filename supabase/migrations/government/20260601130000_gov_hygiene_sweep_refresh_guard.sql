-- gov hygiene sweep: guard REFRESH MATERIALIZED VIEW against plain views
--
-- Root cause of the recurring "[gov] gov hygiene sweep had 2 failing step(s)" alert
-- (lcc_health_alerts rows 34/36/38, firing nightly since 2026-05-30):
--   public.v_sales_comps and public.v_available_listings were converted from
--   materialized views to plain views on 2026-05-29 (migrations
--   20260529160000_gov_available_listings_authoritative_gate.sql and
--   20260529170000_gov_sales_comps_nonlive_excluded_invariant.sql).
--   The hygiene sweep still issued `REFRESH MATERIALIZED VIEW` on both, which
--   raises  '"v_sales_comps" is not a table or materialized view'  every night.
--   The per-step EXCEPTION handlers captured the errors and emitted a
--   data_hygiene_sweep_step_error alert each run. The data-cleaning steps
--   themselves were always fine.
--
-- Fix: only REFRESH when the relation is actually a materialized view (relkind='m').
-- Plain views are always live, so skipping the refresh is correct. This keeps the
-- refresh behaviour intact should either relation ever become a matview again.

CREATE OR REPLACE FUNCTION public.lcc_data_hygiene_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET statement_timeout TO '600s'
AS $function$
DECLARE
  result jsonb := '{}'::jsonb;
  n_owner_backfill int := 0;
  n_dedup_sales int := 0;
  n_supersede_leases int := 0;
  n_close_listings int := 0;
  n_oh_severed int := 0;
  n_dashboard_excluded int := 0;
  n_listing_excluded int := 0;
  n_matviews int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_run_id uuid := gen_random_uuid();
BEGIN
  -- Owner backfill
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
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('step','owner_backfill','error',SQLERRM);
  END;

  -- Bare-dup delete (guard skips bare_ids still referenced by any FK child)
  BEGIN
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
    DELETE FROM public.sales_transactions st
     WHERE st.sale_id::text IN (SELECT bare_id FROM mapping)
       AND NOT EXISTS (SELECT 1 FROM public.ownership_history oh
                        WHERE oh.sale_id = st.sale_id OR oh.matched_sale_id = st.sale_id)
       AND NOT EXISTS (SELECT 1 FROM public.broker_transactions b WHERE b.sale_id = st.sale_id)
       AND NOT EXISTS (SELECT 1 FROM public.loans l WHERE l.sale_id = st.sale_id)
       AND NOT EXISTS (SELECT 1 FROM public.property_documents d WHERE d.sale_id = st.sale_id)
       AND NOT EXISTS (SELECT 1 FROM public.sales_transactions_properties sp WHERE sp.sale_id = st.sale_id);
    GET DIAGNOSTICS n_dedup_sales = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('step','dedup_sales','error',SQLERRM);
  END;

  -- Dashboard-dup suppression
  BEGIN
    WITH dup_groups AS (
      SELECT property_id, sale_date FROM public.sales_transactions
      WHERE property_id IS NOT NULL AND sale_date IS NOT NULL
        AND COALESCE(exclude_from_market_metrics, FALSE) = FALSE
      GROUP BY 1, 2 HAVING COUNT(*) > 1
    ),
    ranked AS (
      SELECT s.sale_id,
        ROW_NUMBER() OVER (
          PARTITION BY s.property_id, s.sale_date
          ORDER BY
            ((s.buyer IS NOT NULL)::int + (s.seller IS NOT NULL)::int + (s.sold_price IS NOT NULL)::int) DESC,
            s.sold_price DESC NULLS LAST,
            s.sale_id::text
        ) AS rn
      FROM public.sales_transactions s
      JOIN dup_groups dg USING (property_id, sale_date)
    )
    UPDATE public.sales_transactions st SET exclude_from_market_metrics = TRUE
      FROM ranked r WHERE st.sale_id = r.sale_id AND r.rn > 1;
    GET DIAGNOSTICS n_dashboard_excluded = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('step','dashboard_excluded','error',SQLERRM);
  END;

  -- Listing-dup suppression
  BEGIN
    WITH ranked AS (
      SELECT al.listing_id,
        ROW_NUMBER() OVER (
          PARTITION BY al.property_id
          ORDER BY
            (CASE WHEN al.listing_status = 'Active' THEN 0
                  WHEN al.listing_status IS NULL THEN 1
                  WHEN al.listing_status = 'superseded' THEN 2 ELSE 3 END),
            al.listing_date DESC NULLS LAST,
            al.last_seen_at DESC NULLS LAST,
            al.listing_id::text
        ) AS rn
      FROM public.available_listings al
      WHERE COALESCE(al.exclude_from_listing_metrics, FALSE) = FALSE
        AND al.property_id IS NOT NULL
    )
    UPDATE public.available_listings al SET exclude_from_listing_metrics = TRUE
      FROM ranked r WHERE al.listing_id = r.listing_id AND r.rn > 1;
    GET DIAGNOSTICS n_listing_excluded = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('step','listing_excluded','error',SQLERRM);
  END;

  -- Multi-unsuperseded-lease supersede
  BEGIN
    WITH ranked AS (
      SELECT lease_id, property_id,
        ROW_NUMBER() OVER (
          PARTITION BY property_id
          ORDER BY (commencement_date IS NULL),
            commencement_date DESC NULLS LAST,
            (CASE WHEN expiration_date IS NULL OR expiration_date >= CURRENT_DATE THEN 0 ELSE 1 END),
            annual_rent DESC NULLS LAST,
            lease_id::text DESC
        ) AS rn,
        COUNT(*) FILTER (WHERE expiration_date IS NULL OR expiration_date >= CURRENT_DATE)
          OVER (PARTITION BY property_id) AS truly_current_count
      FROM public.leases WHERE superseded_at IS NULL
    )
    UPDATE public.leases l SET superseded_at = NOW()
      FROM ranked r WHERE l.lease_id = r.lease_id
       AND r.rn > 1 AND r.truly_current_count <= 1;
    GET DIAGNOSTICS n_supersede_leases = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('step','supersede_leases','error',SQLERRM);
  END;

  -- Sever orphan oh links
  BEGIN
    UPDATE public.ownership_history oh SET matched_sale_id = NULL
     WHERE oh.matched_sale_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.sales_transactions st WHERE st.sale_id = oh.matched_sale_id);
    GET DIAGNOSTICS n_oh_severed = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('step','oh_severed','error',SQLERRM);
  END;

  -- Refresh matviews (each isolated so one failure doesn't block the other).
  -- Guarded: only REFRESH when the relation is actually a materialized view
  -- (relkind='m'). Plain views are always live and need no refresh.
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace nsp ON nsp.oid = c.relnamespace
               WHERE nsp.nspname = 'public' AND c.relname = 'v_sales_comps' AND c.relkind = 'm') THEN
      REFRESH MATERIALIZED VIEW public.v_sales_comps;
      n_matviews := n_matviews + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('step','refresh_v_sales_comps','error',SQLERRM);
  END;
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace nsp ON nsp.oid = c.relnamespace
               WHERE nsp.nspname = 'public' AND c.relname = 'v_available_listings' AND c.relkind = 'm') THEN
      REFRESH MATERIALIZED VIEW public.v_available_listings;
      n_matviews := n_matviews + 1;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('step','refresh_v_available_listings','error',SQLERRM);
  END;

  result := jsonb_build_object(
    'run_id', v_run_id,
    'owner_backfill', n_owner_backfill,
    'dedup_sales', n_dedup_sales,
    'dashboard_excluded', n_dashboard_excluded,
    'listing_excluded', n_listing_excluded,
    'supersede_leases', n_supersede_leases,
    'close_listings', n_close_listings,
    'oh_severed', n_oh_severed,
    'matviews_refreshed', n_matviews,
    'errors', v_errors
  );

  IF jsonb_array_length(v_errors) > 0 THEN
    INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    VALUES ('data_hygiene_sweep_step_error', 'gov', 'error',
            format('gov hygiene sweep had %s failing step(s)', jsonb_array_length(v_errors)),
            result);
  END IF;

  IF (n_owner_backfill + n_dedup_sales + n_dashboard_excluded + n_listing_excluded
      + n_supersede_leases + n_close_listings + n_oh_severed) > 0 THEN
    INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details, resolved_at, resolved_note)
    VALUES ('data_hygiene_sweep', 'gov', 'info',
            format('gov hygiene sweep auto-corrected %s rows',
                   n_owner_backfill + n_dedup_sales + n_dashboard_excluded + n_listing_excluded
                   + n_supersede_leases + n_close_listings + n_oh_severed),
            result, NOW(), 'Auto-resolved on completion');
  END IF;

  RETURN result;
END $function$;

-- Resolve the open step-error alerts that were caused purely by this bug.
UPDATE public.lcc_health_alerts
   SET resolved_at = NOW(),
       resolved_note = 'Resolved by 20260601130000: refresh now guarded against plain views (no real step failure).'
 WHERE resolved_at IS NULL
   AND alert_kind = 'data_hygiene_sweep_step_error'
   AND source = 'gov';
