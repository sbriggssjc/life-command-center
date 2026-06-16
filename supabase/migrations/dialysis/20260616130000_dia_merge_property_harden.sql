-- ============================================================================
-- Unit 3 (dia) — harden dia_merge_property's sales_transactions collision path so
-- a blocked/colliding delete can NEVER abort the merge with a 500, and so a
-- dropped duplicate sale's children FOLLOW the merge instead of being discarded.
--
-- The deployed dia function's sales collision branch explicitly DELETEd the
-- dropped sale's broker_market_coverage / loans / property_documents child rows
-- (silent data loss) and then deleted the sale — and if any of those deletes were
-- refused it would 500. With the Unit 2 FK fix (those three FKs are now SET NULL)
-- the children no longer need pre-deleting; the hardened branch instead:
--   * re-points the dropped sale's child references to the SURVIVING keep-side
--     sale when the duplicate can be matched unambiguously (links follow the
--     merge), else lets the SET NULL / CASCADE FKs handle them on delete; and
--   * wraps the whole per-sale step so a still-blocked delete is RECORDED in
--     `rewired` (…_delete_failed) and the merge continues.
--
-- Everything else is reproduced verbatim from the live function (the leases /
-- available_listings / property_public_records dedups and the ownership_history /
-- property_sale_events per-row repoint blocks composed from prior rounds), so this
-- migration is a faithful supersede — only the #3 sales block + the version tag
-- change. SECURITY DEFINER preserved; CREATE OR REPLACE preserves grants.
--
-- Provenance: structural fix; no business-data writes. Idempotent.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dia_merge_property(p_keep_id integer, p_drop_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_rewired             jsonb := '{}'::jsonb;
  v_n                   integer;
  v_record              record;
  v_cnt                 integer;
  v_sid                 integer;
  v_keep_sale           integer;
  v_fk                  record;
  v_rep                 integer := 0;
  v_drp                 integer := 0;
  v_setnull             integer := 0;
  v_children_repointed  integer := 0;
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

  -- #1 leases dedup
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

  -- #2 available_listings dedup
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

  -- #3 sales_transactions: per-row repoint; true duplicates collide on a unique
  -- key. On a collision the dropped sale's child references follow the merge to
  -- the surviving keep-side sale where it can be matched unambiguously; otherwise
  -- the ON DELETE SET NULL / CASCADE FKs (Unit 2) handle them. The whole per-sale
  -- step is guarded so a still-blocked delete is RECORDED, never fatal.
  FOR v_sid IN
    SELECT sale_id FROM public.sales_transactions WHERE property_id = p_drop_id
  LOOP
    BEGIN
      UPDATE public.sales_transactions SET property_id = p_keep_id WHERE sale_id = v_sid;
      v_rep := v_rep + 1;
    EXCEPTION WHEN unique_violation THEN
      BEGIN
        SELECT k.sale_id INTO v_keep_sale
          FROM public.sales_transactions d
          JOIN public.sales_transactions k
            ON k.property_id = p_keep_id
           AND k.sale_date IS NOT DISTINCT FROM d.sale_date
           AND COALESCE(k.sold_price, -1) = COALESCE(d.sold_price, -1)
         WHERE d.sale_id = v_sid
         ORDER BY k.sale_id
         LIMIT 1;

        IF v_keep_sale IS NOT NULL THEN
          FOR v_fk IN
            SELECT t.relname AS tbl, a.attname AS col
              FROM pg_constraint c
              JOIN pg_class      t ON t.oid = c.conrelid
              JOIN pg_namespace  n ON n.oid = t.relnamespace
              JOIN pg_attribute  a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
             WHERE c.contype = 'f'
               AND c.confrelid = 'public.sales_transactions'::regclass
               AND n.nspname = 'public'
          LOOP
            BEGIN
              EXECUTE format('UPDATE public.%I SET %I = $1 WHERE %I = $2', v_fk.tbl, v_fk.col, v_fk.col)
                USING v_keep_sale, v_sid;
              GET DIAGNOSTICS v_n = ROW_COUNT;
              v_children_repointed := v_children_repointed + v_n;
            EXCEPTION WHEN OTHERS THEN
              NULL;  -- child re-point collided; FK SET NULL/CASCADE handles on delete
            END;
          END LOOP;
        END IF;

        DELETE FROM public.sales_transactions WHERE sale_id = v_sid;
        v_drp := v_drp + 1;
        IF v_keep_sale IS NULL THEN
          v_setnull := v_setnull + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_rewired := v_rewired || jsonb_build_object(
          'sales_transactions.sale_id_delete_failed:' || v_sid::text, SQLERRM);
      END;
      v_keep_sale := NULL;
    END;
  END LOOP;
  IF (v_rep + v_drp) > 0 THEN
    v_rewired := v_rewired || jsonb_build_object(
      'sales_repointed', v_rep,
      'sales_dedup_dropped', v_drp,
      'sale_children_repointed', v_children_repointed,
      'sales_dropped_children_setnull', v_setnull);
  END IF;

  -- #4 property_public_records dedup
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

  -- #5 ownership_history per-row repoint (preserved from prior rounds)
  DECLARE v_oh bigint;
  BEGIN
    FOR v_oh IN SELECT ownership_id FROM public.ownership_history WHERE property_id = p_drop_id LOOP
      BEGIN
        UPDATE public.ownership_history SET property_id = p_keep_id WHERE ownership_id = v_oh;
      EXCEPTION WHEN unique_violation OR exclusion_violation THEN
        DELETE FROM public.ownership_history WHERE ownership_id = v_oh;
      END;
    END LOOP;
  END;

  -- #6 property_sale_events per-row repoint (preserved from prior rounds)
  DECLARE v_pse bigint;
  BEGIN
    FOR v_pse IN SELECT sale_event_id FROM public.property_sale_events WHERE property_id = p_drop_id LOOP
      BEGIN
        UPDATE public.property_sale_events SET property_id = p_keep_id WHERE sale_event_id = v_pse;
      EXCEPTION WHEN unique_violation OR exclusion_violation THEN
        DELETE FROM public.property_sale_events WHERE sale_event_id = v_pse;
      END;
    END LOOP;
  END;

  -- #7 generic property-FK repoint for the remaining children (sales_transactions
  -- is already fully repointed above). Each FK is guarded — a failure records an
  -- error and the merge continues.
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

  -- Final property delete, guarded: if some still-blocking child kept the drop
  -- row referenced (cannot occur in the fixed schema, but defense-in-depth), the
  -- failure is RECORDED and properties_deleted=0 — never a fatal 500.
  BEGIN
    DELETE FROM public.properties WHERE property_id = p_drop_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_n := 0;
    v_rewired := v_rewired || jsonb_build_object('properties_delete_failed', SQLERRM);
  END;
  v_rewired := v_rewired || jsonb_build_object('properties_deleted', v_n);

  RETURN jsonb_build_object(
    'keep_id', p_keep_id, 'drop_id', p_drop_id, 'rewired', v_rewired,
    'merge_function_version', 'dia_harden_sale_repoint_2026_06_16'
  );
END;
$function$;
