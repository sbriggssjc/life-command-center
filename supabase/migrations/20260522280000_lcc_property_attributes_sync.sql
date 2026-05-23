-- Topic 12 (audit §11.28): LCC property attribute sync from dia/gov.
--
-- A10 Lanes 2+3 and future priority queue bands need property-level
-- attributes (lat/lng, size, year, asset type, market) that the
-- §11.23 portfolio sync didn't pull. This topic adds the schema,
-- sync functions, and initial backfill.
--
-- Companion: government/20260522280000_gov_v_property_attributes
-- _portfolio.sql exposes the slim anon-readable view that the gov
-- branch pulls from. dia.properties is already anon-readable.

BEGIN;

CREATE TABLE IF NOT EXISTS public.lcc_property_attributes (
  source_domain      text NOT NULL CHECK (source_domain IN ('dia','gov')),
  source_property_id text NOT NULL,
  address            text,
  city               text,
  state              text,
  postal_code        text,
  county             text,
  metro_area         text,
  latitude           numeric,
  longitude          numeric,
  building_size_sqft numeric,
  land_acres         numeric,
  year_built         int,
  year_renovated     int,
  building_type      text,
  asset_class        text,   -- 'dialysis' | 'government' — derived from source_domain
  tenant_short       text,
  tenant_label       text,
  -- Only present for gov rows; dia leases live in a separate dia table
  lease_commencement date,
  lease_expiration   date,
  firm_term_remaining numeric,
  term_remaining     numeric,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_domain, source_property_id)
);

CREATE INDEX IF NOT EXISTS idx_lcc_property_attributes_metro
  ON public.lcc_property_attributes(metro_area);
CREATE INDEX IF NOT EXISTS idx_lcc_property_attributes_state_city
  ON public.lcc_property_attributes(state, city);
CREATE INDEX IF NOT EXISTS idx_lcc_property_attributes_latlng
  ON public.lcc_property_attributes(latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

COMMENT ON TABLE public.lcc_property_attributes IS
  'Structural property attributes synced from dia.properties + '
  'gov.v_property_attributes_portfolio. Unlocks A10 Lanes 2+3 '
  '(buyer-cohort and geographic-proximity fan-out) and future '
  'priority queue bands keyed on lease expiry, year_built, etc.';

CREATE TABLE IF NOT EXISTS public.lcc_property_attribute_sync_inflight (
  request_id    bigint PRIMARY KEY,
  source_domain text   NOT NULL CHECK (source_domain IN ('dia','gov')),
  page_offset   int    NOT NULL,
  issued_at     timestamptz NOT NULL DEFAULT now()
);

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
      v_url_path := '/rest/v1/properties';
      v_select_cols := 'property_id,address,city,state,zip_code,county,latitude,longitude,building_size,year_built,year_renovated,building_type,property_type,tenant,operator';
      v_max_pages := 14;  -- dia has ~13k properties
    ELSE
      v_url_path := '/rest/v1/v_property_attributes_portfolio';
      v_select_cols := 'property_id,address,city,state,zip_code,county,metro_area,latitude,longitude,building_size_sqft,land_acres,year_built,year_renovated,building_type,tenant_short,tenant_label,lease_commencement,lease_expiration,firm_term_remaining,term_remaining';
      v_max_pages := 18;  -- gov has ~17.7k properties
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

CREATE OR REPLACE FUNCTION public.lcc_finalize_property_attributes()
RETURNS TABLE(domain text, finalized_requests int, rows_upserted int) AS $$
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
        updated_at
      )
      SELECT
        'gov', (row->>'property_id')::text,
        row->>'address', row->>'city', row->>'state', row->>'zip_code', row->>'county', row->>'metro_area',
        NULLIF(row->>'latitude','')::numeric, NULLIF(row->>'longitude','')::numeric,
        NULLIF(row->>'building_size_sqft','')::numeric, NULLIF(row->>'land_acres','')::numeric,
        NULLIF(row->>'year_built','')::int, NULLIF(row->>'year_renovated','')::int,
        row->>'building_type',
        'government',
        row->>'tenant_short', row->>'tenant_label',
        NULLIF(row->>'lease_commencement','')::date,
        NULLIF(row->>'lease_expiration','')::date,
        NULLIF(row->>'firm_term_remaining','')::numeric,
        NULLIF(row->>'term_remaining','')::numeric,
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

COMMIT;
