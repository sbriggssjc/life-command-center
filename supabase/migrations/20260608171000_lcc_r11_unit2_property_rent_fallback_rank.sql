-- R11 Unit 2 (2026-06-08): representative-property rent as a FALLBACK rank.
--
-- The priority queue ranks on current_annual_rent_total (the portfolio rollup),
-- but P0.4 (ownership-resolution) entities typically have NO portfolio edge —
-- they carry a single REPRESENTATIVE property instead. 102 gov P0.4 rows (the
-- audit's "117 $0 rows that are NOT dia") + 1 dia ranked at $0 for this reason.
--
-- Fix: carry the representative property's rent into lcc_property_attributes
-- (synced from the domain attribute views — gov gross_rent/noi added in gov
-- 20260608170000, dia projected lease rent in dia 20260608171000) and rank on
-- COALESCE(NULLIF(rollup_rent,0), representative_property_rent, buyer_rollup).
--
-- DEPLOY ORDERING: apply AFTER both domain views (gov/dia 20260608170000/171000).
-- The enriched view already LEFT JOINs lcc_property_attributes for the
-- representative property, so the fallback is FREE on the hot path (no new join)
-- — the Slice-1 "push into the refresh if the join regresses" contingency is not
-- needed.
--
-- JS (admin.js ordering) ships on the Railway redeploy; until then the live app
-- keeps ordering by current_annual_rent_total — graceful, deploy-order safe.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Schema: rent + noi on the attributes mirror
-- ---------------------------------------------------------------------------
ALTER TABLE public.lcc_property_attributes
  ADD COLUMN IF NOT EXISTS annual_rent numeric,
  ADD COLUMN IF NOT EXISTS noi         numeric;

COMMENT ON COLUMN public.lcc_property_attributes.annual_rent IS
  'Per-property annual rent for representative-property fallback ranking. gov = '
  'gross_rent; dia = primary-lease rent projected to CURRENT_DATE (R11 Unit 2).';

-- ---------------------------------------------------------------------------
-- 2. Sync: dia leg repointed to the rent-bearing view; both legs pull rent
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_sync_property_attributes(p_domain text DEFAULT 'both')
RETURNS TABLE(domain text, pages_fired int) AS $$
DECLARE
  v_url      text;
  v_anon_key text;
  v_page     int;
  v_request_id bigint;
  v_pages_fired int;
  v_domain text;
  v_domains text[];
  v_url_path text;
  v_select_cols text;
  v_max_pages int;
BEGIN
  IF p_domain = 'both' THEN
    v_domains := ARRAY['dia','gov'];
  ELSE
    v_domains := ARRAY[p_domain];
  END IF;

  FOREACH v_domain IN ARRAY v_domains LOOP
    SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets
    WHERE name = (CASE v_domain WHEN 'dia' THEN 'dia_supabase_url' ELSE 'gov_supabase_url' END);

    SELECT decrypted_secret INTO v_anon_key
    FROM vault.decrypted_secrets
    WHERE name = (CASE v_domain WHEN 'dia' THEN 'dia_supabase_anon_key' ELSE 'gov_supabase_anon_key' END);

    IF v_url IS NULL OR v_anon_key IS NULL THEN
      RAISE NOTICE 'lcc_sync_property_attributes(%): missing vault secret, skipping', v_domain;
      CONTINUE;
    END IF;

    IF v_domain = 'dia' THEN
      -- R11: repointed from raw properties to the rent-bearing view (same column
      -- names + annual_rent + noi). Stops pulling the raw table (audit posture).
      v_url_path := '/rest/v1/v_property_attributes_portfolio';
      v_select_cols := 'property_id,address,city,state,zip_code,county,latitude,longitude,building_size,year_built,year_renovated,building_type,property_type,tenant,operator,annual_rent,noi';
      v_max_pages := 14;
    ELSE
      v_url_path := '/rest/v1/v_property_attributes_portfolio';
      v_select_cols := 'property_id,address,city,state,zip_code,county,metro_area,latitude,longitude,building_size_sqft,land_acres,year_built,year_renovated,building_type,tenant_short,tenant_label,lease_commencement,lease_expiration,firm_term_remaining,term_remaining,annual_rent,noi';
      v_max_pages := 18;
    END IF;

    v_pages_fired := 0;
    FOR v_page IN 0..v_max_pages LOOP
      SELECT net.http_get(
        url := v_url || v_url_path
          || '?select=' || v_select_cols
          || '&order=property_id.asc'
          || '&limit=1000&offset=' || (v_page * 1000),
        headers := jsonb_build_object(
          'apikey', v_anon_key,
          'Authorization', 'Bearer ' || v_anon_key
        )
      ) INTO v_request_id;

      INSERT INTO public.lcc_property_attribute_sync_inflight
        (request_id, source_domain, page_offset)
      VALUES (v_request_id, v_domain, v_page * 1000);

      v_pages_fired := v_pages_fired + 1;
    END LOOP;

    domain := v_domain;
    pages_fired := v_pages_fired;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_sync_property_attributes(text) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. Finalize: write annual_rent + noi on both legs (federal-signal columns
--    are untouched — they ride a separate sync and are absent from this upsert).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_finalize_property_attributes()
RETURNS TABLE(domain text, finalized_requests int, rows_upserted int) AS $$
#variable_conflict use_column
DECLARE
  v_finalized int;
  v_upserted int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.lcc_property_attribute_sync_inflight WHERE source_domain = 'dia') THEN
    WITH consumed AS (
      SELECT i.request_id, r.content
      FROM public.lcc_property_attribute_sync_inflight i
      JOIN net._http_response r ON r.id = i.request_id
      WHERE i.source_domain = 'dia' AND r.status_code = 200
    ),
    rows AS (
      SELECT jsonb_array_elements(content::jsonb) AS row FROM consumed
    ),
    upsert AS (
      INSERT INTO public.lcc_property_attributes (
        source_domain, source_property_id,
        address, city, state, postal_code, county,
        latitude, longitude, building_size_sqft,
        year_built, year_renovated, building_type,
        asset_class, tenant_short, tenant_label,
        annual_rent, noi,
        updated_at
      )
      SELECT
        'dia', (row->>'property_id')::text,
        row->>'address', row->>'city', row->>'state', row->>'zip_code', row->>'county',
        NULLIF(row->>'latitude','')::numeric, NULLIF(row->>'longitude','')::numeric,
        NULLIF(row->>'building_size','')::numeric,
        NULLIF(row->>'year_built','')::int,
        NULLIF(row->>'year_renovated','')::int,
        COALESCE(row->>'building_type', row->>'property_type'),
        'dialysis',
        row->>'tenant', row->>'operator',
        NULLIF(row->>'annual_rent','')::numeric, NULLIF(row->>'noi','')::numeric,
        now()
      FROM rows
      WHERE row->>'property_id' IS NOT NULL
      ON CONFLICT (source_domain, source_property_id) DO UPDATE SET
        address = COALESCE(EXCLUDED.address, public.lcc_property_attributes.address),
        city = COALESCE(EXCLUDED.city, public.lcc_property_attributes.city),
        state = COALESCE(EXCLUDED.state, public.lcc_property_attributes.state),
        postal_code = COALESCE(EXCLUDED.postal_code, public.lcc_property_attributes.postal_code),
        county = COALESCE(EXCLUDED.county, public.lcc_property_attributes.county),
        latitude = COALESCE(EXCLUDED.latitude, public.lcc_property_attributes.latitude),
        longitude = COALESCE(EXCLUDED.longitude, public.lcc_property_attributes.longitude),
        building_size_sqft = COALESCE(EXCLUDED.building_size_sqft, public.lcc_property_attributes.building_size_sqft),
        year_built = COALESCE(EXCLUDED.year_built, public.lcc_property_attributes.year_built),
        year_renovated = COALESCE(EXCLUDED.year_renovated, public.lcc_property_attributes.year_renovated),
        building_type = COALESCE(EXCLUDED.building_type, public.lcc_property_attributes.building_type),
        tenant_short = COALESCE(EXCLUDED.tenant_short, public.lcc_property_attributes.tenant_short),
        tenant_label = COALESCE(EXCLUDED.tenant_label, public.lcc_property_attributes.tenant_label),
        annual_rent = COALESCE(EXCLUDED.annual_rent, public.lcc_property_attributes.annual_rent),
        noi = COALESCE(EXCLUDED.noi, public.lcc_property_attributes.noi),
        updated_at = now()
      RETURNING 1
    ),
    cleanup AS (
      DELETE FROM public.lcc_property_attribute_sync_inflight
      WHERE request_id IN (SELECT request_id FROM consumed)
      RETURNING 1
    )
    SELECT (SELECT COUNT(*) FROM consumed), (SELECT COUNT(*) FROM upsert)
    INTO v_finalized, v_upserted;

    domain := 'dia';
    finalized_requests := v_finalized;
    rows_upserted := v_upserted;
    RETURN NEXT;
  END IF;

  IF EXISTS (SELECT 1 FROM public.lcc_property_attribute_sync_inflight WHERE source_domain = 'gov') THEN
    WITH consumed AS (
      SELECT i.request_id, r.content
      FROM public.lcc_property_attribute_sync_inflight i
      JOIN net._http_response r ON r.id = i.request_id
      WHERE i.source_domain = 'gov' AND r.status_code = 200
    ),
    rows AS (
      SELECT jsonb_array_elements(content::jsonb) AS row FROM consumed
    ),
    upsert AS (
      INSERT INTO public.lcc_property_attributes (
        source_domain, source_property_id,
        address, city, state, postal_code, county, metro_area,
        latitude, longitude, building_size_sqft, land_acres,
        year_built, year_renovated, building_type,
        asset_class, tenant_short, tenant_label,
        lease_commencement, lease_expiration, firm_term_remaining, term_remaining,
        annual_rent, noi,
        updated_at
      )
      SELECT
        'gov', (row->>'property_id')::text,
        row->>'address', row->>'city', row->>'state', row->>'zip_code', row->>'county', row->>'metro_area',
        NULLIF(row->>'latitude','')::numeric, NULLIF(row->>'longitude','')::numeric,
        NULLIF(row->>'building_size_sqft','')::numeric, NULLIF(row->>'land_acres','')::numeric,
        NULLIF(row->>'year_built','')::int, NULLIF(row->>'year_renovated','')::int,
        row->>'building_type', 'government',
        row->>'tenant_short', row->>'tenant_label',
        NULLIF(row->>'lease_commencement','')::date,
        NULLIF(row->>'lease_expiration','')::date,
        NULLIF(row->>'firm_term_remaining','')::numeric,
        NULLIF(row->>'term_remaining','')::numeric,
        NULLIF(row->>'annual_rent','')::numeric, NULLIF(row->>'noi','')::numeric,
        now()
      FROM rows
      WHERE row->>'property_id' IS NOT NULL
      ON CONFLICT (source_domain, source_property_id) DO UPDATE SET
        address = COALESCE(EXCLUDED.address, public.lcc_property_attributes.address),
        city = COALESCE(EXCLUDED.city, public.lcc_property_attributes.city),
        state = COALESCE(EXCLUDED.state, public.lcc_property_attributes.state),
        postal_code = COALESCE(EXCLUDED.postal_code, public.lcc_property_attributes.postal_code),
        county = COALESCE(EXCLUDED.county, public.lcc_property_attributes.county),
        metro_area = COALESCE(EXCLUDED.metro_area, public.lcc_property_attributes.metro_area),
        latitude = COALESCE(EXCLUDED.latitude, public.lcc_property_attributes.latitude),
        longitude = COALESCE(EXCLUDED.longitude, public.lcc_property_attributes.longitude),
        building_size_sqft = COALESCE(EXCLUDED.building_size_sqft, public.lcc_property_attributes.building_size_sqft),
        land_acres = COALESCE(EXCLUDED.land_acres, public.lcc_property_attributes.land_acres),
        year_built = COALESCE(EXCLUDED.year_built, public.lcc_property_attributes.year_built),
        year_renovated = COALESCE(EXCLUDED.year_renovated, public.lcc_property_attributes.year_renovated),
        building_type = COALESCE(EXCLUDED.building_type, public.lcc_property_attributes.building_type),
        tenant_short = COALESCE(EXCLUDED.tenant_short, public.lcc_property_attributes.tenant_short),
        tenant_label = COALESCE(EXCLUDED.tenant_label, public.lcc_property_attributes.tenant_label),
        lease_commencement = COALESCE(EXCLUDED.lease_commencement, public.lcc_property_attributes.lease_commencement),
        lease_expiration = COALESCE(EXCLUDED.lease_expiration, public.lcc_property_attributes.lease_expiration),
        firm_term_remaining = COALESCE(EXCLUDED.firm_term_remaining, public.lcc_property_attributes.firm_term_remaining),
        term_remaining = COALESCE(EXCLUDED.term_remaining, public.lcc_property_attributes.term_remaining),
        annual_rent = COALESCE(EXCLUDED.annual_rent, public.lcc_property_attributes.annual_rent),
        noi = COALESCE(EXCLUDED.noi, public.lcc_property_attributes.noi),
        updated_at = now()
      RETURNING 1
    ),
    cleanup AS (
      DELETE FROM public.lcc_property_attribute_sync_inflight
      WHERE request_id IN (SELECT request_id FROM consumed)
      RETURNING 1
    )
    SELECT (SELECT COUNT(*) FROM consumed), (SELECT COUNT(*) FROM upsert)
    INTO v_finalized, v_upserted;

    domain := 'gov';
    finalized_requests := v_finalized;
    rows_upserted := v_upserted;
    RETURN NEXT;
  END IF;

  DELETE FROM public.lcc_property_attribute_sync_inflight
  WHERE issued_at < NOW() - interval '24 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_finalize_property_attributes() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. Enriched view: append representative-property rent + coalesced rank value.
--    (CREATE OR REPLACE is append-only — the 3 new columns go at the end.)
--    rank_annual_rent = rollup rent, else representative-property rent, else the
--    P-BUYER SPE rollup. This is what the operator console should ORDER BY.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_priority_queue_enriched
WITH (security_invoker = true) AS
SELECT
  q.entity_id,
  q.name,
  q.workspace_id,
  CASE q.vertical WHEN 'dialysis' THEN 'dia' WHEN 'government' THEN 'gov' ELSE q.vertical END AS vertical,
  q.owner_user_id,
  q.contact_id,
  q.bd_opportunity_id,
  q.priority_band,
  q.reason,
  q.next_touch_due,
  q.days_overdue,
  q.last_touch_at,
  q.last_touch_type,
  q.effective_owner_role,
  q.owner_role_confidence,
  COALESCE(p.total_property_count, 0::bigint)   AS total_property_count,
  COALESCE(p.current_property_count, 0::bigint) AS current_property_count,
  COALESCE(p.dia_property_count, 0::bigint)     AS dia_property_count,
  COALESCE(p.gov_property_count, 0::bigint)     AS gov_property_count,
  COALESCE(p.is_cross_vertical, false)          AS is_cross_vertical,
  p.earliest_acquisition_date,
  p.latest_acquisition_date,
  p.latest_disposition_date,
  COALESCE(p.current_annual_rent_total, 0::numeric) AS current_annual_rent_total,
  p.avg_cap_rate,
  CASE q.source_domain WHEN 'dialysis' THEN 'dia' WHEN 'government' THEN 'gov' ELSE q.source_domain END AS source_domain,
  q.source_property_id,
  pa.address            AS source_property_address,
  pa.city               AS source_property_city,
  pa.state              AS source_property_state,
  pa.lease_expiration   AS source_property_lease_expiration,
  pa.firm_term_remaining AS source_property_firm_term_remaining,
  pa.term_remaining     AS source_property_term_remaining,
  br.spe_count             AS buyer_spe_count,
  br.rollup_property_count AS buyer_rollup_property_count,
  br.rollup_annual_rent    AS buyer_rollup_annual_rent,
  br.last_acquisition_date AS buyer_last_acquisition_date,
  br.sf_account_id         AS buyer_sf_account_id,
  br.needs_sf_mapping      AS buyer_needs_sf_mapping,
  rs.resolve_reason,
  rs.true_owner_name AS resolve_true_owner_name,
  rs.is_connected    AS resolve_is_connected,
  -- R11 Unit 2 (appended): representative-property rent + coalesced rank value.
  pa.annual_rent AS source_property_rent,
  pa.noi         AS source_property_noi,
  COALESCE(
    NULLIF(COALESCE(p.current_annual_rent_total, 0::numeric), 0::numeric),
    NULLIF(pa.annual_rent, 0::numeric),
    NULLIF(br.rollup_annual_rent, 0::numeric)
  ) AS rank_annual_rent
FROM v_priority_queue q
LEFT JOIN v_entity_portfolio_all p ON p.entity_id = q.entity_id
LEFT JOIN lcc_property_attributes pa ON pa.source_domain = q.source_domain AND pa.source_property_id = q.source_property_id
LEFT JOIN v_lcc_buyer_parent_rollup br ON q.priority_band = 'P-BUYER'::text AND br.parent_entity_id = q.entity_id
LEFT JOIN LATERAL (
  SELECT tof.true_owner_name,
         conn.is_connected,
         CASE
           WHEN conn.is_connected THEN 'connected'::text
           WHEN tof.true_owner_name IS NOT NULL AND lower(tof.true_owner_name) <> lower(q.name) THEN 'true_owner_known_connect'::text
           WHEN lcc_is_spe_shell_name(q.name) THEN 'recorded_owner_shell_true_owner_unresolved'::text
           ELSE 'owner_known_connect'::text
         END AS resolve_reason
  FROM (
    SELECT (EXISTS (SELECT 1 FROM external_identities ei
                     WHERE ei.entity_id = q.entity_id AND ei.source_system = 'salesforce'::text))
        OR (EXISTS (SELECT 1 FROM entity_relationships er
                     JOIN entities pe ON pe.id = er.to_entity_id AND pe.entity_type = 'person'::entity_type
                    WHERE er.from_entity_id = q.entity_id))
        OR (EXISTS (SELECT 1 FROM entity_relationships er
                     JOIN entities pe ON pe.id = er.from_entity_id AND pe.entity_type = 'person'::entity_type
                    WHERE er.to_entity_id = q.entity_id)) AS is_connected
  ) conn
  LEFT JOIN LATERAL (
    SELECT pof.true_owner_name
    FROM lcc_entity_portfolio_facts pf
    JOIN lcc_property_owner_facts pof ON pof.source_domain = pf.source_domain AND pof.source_property_id = pf.source_property_id
    WHERE pf.entity_id = q.entity_id AND pf.is_current = true
    ORDER BY pf.ownership_start_date DESC NULLS LAST
    LIMIT 1
  ) tof ON true
) rs ON true
WHERE q.entity_id IS NOT NULL
  AND CASE q.vertical WHEN 'dialysis' THEN 'dia' WHEN 'government' THEN 'gov' ELSE q.vertical END IS NOT NULL;

GRANT SELECT ON public.v_priority_queue_enriched TO authenticated;

COMMIT;
