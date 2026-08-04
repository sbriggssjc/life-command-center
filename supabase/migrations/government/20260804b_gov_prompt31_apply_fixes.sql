-- Prompt 31 gov apply fixes (2026-08-04), discovered running the apply live:
-- 1) functional index so the plan view computes fast.
CREATE INDEX IF NOT EXISTS idx_properties_gov_norm_addr_state
  ON public.properties (lower(coalesce(state::text,'')), public.gov_normalize_address(address));

-- 2) gov properties.property_id is bigint but gov_merge_property(integer,integer): cast at call site.
-- 3) add p_limit so merges apply in sub-60s batches (gov_merge_property is heavy);
--    replaces the original 2-arg overload (dropped below to avoid ambiguity).
CREATE OR REPLACE FUNCTION public.p31_property_consolidation_apply(
  p_dry_run boolean DEFAULT true, p_batch_tag text DEFAULT NULL, p_limit integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $FN$
DECLARE
  v_batch text := coalesce(NULLIF(p_batch_tag,''), 'p31_gov_property_consolidation_'||to_char(now(),'YYYYMMDD_HH24MISS'));
  v_candidate_count integer := 0; v_applied integer := 0; v_rec record; v_result jsonb;
BEGIN
  SELECT count(*) INTO v_candidate_count FROM public.v_p31_property_consolidation_plan WHERE lane='auto_merge';
  IF p_dry_run THEN
    RETURN jsonb_build_object('dry_run',true,'batch_tag',v_batch,'auto_merge_candidates',v_candidate_count,
      'review_candidates',(SELECT count(*) FROM public.v_p31_property_consolidation_review),
      'plan_view','public.v_p31_property_consolidation_plan');
  END IF;
  FOR v_rec IN SELECT * FROM public.v_p31_property_consolidation_plan WHERE lane='auto_merge'
               ORDER BY norm_state, norm_address, drop_id LOOP
    IF p_limit IS NOT NULL AND v_applied >= p_limit THEN EXIT; END IF;
    IF EXISTS (SELECT 1 FROM public.p31_property_consolidation_log
               WHERE batch_tag=v_batch AND keep_id=v_rec.keep_id AND drop_id=v_rec.drop_id AND decision='applied')
    THEN CONTINUE; END IF;
    INSERT INTO public.p31_property_consolidation_log
      (batch_tag,keep_id,drop_id,confidence,decision,evidence,keep_snapshot,drop_snapshot)
    SELECT v_batch,v_rec.keep_id,v_rec.drop_id,v_rec.confidence,'started',v_rec.evidence,
      (SELECT to_jsonb(p) FROM public.properties p WHERE p.property_id=v_rec.keep_id),
      (SELECT to_jsonb(p) FROM public.properties p WHERE p.property_id=v_rec.drop_id)
    ON CONFLICT (batch_tag,keep_id,drop_id) DO UPDATE
      SET confidence=EXCLUDED.confidence, evidence=EXCLUDED.evidence,
          keep_snapshot=EXCLUDED.keep_snapshot, drop_snapshot=EXCLUDED.drop_snapshot;
    v_result := public.gov_merge_property(v_rec.keep_id::integer, v_rec.drop_id::integer);
    UPDATE public.p31_property_consolidation_log SET decision='applied', merge_result=v_result, applied_at=now()
      WHERE batch_tag=v_batch AND keep_id=v_rec.keep_id AND drop_id=v_rec.drop_id;
    v_applied := v_applied + 1;
  END LOOP;
  RETURN jsonb_build_object('dry_run',false,'batch_tag',v_batch,'auto_merge_candidates_at_start',v_candidate_count,
    'applied',v_applied,'review_candidates_remaining',(SELECT count(*) FROM public.v_p31_property_consolidation_review));
END; $FN$;
DROP FUNCTION IF EXISTS public.p31_property_consolidation_apply(boolean, text);
GRANT EXECUTE ON FUNCTION public.p31_property_consolidation_apply(boolean, text, integer) TO authenticated, service_role;
