-- Round 66x.2 — dia_merge_property: dedup ownership_history before the generic
-- FK-rewire. The Step-3 DUP_REVIEW property merges surfaced this: repointing a
-- drop property's ownership_history rows to the keep property collides on the
-- UNIQUE index (property_id, start_date) AND the EXCLUSION constraint
-- excl_oh_no_overlap (no overlapping ownership date-ranges per property). The
-- function's generic FK-rewire does a blanket UPDATE per child table and catches
-- per-TABLE errors, so the first ownership_history clash aborts the whole table
-- UPDATE, leaving rows on the drop property -> the final DELETE of the drop fails
-- its FK ("ownership_history_property_id_fkey"). Symptom on every affected merge.
--
-- Fix: add a per-ROW repoint with collision-delete for ownership_history (catch
-- unique_violation OR exclusion_violation -> the drop's row duplicates/overlaps
-- the keep's authoritative ownership period, so drop it), mirroring the existing
-- per-row handling for sales_transactions and leases. Inserted just before the
-- generic FK loop via targeted string-replace of the live definition. Idempotent.
DO $outer$
DECLARE src text; blk text; newsrc text;
BEGIN
  src := pg_get_functiondef('public.dia_merge_property(integer,integer)'::regprocedure);
  IF position('ownership_history WHERE property_id = p_drop_id' IN src) > 0 THEN
    RAISE NOTICE 'dia_merge_property already patched for ownership_history'; RETURN;
  END IF;
  blk := '  DECLARE v_oh bigint; BEGIN'
      || ' FOR v_oh IN SELECT ownership_id FROM public.ownership_history WHERE property_id = p_drop_id LOOP'
      || '   BEGIN UPDATE public.ownership_history SET property_id = p_keep_id WHERE ownership_id = v_oh;'
      || '   EXCEPTION WHEN unique_violation OR exclusion_violation THEN DELETE FROM public.ownership_history WHERE ownership_id = v_oh; END;'
      || ' END LOOP; END;' || chr(10) || '  ';
  newsrc := replace(src, '  FOR v_record IN', blk || 'FOR v_record IN');
  IF newsrc = src THEN RAISE EXCEPTION 'patch marker "FOR v_record IN" not found in dia_merge_property'; END IF;
  EXECUTE newsrc;
END $outer$;
