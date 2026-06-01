-- dia_merge_property: stop the recurring auto_merge_property_failures (FK abort).
--
-- Symptom: hourly `dia auto-merge: N of M merges failed` warnings, last_error
--   'update or delete on table "properties" violates foreign key constraint
--    "sales_transactions_property_id_fkey" on table "sales_transactions"'.
--
-- Cause: the generic FK-repoint loop repoints sales_transactions.property_id
--   from drop -> keep, but that collides with the unique index
--   sales_property_date_price_uidx (property_id, sale_date, COALESCE(sold_price,0))
--   whenever two rows would land on the same key under keep -- i.e. intra-drop
--   duplicates that the old step #3 didn't catch (it only removed drop rows with
--   an exact twin already on the keep side). The colliding UPDATE is swallowed by
--   the loop's EXCEPTION handler, leaving a drop-side sales row behind, so the
--   final DELETE FROM properties hits the FK and the whole merge aborts.
--
-- Fix: step #3 now collapses ALL rows that would share that unique key under keep.
--   For each (sale_date, COALESCE(sold_price,0)) group it keeps a single winner --
--   the keep-side row if one exists, else the most-complete drop-side row -- and
--   deletes the remaining DROP-side rows (never a keep-side row). The unique index
--   already treats those rows as the same sale, so this is a safe dedup. The
--   NO ACTION children (broker_market_coverage / loans / property_documents) are
--   pre-deleted as before; available_listings / contacts / ownership_history are
--   ON DELETE SET NULL and sale_brokers is ON DELETE CASCADE, so they self-handle.

CREATE OR REPLACE FUNCTION public.dia_merge_property(p_keep_id integer, p_drop_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_rewired   jsonb := '{}'::jsonb;
  v_n         integer;
  v_record    record;
  v_cnt       integer;
BEGIN
  IF p_keep_id IS NULL OR p_drop_id IS NULL THEN
    RAISE EXCEPTION 'dia_merge_property: keep_id and drop_id must both be non-null';
  END IF;
  IF p_keep_id = p_drop_id THEN
    RAISE EXCEPTION 'dia_merge_property: keep_id and drop_id must differ (got %)', p_keep_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.properties WHERE property_id = p_keep_id) THEN
    RAISE EXCEPTION 'dia_merge_property: keep_id % not found in properties', p_keep_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.properties WHERE property_id = p_drop_id) THEN
    RAISE EXCEPTION 'dia_merge_property: drop_id % not found in properties', p_drop_id;
  END IF;

  -- ── #1 leases (+ RESTRICT kids lease_escalations, expenses)
  CREATE TEMP TABLE IF NOT EXISTS _mg_lease (id integer) ON COMMIT DROP;
  TRUNCATE _mg_lease;
  INSERT INTO _mg_lease
  SELECT ld.lease_id FROM public.leases ld
   WHERE ld.property_id = p_drop_id
     AND ld.tenant_id IS NOT NULL AND ld.lease_start IS NOT NULL AND ld.lease_expiration IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.leases lk
                  WHERE lk.property_id=p_keep_id AND lk.tenant_id=ld.tenant_id
                    AND lk.lease_start=ld.lease_start AND lk.lease_expiration=ld.lease_expiration);
  IF EXISTS (SELECT 1 FROM _mg_lease) THEN
    DELETE FROM public.lease_escalations WHERE lease_id IN (SELECT id FROM _mg_lease);
    DELETE FROM public.expenses          WHERE lease_id IN (SELECT id FROM _mg_lease);
    DELETE FROM public.leases            WHERE lease_id IN (SELECT id FROM _mg_lease);
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    v_rewired := v_rewired || jsonb_build_object('leases_dedup_dropped', v_cnt);
  END IF;

  -- ── #2 available_listings (one active per property); RESTRICT kid broker_market_coverage(listing_id)
  IF EXISTS (SELECT 1 FROM public.available_listings WHERE property_id=p_keep_id AND is_active IS TRUE) THEN
    DELETE FROM public.broker_market_coverage
     WHERE listing_id IN (SELECT listing_id FROM public.available_listings
                           WHERE property_id=p_drop_id AND is_active IS TRUE);
    DELETE FROM public.available_listings WHERE property_id=p_drop_id AND is_active IS TRUE;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt > 0 THEN
      v_rewired := v_rewired || jsonb_build_object('active_listings_dedup_dropped', v_cnt);
    END IF;
  END IF;

  -- ── #3 sales_transactions; RESTRICT kids broker_market_coverage/loans/property_documents(sale_id)
  -- Collapse every row that would share the (property_id, sale_date,
  -- COALESCE(sold_price,0)) unique key under keep. Keep one winner per key
  -- (keep-side, else most-complete drop-side); delete the rest -- only ever
  -- drop-side rows (rn>1 with is_keep=FALSE; a keep row always wins its group).
  CREATE TEMP TABLE IF NOT EXISTS _mg_sale (id integer) ON COMMIT DROP;
  TRUNCATE _mg_sale;
  INSERT INTO _mg_sale
  WITH landing AS (
    SELECT st.sale_id, st.sale_date, COALESCE(st.sold_price,0) AS cp,
           (st.property_id = p_keep_id) AS is_keep,
           ((st.buyer_name IS NOT NULL)::int + (st.seller_name IS NOT NULL)::int
            + (st.sold_price IS NOT NULL)::int) AS completeness
    FROM public.sales_transactions st
    WHERE st.property_id IN (p_keep_id, p_drop_id) AND st.sale_date IS NOT NULL
  ),
  ranked AS (
    SELECT sale_id, is_keep,
      ROW_NUMBER() OVER (PARTITION BY sale_date, cp
        ORDER BY is_keep DESC, completeness DESC, sale_id) AS rn
    FROM landing
  )
  SELECT sale_id FROM ranked WHERE rn > 1 AND is_keep = FALSE;
  IF EXISTS (SELECT 1 FROM _mg_sale) THEN
    DELETE FROM public.broker_market_coverage WHERE sale_id IN (SELECT id FROM _mg_sale);
    DELETE FROM public.loans                  WHERE sale_id IN (SELECT id FROM _mg_sale);
    DELETE FROM public.property_documents     WHERE sale_id IN (SELECT id FROM _mg_sale);
    DELETE FROM public.sales_transactions     WHERE sale_id IN (SELECT id FROM _mg_sale);
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    v_rewired := v_rewired || jsonb_build_object('sales_dedup_dropped', v_cnt);
  END IF;

  -- ── #4 property_public_records (unique property_id,record_type,record_id; no RESTRICT kids)
  DELETE FROM public.property_public_records d
   WHERE d.property_id = p_drop_id
     AND EXISTS (SELECT 1 FROM public.property_public_records k
                  WHERE k.property_id=p_keep_id
                    AND k.record_type IS NOT DISTINCT FROM d.record_type
                    AND k.record_id   IS NOT DISTINCT FROM d.record_id);
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt > 0 THEN
    v_rewired := v_rewired || jsonb_build_object('public_records_dedup_dropped', v_cnt);
  END IF;

  -- ── Generic FK repoint (survivors have no keep twin → no collisions)
  FOR v_record IN
    SELECT n.nspname AS schemaname, t.relname AS tablename, a.attname AS colname
      FROM pg_constraint c
      JOIN pg_class      t ON t.oid = c.conrelid
      JOIN pg_namespace  n ON n.oid = t.relnamespace
      JOIN pg_attribute  a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
     WHERE c.contype='f' AND c.confrelid='public.properties'::regclass AND n.nspname='public'
     ORDER BY t.relname, a.attname
  LOOP
    BEGIN
      EXECUTE format('UPDATE %I.%I SET %I = $1 WHERE %I = $2',
        v_record.schemaname, v_record.tablename, v_record.colname, v_record.colname)
      USING p_keep_id, p_drop_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n > 0 THEN
        v_rewired := v_rewired || jsonb_build_object(v_record.tablename || '.' || v_record.colname, v_n);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_rewired := v_rewired || jsonb_build_object(v_record.tablename || '.' || v_record.colname || '_error', SQLERRM);
    END;
  END LOOP;

  DELETE FROM public.properties WHERE property_id = p_drop_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rewired := v_rewired || jsonb_build_object('properties_deleted', v_n);

  RETURN jsonb_build_object(
    'keep_id', p_keep_id, 'drop_id', p_drop_id, 'rewired', v_rewired,
    'merge_function_version', 'p5c_sales_collision_collapse_2026_06_01'
  );
END;
$function$;

-- Resolve the open warnings caused purely by this bug; new runs won't reopen them.
UPDATE public.lcc_health_alerts
   SET resolved_at = NOW(),
       resolved_note = 'Resolved by 20260601150000: dia_merge_property now collapses sales unique-key collisions before repoint.'
 WHERE resolved_at IS NULL
   AND alert_kind = 'auto_merge_property_failures'
   AND source = 'dia';
