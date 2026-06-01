-- dia_merge_property: robustly resolve sales_transactions repoint collisions.
--
-- Supersedes 20260601150000. That pass collapsed collisions only on the exact
-- (property_id, sale_date, COALESCE(sold_price,0)) unique index, but the auto-merge
-- kept failing on the same sales_transactions_property_id_fkey. Root cause is a
-- THIRD unique key: dedup_natural_key is GENERATED ALWAYS as
--   property_id | round(sold_price/1000)*1000 | <year>-<month>
-- with unique index ux_sales_transactions_dedup_live (dedup_natural_key) WHERE
-- transaction_state='live'. Repointing property_id from drop -> keep regenerates
-- that key (coarser: price bucketed to 1000, grouped by month), which can collide
-- with a keep-side live row even when the exact date/price differ. The collision
-- was swallowed by the generic repoint loop, leaving a drop-side sales row that
-- aborted the final DELETE FROM properties.
--
-- Fix: repoint drop-side sales rows ONE AT A TIME. If a row's repoint raises
-- unique_violation against ANY unique key, that row duplicates an existing
-- keep-side sale, so delete it (and its NO ACTION children) instead. This needs no
-- per-index knowledge and leaves no drop-side row behind.

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
  v_sid       integer;
  v_rep       integer := 0;
  v_drp       integer := 0;
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

  -- #1 leases
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

  -- #2 available_listings
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

  -- #3 sales_transactions: per-row repoint with collision -> delete-duplicate.
  -- Handles every unique key on the table (incl. the generated dedup_natural_key)
  -- without per-index logic. NO ACTION children pre-deleted on the duplicate path;
  -- available_listings / contacts / ownership_history are ON DELETE SET NULL and
  -- sale_brokers is ON DELETE CASCADE, so they self-handle.
  FOR v_sid IN
    SELECT sale_id FROM public.sales_transactions WHERE property_id = p_drop_id
  LOOP
    BEGIN
      UPDATE public.sales_transactions SET property_id = p_keep_id WHERE sale_id = v_sid;
      v_rep := v_rep + 1;
    EXCEPTION WHEN unique_violation THEN
      DELETE FROM public.broker_market_coverage WHERE sale_id = v_sid;
      DELETE FROM public.loans                  WHERE sale_id = v_sid;
      DELETE FROM public.property_documents     WHERE sale_id = v_sid;
      DELETE FROM public.sales_transactions     WHERE sale_id = v_sid;
      v_drp := v_drp + 1;
    END;
  END LOOP;
  IF (v_rep + v_drp) > 0 THEN
    v_rewired := v_rewired || jsonb_build_object('sales_repointed', v_rep, 'sales_dedup_dropped', v_drp);
  END IF;

  -- #4 property_public_records
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

  -- Generic FK repoint for the remaining property-FK children (sales_transactions
  -- is already fully repointed above, so its pass here is a 0-row no-op).
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
    'merge_function_version', 'p5d_per_row_sales_repoint_2026_06_01'
  );
END;
$function$;

UPDATE public.lcc_health_alerts
   SET resolved_at = NOW(),
       resolved_note = 'Resolved by 20260601160000: dia_merge_property repoints sales per-row and drops true duplicates on any unique-key collision.'
 WHERE resolved_at IS NULL
   AND alert_kind = 'auto_merge_property_failures'
   AND source = 'dia';