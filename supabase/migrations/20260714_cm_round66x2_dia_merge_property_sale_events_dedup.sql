-- Round 66x.2 — dia_merge_property: dedup property_sale_events before the generic
-- FK-rewire. Same failure class as the ownership_history patch (20260713), surfaced
-- by the address-variant twin merge 26111<-26166: repointing a drop property's
-- property_sale_events rows to the keep property collides on the UNIQUE constraint
-- uq_pse_property_date_price (property_id, sale_date, price). property_sale_events
-- additionally has property_id NOT NULL and an FK ON DELETE SET NULL — so the
-- generic blanket-UPDATE per child table aborts on the first collision, leaves the
-- colliding row on the drop property, and then the final DELETE of the drop fires
-- the FK's SET NULL, which violates the NOT NULL -> the whole merge fails.
--
-- Fix: add a per-ROW repoint with collision-delete for property_sale_events (catch
-- unique_violation OR exclusion_violation -> the drop's row duplicates the keep's
-- authoritative sale event, so drop it), mirroring the per-row handling already in
-- place for sales_transactions, leases, and ownership_history (20260713). Inserted
-- just before the generic FK loop via targeted string-replace of the live
-- definition. Idempotent; safe to run after the ownership_history patch.
DO $outer$
DECLARE src text; blk text; newsrc text;
BEGIN
  src := pg_get_functiondef('public.dia_merge_property(integer,integer)'::regprocedure);
  IF position('property_sale_events WHERE property_id = p_drop_id' IN src) > 0 THEN
    RAISE NOTICE 'dia_merge_property already patched for property_sale_events'; RETURN;
  END IF;
  blk := '  DECLARE v_pse bigint; BEGIN'
      || ' FOR v_pse IN SELECT sale_event_id FROM public.property_sale_events WHERE property_id = p_drop_id LOOP'
      || '   BEGIN UPDATE public.property_sale_events SET property_id = p_keep_id WHERE sale_event_id = v_pse;'
      || '   EXCEPTION WHEN unique_violation OR exclusion_violation THEN DELETE FROM public.property_sale_events WHERE sale_event_id = v_pse; END;'
      || ' END LOOP; END;' || chr(10) || '  ';
  newsrc := replace(src, '  FOR v_record IN', blk || 'FOR v_record IN');
  IF newsrc = src THEN RAISE EXCEPTION 'patch marker "FOR v_record IN" not found in dia_merge_property'; END IF;
  EXECUTE newsrc;
END $outer$;
