-- ============================================================================
-- Gov — sales_dedup_tick: add a cross-month proximity pass (going-forward)
--
-- Target: government Supabase (GOV_SUPABASE_URL)
-- Gov mirror of the dia migration of the same date (sale_id is uuid, so ordering
-- uses ::text). Same function signature; idempotent (verified 0 on second run).
-- See the dia file header for rationale.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sales_dedup_tick()
 RETURNS TABLE(groups_seen bigint, rows_quarantined bigint, run_at timestamp with time zone)
 LANGUAGE plpgsql AS $function$
DECLARE v_groups BIGINT := 0; v_rows BIGINT := 0; v_rows2 BIGINT := 0;
BEGIN
  WITH ranked AS (
    SELECT sale_id, dedup_natural_key,
      CASE
        WHEN data_source LIKE 'county_deed:%' THEN 1 WHEN data_source = 'excel_master' THEN 2
        WHEN data_source = 'sjc_track_record_v2' THEN 3 WHEN data_source = 'historical_csv_import' THEN 4
        WHEN data_source = 'costar_export' THEN 5 WHEN data_source = 'costar_sidebar' THEN 6
        WHEN data_source = 'rca_sidebar_manual_bootstrap' THEN 7 WHEN data_source IS NULL THEN 8
        WHEN data_source LIKE 'ownership_change_stub%' THEN 9 ELSE 10 END AS prio
    FROM public.sales_transactions
    WHERE transaction_state = 'live' AND dedup_natural_key IS NOT NULL
      AND COALESCE(data_source,'') NOT LIKE 'ownership_change_stub%'
  ),
  groups AS (SELECT dedup_natural_key FROM ranked GROUP BY dedup_natural_key HAVING COUNT(*) > 1),
  group_rows AS (
    SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.dedup_natural_key ORDER BY r.prio ASC, r.sale_id::text ASC) AS rn,
           FIRST_VALUE(r.sale_id) OVER (PARTITION BY r.dedup_natural_key ORDER BY r.prio ASC, r.sale_id::text ASC) AS survivor_sale_id
    FROM ranked r WHERE r.dedup_natural_key IN (SELECT dedup_natural_key FROM groups)
  ),
  losers AS (SELECT sale_id, survivor_sale_id FROM group_rows WHERE rn > 1),
  patched AS (
    UPDATE public.sales_transactions s SET transaction_state='duplicate_superseded', dedup_group_id=losers.survivor_sale_id, updated_at=now()
      FROM losers WHERE s.sale_id = losers.sale_id AND s.transaction_state='live' RETURNING s.sale_id
  )
  SELECT (SELECT COUNT(*) FROM groups), (SELECT COUNT(*) FROM patched) INTO v_groups, v_rows;

  WITH live AS (
    SELECT sale_id, property_id, sold_price, sale_date,
      CASE
        WHEN data_source LIKE 'county_deed:%' THEN 1 WHEN data_source = 'excel_master' THEN 2
        WHEN data_source = 'sjc_track_record_v2' THEN 3 WHEN data_source = 'historical_csv_import' THEN 4
        WHEN data_source = 'costar_export' THEN 5 WHEN data_source = 'costar_sidebar' THEN 6
        WHEN data_source = 'rca_sidebar_manual_bootstrap' THEN 7 WHEN data_source IS NULL THEN 8 ELSE 10 END AS prio
    FROM public.sales_transactions
    WHERE transaction_state='live' AND sold_price > 0
      AND COALESCE(data_source,'') NOT LIKE 'ownership_change_stub%'
  ),
  losers2 AS (
    SELECT b.sale_id AS loser_id, (array_agg(a.sale_id ORDER BY a.prio, a.sale_id::text))[1] AS survivor_id
    FROM live b JOIN live a
      ON a.property_id=b.property_id AND a.sale_id<>b.sale_id
     AND abs(a.sold_price-b.sold_price) <= 1000 AND abs(a.sale_date-b.sale_date) <= 60
     AND (a.prio < b.prio OR (a.prio = b.prio AND a.sale_id::text < b.sale_id::text))
    GROUP BY b.sale_id
  ),
  patched2 AS (
    UPDATE public.sales_transactions s SET transaction_state='duplicate_superseded', dedup_group_id=losers2.survivor_id, updated_at=now()
      FROM losers2 WHERE s.sale_id = losers2.loser_id AND s.transaction_state='live' RETURNING s.sale_id
  )
  SELECT COUNT(*) FROM patched2 INTO v_rows2;

  RETURN QUERY SELECT v_groups, v_rows + v_rows2, now();
END;
$function$;
