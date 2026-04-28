-- ============================================================================
-- Round 76be — Property consolidation lookup function (dia)
--
-- Backs the "🔗 Consolidate" button on the property detail page.
-- GET /api/consolidate-property?domain=dia&property_id=X invokes this RPC.
--
-- Returns three sections:
--   exact_address_dups: same normalized address+state (high-confidence merge)
--   same_chain_in_city: same chain operator (first significant word of
--                       normalize_entity_name(tenant)) in same city, different
--                       address — review before merging
--   chain_summary:      total properties for this chain in this state +
--                       top cities distribution
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
  SELECT property_id, address, city, state, tenant, medicare_id, building_size,
         year_built, recorded_owner_name,
         dia_normalize_address(address) AS na,
         dia_normalize_state(state) AS ns,
         split_part(normalize_entity_name(coalesce(tenant, '')), ' ', 1) AS chain_token
    INTO v_subject FROM public.properties WHERE property_id = p_property_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'property not found', 'property_id', p_property_id);
  END IF;
  v_chain_token := v_subject.chain_token;

  SELECT jsonb_agg(jsonb_build_object(
    'property_id', p.property_id, 'address', p.address, 'city', p.city, 'state', p.state,
    'tenant', p.tenant, 'medicare_id', p.medicare_id, 'building_size', p.building_size,
    'year_built', p.year_built,
    'enrichment_score',
      (CASE WHEN p.tenant IS NOT NULL THEN 5 ELSE 0 END +
       CASE WHEN p.building_size > 0 THEN 3 ELSE 0 END +
       CASE WHEN p.year_built IS NOT NULL THEN 2 ELSE 0 END +
       CASE WHEN p.medicare_id IS NOT NULL THEN 4 ELSE 0 END +
       CASE WHEN p.zip_code IS NOT NULL THEN 1 ELSE 0 END),
    'n_sales', (SELECT count(*) FROM public.sales_transactions WHERE property_id=p.property_id),
    'n_leases', (SELECT count(*) FROM public.leases WHERE property_id=p.property_id),
    'tenant_chain_match',
      (split_part(normalize_entity_name(coalesce(p.tenant,'')), ' ', 1) = v_chain_token)
  ) ORDER BY p.property_id)
  INTO v_exact_dups
  FROM public.properties p
  WHERE p.property_id <> v_subject.property_id
    AND dia_normalize_address(p.address) = v_subject.na
    AND dia_normalize_state(p.state) = v_subject.ns;

  IF v_chain_token <> '' THEN
    SELECT jsonb_agg(jsonb_build_object(
      'property_id', p.property_id, 'address', p.address, 'city', p.city, 'state', p.state,
      'tenant', p.tenant, 'building_size', p.building_size, 'medicare_id', p.medicare_id,
      'normalized_address', dia_normalize_address(p.address),
      'similarity_to_subject',
        round(GREATEST(
          similarity(dia_normalize_address(p.address), v_subject.na),
          similarity(coalesce(p.address, ''), coalesce(v_subject.address, ''))
        )::numeric, 3)
    ) ORDER BY p.property_id)
    INTO v_same_chain_nearby
    FROM public.properties p
    WHERE p.property_id <> v_subject.property_id
      AND split_part(normalize_entity_name(coalesce(p.tenant, '')), ' ', 1) = v_chain_token
      AND dia_normalize_state(p.state) = v_subject.ns
      AND lower(coalesce(p.city, '')) = lower(coalesce(v_subject.city, ''))
      AND dia_normalize_address(p.address) <> v_subject.na;

    SELECT jsonb_build_object(
      'chain_token', v_chain_token, 'state', v_subject.state,
      'total_in_state', count(*), 'cities_in_state', count(DISTINCT city),
      'top_cities',
        (SELECT jsonb_agg(jsonb_build_object('city', c, 'n', n))
         FROM (SELECT lower(city) AS c, count(*) AS n FROM public.properties
               WHERE split_part(normalize_entity_name(coalesce(tenant, '')), ' ', 1) = v_chain_token
                 AND dia_normalize_state(state) = v_subject.ns AND city IS NOT NULL
               GROUP BY 1 ORDER BY 2 DESC LIMIT 5) x)
    ) INTO v_chain_summary
    FROM public.properties
    WHERE split_part(normalize_entity_name(coalesce(tenant, '')), ' ', 1) = v_chain_token
      AND dia_normalize_state(state) = v_subject.ns;
  END IF;

  RETURN jsonb_build_object(
    'subject', jsonb_build_object('property_id', v_subject.property_id,
      'address', v_subject.address, 'city', v_subject.city, 'state', v_subject.state,
      'tenant', v_subject.tenant, 'chain_token', v_chain_token, 'medicare_id', v_subject.medicare_id),
    'exact_address_dups', COALESCE(v_exact_dups, '[]'::jsonb),
    'exact_dup_count', COALESCE(jsonb_array_length(v_exact_dups), 0),
    'same_chain_in_city', COALESCE(v_same_chain_nearby, '[]'::jsonb),
    'same_chain_count', COALESCE(jsonb_array_length(v_same_chain_nearby), 0),
    'chain_summary', COALESCE(v_chain_summary, '{}'::jsonb)
  );
END $$;
