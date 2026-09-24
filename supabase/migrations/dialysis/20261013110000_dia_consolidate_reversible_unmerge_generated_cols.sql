-- CONSOLIDATE-REVERSIBLE (2026-09-24) — dia_unmerge_property: same latent defect as gov.
--
-- The gov twin raised 428C9 on every unmerge (gov properties gained generated
-- columns; the unmerge re-inserted with `INSERT ... SELECT *`). dia properties has
-- no generated column today (measured 2026-09-24), so dia still works — but the
-- first generated column added to dia properties would make the unmerge raise for all 591 live
-- dia merge backups irreversible. Same fix, preventive.
--
-- Fix: insert an explicit column list that excludes generated columns (they
-- recompute). Body otherwise identical to the live definition. Privileges
-- re-asserted (SECURITY DEFINER): service_role only.
-- Revert: re-apply the previous body (SELECT * insert).

CREATE OR REPLACE FUNCTION public.dia_unmerge_property(p_backup_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_b record; v_key text; v_ent jsonb; v_pk text; v_ids jsonb; v_tbl text; v_col text;
  v_n integer; v_report jsonb := '{}'::jsonb; v_repointed integer := 0; v_cols text;
BEGIN
  SELECT * INTO v_b FROM public.dia_property_merge_backup WHERE backup_id = p_backup_id;
  IF v_b IS NULL THEN RAISE EXCEPTION 'dia_unmerge_property: backup % not found', p_backup_id; END IF;
  IF v_b.unmerged_at IS NOT NULL THEN RAISE EXCEPTION 'dia_unmerge_property: backup % already unmerged', p_backup_id; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.properties WHERE property_id = v_b.dropped_property_id) THEN
    -- CONSOLIDATE-REVERSIBLE: name the columns. `INSERT ... SELECT *` fails 428C9
    -- as soon as properties gains a GENERATED column (gov: county_norm, city_norm),
    -- which made every unmerge raise. Generated columns recompute on insert.
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
      FROM pg_attribute a
     WHERE a.attrelid = 'public.properties'::regclass AND a.attnum > 0
       AND NOT a.attisdropped AND a.attgenerated = '';
    EXECUTE format('INSERT INTO public.properties (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM jsonb_populate_record(NULL::public.properties, $1)', v_cols, v_cols)
      USING v_b.row_json;
    v_report := v_report || jsonb_build_object('property_reinserted', v_b.dropped_property_id);
  ELSE
    v_report := v_report || jsonb_build_object('property_already_present', v_b.dropped_property_id);
  END IF;
  FOR v_key, v_ent IN SELECT * FROM jsonb_each(v_b.child_keys) LOOP
    v_tbl := split_part(v_key, '.', 1); v_col := split_part(v_key, '.', 2);
    v_pk := v_ent->>'pk'; v_ids := v_ent->'ids';
    BEGIN
      EXECUTE format('UPDATE public.%I SET %I = $1 WHERE %I = $2 AND %I::text = ANY(SELECT jsonb_array_elements_text($3))',
                     v_tbl, v_col, v_col, v_pk)
        USING v_b.dropped_property_id, v_b.kept_property_id, v_ids;
      GET DIAGNOSTICS v_n = ROW_COUNT; v_repointed := v_repointed + v_n;
      v_report := v_report || jsonb_build_object(v_key || '_repointed', v_n, v_key || '_lost', jsonb_array_length(v_ids) - v_n);
    EXCEPTION WHEN OTHERS THEN v_report := v_report || jsonb_build_object(v_key || '_error', SQLERRM); END;
  END LOOP;
  v_report := v_report || jsonb_build_object('total_children_repointed', v_repointed,
                'note', 'dedup-deleted children (see backup.rewired *_dedup_dropped) are not recoverable');
  UPDATE public.dia_property_merge_backup SET unmerged_at = now(), unmerge_report = v_report WHERE backup_id = p_backup_id;
  UPDATE public.dia_property_redirects SET reversed_at = now()
   WHERE dropped_property_id = v_b.dropped_property_id AND reversed_at IS NULL;
  UPDATE public.dia_property_twin_review
     SET status='pending', backup_id=NULL, resolved_at=NULL,
         resolution_note = coalesce(resolution_note,'') || ' [unmerged '||now()::text||']'
   WHERE backup_id = p_backup_id;
  RETURN v_report;
END;
$function$;

revoke all on function public.dia_unmerge_property(bigint) from public, anon, authenticated;
grant execute on function public.dia_unmerge_property(bigint) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.dia_unmerge_property(bigint)', 'execute')
     or has_function_privilege('authenticated', 'public.dia_unmerge_property(bigint)', 'execute') then
    raise exception 'dia_unmerge_property is still reachable by anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.dia_unmerge_property(bigint)', 'execute') then
    raise exception 'dia_unmerge_property lost its service_role grant';
  end if;
end $$;
