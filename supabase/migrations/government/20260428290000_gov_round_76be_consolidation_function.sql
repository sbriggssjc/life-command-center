-- ============================================================================
-- Round 76be (gov) — Property consolidation lookup + merge function.
-- Mirror of dia 76be. Uses agency vs tenant, rba vs building_size,
-- lease_number vs medicare_id.
-- Also adds gov_merge_property() since gov didn't have one.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION public.find_property_consolidation_candidates(p_property_id integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_subject record;
  v_chain_token text;
  v_exact_dups jsonb;
  v_same_chain_nearby jsonb;
  v_chain_summary jsonb;
BEGIN
  SELECT property_id, address, city, state, agency, lease_number, rba, year_built,
         lower(regexp_replace(trim(coalesce(address,'')), '\s+', ' ', 'g')) AS na,
         lower(coalesce(state,'')) AS ns,
         split_part(normalize_entity_name(coalesce(agency, '')), ' ', 1) AS chain_token
    INTO v_subject FROM public.properties WHERE property_id = p_property_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'property not found', 'property_id', p_property_id);
  END IF;
  v_chain_token := v_subject.chain_token;

  SELECT jsonb_agg(jsonb_build_object(
    'property_id', p.property_id, 'address', p.address, 'city', p.city, 'state', p.state,
    'agency', p.agency, 'lease_number', p.lease_number, 'rba', p.rba, 'year_built', p.year_built,
    'enrichment_score',
      (CASE WHEN p.agency IS NOT NULL THEN 5 ELSE 0 END +
       CASE WHEN p.rba > 0 THEN 3 ELSE 0 END +
       CASE WHEN p.year_built IS NOT NULL THEN 2 ELSE 0 END +
       CASE WHEN p.lease_number IS NOT NULL THEN 4 ELSE 0 END),
    'n_sales', (SELECT count(*) FROM public.sales_transactions WHERE property_id=p.property_id),
    'n_leases', (SELECT count(*) FROM public.leases WHERE property_id=p.property_id)
  ) ORDER BY p.property_id)
  INTO v_exact_dups
  FROM public.properties p
  WHERE p.property_id <> v_subject.property_id
    AND lower(regexp_replace(trim(coalesce(p.address, '')), '\s+', ' ', 'g')) = v_subject.na
    AND lower(coalesce(p.state, '')) = v_subject.ns;

  IF v_chain_token <> '' THEN
    SELECT jsonb_agg(jsonb_build_object(
      'property_id', p.property_id, 'address', p.address, 'city', p.city, 'state', p.state,
      'agency', p.agency, 'rba', p.rba, 'lease_number', p.lease_number,
      'similarity_to_subject',
        round(similarity(coalesce(p.address, ''), coalesce(v_subject.address, ''))::numeric, 3)
    ) ORDER BY p.property_id)
    INTO v_same_chain_nearby
    FROM public.properties p
    WHERE p.property_id <> v_subject.property_id
      AND split_part(normalize_entity_name(coalesce(p.agency, '')), ' ', 1) = v_chain_token
      AND lower(coalesce(p.state, '')) = v_subject.ns
      AND lower(coalesce(p.city, '')) = lower(coalesce(v_subject.city, ''))
      AND lower(regexp_replace(trim(coalesce(p.address, '')), '\s+', ' ', 'g')) <> v_subject.na;

    SELECT jsonb_build_object(
      'chain_token', v_chain_token, 'state', v_subject.state,
      'total_in_state', count(*), 'cities_in_state', count(DISTINCT city),
      'top_cities',
        (SELECT jsonb_agg(jsonb_build_object('city', c, 'n', n))
         FROM (SELECT lower(city) AS c, count(*) AS n FROM public.properties
               WHERE split_part(normalize_entity_name(coalesce(agency, '')), ' ', 1) = v_chain_token
                 AND lower(coalesce(state, '')) = v_subject.ns AND city IS NOT NULL
               GROUP BY 1 ORDER BY 2 DESC LIMIT 5) x)
    ) INTO v_chain_summary
    FROM public.properties
    WHERE split_part(normalize_entity_name(coalesce(agency, '')), ' ', 1) = v_chain_token
      AND lower(coalesce(state, '')) = v_subject.ns;
  END IF;

  RETURN jsonb_build_object(
    'subject', jsonb_build_object('property_id', v_subject.property_id, 'address', v_subject.address,
      'city', v_subject.city, 'state', v_subject.state, 'agency', v_subject.agency,
      'chain_token', v_chain_token, 'lease_number', v_subject.lease_number),
    'exact_address_dups', COALESCE(v_exact_dups, '[]'::jsonb),
    'exact_dup_count', COALESCE(jsonb_array_length(v_exact_dups), 0),
    'same_chain_in_city', COALESCE(v_same_chain_nearby, '[]'::jsonb),
    'same_chain_count', COALESCE(jsonb_array_length(v_same_chain_nearby), 0),
    'chain_summary', COALESCE(v_chain_summary, '{}'::jsonb)
  );
END $$;

-- gov_merge_property — rewires all property_id FKs from drop to keep, then deletes.
CREATE OR REPLACE FUNCTION public.gov_merge_property(p_keep_id integer, p_drop_id integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_rewired jsonb := '{}'::jsonb;
  v_count int;
  v_table_name text;
BEGIN
  IF p_keep_id = p_drop_id THEN RAISE EXCEPTION 'keep_id and drop_id must differ'; END IF;

  FOR v_table_name IN
    SELECT n.nspname || '.' || t.relname || '|' || a.attname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'f' AND c.confrelid = 'public.properties'::regclass
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
    EXCEPTION WHEN OTHERS THEN
      v_rewired := v_rewired || jsonb_build_object(v_tbl || '.' || v_col || '_error', SQLERRM);
    END;
  END LOOP;

  DELETE FROM public.properties WHERE property_id = p_drop_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('keep_id', p_keep_id, 'drop_id', p_drop_id,
                            'rewired', v_rewired, 'property_deleted', v_count);
END $$;

GRANT EXECUTE ON FUNCTION public.gov_merge_property(integer, integer) TO authenticated, service_role;
