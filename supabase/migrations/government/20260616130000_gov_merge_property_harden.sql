-- ============================================================================
-- Unit 3 (gov) — harden gov_merge_property so a blocked/colliding child delete
-- can NEVER abort the whole merge with a 500.
--
-- The schema fix (Unit 1) removes the known blockers, but the function's
-- structure made ANY future blocked delete fatal: the `WHEN unique_violation`
-- fallback ran a DELETE that, if itself refused (a NO ACTION grandchild), raised
-- an error the sibling `WHEN OTHERS` could not catch, so it propagated.
--
-- Two changes:
--   1. Dedicated PER-ROW sales_transactions repoint (mirrors dia). The old code
--      bulk-`UPDATE`d every drop-side sale and, on the first collision, bulk-
--      DELETEd ALL drop-side sales — even the non-colliding ones. Per-row repoint
--      moves the non-duplicates and only removes true duplicates. On a collision
--      it re-points the dropped sale's child references to the SURVIVING keep-side
--      sale (links follow the merge) when the duplicate can be matched
--      unambiguously; otherwise the now-SET NULL / CASCADE FKs handle the children
--      on delete. The whole per-sale step is wrapped so a still-blocked delete is
--      RECORDED in `rewired` (…_delete_failed) and the merge continues.
--   2. The generic property-FK loop's collision DELETE is wrapped in its own
--      BEGIN…EXCEPTION block, so a blocked secondary delete records
--      `<tbl>.<col>_delete_failed` instead of aborting the merge.
--
-- This migration also brings the repo back in sync: the live function had drifted
-- ahead of the committed 20260428290000 (it had grown the collision-DELETE path
-- directly, never committed). Function characteristics match live (SECURITY
-- INVOKER); CREATE OR REPLACE preserves existing grants.
--
-- Provenance: structural / role fix; no business-data writes. Idempotent.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.gov_merge_property(p_keep_id integer, p_drop_id integer)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_rewired             jsonb := '{}'::jsonb;
  v_count               int;
  v_n                   int;
  v_table_name          text;
  v_sid                 uuid;        -- gov sales_transactions.sale_id is uuid
  v_keep_sale           uuid;
  v_fk                  record;
  v_rep                 int := 0;   -- sales repointed
  v_drp                 int := 0;   -- duplicate sales dropped
  v_setnull             int := 0;   -- dropped sales whose children were SET NULL
  v_children_repointed  int := 0;   -- child rows re-pointed to the surviving sale
BEGIN
  IF p_keep_id = p_drop_id THEN
    RAISE EXCEPTION 'keep_id and drop_id must differ';
  END IF;

  -- #1 sales_transactions: per-row repoint; true duplicates collide on a unique
  -- key and are removed after their children follow the merge where possible.
  FOR v_sid IN
    SELECT sale_id FROM public.sales_transactions WHERE property_id = p_drop_id
  LOOP
    BEGIN
      UPDATE public.sales_transactions SET property_id = p_keep_id WHERE sale_id = v_sid;
      v_rep := v_rep + 1;
    EXCEPTION WHEN unique_violation THEN
      BEGIN
        -- Identify the surviving keep-side duplicate (exact date + price match).
        -- A coarser collision (e.g. a bucketed dedup key) may not match here, in
        -- which case v_keep_sale stays NULL and the FKs SET NULL the children.
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
          -- Re-point every child of the dropped sale to the surviving sale.
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
              -- child re-point collided/failed; the FK SET NULL/CASCADE handles
              -- it when the dropped sale is deleted below. Not fatal.
              NULL;
            END;
          END LOOP;
        END IF;

        DELETE FROM public.sales_transactions WHERE sale_id = v_sid;
        v_drp := v_drp + 1;
        IF v_keep_sale IS NULL THEN
          v_setnull := v_setnull + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- A still-blocked delete is RECORDED, never fatal.
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

  -- #2 generic property-FK repoint for all remaining children. sales_transactions
  -- is already fully handled above, so its pass here is a 0-row no-op.
  FOR v_table_name IN
    SELECT n.nspname || '.' || t.relname || '|' || a.attname
      FROM pg_constraint c
      JOIN pg_class      t ON t.oid = c.conrelid
      JOIN pg_namespace  n ON n.oid = t.relnamespace
      JOIN pg_attribute  a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
     WHERE c.contype = 'f'
       AND c.confrelid = 'public.properties'::regclass
       AND n.nspname = 'public'
  LOOP
    DECLARE
      v_tbl text := split_part(v_table_name, '|', 1);
      v_col text := split_part(v_table_name, '|', 2);
    BEGIN
      EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', v_tbl, v_col, v_col)
        USING p_keep_id, p_drop_id;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      IF v_count > 0 THEN
        v_rewired := v_rewired || jsonb_build_object(v_tbl || '.' || v_col, v_count);
      END IF;
    EXCEPTION
      WHEN unique_violation THEN
        -- The dropped child duplicates a keep-side row; delete it. Wrapped in its
        -- own block so a blocked secondary-FK delete RECORDS instead of aborting.
        BEGIN
          EXECUTE format('DELETE FROM %s WHERE %I = $1', v_tbl, v_col) USING p_drop_id;
          GET DIAGNOSTICS v_count = ROW_COUNT;
          v_rewired := v_rewired || jsonb_build_object(v_tbl || '.' || v_col || '_deleted_on_collision', v_count);
        EXCEPTION WHEN OTHERS THEN
          v_rewired := v_rewired || jsonb_build_object(v_tbl || '.' || v_col || '_delete_failed', SQLERRM);
        END;
      WHEN OTHERS THEN
        v_rewired := v_rewired || jsonb_build_object(v_tbl || '.' || v_col || '_error', SQLERRM);
    END;
  END LOOP;

  -- Final property delete, guarded: if some still-blocking child kept the drop
  -- row referenced (cannot occur in the fixed schema, but defense-in-depth), the
  -- failure is RECORDED and property_deleted=0 — never a fatal 500.
  BEGIN
    DELETE FROM public.properties WHERE property_id = p_drop_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_count := 0;
    v_rewired := v_rewired || jsonb_build_object('properties_delete_failed', SQLERRM);
  END;

  RETURN jsonb_build_object(
    'keep_id', p_keep_id, 'drop_id', p_drop_id,
    'rewired', v_rewired, 'property_deleted', v_count,
    'merge_function_version', 'gov_harden_sale_repoint_2026_06_16');
END;
$function$;
