-- ============================================================================
-- Migration: rebuild gov find_property_consolidation_candidates so it strips
--            CoStar/LoopNet listing-status prefixes ("For Sale | ", …) before
--            comparing addresses, matching the dialysis side
--            (20260504110000_dia_normalize_address_strip_listing_prefix.sql).
--
-- Target:    government Supabase
--
-- Why: same root cause as dia. Sidebar captures of CoStar /for-sale/ and
-- LoopNet pages occasionally leak the listing-status heading prefix into
-- properties.address. The "🔗 Consolidate" sidebar action's
-- exact_address_dups query previously compared
--   lower(regexp_replace(trim(coalesce(p.address, '')), '\s+', ' ', 'g'))
-- which is just whitespace+case normalization, so the prefixed and bare
-- forms never matched and the merge button never appeared.
--
-- Add an inline gov_normalize_address() helper that strips the prefix and
-- collapses whitespace, then have the candidates RPC call it.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION public.gov_normalize_address(addr text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(trim(regexp_replace(
    regexp_replace(
      coalesce(addr, ''),
      '^\s*(for\s+sale|for\s+lease|for\s+rent|sale|sold|lease|rent|new\s+listing|reduced|price\s+reduced|just\s+listed|coming\s+soon|under\s+contract|off\s+market|new\s+price)\s*[|\-–—:]\s*',
      '',
      'i'
    ),
    '\s+', ' ', 'g'
  )));
$$;

COMMENT ON FUNCTION public.gov_normalize_address(text) IS
  'Address key for gov consolidation lookups. Strips CoStar/LoopNet listing-
   status prefixes ("For Sale | ", "Reduced | ", …) so prefixed sidebar
   captures group with their canonical bare-address row. Whitespace
   collapsed, lowercased.';

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
         gov_normalize_address(address) AS na,
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
    AND gov_normalize_address(p.address) = v_subject.na
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
      AND gov_normalize_address(p.address) <> v_subject.na;

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
