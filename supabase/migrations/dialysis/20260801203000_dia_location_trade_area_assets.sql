-- Dossier v2 Location & Trade Area support for dialysis properties.
-- Additive only: dossier code treats these tables as optional caches and
-- renders "Not on file" when rows are absent.

CREATE TABLE IF NOT EXISTS public.property_static_map_cache (
  property_id       bigint NOT NULL REFERENCES public.properties(property_id) ON DELETE CASCADE,
  provider          text NOT NULL DEFAULT 'google_static_maps',
  cache_key         text NOT NULL,
  center_latitude   double precision NOT NULL,
  center_longitude  double precision NOT NULL,
  radius_miles      numeric[] NOT NULL DEFAULT ARRAY[1,3,5]::numeric[],
  image_data_uri    text NOT NULL,
  source_url_hash   text,
  map_notes         text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, cache_key)
);

COMMENT ON TABLE public.property_static_map_cache IS
  'Server-side Google Static Maps cache for dossier Location & Trade Area thumbnails. Stores rendered image data URIs; API keys are never persisted.';

CREATE TABLE IF NOT EXISTS public.property_nearby_national_tenants (
  property_id          bigint NOT NULL REFERENCES public.properties(property_id) ON DELETE CASCADE,
  place_id             text NOT NULL,
  tenant_name          text NOT NULL,
  vicinity             text,
  distance_miles       numeric,
  latitude             double precision,
  longitude            double precision,
  business_status      text,
  place_types          text[] NOT NULL DEFAULT ARRAY[]::text[],
  rating               numeric,
  user_ratings_total   integer,
  source               text NOT NULL DEFAULT 'google_places_nearbysearch',
  raw_result           jsonb,
  observed_at          timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, place_id)
);

COMMENT ON TABLE public.property_nearby_national_tenants IS
  'Stored Google Places pass for nearby national/credit tenant callouts in grounded dossiers. Tenant names render only from these rows.';

CREATE INDEX IF NOT EXISTS property_nearby_national_tenants_property_distance_idx
  ON public.property_nearby_national_tenants (property_id, distance_miles);

CREATE OR REPLACE FUNCTION public.dia_properties_missing_demographics()
RETURNS TABLE (
  property_id bigint,
  address text,
  city text,
  state text,
  zip_code text,
  latitude double precision,
  longitude double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT p.property_id, p.address, p.city, p.state, p.zip_code, p.latitude, p.longitude
  FROM public.properties p
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.property_demographics d
    WHERE d.property_id = p.property_id
  )
  ORDER BY p.property_id;
$$;

COMMENT ON FUNCTION public.dia_properties_missing_demographics() IS
  'Coverage audit helper for dossier radius demographics: dialysis properties with no property_demographics rows.';
