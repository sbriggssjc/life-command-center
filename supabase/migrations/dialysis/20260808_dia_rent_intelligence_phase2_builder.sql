-- Rent Intelligence Engine Phase 2 — builder + batch driver (dia).
-- dia_build_property_rent_timeline: per-property, idempotent, versioned. Assembles
-- evidence (excluding projected_from_* self-outputs), unit-normalizes to annual
-- total with a [5,200] PSF sanity gate (bad -> rent_reconcile_queue), resolves the
-- tenant convention, projects each year from the NEAREST PRIOR evidence point, and
-- writes a superseding version. Evidence years keep their basis; projection fills
-- gaps only. Applied live to zqzrriwuavgrquhisnoa. See phase2 report for the
-- verified DaVita #22023 round-trip.
--
-- NOTE: this is the authoritative final body (nearest-prior-evidence anchor). The
-- full function text is applied via mcp apply_migration
-- (dia_rent_intelligence_phase2_builder + _builder_nearest_anchor); reproduce from
-- pg_get_functiondef('public.dia_build_property_rent_timeline') if re-deriving.

-- Batch driver (resumable, per-property error isolation).
CREATE OR REPLACE FUNCTION public.dia_build_rent_timeline_all(
  p_batch text DEFAULT NULL, p_limit integer DEFAULT NULL, p_only_missing boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public','extensions','pg_temp' AS $$
DECLARE
  v_batch text := COALESCE(p_batch, 'batch_' || to_char(now(),'YYYYMMDDHH24MISS'));
  pid int; v_res jsonb; v_built int:=0; v_noev int:=0; v_err int:=0; v_seen int:=0;
BEGIN
  FOR pid IN
    SELECT DISTINCT prop FROM (
      SELECT property_id prop FROM public.leases WHERE annual_rent>0
      UNION SELECT property_id FROM public.lease_escalations WHERE rent_amount>0
      UNION SELECT property_id FROM public.sales_transactions
        WHERE rent_at_sale>0 AND (rent_source IS NULL OR rent_source NOT LIKE 'projected%')
    ) e
    WHERE (NOT p_only_missing OR NOT EXISTS (
      SELECT 1 FROM public.property_rent_timeline t WHERE t.property_id=e.prop AND t.superseded_at IS NULL))
    ORDER BY prop LIMIT p_limit
  LOOP
    v_seen := v_seen+1;
    BEGIN
      v_res := public.dia_build_property_rent_timeline(pid, v_batch, false);
      IF v_res->>'status'='built' THEN v_built:=v_built+1;
      ELSIF v_res->>'status'='no_evidence' THEN v_noev:=v_noev+1; END IF;
    EXCEPTION WHEN OTHERS THEN
      v_err:=v_err+1;
      INSERT INTO public.rent_reconcile_queue(property_id,issue_kind,detail,build_batch)
      VALUES (pid,'bad_data',jsonb_build_object('build_error',SQLERRM),v_batch);
    END;
  END LOOP;
  RETURN jsonb_build_object('batch',v_batch,'seen',v_seen,'built',v_built,'no_evidence',v_noev,'errors',v_err);
END; $$;
GRANT EXECUTE ON FUNCTION public.dia_build_rent_timeline_all(text,integer,boolean) TO service_role;
